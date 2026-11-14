"""Step 2: harmonise PSI 'Experimental table' CSVs into one test-level table.

Input : data/raw/PSI-*/Experimental table/*.csv   (download tier 1)
Output: data/processed/tests.parquet, data/processed/tests.csv, dashboard/public/data/tests.json

Unified columns (SI-ish units):
  accession, acronym, test_id, row_kind, fuel, fuel_phase, material, thickness_mm, droplet_d0_mm,
  o2_frac, pressure_kpa, o2_partial_kpa, diluent, flow_cm_s, flow_direction, gravity,
  outcome, burn_time_s, burning_rate_mm2_s, extinction_d_mm, n_flames, notes,
  pressure_assumed, source_file, source_row

row_kind: 'test' (one physical run) | 'daily_summary' (one row = one ISS test day, O2 list expanded)
          | 'matrix' (published test-matrix envelope, not individual runs)
Values that were assumed rather than read are flagged (pressure_assumed) - never silently invented.
"""
import glob, json, pathlib, re
import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw"
OUT = ROOT / "data/processed"
DASH = ROOT / "dashboard/public/data"
ATM = 101.325
MMHG = 0.133322
ISS_CABIN_KPA = 101.3  # ISS nominal cabin pressure (14.7 psi) - used only where flagged as assumed

ACR = {"PSI-10": "ACME Flame Design", "PSI-20": "ACME BRE", "PSI-21": "ACME CLD Flame", "PSI-22": "ACME E-FIELD",
       "PSI-23": "ACME s-Flame", "PSI-25": "BASS-II", "PSI-26": "BASS", "PSI-39": "CFI", "PSI-47": "DAFT",
       "PSI-68": "FLEX-2", "PSI-69": "FLEX", "PSI-98": "SAFFIRE-I", "PSI-99": "SAFFIRE-II", "PSI-100": "SAFFIRE-III",
       "PSI-159": "ACME CFI-G", "PSI-106": "SLICE"}


def num(x):
    """First number in a messy cell ('~ 21.5', '20 cm/s', '.33 cm', '037 mm') -> float or NaN."""
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return np.nan
    if isinstance(x, (int, float, np.number)):
        return float(x)
    m = re.search(r"(?<![A-Za-z])-?\d*\.?\d+", str(x).replace(",", ""))  # 'LOW O2' -> NaN, not 2
    return float(m.group(0)) if m else np.nan


def nums(x):
    """'21; 26.5; 40' -> [21, 26.5, 40].  Fixes Excel %-format artefact: '3400%' -> 34 (logged in notes)."""
    if not isinstance(x, str):
        return [] if pd.isna(x) else [float(x)]
    vals = [float(v) for v in re.findall(r"(?<![A-Za-z])\d*\.?\d+", x)]
    return [v / 100 if ("%" in x and v > 100) else v for v in vals]


def read(path):
    d = pd.read_csv(path, encoding="latin1", low_memory=False)
    d.columns = [re.sub(r"\s+", " ", str(c).replace("﻿", "").replace("ï»¿", "")).strip() for c in d.columns]
    return d


def col(d, *pats):
    for p in pats:
        for c in d.columns:
            if re.search(p, c, re.I):
                return c
    return None


def base(acc, f, i, **kw):
    r = dict(accession=acc, acronym=ACR.get(acc, acc), test_id=None, row_kind="test", fuel=None, fuel_phase=None,
             material=None, thickness_mm=np.nan, droplet_d0_mm=np.nan, o2_frac=np.nan, pressure_kpa=np.nan,
             diluent=None, flow_cm_s=np.nan, flow_direction=None, gravity="microgravity", outcome="unknown",
             burn_time_s=np.nan, burning_rate_mm2_s=np.nan, extinction_d_mm=np.nan, n_flames=np.nan, notes=None,
             pressure_assumed=False, source_file=str(pathlib.Path(f).relative_to(ROOT)).replace("\\", "/"), source_row=int(i) + 2)
    r.update(kw)
    return r


