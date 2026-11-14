import type { FeatureKey, Habitat, Investigation, TestRow } from "./types";

const PSI = 6.89476;

/** Habitat atmospheres. Sources: challenge statement (spacesuit, Moon base); NASA nominal ISS cabin. */
export const HABITATS: Habitat[] = [
  {
    id: "moon",
    name: "Moon base",
    short: "Moon",
    o2_pct: 34,
    pressure_kpa: 10.2 * PSI,
    gravity: "0.16 g",
    blurb: "Expected ≥30% O₂ at ≤10.2 psi to shorten spacesuit pre-breathe. Materials burn much more readily than in Earth air.",
    weights: { high_o2: 1.3, reduced_pressure: 1.1, partial_gravity: 1.0, prevention: 1.0, crew_materials: 1.0, suppression: 0.8, detection: 0.8, airflow: 0.4, modeling: 0.6 },
  },
  {
    id: "rover",
    name: "Pressurized rover",
    short: "Rover",
    o2_pct: 34,
    pressure_kpa: 10.2 * PSI,
    gravity: "0.16 g",
    blurb: "Same enriched atmosphere as the Moon base in a small, tightly ventilated cabin. Early detection matters most.",
    weights: { high_o2: 1.2, reduced_pressure: 1.0, partial_gravity: 0.8, detection: 1.1, airflow: 0.9, prevention: 0.9, crew_materials: 0.9, suppression: 0.9, modeling: 0.5 },
  },
  {
    id: "iss",
    name: "Spacecraft / ISS",
    short: "ISS",
    o2_pct: 21,
    pressure_kpa: 14.7 * PSI,
    gravity: "microgravity",
    blurb: "Sea-level air in microgravity. Flames rely on ventilation flow for oxygen. Includes Orion and Gateway-class cabins.",
    weights: { prevention: 1.0, detection: 1.0, suppression: 1.0, crew_materials: 1.0, airflow: 0.9, modeling: 0.6, high_o2: 0.2, reduced_pressure: 0.2 },
  },
  {
    id: "mars",
    name: "Mars habitat",
    short: "Mars",
    o2_pct: 34,
    pressure_kpa: 10.2 * PSI,
    gravity: "0.38 g",
    blurb: "Assumed to share the lunar atmosphere design. Gravity is between microgravity and 1 g, so PSI data can only bound it.",
    weights: { high_o2: 1.2, reduced_pressure: 1.0, partial_gravity: 1.2, prevention: 1.0, crew_materials: 1.0, suppression: 0.9, detection: 0.8, airflow: 0.4, modeling: 0.6 },
  },
  {
    id: "earth",
    name: "Earth applications",
    short: "Earth",
    o2_pct: 20.9,
    pressure_kpa: 101.3,
    gravity: "1 g",
    blurb: "Spin-offs: water-mist suppression, smoke detection, firefighter gear, fire modelling.",
    weights: { suppression: 1.1, detection: 1.1, prevention: 0.8, modeling: 0.8, crew_materials: 0.3 },
  },
];

export const FEATURE_LABEL: Record<FeatureKey, string> = {
  prevention: "Prevention / flammability",
  detection: "Detection (smoke, aerosol)",
  suppression: "Suppression / extinction",
  high_o2: "Elevated oxygen",
  reduced_pressure: "Reduced pressure",
  partial_gravity: "Partial-gravity relevance",
  airflow: "Airflow / ventilation",
  modeling: "Supports modelling",
  crew_materials: "Crew-cabin materials",
};

export function nearHabitat(t: Pick<TestRow, "o2_pct" | "pressure_kpa">, h: Habitat) {
  if (t.o2_pct == null || t.pressure_kpa == null) return false;
  return Math.abs(t.o2_pct - h.o2_pct) <= 5 && Math.abs(Math.log(t.pressure_kpa / h.pressure_kpa)) <= Math.log(1.25);
}

export interface Contribution {
  key: string;
  label: string;
  points: number;
  evidence: string[];
}
export interface Ranked {
  accession: string;
  score: number;
  contributions: Contribution[];
  nearTests: number;
}

/**
 * Transparent relevance score (0-100). Every point is attributable to a contribution with evidence:
 *   keyword features (capped at 4 hits each) x habitat weight
 * + atmosphere coverage: real tests within ±5% O2 and ±25% pressure of the habitat
 * + flight data bonus (microgravity > ground) + curated per-test table available
 */
export function rank(invs: Investigation[], tests: TestRow[], h: Habitat): Ranked[] {
  const near: Record<string, number> = {};
  for (const t of tests) if (t.row_kind === "test" && nearHabitat(t, h)) near[t.accession] = (near[t.accession] ?? 0) + 1;
  const maxNear = Math.max(1, ...Object.values(near));

  const raw = invs.map((inv) => {
    const contributions: Contribution[] = [];
    for (const [k, w] of Object.entries(h.weights) as [FeatureKey, number][]) {
      const ev = inv.features[k] ?? [];
      if (!ev.length) continue;
      contributions.push({ key: k, label: FEATURE_LABEL[k], points: (Math.min(ev.length, 4) / 4) * w * 10, evidence: ev });
    }
    const n = near[inv.accession] ?? 0;
    if (n) contributions.push({ key: "coverage", label: "Tests near this atmosphere", points: (n / maxNear) * 15, evidence: [`${n} tests within ±5% O₂, ±25% pressure`] });
    if (inv.microgravity) contributions.push({ key: "flight", label: "Flight (microgravity) data", points: 4, evidence: [inv.platform || "microgravity"] });
    if (inv.has_experimental_table) contributions.push({ key: "table", label: "Per-test table available", points: 3, evidence: ["PSI Experimental table"] });
    contributions.sort((a, b) => b.points - a.points);
    return { accession: inv.accession, raw: contributions.reduce((s, c) => s + c.points, 0), contributions, nearTests: n };
  });
  const max = Math.max(...raw.map((r) => r.raw));
  return raw
    .map((r) => ({ accession: r.accession, score: Math.round((100 * r.raw) / max), contributions: r.contributions, nearTests: r.nearTests }))
    .sort((a, b) => b.score - a.score);
}

export const PHASE_GROUP = (phase: string | null): "Solid materials" | "Liquid droplets" | "Gaseous flames" | "Other" => {
  if (!phase) return "Other";
  if (phase.startsWith("solid")) return "Solid materials";
  if (phase.startsWith("liquid")) return "Liquid droplets";
  if (phase.startsWith("gas")) return "Gaseous flames";
  return "Other";
};
