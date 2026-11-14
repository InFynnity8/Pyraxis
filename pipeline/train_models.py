"""Train every model behind the dashboard - all three fire-safety layers.

Run:  python pipeline/train_models.py            (after build_tests / build_detection / build_smoke_points)

Inputs : data/processed/tests.parquet, detection.parquet, smoke_points.parquet
Outputs: data/processed/models/*.joblib, data/processed/model_report.json + layers_report.json,
         dashboard/public/data/model.json (Predictions page) + layers.json (Fire-safety layers page)

PART A - SUPPRESSION (droplet flames, FLEX + CFI)
  burning_rate : GP regression, burning-rate constant K [mm^2/s] ~ O2, pressure, He, CO2, d0, fuel descriptors
  extinction_d : GP regression, flame-extinction droplet diameter [mm]
  outcome      : GP classifier, FLEX extinction vs disruption
  cool_flame   : GP classifier, CFI cool flame survives hot-flame extinction
  coverage     : test density over (O2, pressure) for all investigations -> data gaps
PART B - PREVENTION (BASS) and DETECTION (SAME, SAME-R, SPICE), plus the three-layer summary for the dashboard

Validation everywhere: grouped K-fold (by campaign / block of runs / ops day), never random splits,
always reported next to simple baselines (mean, linear/logistic, gradient boosting).
"""
import json, pathlib, re, warnings
import numpy as np
import pandas as pd
import joblib
from sklearn.gaussian_process import GaussianProcessRegressor, GaussianProcessClassifier
from sklearn.gaussian_process.kernels import RBF, WhiteKernel, ConstantKernel as C
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.model_selection import GroupKFold
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.metrics import mean_absolute_error, r2_score, roc_auc_score, accuracy_score
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.metrics import brier_score_loss

warnings.filterwarnings("ignore")
ROOT = pathlib.Path(__file__).resolve().parents[1]
TESTS = ROOT / "data/processed/tests.parquet"
OUTM = ROOT / "data/processed/models"
REPORT = ROOT / "data/processed/model_report.json"
DASH = ROOT / "dashboard/public/data/model.json"
DASH_DIR = ROOT / "dashboard/public/data"
P = ROOT / "data/processed"

# Habitat atmospheres (challenge statement + NASA nominal values). psi -> kPa = * 6.89476
HABITATS = {
    "Earth sea level": {"o2_pct": 20.9, "pressure_kpa": 101.3, "gravity": "1 g"},
    "ISS cabin": {"o2_pct": 21.0, "pressure_kpa": 101.3, "gravity": "microgravity"},
    "Moon base / rover (expected)": {"o2_pct": 34.0, "pressure_kpa": 10.2 * 6.89476, "gravity": "0.16 g"},
    "Mars habitat (assumed = Moon)": {"o2_pct": 34.0, "pressure_kpa": 10.2 * 6.89476, "gravity": "0.38 g"},
    "Spacesuit": {"o2_pct": 100.0, "pressure_kpa": 4.3 * 6.89476, "gravity": "varies"},
}
FEATURES = ["o2_frac", "pressure_kpa", "he_frac", "co2_frac", "droplet_d0_mm", "fuel_carbons", "is_alcohol", "branched_frac"]
# fuel -> (carbon atoms, alcohol?, branched fraction). Lets one model learn across FLEX and CFI fuels.
FUELS = {"methanol": (1, 1, 0.0), "heptane": (7, 0, 0.0), "n-dodecane": (12, 0, 0.0), "farnesane": (15, 0, 1.0),
         "n-dodecane / iso-dodecane blend": (12, 0, None)}


def droplet_frame(df):
    """FLEX (PSI-69) + CFI (PSI-39) single-droplet tests with measured outcomes."""
    d = df[df.accession.isin(["PSI-69", "PSI-39"]) & (df.row_kind == "test")].copy()
    fl = d.fuel.str.lower().str.strip()
    d["fuel_carbons"] = fl.map(lambda f: FUELS.get(f, (np.nan,))[0])
    d["is_alcohol"] = fl.map(lambda f: FUELS.get(f, (np.nan, np.nan))[1])
    d["branched_frac"] = fl.map(lambda f: FUELS.get(f, (np.nan, np.nan, np.nan))[2])
    blend = fl == "n-dodecane / iso-dodecane blend"
    d.loc[blend, "branched_frac"] = 1 - d.loc[blend, "n_fuel_frac"]
    flex = d.accession == "PSI-69"
    d.loc[flex, "group"] = "FLEX-" + d.loc[flex, "test_id"].str.extract(r"^(\d+[A-Z]+)")[0].fillna("other")  # campaign prefix
    d.loc[~flex, "group"] = "CFI-" + d.loc[~flex, "test_date"].astype(str).str[:7]                           # CFI by month
    return d