# ---------------- adapters -----------------------------------------------------------------
def a_flex(acc, f):
    d = read(f); rows = []
    for i, r in d.iterrows():
        p = num(r[col(d, "pressure")]) * MMHG
        p = p if p > 0 else np.nan  # a 0 mmHg row exists in the source table (data-entry error)
        o2 = num(r[col(d, "^O initial", "O2? initial")])
        he = num(r[col(d, "^He ")]); co2 = num(r[col(d, "^CO ")])
        end = str(r.get(col(d, "Test end"), "")).strip().lower()
        outcome = "extinguished" if "extinc" in end else "disrupted" if "disrup" in end else ("burned" if end and end != "nan" else "unknown")
        rows.append(base(acc, f, i, test_id=str(r[col(d, "Identifier")]), fuel=str(r[col(d, "^Fuel")]).strip(),
                         fuel_phase="liquid droplet", o2_frac=o2, pressure_kpa=p,
                         diluent="He" if he > 0 else "CO2" if co2 > 0 else "N2",
                         droplet_d0_mm=num(r[col(d, "initial diameter")]), extinction_d_mm=num(r[col(d, "extinction diameter")]),
                         burning_rate_mm2_s=num(r[col(d, "Burning rate")]), burn_time_s=num(r[col(d, "Burn time")]),
                         outcome=outcome, he_frac=he, co2_frac=co2, notes=f"He={he}, CO2={co2}"))
    return rows


def a_cfi(acc, f):
    """CFI: prefer the PI's data summary (227 tests, measured burning rates + extinction diameters);
    fall back to the experimental table (conditions only) if the summary is missing."""
    s = glob.glob(str(RAW / acc / "Science Documents" / "*DataSummary*.xlsx"))
    if s:
        return a_cfi_summary(acc, s[0])
    d = read(f); rows = []
    for i, r in d.iterrows():
        he = num(r[col(d, "Helium")])
        rows.append(base(acc, f, i, test_id=str(r[col(d, "Flex Number")]), fuel=str(r[col(d, "Fuel")]).strip(),
                         fuel_phase="liquid droplet", o2_frac=num(r[col(d, "Oxygen")]),
                         pressure_kpa=num(r[col(d, "Pressure")]) * ATM, diluent="He" if he > 0 else "N2",
                         notes=f"fiber={r[col(d, 'Fiber')]}"))
    return rows


CFI_FUEL = {"c12h26/iso": "n-dodecane / iso-dodecane blend", "c12h26": "n-dodecane", "farnesane": "farnesane"}


def a_cfi_summary(acc, f):
    m = pd.read_excel(f, sheet_name="Master Sheet"); d = pd.read_excel(f, sheet_name="DATA")
    cm = pd.read_excel(f, sheet_name="Comments")
    for t in (m, d, cm):
        t.columns = [re.sub(r"\s+", " ", str(c)).strip() for c in t.columns]
    t = m.merge(d.drop(columns=[c for c in d.columns if c == "Pressure (atm)"]), on="Flex Number", how="left") \
         .merge(cm, on="Flex Number", how="left")
    rows = []
    for i, r in t.iterrows():
        fuel_raw = str(r["Fuel"]).strip(); fl = fuel_raw.lower().replace(" ", "")
        fuel = next((v for k, v in CFI_FUEL.items() if k in fl), fuel_raw)
        blend = re.search(r"\[\.(\d+)\]", fuel_raw)
        he = num(r["Helium"]) or 0.0
        kcool, dcool = num(r.get("kcool ( mm^2/s )")), num(r.get("Dext,cool ( mm )"))
        analysed = str(r.get("Completed Analysis?", "")).strip().lower() == "yes"
        rows.append(base(acc, f, i, test_id=str(r["Flex Number"]).strip(), fuel=fuel, fuel_phase="liquid droplet",
                         o2_frac=num(r["Oxygen"]), pressure_kpa=num(r["Pressure"]) * ATM, diluent="He" if he > 0 else "N2",
                         droplet_d0_mm=num(r.get("D0 ( mm )")), extinction_d_mm=num(r.get("Dext, hot ( mm )")),
                         burning_rate_mm2_s=num(r.get("khot ( mm^2/s )")), burn_time_s=num(r.get("HF Burn Time")),
                         outcome=("extinguished" if analysed else "unknown"),
                         he_frac=he, co2_frac=0.0, fiber=str(r["Fiber"]).strip().lower().startswith("y"),
                         n_fuel_frac=(int(blend.group(1)) / 100 if blend else (1.0 if fuel == "n-dodecane" else 0.0)),
                         burning_rate_cool_mm2_s=kcool, extinction_d_cool_mm=dcool,
                         cool_flame=(bool(kcool == kcool or dcool == dcool) if analysed else None),
                         reignitions=num(r.get("Reignitions")), test_date=str(r["Test Date"])[:10],
                         notes=f"CFI data summary; {str(r.get('Comments', ''))[:300]}"))
    return rows


