"""Step 4: build the search index behind the dashboard's "Ask the data" page.

Inputs : data/inventory/investigations.json, data/processed/tests.parquet, data/processed/model_report.json,
         data/raw/PSI-*/{Science Documents,Reports,Analyzed Data,Presentations}/*.pdf   (Tier 1, on the external drive)
Output : dashboard/data/search_chunks.json   (read server-side by /api/ask; not shipped to the browser)

Each chunk = one citable passage: {id, acc, name, kind, title, text, source, href}
  kind: overview | objectives | hypothesis | approach | earth | publications | tests | findings | model | document
Run:  python pipeline/build_search_index.py [--no-docs] [--max-pages 25]
"""
import argparse, json, pathlib, re
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "dashboard/data/search_chunks.json"
DOC_CATS = ["Science Documents", "Reports", "Analyzed Data", "Presentations"]
CHUNK_CHARS = 1400


def clean(t):
    t = re.sub(r"[ \t ]+", " ", t or "")
    t = re.sub(r"\s*\n\s*", "\n", t)
    return t.strip()


def split(text, n=CHUNK_CHARS):
    """Split on paragraph/sentence boundaries into ~n-char passages."""
    paras, out, cur = re.split(r"\n{1,}", text), [], ""
    for p in paras:
        if len(cur) + len(p) + 1 <= n:
            cur = f"{cur}\n{p}" if cur else p
            continue
        if cur:
            out.append(cur)
        while len(p) > n:  # very long paragraph: cut at a sentence end
            cut = p.rfind(". ", 0, n)
            cut = cut + 1 if cut > n * 0.5 else n
            out.append(p[:cut]); p = p[cut:].lstrip()
        cur = p
    if cur:
        out.append(cur)
    return [c for c in out if len(c) > 120]


def metadata_chunks(invs):
    chunks = []
    for i in invs:
        acc, name = i["accession"], i.get("acronym") or i["accession"]
        base = dict(acc=acc, name=name, href=f"/investigations/{acc}")
        overview = (f"{name} ({acc}): {i['title']}. {i['project_type']}"
                    + (f" on {i['platform']}" if i.get("platform") else "")
                    + (f". Hardware: {i['hardware']}" if i.get("hardware") else "")
                    + (f" ({i['hardware_family']})" if i.get("hardware_family") else "")
                    + (f". Fuel: {i['fuel_phase']}" if i.get("fuel_phase") else "")
                    + (f". Sub-area: {i['subarea']}" if i.get("subarea") else "")
                    + (f". Keywords: {', '.join(i['keywords'])}" if i.get("keywords") else "")
                    + (f". PI: {i['pi']}" if i.get("pi") else "")
                    + (f". Note: {i['note']}" if i.get("note") else ""))
        chunks.append({**base, "kind": "overview", "title": f"{name}: overview", "text": overview, "source": "PSI investigation metadata"})
        for field, kind, label in [("objectives", "objectives", "Objectives"), ("hypothesis", "hypothesis", "Hypothesis"),
                                   ("approach", "approach", "Approach"), ("earth_benefits", "earth", "Research impacts / Earth benefits")]:
            for j, part in enumerate(split(i.get(field) or "")):
                chunks.append({**base, "kind": kind, "title": f"{name}: {label}" + (f" ({j+1})" if j else ""),
                               "text": part, "source": "PSI investigation metadata"})
        if i.get("publications"):
            pubs = "; ".join(i["publications"][:25])
            chunks.append({**base, "kind": "publications", "title": f"{name}: publications", "text": f"Publications from {name}: {pubs}",
                           "source": "PSI investigation metadata"})
    return chunks


