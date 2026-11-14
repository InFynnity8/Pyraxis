"""Detection layer: one row per smoke test from SAME (PSI-102) and SAME-R (PSI-101).

Input : data/raw/PSI-10{1,2}/Analyzed Data/*.xls[x]   (1 Hz instrument time series, one file per run/day)
        data/raw/PSI-101/Experimental table/*.csv      (material, heater Rt/R0, inlet flow, aging time per test #)
Output: data/processed/detection.parquet / .csv, dashboard/public/data/detection.json

What a row says: a material was heated (Rt/R0 = heater resistance ratio, a proxy for temperature) in a given
air flow, its smoke was aged for some seconds, then pushed past five smoke sensors. We record:
  * the particle counter (P-Trak, number/cm3, particles > ~0.02 um) and two mass monitors (DustTrak, mg/m3)
  * every detector's response above its own baseline: ISS photoelectric (obscuration + scatter),
    Space Shuttle (STS) ionisation-type detector, two ionisation detectors (A, B)
  * a "detected" flag per detector = response > max(5 x baseline noise, small absolute floor)
  * an estimated mean particle diameter from mass / number (assumes unit density spheres; an index, not truth)
Nothing is invented: unreadable or saturated values are left empty and the file/sheet is recorded.
"""
import glob, json, pathlib, re, warnings
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw"
OUT = ROOT / "data/processed"
DASH = ROOT / "dashboard/public/data"

SIG = {  # short name -> column pattern
    "iss_obscuration": r"ISSDetectorObscuration", "iss_scatter": r"ISSDetectorScatter",
    "sts": r"STSDetectorMeasurement", "ion_a": r"IonDetectorAMeasurement", "ion_b": r"IonDetectorBMeasurement",
    "ptrak": r"PTrakMeasurement", "dusttrak_a": r"DustTrakAMeasurement\(", "dusttrak_b": r"DustTrakBMeasurement\(",
    "plume_c": r"GasPlumeTemperature", "test_no": r"^TestNumber$", "elapsed": r"ElapsedTestTime",
}
DETECTORS = ["iss_obscuration", "iss_scatter", "sts", "ion_a", "ion_b"]
FLOOR = {"iss_obscuration": 0.01, "iss_scatter": 0.1, "sts": 0.1, "ion_a": 0.1, "ion_b": 0.1}  # volts; assumption, stated in the README
MATERIALS = {"kapton": "Kapton", "silic": "Silicone rubber", "silcon": "Silicone rubber", "teflon": "Teflon",
             "lampwick": "Lampwick (cotton)", "pyrell": "Pyrell (PU foam)", "dbp": "Dibutyl phthalate",
             "dibutyl": "Dibutyl phthalate", "mix": "Mixed"}


def material_from(name):
    n = name.lower()
    for k, v in MATERIALS.items():
        if k in n:
            return v
    return None


def find(cols, pat):
    for c in cols:
        if re.search(pat, str(c), re.I):
            return c
    return None


def best_sheet(path):
    """The sheet holding the full instrument table (has P-Trak and a detector column, most rows)."""
    best = None
    for name, d in pd.read_excel(path, sheet_name=None).items():
        if d.shape[1] < 5:
            continue
        hdr = 0
        if find(d.columns, SIG["ptrak"]) is None:  # header may sit a row or two down
            for i in range(min(5, len(d))):
                if any(re.search(SIG["ptrak"], str(v)) for v in d.iloc[i].values):
                    d.columns = [str(v) for v in d.iloc[i].values]; d = d.iloc[i + 1:]; hdr = i + 1; break
        if find(d.columns, SIG["ptrak"]) and find(d.columns, SIG["ion_a"]):
            score = (find(d.columns, r"^HeatingInProgress$") is not None, len(d))  # full instrument dump beats a plot sheet
            if best is None or score > best[2]:
                best = (name, d, score)
    return best[:2] if best else None