def a_flex2(acc, f):
    d = read(f); rows = []
    for i, r in d.iterrows():
        for o2 in nums(r[col(d, "Oxygen")]):
            for p in nums(r[col(d, "Pressure")]):
                rows.append(base(acc, f, i, row_kind="matrix", test_id=f"matrix-{i}", fuel=str(r[col(d, "Sample")]).strip(),
                                 fuel_phase="liquid droplet", o2_frac=o2, pressure_kpa=p * ATM,
                                 diluent=str(r[col(d, "Gas Mixture")]).strip(), notes="published test-matrix envelope"))
    return rows


def a_bass2(acc, f):
    d = read(f); rows = []
    for i, r in d.iterrows():
        mat = str(r[col(d, "Material")]).strip()
        if mat == "nan":
            continue
        th = re.search(r"(\d+)\s*micron", mat, re.I)
        o2 = num(r[col(d, "initial O2")])
        rows.append(base(acc, f, i, test_id=str(r[col(d, "^Test #")]), material=mat, fuel_phase="solid",
                         thickness_mm=float(th.group(1)) / 1000 if th else np.nan,
                         o2_frac=o2 / 100 if o2 == o2 else np.nan, pressure_kpa=ISS_CABIN_KPA, pressure_assumed=True,
                         notes=f"fan display={r[col(d, 'Fan display')]}, air display={r[col(d, 'Air display')]}"))
    return rows


NO_IGN = r"no joy|did not ignite|didn'?t ignite|no ignition|fail(ed)? to ignite|would not ignite|could not ignite|never ignited|not ignite"
NOT_SUSTAINED = r"died when (the )?igniter|went out when (the )?igniter|only (burned|lasted) for|burned for only|out (as soon as|when) igniter|self[- ]extinguish|did not sustain|not self[- ]sustain"
BURNED = r"spread|burn|sooty|flame|ignit"


def label_bass(text):
    """Crew observation text -> (outcome, extinguished_by). Rules are deliberately simple and auditable."""
    t = str(text).lower()
    if t in ("nan", "", "none"):
        return "unknown", None
    if re.search(NO_IGN, t):
        return "no ignition", None
    if re.search(NOT_SUSTAINED, t):
        return "ignited, not self-sustaining", None
    if re.search(BURNED, t):
        by = "N2" if re.search(r"n2 (on|flow)|nitrogen", t) and re.search(r"extingu|went out|blew out|died|out at", t) else \
             "low flow" if re.search(r"extingu|went out|blew out|died|quench", t) else None
        return "burned", by
    return "unknown", None


def material_class(m):
    m = str(m).lower()
    for k, v in [("pmma", "PMMA (acrylic)"), ("sphere", "PMMA (acrylic)"), ("rod", "PMMA (acrylic)"), ("sibal", "SIBAL (cotton/fiberglass)"),
                 ("nomex", "Nomex (aramid fabric)"), ("candle", "wax"), ("wax", "wax"), ("ultem", "Ultem (polyetherimide)"),
                 ("cotton", "cotton"), ("silicone", "silicone"), ("acetal", "acetal"), ("delrin", "acetal"), ("paper", "paper")]:
        if k in m:
            return v
    return "other"


def geometry(m):
    m = str(m).lower()
    return "sphere" if "sphere" in m else "rod/cylinder" if ("rod" in m or "cylinder" in m) else \
           "candle" if "candle" in m else "slab" if "slab" in m else "flat sheet/fabric"