def test_chunks(tests):
    chunks = []
    for acc, d in tests.groupby("accession"):
        name = d.acronym.iloc[0]
        def rng(col, unit, k=1):
            v = d[col].dropna()
            return f"{v.min():.{k}f}-{v.max():.{k}f} {unit}" if len(v) else "not reported"
        fuels = ", ".join(sorted({str(x) for x in pd.concat([d.material, d.fuel]).dropna().unique()})[:12])
        outcomes = ", ".join(f"{k}: {v}" for k, v in d.outcome.value_counts().items())
        measured = [lbl for col, lbl in [("burning_rate_mm2_s", "burning-rate constant"), ("extinction_d_mm", "extinction diameter"),
                                         ("burn_time_s", "burn time"), ("n_flames", "flames ignited per day")] if d[col].notna().any()]
        text = (f"Parsed test table for {name} ({acc}): {len(d)} rows ({', '.join(f'{k}: {v}' for k, v in d.row_kind.value_counts().items())}). "
                f"Oxygen {rng('o2_pct', '%')}; pressure {rng('pressure_kpa', 'kPa', 0)}"
                + (" (partly assumed ISS cabin pressure)" if d.pressure_assumed.any() else "")
                + f"; O2 partial pressure {rng('o2_partial_kpa', 'kPa')}. Diluents: {', '.join(sorted(d.diluent.dropna().unique())) or 'not reported'}. "
                f"Fuels/materials: {fuels or 'not reported'}. Outcomes: {outcomes}. Measured: {', '.join(measured) or 'conditions only'}. "
                f"Flow speed {rng('flow_cm_s', 'cm/s', 0)}; sample thickness {rng('thickness_mm', 'mm', 2)}; droplet diameter {rng('droplet_d0_mm', 'mm', 2)}.")
        if d.burning_rate_mm2_s.notna().any():
            g = d.dropna(subset=["burning_rate_mm2_s"]).groupby("fuel").burning_rate_mm2_s.agg(["mean", "count"])
            text += " Mean burning-rate constant by fuel: " + "; ".join(f"{f} {r['mean']:.2f} mm2/s (n={int(r['count'])})" for f, r in g.iterrows()) + "."
        chunks.append({"acc": acc, "name": name, "kind": "tests", "title": f"{name}: parsed test conditions", "text": text,
                       "source": d.source_file.iloc[0], "href": f"/investigations/{acc}"})
    return chunks


MOON = {"o2_pct": 34.0, "pressure_kpa": 10.2 * 6.89476}


def moon_phase_sentence(tests):
    """Which fuel types were tested near Moon-base air - computed, so it stays true after new data."""
    import numpy as np
    d = tests.dropna(subset=["o2_pct", "pressure_kpa"])
    near = d[(abs(d.o2_pct - MOON["o2_pct"]) <= 5) & (abs(np.log(d.pressure_kpa / MOON["pressure_kpa"])) <= np.log(1.25))]
    phases = near.fuel_phase.value_counts().to_dict()
    solid = sum(n for p, n in phases.items() if str(p).startswith("solid"))
    by = ", ".join(f"{n} {p}" for p, n in phases.items()) or "none"
    if solid == 0:
        return f"No solid-material (fabric, plastic) test in PSI sits near the Moon-base atmosphere; the nearby tests are: {by}."
    return f"Tests near the Moon-base atmosphere by fuel type: {by} (including {solid} solid-material tests)."


def habitat_prediction_sentence():
    """Habitat predictions read from the latest model.json written by train_models.py."""
    p = ROOT / "dashboard/public/data/model.json"
    if not p.exists():
        return ""
    h = json.load(open(p, encoding="utf-8"))["habitats"]
    iss, moon = h.get("ISS cabin"), h.get("Moon base / rover (expected)")
    if not (iss and moon):
        return ""
    a, b = iss["burning_rate"]["mean"], moon["burning_rate"]["mean"]
    s = (f"Predicted methanol droplet burning-rate constant (2 mm, N2 diluent): about {a:.2f} mm2/s in ISS/Earth air and about {b:.2f} mm2/s "
         f"(±{1.96 * moon['burning_rate']['sd']:.2f} at 95%) in Moon-base air (34% O2, 70 kPa), roughly {abs(b / a - 1):.0%} "
         f"{'faster' if b >= a else 'slower'}.")
    suit = h.get("Spacesuit")
    if suit and not suit.get("inside_training_range", True):
        s += " Spacesuit atmosphere (100% O2, 30 kPa) is outside the tested range."
    return s


