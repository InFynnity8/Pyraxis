"""Step 1 of the pipeline: clean PSI investigation metadata + file stats -> dashboard JSON.

Inputs : data/inventory/investigations.json, data/inventory/files.csv
Outputs: data/processed/investigations.parquet, dashboard/public/data/investigations.json

Every derived feature is rule-based and records the evidence (matched keywords) so the
dashboard can explain *why* an investigation ranks where it does. Manual facts carry a
source string (challenge statement / PSI metadata) - no unsourced numbers.
"""
import csv, json, re, pathlib, collections
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[1]
INV = ROOT / "data/inventory"
OUT_PARQ = ROOT / "data/processed/investigations.parquet"
OUT_JSON = ROOT / "dashboard/public/data/investigations.json"


def clean(t):
    if not isinstance(t, str):
        return ""
    t = t.replace("�", "'").replace("\r", "")
    t = re.sub(r"[ \t]{2,}", " ", t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def split_multi(t):
    """PSI separates list items with runs of 4-5 spaces."""
    return [clean(x) for x in re.split(r"\s{4,}", t or "") if clean(x)]


# --- Facts from the challenge statement (source noted) --------------------------------------
HARDWARE_FAMILY = {  # challenge.txt "Hardware" section
    **{a: "ACME modular hardware in Combustion Integrated Rack (CIR)" for a in ["PSI-10", "PSI-20", "PSI-21", "PSI-22", "PSI-23", "PSI-159"]},
    **{a: "Multi-user Droplet Combustion Apparatus (MDCA) in CIR" for a in ["PSI-68", "PSI-69", "PSI-39"]},
    **{a: "SPICE flow duct in Microgravity Science Glovebox (MSG)" for a in ["PSI-25", "PSI-26", "PSI-106", "PSI-107"]},
    **{a: "Cygnus cargo vehicle (post-ISS departure)" for a in ["PSI-98", "PSI-99", "PSI-100"]},
}
FUEL_PHASE = {
    "PSI-10": "gas", "PSI-20": "gas (emulates solids)", "PSI-21": "gas", "PSI-22": "gas", "PSI-23": "gas",
    "PSI-159": "gas", "PSI-68": "liquid droplet", "PSI-69": "liquid droplet", "PSI-39": "liquid droplet",
    "PSI-25": "solid + gas", "PSI-26": "solid + gas", "PSI-106": "gas", "PSI-107": "gas",
    "PSI-98": "solid", "PSI-99": "solid", "PSI-100": "solid",
    "PSI-101": "smoke aerosol", "PSI-102": "smoke aerosol", "PSI-47": "dust aerosol",
    "PSI-117": "liquid droplet", "PSI-142": "liquid droplet", "PSI-60": "gas", "PSI-62": "solid", "PSI-115": "smoke aerosol",
}
SPECIAL_NOTES = {  # challenge.txt "Potential Considerations"
    "PSI-159": "Highest-O2 microgravity tests in PSI: O2/N2 up to 85% O2 flowing from a spherical burner (inside-out flame).",
    "PSI-22": "Electric field acts on flame ions to mimic partial gravity - the only PSI proxy for Moon/Mars gravity.",
    "PSI-20": "Gaseous-fuel burner that emulates materials flammability in still atmospheres as a function of material properties.",
    "PSI-47": "Uses one of the SAME/SAME-R smoke instruments to detect dust instead.",
    "PSI-69": "Suppression by diluting the chamber atmosphere with CO2 and helium.",
}

# --- Rule-based features (keyword evidence) --------------------------------------------------
RULES = {
    "prevention": r"flammab|flame spread|ignit|material|solid fuel|burning rate|extinction limit|oxygen index|PMMA|cotton|fabric|NASA-STD-6001",
    "detection": r"smoke|aerosol|detect|particulate|soot|dust",
    "suppression": r"suppress|extingui|CO2|carbon dioxide|helium|dilut|fire.?fight|water.?mist",
    "high_o2": r"elevated oxygen|high oxygen|oxygen.enrich|\b(3\d|[4-9]\d|100) ?% ?O2|\b(3\d|[4-9]\d)% oxygen|85%",
    "reduced_pressure": r"reduced pressure|low pressure|sub-?atmospheric|\bpsi[a]?\b|\bkPa\b|\batm\b",
    "partial_gravity": r"partial.gravit|lunar|moon|mars|martian|electric.field",
    "airflow": r"flow (speed|velocity)|forced flow|ventilat|airflow|air flow|co-?flow|opposed.flow|concurrent",
    "modeling": r"model|simulat|computational|CFD|numerical|predict",
    "crew_materials": r"spacecraft fire|crew|cabin|habitat|spacecraft materials|fabric|cotton|acrylic|PMMA|Nomex|silicone",
}


def evidence(text, pattern):
    hits = sorted({m.group(0).lower() for m in re.finditer(pattern, text, re.I)})
    return hits[:8]


def main():
    invs = json.load(open(INV / "investigations.json", encoding="utf-8"))
    files = list({f["key"]: f for f in csv.DictReader(open(INV / "files.csv", encoding="utf-8"))}.values())  # PSI lists some files twice: count each once
    fstat = collections.defaultdict(lambda: {"n_files": 0, "bytes": 0, "categories": collections.Counter(), "ext": collections.Counter()})
    for f in files:
        s = fstat[f["accession"]]
        s["n_files"] += 1; s["bytes"] += int(f["bytes"]); s["categories"][f["category"]] += 1; s["ext"][f["ext"]] += 1

    recs = []
    for s in sorted(invs, key=lambda x: int(x["Accession"].split("-")[1])):
        acc = s["Accession"]
        text = " ".join(clean(s.get(k)) for k in ["Title", "Keywords", "Objectives", "Approach", "Hypothesis",
                                                     "Research Impacts/Earth Benefits", "SubResearch Area", "Publication Title"])
        feats = {k: evidence(text, p) for k, p in RULES.items()}
        if acc == "PSI-159": feats["high_o2"] = sorted(set(feats["high_o2"] + ["up to 85% o2 (challenge statement)"]))
        if acc == "PSI-22": feats["partial_gravity"] = sorted(set(feats["partial_gravity"] + ["mimics partial gravity (challenge statement)"]))
        fs = fstat[acc]
        person = s.get("Person") or {}
        pubs = split_multi(s.get("Publication Title"))
        hw = s.get("Experiment Hardware") or {}
        recs.append({
            "accession": acc,
            "acronym": clean(s.get("Acronym")) or None,
            "title": clean(s["Title"]),
            "project_type": s.get("Project Type"),
            "microgravity": s.get("Project Type") == "Microgravity Investigation",
            "subarea": clean(s.get("SubResearch Area")),
            "platform": clean(s.get("Flight Platform")),
            "hardware": clean(hw.get("Name")) if isinstance(hw, dict) else clean(str(hw)),
            "hardware_link": hw.get("Link") if isinstance(hw, dict) else None,
            "hardware_family": HARDWARE_FAMILY.get(acc),
            "fuel_phase": FUEL_PHASE.get(acc),
            "note": SPECIAL_NOTES.get(acc),
            "pi": clean(f"{person.get('First Name','')} {person.get('Last Name','')}") if isinstance(person, dict) else "",
            "start": s.get("Investigation Start Date"), "end": s.get("Investigation End Date"),
            "keywords": split_multi(s.get("Keywords")),
            "related": split_multi(s.get("Related Investigations")),
            "objectives": clean(s.get("Objectives")),
            "hypothesis": clean(s.get("Hypothesis")),
            "approach": clean(s.get("Approach")),
            "earth_benefits": clean(s.get("Research Impacts/Earth Benefits")),
            "publications": pubs,
            "n_publications": len(pubs),
            "features": feats,
            "n_files": fs["n_files"],
            "size_gb": round(fs["bytes"] / 1e9, 2),
            "file_categories": dict(fs["categories"]),
            "has_experimental_table": fs["categories"].get("Experimental table", 0) > 0,
            "has_analyzed_data": fs["categories"].get("Analyzed Data", 0) > 0,
            "psi_url": f"https://psi.nasa.gov/physci/repo/data/investigations/{acc}",
            "thumbnail": f"https://psi.nasa.gov{s['Thumbnail']}" if s.get("Thumbnail") else None,
        })

    OUT_PARQ.parent.mkdir(parents=True, exist_ok=True); OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(recs).assign(features=lambda d: d.features.map(json.dumps), file_categories=lambda d: d.file_categories.map(json.dumps)).to_parquet(OUT_PARQ)
    json.dump(recs, open(OUT_JSON, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"wrote {len(recs)} investigations")
    for r in recs:
        print(f"{r['accession']:8} {str(r['acronym'] or '-')[:16]:16}", {k: len(v) for k, v in r["features"].items()})


if __name__ == "__main__":
    main()