def a_bass_asrun(acc, f):
    d = pd.read_excel(f, sheet_name="as run matrix", header=2)
    d.columns = [re.sub(r"\s+", " ", str(c)).strip() for c in d.columns]
    obs, mat = col(d, "Observations"), col(d, "^material$")
    rows = []
    for i, r in d.iterrows():
        m = str(r[mat]).strip()
        if m in ("nan", "") or str(r[col(d, "As run test no")]).strip().upper() == "SETUP":
            continue
        outcome, by = label_bass(r[obs])
        flows = nums(str(r[col(d, "Air display")]))
        o2, p = num(r[col(d, "O2 % by volume")]), num(r[col(d, "pressure, atm")])
        size = re.search(r"(\d+(?:\.\d+)?)\s*cm", m)
        rows.append(base(acc, f, i, test_id=str(r[col(d, "As run test no")]), material=m, fuel_phase="solid",
                         material_class=material_class(m), geometry=geometry(m),
                         sample_size_cm=float(size.group(1)) if size else np.nan,
                         o2_frac=o2 if o2 == o2 and o2 < 1 else (o2 / 100 if o2 == o2 else np.nan),
                         pressure_kpa=p * ATM if p == p else np.nan,
                         co2_frac=(num(r[col(d, "CO2, mm Hg")]) * MMHG) / (p * ATM) if p == p else np.nan,
                         flow_cm_s=flows[0] if flows else np.nan, flow_min_cm_s=min(flows) if flows else np.nan,
                         outcome=outcome, extinguished_by=by, diluent="N2" if by == "N2" else None,
                         notes=str(r[obs])[:400], label_source="rules"))
    # Hand-audited labels (every crew note read by a person) override the keyword rules above.
    # pipeline/labels/bass_label_audit.csv: as_run_row, test_id, note_start, outcome, extinguished_by, n2_jet
    audit_f = ROOT / "pipeline/labels/bass_label_audit.csv"
    if audit_f.exists():
        audit = pd.read_csv(audit_f, keep_default_na=False).set_index("as_run_row")
        for r in rows:
            if r["source_row"] in audit.index:
                a = audit.loc[r["source_row"]]
                if str(a.note_start)[:25] != str(r["notes"])[:25]:
                    continue  # sheet changed under us: keep the rule label rather than mis-assign
                r.update(outcome=a.outcome, extinguished_by=a.extinguished_by or None,
                         n2_jet=a.n2_jet or None, diluent="N2" if a.extinguished_by == "N2" else None, label_source="audited")
    return rows


def a_bass(acc, f):
    s = glob.glob(str(RAW / acc / "Science Documents" / "*As Run*Test Matrix*.xlsx"))
    if s:
        return a_bass_asrun(acc, s[0])
    d = read(f); rows = []
    for i, r in d.iterrows():
        mat = str(r[col(d, "Material")]).strip()
        if mat == "nan":
            continue
        th = re.search(r"(\d+)\s*micron", mat, re.I)
        rows.append(base(acc, f, i, test_id=str(r[col(d, "^Test #")]), material=mat, fuel_phase="solid",
                         thickness_mm=float(th.group(1)) / 1000 if th else np.nan,
                         pressure_kpa=ISS_CABIN_KPA, pressure_assumed=True))
    return rows


def a_saffire(acc, f):
    d = read(f); rows = []
    for i, r in d.iterrows():
        mat = str(r[col(d, "Material")]).strip()
        if mat == "nan" or "visul" in mat.lower() or "visual" in mat.lower():
            continue
        thc = col(d, "Thick")
        th = num(r[thc]); th = th * 10 if ("cm" in thc.lower() or "cm" in str(r[thc])) else th
        o2 = num(r[col(d, "O2")]) if col(d, "O2") else np.nan
        bt = r[col(d, "Burn Time")] if col(d, "Burn Time") else np.nan
        rows.append(base(acc, f, i, test_id=str(r[col(d, "Sample Number")]).strip(), material=mat, fuel_phase="solid",
                         thickness_mm=th, flow_cm_s=num(r[col(d, "Air Flow")]),
                         flow_direction=str(r[col(d, "Direction")]).strip(), o2_frac=o2 / 100 if o2 == o2 else np.nan,
                         pressure_kpa=ISS_CABIN_KPA, pressure_assumed=True, burn_time_s=num(bt),
                         outcome="burned" if num(bt) > 0 else ("limited/self-extinguished" if "insig" in str(bt).lower() else "unknown"),
                         gravity="microgravity (Cygnus)", notes=None))
    return rows


