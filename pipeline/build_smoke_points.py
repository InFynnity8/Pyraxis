"""Detection layer, part 2: SPICE (PSI-107) laminar smoke points measured aboard the ISS.

Input : data/raw/PSI-107/Raw Data/*SmokePointReview*.xlsx  (PI's reduced flight data, sheet 'Smoke Point Datasheet')
Output: data/processed/smoke_points.parquet / .csv, dashboard/public/data/smoke_points.json

Smoke point = the flame length at which a gas-jet flame starts to release soot (smoke). Shorter smoke point
= sootier fuel = more smoke for detectors to see, and more radiant heat. One row per flight test point.
"""
import glob, json, pathlib, re, warnings
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT, DASH = ROOT / "data/processed", ROOT / "dashboard/public/data"
COLS = {0: "gmt_day", 5: "test_point", 6: "fuel_label", 7: "nozzle_mm", 8: "pressure_pa", 11: "fuel_mole_frac",
        18: "smoke_point_mm", 20: "flame_width_mm", 22: "adiabatic_flame_temp_k", 27: "fuel_mass_flow_mg_s",
        29: "air_velocity_cm_s", 30: "fuel_velocity_cm_s", 45: "residence_time_ms"}


def main():
    f = glob.glob(str(ROOT / "data/raw/PSI-107/Raw Data/*SmokePointReview*.xlsx"))[0]
    raw = pd.read_excel(f, sheet_name="Smoke Point Datasheet", header=None).iloc[4:]
    d = raw[list(COLS)].rename(columns=COLS)
    d = d[d.fuel_label.astype(str).str.contains("ylene|ropane", case=False) & ~d.fuel_label.astype(str).str.contains("avg", case=False)]
    for c in d.columns:
        if c not in ("test_point", "fuel_label"):
            d[c] = pd.to_numeric(d[c], errors="coerce")
    lab = d.fuel_label.astype(str)
    d["fuel"] = np.where(lab.str.contains("ropylene"), "propylene", np.where(lab.str.contains("thylene"), "ethylene", "propane"))
    pct = lab.str.extract(r"(\d+)\s*%")[0].astype(float) / 100
    d["fuel_mole_frac"] = d.fuel_mole_frac.where(d.fuel_mole_frac.notna(), pct).fillna(1.0)
    d = d.dropna(subset=["smoke_point_mm"])
    d = d[(d.smoke_point_mm > 0) & (d.smoke_point_mm < 500)]
    # SPICE flew three burner tubes (0.41, 0.76, 1.6 mm; see the sheet's 'Reference' notes). Rows with other nozzle
    # values or zero air speed come from a different block of the sheet (planning/ground rows), not flight smoke points.
    real = d.nozzle_mm.apply(lambda n: any(abs(n - t) < 0.05 for t in (0.4064, 0.762, 1.6002)) if n == n else False)
    d = d[real & (d.air_velocity_cm_s > 0)]
    d.insert(0, "accession", "PSI-107"); d.insert(1, "acronym", "SPICE")
    d["source_file"] = str(pathlib.Path(f).relative_to(ROOT)).replace("\\", "/")
    OUT.mkdir(parents=True, exist_ok=True)
    d.to_parquet(OUT / "smoke_points.parquet"); d.to_csv(OUT / "smoke_points.csv", index=False)
    d.replace({np.nan: None}).to_json(DASH / "smoke_points.json", orient="records", indent=0)
    print(f"{len(d)} smoke-point flames | {d.fuel.value_counts().to_dict()} | nozzles {sorted(d.nozzle_mm.round(2).unique())}")
    print(d.groupby(["fuel", "fuel_mole_frac"]).smoke_point_mm.agg(["count", "median"]).round(1).to_string())


if __name__ == "__main__":
    main()