def official_chunks():
    """Challenge official resources under data/official/: every page of every PDF (they're short and
    high-value, so no page cap) plus saved web pages as .txt (first line 'Source: <url>')."""
    from pypdf import PdfReader
    base = ROOT / "data/official"
    nice = lambda f: re.sub(r"^factsheet_", "Fact sheet: ", f.stem).replace("_", " ").replace("-", " ")
    chunks, n_pdf, n_txt, n_fail = [], 0, 0, 0
    for f in sorted(base.rglob("*.pdf")):
        try:
            pages = PdfReader(str(f)).pages
            n_pdf += 1
            for pno, p in enumerate(pages, 1):
                for part in split(clean(p.extract_text() or "")):
                    chunks.append({"acc": None, "name": "Official resource", "kind": "document",
                                   "title": nice(f) + (f", p.{pno}" if len(pages) > 1 else ""), "text": part,
                                   "source": f"{f.relative_to(ROOT).as_posix()}#page={pno}", "href": "/about"})
        except Exception:
            n_fail += 1
    for f in sorted(base.rglob("*.txt")):
        raw = f.read_text(encoding="utf-8", errors="ignore")
        url = raw.splitlines()[0].removeprefix("Source: ").strip() if raw.startswith("Source:") else ""
        n_txt += 1
        for part in split(clean(raw.split("\n", 1)[-1] if url else raw)):
            chunks.append({"acc": None, "name": "Official resource", "kind": "document", "title": nice(f), "text": part,
                           "source": url or f.relative_to(ROOT).as_posix(), "href": "/about"})
    if n_pdf or n_txt or n_fail:
        print(f"  official resources: {n_pdf} PDFs + {n_txt} web pages read, {n_fail} unreadable")
    return chunks


def findings_chunks(tests, report):
    hc = report["habitat_coverage"]; m = report["models"]
    near = lambda k: hc[k]["tests_within_5pctO2_25pctP"]
    text = ("Coverage of PSI combustion tests near habitat atmospheres (within ±5% O2 and ±25% pressure, all row kinds): "
            + "; ".join(f"{k}: {v['tests_within_5pctO2_25pctP']} tests ({', '.join(f'{a} {n}' for a, n in v['by_investigation'].items()) or 'none'})"
                        for k, v in hc.items())
            + ". Moon base / pressurized rover atmosphere is expected at about 34% O2 and 10.2 psi (70 kPa). "
            + moon_phase_sentence(tests)
            + " PSI has no partial-gravity combustion data yet (LUCI and FM2 planned); ACME E-FIELD mimics partial gravity with an electric field.")
    model = (f"Gaussian-process models trained on FLEX and CFI droplet tests, validated with {report['validation']} against mean and linear baselines. "
             + "; ".join(f"{k} (n={v['n']}): " + ", ".join(f"{mk} " + ", ".join(f"{a}={b:.2f}" for a, b in mv.items() if isinstance(b, (int, float)))
                                                               for mk, mv in v["metrics"].items() if isinstance(mv, dict))
                         for k, v in m.items())
             + ". " + habitat_prediction_sentence())
    return [
        {"acc": None, "name": "Project findings", "kind": "findings", "title": "Evidence coverage by habitat atmosphere", "text": text,
         "source": "data/processed/model_report.json", "href": "/map"},
        {"acc": None, "name": "Project findings", "kind": "model", "title": "Flammability model results", "text": model,
         "source": "data/processed/model_report.json", "href": "/model"},
    ] + layer_chunks()