flex_frame = droplet_frame  # backward-compatible name used by the notebook


def gp_regressor():
    k = C(1.0) * RBF(length_scale=np.ones(len(FEATURES)), length_scale_bounds=(1e-2, 1e3)) + WhiteKernel(0.1, (1e-5, 10))
    return make_pipeline(StandardScaler(), GaussianProcessRegressor(kernel=k, normalize_y=True, n_restarts_optimizer=3, random_state=0))


def cv_regression(d, target):
    d = d.dropna(subset=FEATURES + [target])
    X, y, g = d[FEATURES].values, d[target].values, d.group.values
    n_splits = min(5, len(np.unique(g)))
    pred = {"gp": np.zeros_like(y), "boosting": np.zeros_like(y), "linear": np.zeros_like(y), "mean": np.zeros_like(y)}
    cover = []
    for tr, te in GroupKFold(n_splits).split(X, y, g):
        gp = gp_regressor().fit(X[tr], y[tr])
        mu, sd = gp.predict(X[te], return_std=True)
        pred["gp"][te] = mu
        cover += list(np.abs(y[te] - mu) <= 1.96 * sd)
        pred["boosting"][te] = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, min_samples_leaf=8, random_state=0).fit(X[tr], y[tr]).predict(X[te])
        pred["linear"][te] = make_pipeline(StandardScaler(), LinearRegression()).fit(X[tr], y[tr]).predict(X[te])
        pred["mean"][te] = y[tr].mean()
    metrics = {m: {"MAE": float(mean_absolute_error(y, p)), "R2": float(r2_score(y, p))} for m, p in pred.items()}
    metrics["gp"]["95%_interval_coverage"] = float(np.mean(cover))
    final = gp_regressor().fit(X, y)
    return final, metrics, len(y), n_splits


def cv_outcome(d, label=None):
    """Binary GP classifier. Default label: FLEX extinguished (1) vs disrupted (0).
    label='cool_flame': CFI - does a cool flame keep burning after the visible flame goes out (1/0)."""
    if label is None:
        d = d[(d.accession == "PSI-69") & d.outcome.isin(["extinguished", "disrupted"])].dropna(subset=FEATURES)
        yv = (d.outcome == "extinguished").astype(int).values
    else:
        d = d[d[label].isin([True, False])].dropna(subset=FEATURES)
        yv = d[label].astype(int).values
    X, y, g = d[FEATURES].values, yv, d.group.values
    n_splits = min(5, len(np.unique(g)))
    p_gp, p_lr = np.zeros(len(y)), np.zeros(len(y))
    for tr, te in GroupKFold(n_splits).split(X, y, g):
        if len(np.unique(y[tr])) < 2:
            p_gp[te] = p_lr[te] = y[tr].mean(); continue
        p_gp[te] = make_pipeline(StandardScaler(), GaussianProcessClassifier(1.0 * RBF(np.ones(len(FEATURES))), random_state=0)).fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
        p_lr[te] = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000)).fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
    safe_auc = lambda p: float(roc_auc_score(y, p)) if len(np.unique(y)) > 1 else None
    metrics = {"gp": {"AUC": safe_auc(p_gp), "accuracy": float(accuracy_score(y, p_gp > 0.5))},
               "logistic": {"AUC": safe_auc(p_lr), "accuracy": float(accuracy_score(y, p_lr > 0.5))},
               "majority_class_accuracy": float(max(y.mean(), 1 - y.mean()))}
    final = make_pipeline(StandardScaler(), GaussianProcessClassifier(1.0 * RBF(np.ones(len(FEATURES))), random_state=0)).fit(X, y)
    return final, metrics, len(y), n_splits


