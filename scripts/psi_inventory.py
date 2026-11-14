"""Inventory the 24 PSI Combustion Science investigations (metadata + file lists + sizes).

Usage:  python scripts/psi_inventory.py [OUT_DIR]
Writes: OUT_DIR/investigations.json, OUT_DIR/files.csv, prints a size summary.
Downloads NO data files - only listings. Safe to run on any disk.
"""
import csv, json, sys, urllib.request, pathlib

API = "https://psi.nasa.gov/geode-py/ws"
UA = {"User-Agent": "psi-hackathon-inventory/1.0", "Content-Type": "application/json"}


def http(url, body=None, tries=4):
    """POST/GET JSON with retries. A version that doesn't exist answers 4xx at once (no retry);
    network hiccups and 5xx are retried, so a flaky moment can't make a listing silently shrink."""
    import time, urllib.error
    data = json.dumps(body).encode() if body is not None else None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=UA, method="POST" if data else "GET")
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code < 500 or i == tries - 1:
                raise
        except Exception:
            if i == tries - 1:
                raise
        time.sleep(3 * (i + 1))


def combustion_investigations():
    hits = http(f"{API}/repo/search?q=&data_source=psi&data_type=investigation&size=500")["hits"]["hits"]
    return [h["_source"] for h in hits if "Combustion" in str(h["_source"].get("Research Area"))]


def list_files(acc):
    """Return (version, flat list of file dicts). Tries versions 1..5, keeps the highest that exists."""
    best = (None, [])
    for v in range(1, 6):
        try:
            tree = http(f"{API}/files/v2", {"folder": "", "fileType": "study", "studyId": acc, "version": str(v)})
        except Exception:
            break
        flat = []
        def walk(nodes):
            for n in nodes:
                if n.get("directory") is False and n.get("key"):
                    flat.append(n)
                walk(n.get("files") or [])
        walk(tree.get("files") or [])
        best = (v, flat)
    return best


def main():
    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "data/inventory")
    out.mkdir(parents=True, exist_ok=True)
    invs = sorted(combustion_investigations(), key=lambda s: int(s["Accession"].split("-")[1]))
    (out / "investigations.json").write_text(json.dumps(invs, indent=2), encoding="utf-8")

    rows, total = [], 0
    print(f"{'Accession':9} {'Acronym':22} {'ver':>3} {'files':>6} {'GB':>8}")
    for s in invs:
        acc = s["Accession"]
        ver, files = list_files(acc)
        size = sum(f.get("bytes_size") or 0 for f in files)
        total += size
        print(f"{acc:9} {(s.get('Acronym') or '-')[:22]:22} {ver or '-':>3} {len(files):>6} {size/1e9:8.2f}")
        for f in files:
            rows.append({"accession": acc, "acronym": s.get("Acronym"), "version": ver,
                         "category": f.get("sortingCategory"), "key": f["key"],
                         "bytes": int(f.get("bytes_size") or 0),
                         "ext": pathlib.PurePosixPath(f["key"]).suffix.lower(),
                         "restricted": f.get("restricted")})
    with open(out / "files.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)

    print(f"\nTOTAL: {len(rows)} files, {total/1e9:.1f} GB")
    by_ext = {}
    for r in rows:
        by_ext[r["ext"]] = by_ext.get(r["ext"], 0) + r["bytes"]
    print("By extension (GB):", {k: round(v/1e9, 2) for k, v in sorted(by_ext.items(), key=lambda x: -x[1])[:15]})


if __name__ == "__main__":
    main()
