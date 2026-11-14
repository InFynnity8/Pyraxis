"""Download Tier 2 (raw sensor logs) in fire-safety priority order. Safe to stop and re-run at any time.

  python scripts/download_tier2.py               # start or RESUME (skips files already downloaded)
  python scripts/download_tier2.py --status      # show progress only, downloads nothing
  python scripts/download_tier2.py --dest E:/psi_raw
  python scripts/download_tier2.py --include-slice  # also fetch SLICE (PSI-106, ~42 GB, low priority; skipped by default)

Pause : press Ctrl+C (or close the window). Nothing is lost.
Resume: run the same command again. Finished files are skipped; a file cut off mid-download
        is kept as '*.part' and restarted, never mistaken for a complete file.
Network drop: affected files are reported as errors; just re-run to retry them.
"""
import argparse, csv, pathlib, subprocess, sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from psi_download import load_inventory, local_path, tier_of  # noqa: E402

GROUPS = [
    ("1 fire-safety core", ["PSI-25", "PSI-26", "PSI-98", "PSI-99", "PSI-100", "PSI-101", "PSI-102", "PSI-47", "PSI-115", "PSI-62", "PSI-60"]),
    ("2 suppression + high-O2", ["PSI-69", "PSI-68", "PSI-20", "PSI-159", "PSI-22", "PSI-39"]),
    ("3 other combustion", ["PSI-107", "PSI-10", "PSI-21", "PSI-23", "PSI-117", "PSI-142"]),
    ("4 SLICE (low priority, ~42 GB)", ["PSI-106"]),
]


def status(dest):
    rows = [r for r in load_inventory(HERE.parent / "data/inventory/files.csv") if tier_of(r) <= 2]
    tot_n = tot_b = got_n = got_b = 0
    print(f"{'group':34} {'files':>15} {'GB':>15}")
    for name, accs in GROUPS:
        rs = [r for r in rows if r["accession"] in accs]
        n = b = 0
        for r in rs:
            f = local_path(dest, r)
            if f.exists() and f.stat().st_size == int(r["bytes"]):
                n += 1; b += int(r["bytes"])
        gb = sum(int(r["bytes"]) for r in rs)
        tot_n += len(rs); tot_b += gb; got_n += n; got_b += b
        print(f"{name:34} {n:>7,}/{len(rs):<7,} {b/1e9:>6.2f}/{gb/1e9:<6.2f} {'done' if n == len(rs) else ''}")
    print(f"{'TOTAL':34} {got_n:>7,}/{tot_n:<7,} {got_b/1e9:>6.2f}/{tot_b/1e9:<6.2f}  = {100*got_b/max(tot_b,1):.1f}% by size")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dest", default="D:/psi_raw")
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--workers", default="12")
    ap.add_argument("--include-slice", action="store_true", help="also download SLICE (PSI-106), ~42 GB, low fire-safety relevance")
    a = ap.parse_args()
    dest = pathlib.Path(a.dest)
    if a.status:
        return status(dest)
    for name, accs in GROUPS:
        if accs == ["PSI-106"] and not a.include_slice:
            print("\n== Skipping SLICE (PSI-106, ~42 GB). Add --include-slice to fetch it.", flush=True)
            continue
        print(f"\n== Priority {name}", flush=True)
        subprocess.run([sys.executable, "-u", str(HERE / "psi_download.py"), "--tier", "2", "--dest", str(dest),
                        "--reserve-gb", "20", "--workers", a.workers, "--acc", *accs], check=False)
    print("\nFinished one full pass. Run again to retry any errors.")
    status(dest)


if __name__ == "__main__":
    main()