def coverage(df):
    """Gaussian-kernel test density over (O2 %, log pressure) for every row with both values."""
    d = df.dropna(subset=["o2_pct", "pressure_kpa"])
    o2 = np.linspace(10, 100, 46); p = np.geomspace(20, 520, 40)
    O, P = np.meshgrid(o2, p)
    dens = np.zeros_like(O)
    for a, b in zip(d.o2_pct.values, np.log(d.pressure_kpa.values)):
        dens += np.exp(-(((O - a) / 3.0) ** 2 + ((np.log(P) - b) / 0.12) ** 2) / 2)
    hab = {}
    for name, h in HABITATS.items():
        near = d[(abs(d.o2_pct - h["o2_pct"]) <= 5) & (abs(np.log(d.pressure_kpa / h["pressure_kpa"])) <= np.log(1.25))]
        hab[name] = {"tests_within_5pctO2_25pctP": int(len(near)),
                     "by_investigation": near.acronym.value_counts().to_dict()}
    return {"o2_pct": o2.round(2).tolist(), "pressure_kpa": p.round(2).tolist(), "density": dens.round(3).tolist()}, hab


def main_suppression():
    df = pd.read_parquet(TESTS)
    flex = flex_frame(df)
    OUTM.mkdir(parents=True, exist_ok=True)
    report = {"n_rows_total": int(len(df)), "validation": "GroupKFold by test campaign (FLEX campaign prefix, CFI test month)", "features": FEATURES, "models": {}}
    preds = {"habitats": {}, "grid": {}}

    targets = {"burning_rate": "burning_rate_mm2_s", "extinction_d": "extinction_d_mm"}
    fitted = {}
    for name, t in targets.items():
        m, met, n, k = cv_regression(flex, t)
        fitted[name] = m
        report["models"][name] = {"target": t, "n": n, "folds": k, "metrics": met}
        joblib.dump(m, OUTM / f"{name}.joblib")
        print(f"{name:14} n={n:3}  GP MAE={met['gp']['MAE']:.3f} R2={met['gp']['R2']:.2f} cov95={met['gp']['95%_interval_coverage']:.2f} | "
              f"boosting R2={met['boosting']['R2']:.2f} | linear R2={met['linear']['R2']:.2f} | mean R2={met['mean']['R2']:.2f}")

    m, met, n, k = cv_outcome(flex)
    fitted["outcome"] = m
    report["models"]["outcome"] = {"target": "P(extinguished vs disrupted)", "n": n, "folds": k, "metrics": met}
    joblib.dump(m, OUTM / "outcome.joblib")
    print(f"outcome        n={n:3}  GP AUC={met['gp']['AUC']} acc={met['gp']['accuracy']:.2f} | logistic AUC={met['logistic']['AUC']} | majority={met['majority_class_accuracy']:.2f}")

    m, met, n, k = cv_outcome(flex, "cool_flame")
    fitted["cool_flame"] = m
    report["models"]["cool_flame"] = {"target": "P(cool flame keeps burning after the hot flame goes out) - CFI", "n": n, "folds": k, "metrics": met}
    joblib.dump(m, OUTM / "cool_flame.joblib")
    print(f"cool_flame     n={n:3}  GP AUC={met['gp']['AUC']} acc={met['gp']['accuracy']:.2f} | logistic AUC={met['logistic']['AUC']} | majority={met['majority_class_accuracy']:.2f}")
    report["training_data"] = {k_: int(v) for k_, v in flex.accession.map({"PSI-69": "FLEX", "PSI-39": "CFI"}).value_counts().items()}

    # Predictions: habitat points (methanol, 2 mm droplet, N2 diluent) and an O2 x pressure grid
    def row(o2, p):
        return [o2 / 100, p, 0.0, 0.0, 2.0, 1.0, 1.0, 0.0]  # methanol: 1 carbon, alcohol, unbranched
    o2_range = flex[flex.accession == "PSI-69"].o2_frac.agg(["min", "max"]) * 100
    p_range = flex[flex.accession == "PSI-69"].pressure_kpa.agg(["min", "max"])
    for hname, h in HABITATS.items():
        x = np.array([row(h["o2_pct"], h["pressure_kpa"])])
        out = {"inside_training_range": bool(o2_range["min"] <= h["o2_pct"] <= o2_range["max"] and p_range["min"] <= h["pressure_kpa"] <= p_range["max"])}
        for name in targets:
            mu, sd = fitted[name].predict(x, return_std=True)
            out[name] = {"mean": float(mu[0]), "sd": float(sd[0])}
        # outcome model (FLEX): same methanol droplet -> P(flame goes out cleanly rather than droplet breaking up)
        out["p_clean_extinction"] = float(fitted["outcome"].predict_proba(x)[0, 1])
        # cool-flame model (CFI): reference CFI droplet = 4 mm n-dodecane, N2 diluent
        xc = np.array([[h["o2_pct"] / 100, h["pressure_kpa"], 0.0, 0.0, 4.0, 12.0, 0.0, 0.0]])
        cfi = flex[flex.accession == "PSI-39"]
        out["p_cool_flame"] = float(fitted["cool_flame"].predict_proba(xc)[0, 1])
        out["cool_flame_inside_range"] = bool(cfi.o2_frac.min() * 100 - 1 <= h["o2_pct"] <= cfi.o2_frac.max() * 100 + 1
                                              and cfi.pressure_kpa.min() <= h["pressure_kpa"] <= cfi.pressure_kpa.max())
        preds["habitats"][hname] = {**h, **out}
    preds["habitat_assumptions"] = {
        "burning_rate / extinction_d / p_clean_extinction": "2 mm methanol droplet, N2 diluent (FLEX conditions)",
        "p_cool_flame": "4 mm n-dodecane droplet, N2 diluent (CFI conditions)"}
    go2 = np.linspace(10, 50, 41); gp_ = np.linspace(40, 310, 28)
    G = np.array([row(a, b) for b in gp_ for a in go2])
    mu, sd = fitted["burning_rate"].predict(G, return_std=True)
    preds["grid"] = {"o2_pct": go2.round(2).tolist(), "pressure_kpa": gp_.round(1).tolist(),
                     "burning_rate_mean": mu.reshape(len(gp_), len(go2)).round(4).tolist(),
                     "burning_rate_sd": sd.reshape(len(gp_), len(go2)).round(4).tolist(),
                     "assumptions": "methanol droplet, d0 = 2 mm, N2 diluent (FLEX-1 conditions)"}
    preds["coverage"], report["habitat_coverage"] = coverage(df)
    preds["training_range"] = {"o2_pct": o2_range.round(1).tolist(), "pressure_kpa": p_range.round(1).tolist()}
    preds["report"] = report

    REPORT.write_text(json.dumps(report, indent=2))
    DASH.write_text(json.dumps(preds))
    print("\nHabitat predictions (burning-rate K, mm^2/s):")
    for k_, v in preds["habitats"].items():
        print(f"  {k_:32} K={v['burning_rate']['mean']:.3f} ± {1.96*v['burning_rate']['sd']:.3f}  in-range={v['inside_training_range']}")
    print("\nTests near each habitat atmosphere (±5% O2, ±25% P):")
    for k_, v in report["habitat_coverage"].items():
        print(f"  {k_:32} {v['tests_within_5pctO2_25pctP']:4}  {v['by_investigation']}")


