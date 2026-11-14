"""Tiered, resumable downloader for PSI files listed in data/inventory/files.csv.

Examples:
  python scripts/psi_download.py --tier 1 --dest data/raw                  # docs & tables
  python scripts/psi_download.py --tier 2 --dest E:/psi_raw                # + sensor data / images
  python scripts/psi_download.py --tier 3 --dest E:/psi_raw --acc PSI-69   # + video, one investigation
  python scripts/psi_download.py --tier 1 --dry-run                        # just show what/how much

Tier 1: curated docs & tables (~GBs)  Tier 2: + raw sensor logs (~52 GB)  Tier 3: + video/zip (~13 TB!)
Skips files already present with the right size. Stops before free space drops below --reserve-gb.
"""
import argparse, csv, json, re, shutil, sys, pathlib, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

API = "https://psi.nasa.gov/geode-py/ws"
UA = {"User-Agent": "psi-hackathon-downloader/1.0"}
# Inventory (11 Nov 2026): 60,826 unique files / ~13.5 TB, of which ~13 TB are raw .zip/.ts/.mp4 archives.
DOC = {".xls", ".xlsx", ".xlsm", ".pdf", ".ppt", ".pptx", ".doc", ".docx", ".rtf", ".metadata",
       ".xml", ".mat", ".jpg", ".png", ".tif", ".eps", ".json", ".md", ".htm", ".html"}
SENSOR = {".csv", ".tsv", ".txt", ".dat", ".asc", ".log", ".meta", ".mdipsug", ".pxp", ".errors", ".next"}
HEAVY = {".zip", ".ziip", ".ts", ".mp4", ".avi", ".mpg", ".mov", ".nef", ".sfk"}
T1_MAX = 150e6  # single-file cap for tier 1


def tier_of(row):
    """1 = curated docs/tables (~few GB) | 2 = raw sensor logs (~52 GB) | 3 = video & archives (~13 TB)."""
    ext, cat, size = row["ext"], row["category"], int(row["bytes"])
    if ext in HEAVY or cat == "Calibration":
        return 3
    if size <= T1_MAX and (cat != "Raw Data" or ext in DOC):
        return 1
    return 2


def presigned(acc, key, version):
    q = urllib.parse.urlencode({"file": pathlib.PurePosixPath(key).name, "version": version, "redirect": "false"})
    with urllib.request.urlopen(urllib.request.Request(f"{API}/studies/{acc}/download?{q}", headers=UA), timeout=60) as r:
        body = r.read().decode().strip()
    return json.loads(body) if body.startswith('"') else body


_BAD = re.compile(r'[<>:"|?*\x00-\x1f]')


def local_path(dest, row):
    """Where a PSI file is stored locally. Characters Windows forbids in names (e.g. ':' in
    'FLEX: A Decisive Step...') become '_'; trailing dots/spaces are trimmed. Same rule everywhere."""
    rel = row["key"].split(f"{row['accession']}/", 1)[-1]
    parts = [(_BAD.sub("_", p).rstrip(" .") or "_") for p in rel.split("/")]
    return pathlib.Path(dest) / row["accession"] / pathlib.Path(*parts)


def load_inventory(path="data/inventory/files.csv"):
    """Inventory rows, de-duplicated: the PSI listing repeats ~4,400 files, and two workers
    downloading the same file at once collide on the final rename (WinError 32)."""
    seen, rows = set(), []
    for r in csv.DictReader(open(path, encoding="utf-8")):
        if r["key"] not in seen:
            seen.add(r["key"]); rows.append(r)
    return rows


MISSING_LOG = "_missing_on_psi.txt"  # files PSI lists but returns 404 for; skipped on re-runs


def fetch(row, dest, reserve):
    out = local_path(dest, row)
    size = int(row["bytes"])
    if out.exists() and out.stat().st_size == size:
        return "skip", row["key"], 0
    out.parent.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(out.parent).free - size < reserve:
        return "nospace", row["key"], 0
    tmp = out.with_suffix(out.suffix + ".part")
    try:
        url = presigned(row["accession"], row["key"], row["version"])
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r, open(tmp, "wb") as fh:
            shutil.copyfileobj(r, fh, 1 << 20)
    except urllib.error.HTTPError as e:
        if e.code == 404:  # listed by PSI but not actually stored there: nothing we can fix
            tmp.unlink(missing_ok=True)
            return "missing", row["key"], 0
        raise
    tmp.replace(out)
    return "ok", row["key"], size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier", type=int, default=1, choices=[1, 2, 3])
    ap.add_argument("--dest", default="data/raw")
    ap.add_argument("--inventory", default="data/inventory/files.csv")
    ap.add_argument("--acc", nargs="*", help="only these accessions, e.g. PSI-26 PSI-69")
    ap.add_argument("--max-file-gb", type=float, default=None, help="skip single files bigger than this")
    ap.add_argument("--reserve-gb", type=float, default=3.0, help="always leave this much free space")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--retry-missing", action="store_true", help="also retry files PSI returned 404 for before")
    a = ap.parse_args()

    rows = load_inventory(a.inventory)
    dest = pathlib.Path(a.dest)
    dest.mkdir(parents=True, exist_ok=True)
    mlog = dest / MISSING_LOG
    known_missing = set(mlog.read_text(encoding="utf-8").splitlines()) if mlog.exists() and not a.retry_missing else set()
    sel = [r for r in rows if r["key"] not in known_missing and tier_of(r) <= a.tier and r["restricted"] != "True"
           and (not a.acc or r["accession"] in a.acc)
           and (a.max_file_gb is None or int(r["bytes"]) <= a.max_file_gb * 1e9)]
    total = sum(int(r["bytes"]) for r in sel)
    free = shutil.disk_usage(dest).free
    print(f"Tier {a.tier}: {len(sel)} files, {total/1e9:.2f} GB -> {dest.resolve()} (free {free/1e9:.1f} GB)"
          + (f"; skipping {len(known_missing & {r['key'] for r in rows})} files known to be missing on PSI" if known_missing else ""))
    if a.dry_run:
        by = {}
        for r in sel:
            by[r["accession"]] = by.get(r["accession"], 0) + int(r["bytes"])
        for k, v in sorted(by.items(), key=lambda x: -x[1]):
            print(f"  {k:8} {v/1e9:8.3f} GB")
        return

    done = err = nospace = 0
    missing = []
    got = 0
    with ThreadPoolExecutor(a.workers) as ex:
        futs = {ex.submit(fetch, r, dest, a.reserve_gb * 1e9): r for r in sel}
        for i, f in enumerate(as_completed(futs), 1):
            try:
                st, key, n = f.result()
                got += n
                done += st in ("ok", "skip")
                nospace += st == "nospace"
                if st == "missing":
                    missing.append(key)
            except Exception as e:
                err += 1
                print(f"  ERR {futs[f]['key']}: {e}", file=sys.stderr)
            if i % 25 == 0 or i == len(sel):
                print(f"  [{i}/{len(sel)}] downloaded {got/1e9:.2f} GB, errors {err}, missing on PSI {len(missing)}, skipped-for-space {nospace}", flush=True)
    if missing:
        with open(mlog, "a", encoding="utf-8") as fh:
            fh.writelines(k + "\n" for k in missing)
    print(f"Done: {done} ok/skipped, {err} errors, {len(missing)} missing on PSI (404, logged in {MISSING_LOG}, "
          f"not retried), {nospace} skipped for lack of space. Re-run to resume / retry errors.")


if __name__ == "__main__":
    main()