def layer_chunks():
    """Plain-language findings for the three fire-safety layers (from layers.json, written by train_models.py)."""
    f = ROOT / "dashboard/public/data/layers.json"
    if not f.exists():
        return []
    L = json.loads(f.read_text(encoding="utf-8"))
    pv, dt, sp = L["prevention"], L["detection"], L["suppression"]
    prev = (f"Prevention layer (BASS solid-material burns aboard the ISS, {pv['n']} labelled tests, {pv['n'] - pv['positives']} did not keep burning). "
            + "; ".join(f"{m['material']}: {m['sustained']} of {m['tests']} kept burning, lowest O2 that burned "
                        f"{m['lowest_o2_pct_that_burned'] or 0:.1f}%, {m['extinguished_by_low_flow']} went out when air flow was cut, "
                        f"{m['extinguished_by_n2']} put out by nitrogen" for m in pv["materials"])
            + f". Classifier P(keeps burning): AUC {pv['metrics']['gp']['AUC']:.2f}. Limits: {pv['limits']}")
    det = (f"Detection layer (SAME and SAME-R smoke tests, {dt['smoke_tests']} tests). By material: "
           + "; ".join(f"{r['material']}: median smoke mass {r['smoke_mass_mg_m3_median'] or 0:.1f} mg/m3, particle size index "
                       f"{r['diameter_index_um_median'] or 0:.2f} um, ISS photoelectric obscuration responded in "
                       f"{(r.get('iss_obscuration_response_rate') or 0) * 100:.0f}% of tests, ionisation detector B in "
                       f"{(r.get('ion_b_response_rate') or 0) * 100:.0f}%" for r in dt["by_material"])
           + ". Teflon and Kapton make the smallest particles, which the obscuration detector sees least often. SPICE smoke points "
           + "(shorter = sootier): " + "; ".join(f"{s['fuel']} at {s['fuel_mole_frac'] * 100:.0f}% {s['median']} mm" for s in dt["smoke_points"])
           + f". Limits: {dt['limits']}")
    cf = sp["cool_flame"]
    sup = (f"Suppression layer. FLEX diluents: " + "; ".join(f"{d['diluent']}: flame went out in {d['extinguished']} of {d['tests']} tests"
                                                         for d in sp["diluents"])
           + f". CFI: in {cf['cool_flame_after_hot_extinction']} of {cf['tests']} analysed tests a cool flame kept burning after the visible "
           f"flame went out; {cf['reignitions_tests']} tests re-ignited. BASS: {sp['nitrogen_on_solids']['tests_extinguished_by_n2']} solid "
           f"flames were put out with nitrogen and {sp['nitrogen_on_solids']['tests_extinguished_by_low_flow']} by cutting the air flow.")
    mk = lambda kind, title, text: {"acc": None, "name": "Project findings", "kind": "findings", "title": title, "text": text,
                                    "source": "dashboard/public/data/layers.json", "href": "/layers"}
    return [mk("findings", "Prevention: which solids keep burning", prev),
            mk("findings", "Detection: smoke and detectors", det),
            mk("findings", "Suppression: putting flames out", sup)]


def document_chunks(invs, max_pages):
    from pypdf import PdfReader
    names = {i["accession"]: i.get("acronym") or i["accession"] for i in invs}
    chunks, n_pdf, n_fail = [], 0, 0
    for acc in names:
        for cat in DOC_CATS:
            for f in sorted((ROOT / "data/raw" / acc / cat).glob("*")):
                if f.suffix.lower() != ".pdf":
                    continue
                try:
                    r = PdfReader(str(f))
                    pages = r.pages[:max_pages]
                    title = re.sub(rf"^{acc}_{cat}_", "", f.stem)
                    n_pdf += 1
                    for pno, p in enumerate(pages, 1):
                        txt = clean(p.extract_text() or "")
                        for k, part in enumerate(split(txt)):
                            chunks.append({"acc": acc, "name": names[acc], "kind": "document",
                                           "title": f"{names[acc]}: {title}" + (f", p.{pno}" if len(pages) > 1 else ""),
                                           "text": part, "source": f"data/raw/{acc}/{cat}/{f.name}#page={pno}",
                                           "href": f"/investigations/{acc}"})
                except Exception:
                    n_fail += 1
    print(f"  documents: {n_pdf} PDFs read, {n_fail} unreadable")
    return chunks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-docs", action="store_true")
    ap.add_argument("--max-pages", type=int, default=25)
    a = ap.parse_args()
    invs = json.load(open(ROOT / "dashboard/public/data/investigations.json", encoding="utf-8"))  # cleaned version
    tests = pd.read_parquet(ROOT / "data/processed/tests.parquet")
    report = json.load(open(ROOT / "data/processed/model_report.json", encoding="utf-8"))

    chunks = metadata_chunks(invs) + test_chunks(tests) + findings_chunks(tests, report)
    if not a.no_docs:
        if (ROOT / "data/raw").exists():
            chunks += document_chunks(invs, a.max_pages)
        else:
            print("  data/raw not found (external drive unplugged?) - skipping documents")
        chunks += official_chunks()
    for n, c in enumerate(chunks):
        c["id"] = n
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(chunks, ensure_ascii=False), encoding="utf-8")
    kinds = pd.Series([c["kind"] for c in chunks]).value_counts().to_dict()
    print(f"wrote {len(chunks)} chunks ({OUT.stat().st_size/1e6:.1f} MB): {kinds}")


if __name__ == "__main__":
    main()