# ======================================================================
# PART B - PREVENTION + DETECTION + three-layer summary
# ======================================================================
DETECTORS = {"iss_obscuration": "ISS photoelectric (obscuration)", "iss_scatter": "ISS photoelectric (scatter)",
             "ion_a": "Ionisation A", "ion_b": "Ionisation B", "sts": "Shuttle (STS) detector"}


def onehot(s, cats):
    return np.column_stack([(s == c).astype(float) for c in cats])


def gp_reg(nf):
    k = C(1.0) * RBF(np.ones(nf), (1e-2, 1e3)) + WhiteKernel(0.1, (1e-5, 10))
    return make_pipeline(StandardScaler(), GaussianProcessRegressor(kernel=k, normalize_y=True, n_restarts_optimizer=2, random_state=0))


def gp_clf(nf):
    return make_pipeline(StandardScaler(), GaussianProcessClassifier(1.0 * RBF(np.ones(nf)), random_state=0))


def cv_reg(X, y, g, k=5):
    k = min(k, len(np.unique(g)))
    pr = {m: np.zeros_like(y) for m in ["gp", "boosting", "linear", "mean"]}; cover = []
    for tr, te in GroupKFold(k).split(X, y, g):
        mu, sd = gp_reg(X.shape[1]).fit(X[tr], y[tr]).predict(X[te], return_std=True)
        pr["gp"][te] = mu; cover += list(np.abs(y[te] - mu) <= 1.96 * sd)
        pr["boosting"][te] = HistGradientBoostingRegressor(max_iter=200, learning_rate=0.05, min_samples_leaf=5, random_state=0).fit(X[tr], y[tr]).predict(X[te])
        pr["linear"][te] = make_pipeline(StandardScaler(), LinearRegression()).fit(X[tr], y[tr]).predict(X[te])
        pr["mean"][te] = y[tr].mean()
    met = {m: {"MAE": float(mean_absolute_error(y, p)), "R2": float(r2_score(y, p))} for m, p in pr.items()}
    met["gp"]["95%_interval_coverage"] = float(np.mean(cover))
    return met, k