def a_bre(acc, f):
    d = read(f); rows = []
    for i, r in d.iterrows():
        for o2 in nums(r[col(d, "Oxygen")]):
            fixed = "%" in str(r[col(d, "Oxygen")]) and "fixed Excel % artefact; " or ""
            rows.append(base(acc, f, i, row_kind="daily_summary", test_id=f"{r[col(d,'Year')]}-{r[col(d,'Month')]}-{r[col(d,'Date')]}",
                             fuel=str(r[col(d, "Fuel Bottle")]).strip(), fuel_phase="gas (emulates solid)",
                             o2_frac=o2 / 100, n_flames=num(r[col(d, "Ignited")]), outcome="ignited",
                             notes=f"{fixed}burner {r[col(d, 'Burner Size')]} mm; pressure varied, not tabulated"))
    return rows


def a_flamedesign(acc, f):
    d = read(f); rows = []
    for i, r in d.iterrows():
        o2 = num(r[col(d, r"^XO2$", r"XO2 \(init")])
        inverse = "nverse" in str(r[col(d, 'Flame Type')])
        # Inverse flame: O2 flows from the burner, the chamber holds fuel -> that O2 is NOT the surrounding atmosphere.
        rows.append(base(acc, f, i, test_id=str(r[col(d, "^Test")]), fuel=str(r.get(col(d, "^Fuel$") or "", "C2H4")) if col(d, "^Fuel$") else "C2H4",
                         fuel_phase="gas", o2_frac=np.nan if inverse else o2, burner_o2_frac=o2 if inverse else np.nan,
                         pressure_kpa=num(r[col(d, "pmean")]) * ATM, flame_type="inverse" if inverse else "normal",
                         notes=f"{r[col(d,'Flame Type')]} flame; Tad={r[col(d,'Tad')]} K"
                               + ("; inverse flame: O2 is the burner oxidizer stream, ambient is fuel" if inverse else "")))
    return rows


def a_cfig(acc, f):
    """ACME CFI-G (Cool Flames Investigation with Gases). Two tables:
    Normal flames  - gaseous fuel from the spherical burner into an O2-enriched chamber (XO2 = chamber atmosphere, up to 40 %)
    Inverse flames - O2/N2 (up to 85 % O2) from the burner into a fuel/N2 chamber (XO2 = burner stream, NOT the atmosphere)"""
    d = read(f); rows = []
    inverse = "Inverse" in pathlib.Path(f).name
    xo = col(d, r"^XO2 before", r"^XO2$"); end = col(d, r"^Self")
    for i, r in d.iterrows():
        o2 = num(r[xo])
        if o2 != o2:
            continue  # blank spacer rows in the sheet
        ign = str(r[col(d, "Hot ignition")]).strip().lower()
        how = str(r[end]).strip().upper()
        outcome = ("no ignition" if ign.startswith("no") else "flash only" if ign.startswith("flash")
                   else "limited/self-extinguished" if how == "SE" else "burned" if how == "FT" else "ignited")
        cool = str(r.get(col(d, r"^Cool flame") or "", "")).strip().lower() if col(d, r"^Cool flame") else ""
        fuel = str(r[col(d, "^Fuel")]).strip()
        rows.append(base(acc, f, i, test_id=str(r[col(d, "^Test")]).strip(), fuel=fuel, fuel_phase="gas",
                         flame_type="inverse" if inverse else "normal",
                         o2_frac=np.nan if inverse else o2, burner_o2_frac=o2 if inverse else np.nan,
                         pressure_kpa=num(r[col(d, "approx p")]) * 100.0, burn_time_s=num(r[col(d, "burn time")]),
                         outcome=outcome, cool_flame=(True if cool.startswith("yes") else False if cool.startswith("no") else None),
                         notes=("inverse flame: O2 flows from the burner, chamber holds fuel/N2; " if inverse else "")
                               + (f"ended by {'self-extinction' if how == 'SE' else 'flow termination' if how == 'FT' else '-'}; ")
                               + str(r.get(col(d, "Comments") or "", "") if col(d, "Comments") else "")[:200]))
    return rows


