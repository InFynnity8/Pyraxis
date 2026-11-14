"""Compare two PSI inventories: what's new or changed since our download?

  python scripts/compare_inventory.py data/inventory data/inventory_new

Prints new / removed investigations, and new or changed files (with size and tier) per investigation.
Tier 1 files (curated tables and documents) are what the pipeline uses; Experimental-table CSVs matter most.
"""
import json, pathlib, sys
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from psi_download import load_inventory, tier_of  # noqa: E402


def invs(d):
    return {i.get("Accession") or i.get("accession"): i.get("Acronym") or i.get("acronym") or "" for i in json.load(open(pathlib.Path(d) / "investigations.json", encoding="utf-8"))}


def main(old, new):
    oi, ni = invs(old), invs(new)
    print(f"Investigations: {len(oi)} -> {len(ni)}")
    for a in sorted(set(ni) - set(oi)):
        print(f"  NEW investigation  {a} {ni[a]}")
    for a in sorted(set(oi) - set(ni)):
        print(f"  REMOVED            {a} {oi[a]}")

    of = {r["key"]: r for r in load_inventory(pathlib.Path(old) / "files.csv")}
    nf = {r["key"]: r for r in load_inventory(pathlib.Path(new) / "files.csv")}
    added = [nf[k] for k in nf.keys() - of.keys()]
    changed = [nf[k] for k in nf.keys() & of.keys() if (nf[k]["bytes"], nf[k]["version"]) != (of[k]["bytes"], of[k]["version"])]
    print(f"\nFiles: {len(of):,} -> {len(nf):,} | new {len(added):,} | changed {len(changed):,} | removed {len(of.keys() - nf.keys()):,}")
    for label, rows in [("NEW", added), ("CHANGED", changed)]:
        if not rows:
            continue
        print(f"\n{label} files by investigation and tier (GB):")
        c = Counter((r["accession"], tier_of(r)) for r in rows)
        for (a, t), n in sorted(c.items()):
            gb = sum(int(r["bytes"]) for r in rows if r["accession"] == a and tier_of(r) == t) / 1e9
            print(f"  {a:8} tier {t}: {n:6,} files  {gb:7.2f} GB")
        tables = [r for r in rows if "/Experimental table/" in r["key"]]
        if tables:
            print(f"\n  {label} experimental tables (pipeline inputs - check build_tests.py has an adapter):")
            for r in tables:
                print(f"    {r['key']}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