def cv_clf(X, y, g, k=5):
    k = min(k, len(np.unique(g)))
    pg, pl = np.zeros(len(y)), np.zeros(len(y))
    for tr, te in StratifiedGroupKFold(k, shuffle=True, random_state=0).split(X, y, g):
        if len(np.unique(y[tr])) < 2:
            pg[te] = pl[te] = y[tr].mean(); continue
        pg[te] = gp_clf(X.shape[1]).fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
        pl[te] = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=0.5)).fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
    auc = lambda p: float(roc_auc_score(y, p)) if len(np.unique(y)) > 1 else None
    return {"gp": {"AUC": auc(pg), "accuracy": float(accuracy_score(y, pg > .5)), "brier": float(brier_score_loss(y, pg))},
            "logistic": {"AUC": auc(pl), "accuracy": float(accuracy_score(y, pl > .5))},
            "majority_class_accuracy": float(max(y.mean(), 1 - y.mean())),
            "base_rate_brier": float(brier_score_loss(y, np.full(len(y), y.mean())))}, k


# ---------------------------------------------------------------- Prevention (BASS)
def prevention(tests):
    b = tests[(tests.accession == "PSI-26") & tests.outcome.isin(["burned", "no ignition", "ignited, not self-sustaining"])].copy()
    b = b.dropna(subset=["o2_frac", "flow_cm_s"])
    mats = ["PMMA (acrylic)", "wax", "SIBAL (cotton/fiberglass)", "Nomex (aramid fabric)"]
    b["material_group"] = b.material_class.where(b.material_class.isin(mats), "other")
    geo = ["sphere", "flat sheet/fabric", "slab", "candle", "rod/cylinder"]
    size = b.sample_size_cm.fillna(b.sample_size_cm.median())
    X = np.column_stack([b.o2_frac * 100, b.flow_cm_s, size, onehot(b.material_group, mats), onehot(b.geometry, geo)])
    names = ["o2_pct", "flow_cm_s", "size_cm"] + [f"mat:{m}" for m in mats] + [f"shape:{s}" for s in geo]
    y = (b.outcome == "burned").astype(int).values
    g = b.test_id.astype(str).str.extract(r"(\d+)")[0].fillna("0").astype(int).floordiv(10).values  # blocks of 10 consecutive runs
    met, k = cv_clf(X, y, g)
    final = gp_clf(X.shape[1]).fit(X, y); joblib.dump({"model": final, "features": names}, OUTM / "prevention_sustained_burn.joblib")

    # what-if curves: P(sustained burn) vs air flow for each material at ISS O2 (21%), median size, its commonest shape
    flows = np.linspace(0, 20, 41); curves = {}
    for m in mats:
        sub = b[b.material_group == m]
        if len(sub) < 3:
            continue
        shp = sub.geometry.mode()[0]; sz = sub.sample_size_cm.median() if sub.sample_size_cm.notna().any() else size.median()
        Xg = np.column_stack([np.full(len(flows), 21.0), flows, np.full(len(flows), sz),
                              onehot(pd.Series([m] * len(flows)), mats), onehot(pd.Series([shp] * len(flows)), geo)])
        curves[m] = {"shape": shp, "size_cm": float(sz), "p_burn": final.predict_proba(Xg)[:, 1].round(3).tolist()}
    table = []
    for m, sub in b.groupby("material_group"):
        lf = sub[sub.extinguished_by == "low flow"].flow_min_cm_s
        # model prediction for this material in ISS air (21 % O2) at its typical test flow, size and shape
        shp = sub.geometry.mode()[0]; sz = sub.sample_size_cm.median() if sub.sample_size_cm.notna().any() else size.median()
        xm = np.column_stack([[21.0], [sub.flow_cm_s.median()], [sz], onehot(pd.Series([m]), mats), onehot(pd.Series([shp]), geo)])
        table.append({"material": m, "tests": int(len(sub)), "sustained": int((sub.outcome == "burned").sum()),
                      "model_p_burn_iss_air": float(final.predict_proba(xm)[0, 1]),
                      "did_not_sustain": int((sub.outcome != "burned").sum()),
                      "lowest_o2_pct_that_burned": float(sub[sub.outcome == "burned"].o2_frac.min() * 100) if (sub.outcome == "burned").any() else None,
                      "extinguished_by_low_flow": int(len(lf)), "flow_at_low_flow_extinction_cm_s": float(lf.median()) if len(lf) else None,
                      "extinguished_by_n2": int((sub.extinguished_by == "N2").sum())})
    return {"question": "Will this solid keep burning once lit, in ISS-like air?", "source": "BASS (PSI-26) crew observations, as-run test matrix",
            "n": int(len(y)), "positives": int(y.sum()), "folds": k, "features": names, "metrics": met,
            "flow_cm_s": flows.round(2).tolist(), "curves": curves, "materials": table,
            "points": [{"material": r.material, "o2_pct": round(float(r.o2_frac) * 100, 2), "flow_cm_s": float(r.flow_cm_s),
                        "burned": bool(r.outcome == "burned"), "notes": str(r.notes)[:200]} for r in b.itertuples()],
            "limits": (f"Labels hand-audited from every crew note. Only {int(len(y) - y.sum())} of {len(y)} tests failed to keep burning, "
                       "all at 16-23 % O2 and ~1 atm, and the model learns mostly from material type (Nomex rarely sustained a flame). "
                       + ("Its probabilities beat the base rate (lower Brier score). " if met["gp"]["brier"] < met["base_rate_brier"]
                          else "Its probabilities are not yet better than the base rate. ")
                       + "It cannot speak to Moon/Mars atmospheres: no solid was tested above 23 % O2 in the public archive.")}


