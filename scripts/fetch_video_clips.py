"""Download a small set of short, real NASA flame videos (B-roll for the demo video).

  python scripts/fetch_video_clips.py              # ~3 clips per fire-safety investigation (~300 MB)
  python scripts/fetch_video_clips.py --per 6      # more choice
  python scripts/fetch_video_clips.py --list       # show what it would fetch, download nothing

Clips land in the normal mirror layout (D:/psi_raw/<PSI-xx>/Raw Data/...), and a
D:/psi_raw/_video_clips.csv index lists every clip with its investigation, size and credit line.
Safe to re-run: finished files are skipped.
"""
import argparse, csv, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from psi_download import fetch, load_inventory, local_path  # noqa: E402

# Investigations whose footage tells our story, in storytelling priority.
PICKS = {
    "PSI-25": "BASS-II: flames spreading over solid materials (fabrics/plastics)",
    "PSI-26": "BASS: burning solids in microgravity",
    "PSI-69": "FLEX: spherical fuel-droplet flames, extinction",
    "PSI-101": "SAME-R: smoke from overheated materials (Kapton etc.)",
    "PSI-39": "CFI: cool flames / droplet combustion",
    "PSI-21": "ACME CLD Flame: gas-jet flames",
    "PSI-23": "ACME s-Flame: soot/flame structure",
    "PSI-20": "ACME BRE: burning-rate emulator",
    "PSI-22": "ACME E-FIELD: flames in an electric field",
}
VIDEO = {"mp4", "mov", "avi", "m4v", "mpg", "mpeg", "wmv"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dest", default="D:/psi_raw")
    ap.add_argument("--per", type=int, default=3, help="clips per investigation")
    ap.add_argument("--min-mb", type=float, default=5)
    ap.add_argument("--max-mb", type=float, default=60)
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()

    rows = load_inventory(HERE.parent / "data/inventory/files.csv")
    chosen = []
    for acc in PICKS:
        vids = [r for r in rows if r["accession"] == acc and r["ext"].lower().strip(".") in VIDEO
                and r["restricted"] != "True" and a.min_mb * 1e6 <= int(r["bytes"]) <= a.max_mb * 1e6]
        vids.sort(key=lambda r: -int(r["bytes"]))  # larger = usually longer / higher quality
        step = max(1, len(vids) // max(a.per, 1))   # spread picks across the investigation
        chosen += vids[::step][: a.per]

    total = sum(int(r["bytes"]) for r in chosen)
    print(f"{len(chosen)} clips, {total / 1e6:.0f} MB -> {a.dest}")
    index = []
    for r in chosen:
        out = local_path(a.dest, r)
        if a.list:
            print(f"  {r['accession']:8} {int(r['bytes']) / 1e6:6.1f} MB  {out.name}")
            continue
        try:
            status, _, _ = fetch(r, a.dest, reserve=20e9)
        except Exception as e:  # network drop / missing file: report and continue
            status = f"error: {e}"
        print(f"  {status:5} {r['accession']:8} {out.name}", flush=True)
        if out.exists():
            index.append({"accession": r["accession"], "investigation": PICKS[r["accession"]],
                          "mb": round(int(r["bytes"]) / 1e6, 1), "path": str(out),
                          "credit": f"NASA Physical Sciences Informatics, {r['acronym']} ({r['accession']})"})
    if index:
        p = pathlib.Path(a.dest) / "_video_clips.csv"
        with open(p, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(index[0]))
            w.writeheader(); w.writerows(index)
        print(f"Index: {p}")


if __name__ == "__main__":
    main()