def a_slice(acc, f):
    """SLICE (PSI-106): the table lists test days and fuel mixtures only (no O2/pressure per test)."""
    d = read(f); rows = []
    for i, r in d.iterrows():
        rows.append(base(acc, f, i, row_kind="daily_summary", test_id=str(r.iloc[0]).strip(), fuel=str(r.iloc[1]).strip()[:80],
                         fuel_phase="gas", notes="test-day summary; conditions not tabulated (SLICE raw data ~42 GB not used)"))
    return rows


def a_acme_days(acc, f):
    d = read(f); rows = []
    for i, r in d.iterrows():
        nf = num(r[col(d, "Ignited")])
        if nf != nf:
            continue
        atm = str(r[col(d, "Atmosphere")]) if col(d, "Atmosphere") else ""
        o2 = num(atm) / 100 if "O2" in atm else np.nan
        rows.append(base(acc, f, i, row_kind="daily_summary", test_id=str(r[col(d, "Test Day")]),
                         fuel=str(r[col(d, "Fuel Bottle")]).strip(), fuel_phase="gas", o2_frac=o2,
                         pressure_kpa=ATM if o2 == o2 else np.nan, pressure_assumed=o2 == o2,
                         n_flames=nf, outcome="ignited", notes=str(r[col(d, "Test Type")]) if col(d, "Test Type") else None))
    return rows


ADAPTERS = {"PSI-69": a_flex, "PSI-39": a_cfi, "PSI-68": a_flex2, "PSI-25": a_bass2, "PSI-26": a_bass,
            "PSI-98": a_saffire, "PSI-99": a_saffire, "PSI-100": a_saffire, "PSI-20": a_bre, "PSI-10": a_flamedesign,
            "PSI-21": a_acme_days, "PSI-22": a_acme_days, "PSI-23": a_acme_days, "PSI-159": a_cfig, "PSI-106": a_slice}


def main():
    rows, report = [], []
    for f in sorted(glob.glob(str(RAW / "*/Experimental table/*.csv"))):
        acc = pathlib.Path(f).parts[-3]
        fn = ADAPTERS.get(acc)
        if not fn:
            report.append((acc, pathlib.Path(f).name, "no adapter yet")); continue
        try:
            got = fn(acc, f); rows += got; report.append((acc, pathlib.Path(f).name, f"{len(got)} rows"))
        except Exception as e:
            report.append((acc, pathlib.Path(f).name, f"ERROR {e!r}"))

    df = pd.DataFrame(rows)
    df["o2_pct"] = df.o2_frac * 100
    df["o2_partial_kpa"] = df.o2_frac * df.pressure_kpa
    df["pressure_psi"] = df.pressure_kpa / 6.89476
    OUT.mkdir(parents=True, exist_ok=True); DASH.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT / "tests.parquet"); df.to_csv(OUT / "tests.csv", index=False)
    df.replace({np.nan: None}).to_json(DASH / "tests.json", orient="records", indent=0)

    for r in report:
        print(f"  {r[0]:8} {r[2]:18} {r[1]}")
    print(f"\n{len(df)} rows | by kind: {df.row_kind.value_counts().to_dict()}")
    print("non-null:", {c: int(df[c].notna().sum()) for c in ["o2_frac", "pressure_kpa", "flow_cm_s", "thickness_mm", "burn_time_s", "extinction_d_mm"]})
    print("outcomes:", df.outcome.value_counts().to_dict())
    print(f"O2 range {df.o2_pct.min():.1f}-{df.o2_pct.max():.1f}% | pressure {df.pressure_kpa.min():.1f}-{df.pressure_kpa.max():.1f} kPa")


if __name__ == "__main__":
    main()