# ---------------------------------------------------------------- Detection (SAME / SAME-R, SPICE)
def detection():
    d = pd.read_parquet(P / "detection.parquet")
    resp_cols = [c for c in d.columns if c.endswith("_responded")]
    by_mat = []
    for m, sub in d.dropna(subset=["material"]).groupby("material"):
        r = {"material": m, "tests": int(len(sub)),
             "smoke_mass_mg_m3_median": float(sub.dusttrak_peak_mg_m3.median()) if sub.dusttrak_peak_mg_m3.notna().any() else None,
             "particle_count_per_cc_median": float(sub.ptrak_peak_per_cc.median()) if sub.ptrak_peak_per_cc.notna().any() else None,
             "diameter_index_um_median": float(sub.mean_diameter_index_um.median()) if sub.mean_diameter_index_um.notna().any() else None}
        for c in resp_cols:
            k = c.replace("_responded", "")
            v = sub[c].dropna()
            r[f"{k}_response_rate"] = float(v.mean()) if len(v) else None
        by_mat.append(r)

    # model: log10 smoke mass from test conditions (SAME-R rows that have the conditions table)
    s = d.dropna(subset=["heater_rt_r0", "inlet_flow_cm_s", "aging_s", "dusttrak_peak_mg_m3", "material"]).copy()
    s = s[s.dusttrak_peak_mg_m3 > 0]
    mats = sorted(s.material.unique())
    X = np.column_stack([s.heater_rt_r0, s.inlet_flow_cm_s, np.log10(s.aging_s.clip(lower=1)), onehot(s.material, mats)])
    y = np.log10(s.dusttrak_peak_mg_m3.values)
    g = s.test_no.astype(int).floordiv(10).values
    smoke_met, k = cv_reg(X, y, g) if len(s) >= 15 else ({}, 0)
    mass_pred = []
    if len(s) >= 15:
        mm = gp_reg(X.shape[1]).fit(X, y)
        joblib.dump({"model": mm, "features": ["heater_rt_r0", "inlet_flow_cm_s", "log10_aging_s"] + mats},
                    OUTM / "detection_smoke_mass.joblib")
        # predicted smoke mass per material at its own lowest / typical / highest tested heater level (flow 8.1 cm/s, typical aging)
        for m in mats:
            sub = s[s.material == m]
            levels = {"low": sub.heater_rt_r0.min(), "typical": sub.heater_rt_r0.median(), "high": sub.heater_rt_r0.max()}
            row = {"material": m, "tests": int(len(sub))}
            for lev, r in levels.items():
                xm = np.column_stack([[r], [8.1], [np.log10(sub.aging_s.median())], onehot(pd.Series([m]), mats)])
                mu, sd = mm.predict(xm, return_std=True)
                row[lev] = {"heater_rt_r0": float(r), "mg_m3": float(10 ** mu[0]),
                            "lo": float(10 ** (mu[0] - 1.96 * sd[0])), "hi": float(10 ** (mu[0] + 1.96 * sd[0]))}
            mass_pred.append(row)

    sp = pd.read_parquet(P / "smoke_points.parquet").dropna(subset=["nozzle_mm", "air_velocity_cm_s", "smoke_point_mm"])
    fuels = ["ethylene", "propane", "propylene"]
    Xs = np.column_stack([onehot(sp.fuel, fuels), sp.fuel_mole_frac, sp.nozzle_mm, sp.air_velocity_cm_s])
    ys = sp.smoke_point_mm.values
    gs = sp.gmt_day.fillna(0).astype(int).values  # one ISS operations day per group
    sp_met, ks = cv_reg(Xs, ys, gs)
    spm = gp_reg(Xs.shape[1]).fit(Xs, ys)
    joblib.dump({"model": spm, "features": fuels + ["fuel_mole_frac", "nozzle_mm", "air_velocity_cm_s"]}, OUTM / "detection_smoke_point.joblib")
    sp_tab = sp.groupby(["fuel", "fuel_mole_frac"]).smoke_point_mm.agg(["count", "median", "min", "max"]).round(1).reset_index().to_dict("records")
    # what-if curves: smoke point vs air speed for each fuel mix, 1.6 mm burner, only across the air speeds actually flown
    sp_curves = []
    for (fu, xf), sub in sp.groupby(["fuel", "fuel_mole_frac"]):
        ua = np.linspace(sub.air_velocity_cm_s.min(), sub.air_velocity_cm_s.max(), 25)
        Xc = np.column_stack([onehot(pd.Series([fu] * len(ua)), fuels), np.full(len(ua), xf), np.full(len(ua), 1.6002), ua])
        mu, sd = spm.predict(Xc, return_std=True)
        sp_curves.append({"fuel": fu, "fuel_mole_frac": float(xf), "air_cm_s": ua.round(1).tolist(), "mean": mu.round(1).tolist(),
                          "lo": (mu - 1.96 * sd).round(1).tolist(), "hi": (mu + 1.96 * sd).round(1).tolist(),
                          "points": sub[["air_velocity_cm_s", "smoke_point_mm", "nozzle_mm"]].round(2).values.tolist()})

    return {"question": "Which materials make smoke that today's detectors can see, and how much?",
            "source": "SAME (PSI-102), SAME-R (PSI-101) instrument logs; SPICE (PSI-107) smoke-point datasheet",
            "smoke_tests": int(len(d)), "detectors": DETECTORS, "by_material": by_mat,
            "smoke_mass_model": {"target": "log10 peak smoke mass (DustTrak, mg/m3)", "n": int(len(s)), "folds": k, "metrics": smoke_met,
                                 "features": ["heater level (Rt/R0)", "inlet flow", "aging time", "material"]},
            "smoke_point_model": {"target": "smoke-point flame length (mm)", "n": int(len(ys)), "folds": ks, "metrics": sp_met},
            "smoke_points": sp_tab, "smoke_point_curves": sp_curves, "smoke_mass_predictions": mass_pred,
            "limits": "Detector 'response' = signal change > max(10x baseline noise, fixed floor); alarm thresholds of flight "
                      "detectors are not in the data. Particle diameter is a mass/number index (unit density), not a sizing measurement."}