def summarise(d, test_no, src, sheet):
    """Baseline = before the sample heater first switches on; smoke window = after it last switches off.
    (Files without a heater channel fall back to first 10% vs rest.)"""
    cols = {k: find(d.columns, p) for k, p in SIG.items()}
    num = {k: pd.to_numeric(d[c], errors="coerce").reset_index(drop=True) for k, c in cols.items() if c is not None and k != "test_no"}
    n = len(d)
    heat_c, sts_pow = find(d.columns, r"^HeatingInProgress$"), find(d.columns, r"^STSDetectorPower$")
    heat = pd.to_numeric(d[heat_c], errors="coerce").fillna(0).reset_index(drop=True) if heat_c else None
    if heat is not None and heat.max() > 0:
        on = np.flatnonzero(heat.values > 0)
        base_idx, smoke_idx = np.arange(0, max(on[0], 5)), np.arange(on[-1] + 1, n)
        window = "heater"
    else:
        k = max(10, n // 10); base_idx, smoke_idx = np.arange(0, k), np.arange(k, n); window = "first10pct"
    row = dict(source_file=str(src.relative_to(ROOT)).replace("\\", "/"), sheet=sheet, test_no=test_no,
               n_seconds=n, smoke_window=window, smoke_seconds=int(len(smoke_idx)))
    if len(smoke_idx) < 20:
        return row
    for k in DETECTORS:
        s = num.get(k)
        if s is None or s.notna().sum() < 20:
            continue
        if k == "sts" and sts_pow and pd.to_numeric(d[sts_pow], errors="coerce").max() < 1:
            continue  # STS detector not powered on this run
        s = s.where(s.abs() < 50)
        b = s.iloc[base_idx]; mu, sd = b.median(), b.std()
        resp = (s.iloc[smoke_idx] - mu).abs().quantile(0.98)  # robust peak (ignores single-sample spikes)
        row[f"{k}_response_v"] = float(resp)
        row[f"{k}_responded"] = bool(resp > max(10 * (sd if sd == sd else 0), FLOOR[k]))
    pt = num.get("ptrak"); db = num.get("dusttrak_b")
    if pt is not None:
        pt = pt.where((pt >= 0) & (pt < 5e5)).iloc[smoke_idx]  # -999 = no reading
        if pt.notna().sum() >= 10:
            row["ptrak_peak_per_cc"] = float(pt.quantile(0.98))
    if db is not None:
        db = db.where((db >= 0) & (db < 1e3)).iloc[smoke_idx]  # DustTrak A logs status codes (1e4, 2e4); B is mass
        if db.notna().sum() >= 10:
            row["dusttrak_peak_mg_m3"] = float(db.quantile(0.98))
    if pt is not None and db is not None:
        both = pd.DataFrame({"n": pt, "m": db}).dropna()
        both = both[(both.n > 1000) & (both.m > 0.05)]
        if len(both) >= 5:  # mass-per-particle -> equivalent sphere diameter (unit density): an index, not a measurement
            dia = (6 * both.m * 1e-9 / both.n / np.pi) ** (1 / 3) * 1e4
            row["mean_diameter_index_um"] = float(dia.median())
    if "plume_c" in num:
        row["plume_temp_max_c"] = float(num["plume_c"].max())
    return row


def exp_table():
    f = glob.glob(str(RAW / "PSI-101/Experimental table/*.csv"))[0]
    t = pd.read_csv(f, encoding="latin1")
    t.columns = [c.strip() for c in t.columns]
    t["test_key"] = t["SAME Test #"].astype(str).str.strip()
    return t


def main():
    rows, log = [], []
    for acc, label in [("PSI-101", "SAME-R"), ("PSI-102", "SAME")]:
        for f in sorted(glob.glob(str(RAW / acc / "Analyzed Data" / "*.xls*"))):
            p = pathlib.Path(f)
            try:
                got = best_sheet(p)
            except Exception as e:
                log.append((p.name, f"ERROR {e!r}")); continue
            if got is None:
                log.append((p.name, "no instrument sheet")); continue
            sheet, d = got
            tcol = find(d.columns, SIG["test_no"])
            groups = []
            if tcol is not None:
                tn = pd.to_numeric(d[tcol], errors="coerce")
                for t in sorted(tn[tn > 0].dropna().unique()):
                    groups.append((int(t), d[tn == t]))
            if not groups:
                m = re.search(r"run\s*_?(\d+)", p.name, re.I)
                groups = [(int(m.group(1)) if m else None, d)]
            for t, g in groups:
                if len(g) < 30:
                    continue
                r = summarise(g, t, p, sheet)
                r.update(accession=acc, acronym=label, material=material_from(p.name))
                rows.append(r)
            log.append((p.name, f"{len(groups)} test(s) from [{sheet}]"))

    df = pd.DataFrame(rows)
    # one row per (investigation, test number): keep the longest record (files often repeat a run with plots)
    df["_k"] = df.accession + "|" + df.test_no.astype(str) + "|" + df.material.fillna("")
    df = df.sort_values("n_seconds", ascending=False).drop_duplicates("_k").drop(columns="_k")

    t = exp_table()
    base = t[~t.test_key.str.endswith("a")].set_index("test_key")
    aged = t[t.test_key.str.endswith("a")].assign(test_key=lambda x: x.test_key.str[:-1]).set_index("test_key")
    def cond(r):
        k = str(int(r.test_no)) if r.test_no == r.test_no and r.accession == "PSI-101" else None
        if k is None or k not in base.index:
            return pd.Series(dtype=float)
        b = base.loc[k]
        b = b.iloc[0] if isinstance(b, pd.DataFrame) else b
        return pd.Series(dict(material_table=str(b["Sample Type"]).strip(), description=b["Description"],
                              inlet_flow_cm_s=pd.to_numeric(b["Inlet velocity (cm/s)"], errors="coerce"),
                              heater_rt_r0=pd.to_numeric(b["Rt/R0"], errors="coerce"),
                              heat_duration_s=pd.to_numeric(b["Duration (sec)"], errors="coerce"),
                              aging_s=pd.to_numeric(b["Net aging time (sec)"], errors="coerce"),
                              aged_rerun_aging_s=pd.to_numeric(aged.loc[k]["Net aging time (sec)"], errors="coerce") if k in aged.index else np.nan))
    c = df.apply(cond, axis=1)
    df = pd.concat([df.reset_index(drop=True), c.reset_index(drop=True)], axis=1)
    if "material_table" in df:
        df["material"] = df.material_table.where(df.material_table.notna(), df.material)
        df["material"] = df.material.replace({"Silicone": "Silicone rubber", "Lampwick": "Lampwick (cotton)", "Pyrell": "Pyrell (PU foam)"})
    det_cols = [f"{k}_responded" for k in DETECTORS if f"{k}_responded" in df]
    df["n_detectors_responded"] = df[det_cols].fillna(False).sum(axis=1)

    OUT.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT / "detection.parquet"); df.to_csv(OUT / "detection.csv", index=False)
    df.replace({np.nan: None}).to_json(DASH / "detection.json", orient="records", indent=0)
    for name, msg in log:
        print(f"  {msg:32} {name}")
    print(f"\n{len(df)} smoke tests | by investigation {df.acronym.value_counts().to_dict()}")
    print("materials:", df.material.value_counts(dropna=False).to_dict())
    print("with conditions:", int(df.get("heater_rt_r0", pd.Series(dtype=float)).notna().sum()),
          "| with particle size index:", int(df.get("mean_diameter_index_um", pd.Series(dtype=float)).notna().sum()))
    print("response rate per detector:", {c: round(float(df[c].mean()), 2) for c in det_cols})


if __name__ == "__main__":
    main()