# ---------------------------------------------------------------- Suppression summary
def suppression(tests):
    m = json.loads((DASH_DIR / "model.json").read_text())
    flex = tests[tests.accession == "PSI-69"]
    dil = flex[flex.outcome.isin(["extinguished", "disrupted"])].groupby("diluent").agg(
        tests=("outcome", "size"), extinguished=("outcome", lambda s: int((s == "extinguished").sum())),
        median_extinction_d_mm=("extinction_d_mm", "median")).reset_index()
    cfi = tests[(tests.accession == "PSI-39") & tests.cool_flame.isin([True, False])]
    bass = tests[(tests.accession == "PSI-26")]
    return {"question": "Does this atmosphere or agent put the flame out - and does it stay out?",
            "source": "FLEX (PSI-69) + CFI (PSI-39) droplet tests; BASS (PSI-26) nitrogen-flood observations",
            "models": m["report"]["models"], "training_data": m["report"].get("training_data"),
            "diluents": dil.replace({np.nan: None}).to_dict("records"),
            "cool_flame": {"tests": int(len(cfi)), "cool_flame_after_hot_extinction": int(cfi.cool_flame.astype(bool).sum()),
                           "reignitions_tests": int((tests[tests.accession == "PSI-39"].reignitions.fillna(0) > 0).sum())},
            "nitrogen_on_solids": {"tests_extinguished_by_n2": int((bass.extinguished_by == "N2").sum()),
                                   "tests_extinguished_by_low_flow": int((bass.extinguished_by == "low flow").sum()),
                                   "tests_burned_out": int((bass.extinguished_by == "burnout").sum()),
                                   # n2_jet: crew aimed the GN2 line at a burning sample (hand-audited from the notes)
                                   "n2_jet_attempts": int(bass.n2_jet.isin(["extinguished", "partial", "failed"]).sum()) if "n2_jet" in bass else 0,
                                   "n2_jet_extinguished": int((bass.n2_jet == "extinguished").sum()) if "n2_jet" in bass else 0,
                                   "n2_jet_partial": int((bass.n2_jet == "partial").sum()) if "n2_jet" in bass else 0,
                                   "labels": "hand-audited from all 122 BASS crew notes (pipeline/labels/bass_label_audit.csv)"}}


def main_layers():
    OUTM.mkdir(parents=True, exist_ok=True)
    tests = pd.read_parquet(P / "tests.parquet")
    out = {"prevention": prevention(tests), "detection": detection(), "suppression": suppression(tests)}
    (DASH_DIR / "layers.json").write_text(json.dumps(out, default=float))
    rep = {k: {kk: vv for kk, vv in v.items() if kk in ("n", "positives", "folds", "metrics", "smoke_mass_model", "smoke_point_model", "models", "training_data")} for k, v in out.items()}
    (P / "layers_report.json").write_text(json.dumps(rep, indent=2, default=float))
    pv, dt = out["prevention"], out["detection"]
    print(f"PREVENTION  P(sustained burn) n={pv['n']} (pos {pv['positives']})  GP AUC={pv['metrics']['gp']['AUC']:.2f} brier={pv['metrics']['gp']['brier']:.3f} "
          f"(base {pv['metrics']['base_rate_brier']:.3f}) | logistic AUC={pv['metrics']['logistic']['AUC']:.2f}")
    sm = dt["smoke_mass_model"]
    if sm["metrics"]:
        print(f"DETECTION   smoke mass n={sm['n']}  GP R2={sm['metrics']['gp']['R2']:.2f} MAE={sm['metrics']['gp']['MAE']:.2f} dex | boosting R2={sm['metrics']['boosting']['R2']:.2f} | linear R2={sm['metrics']['linear']['R2']:.2f}")
    spm = dt["smoke_point_model"]
    print(f"DETECTION   smoke point n={spm['n']}  GP R2={spm['metrics']['gp']['R2']:.2f} MAE={spm['metrics']['gp']['MAE']:.1f} mm cov95={spm['metrics']['gp']['95%_interval_coverage']:.2f} | boosting R2={spm['metrics']['boosting']['R2']:.2f} | linear R2={spm['metrics']['linear']['R2']:.2f}")
    print("materials (prevention):"); [print("  ", r) for r in pv["materials"]]


def main():
    main_suppression()   # writes model.json (Part B's suppression summary reads it)
    print()
    main_layers()


if __name__ == "__main__":
    main()
