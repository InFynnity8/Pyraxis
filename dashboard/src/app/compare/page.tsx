import { getInvestigations, getTests } from "@/lib/data";
import { FEATURE_LABEL } from "@/lib/habitats";
import { CompareView, type CompareItem } from "@/components/compare-view";
import type { FeatureKey } from "@/lib/types";

export const metadata = { title: "Compare · PYRAXIS" };

const range = (xs: number[], d = 0, unit = "") =>
  xs.length ? (Math.min(...xs) === Math.max(...xs) ? `${Math.min(...xs).toFixed(d)}${unit}` : `${Math.min(...xs).toFixed(d)}–${Math.max(...xs).toFixed(d)}${unit}`) : "—";

export default function Page() {
  const tests = getTests();
  const items: CompareItem[] = getInvestigations().map((i) => {
    const ts = tests.filter((t) => t.accession === i.accession);
    const vals = (k: "o2_pct" | "pressure_kpa" | "flow_cm_s" | "thickness_mm" | "droplet_d0_mm") => ts.map((t) => t[k]).filter((v): v is number => v != null);
    const fuels = [...new Set(ts.map((t) => t.material || t.fuel).filter(Boolean))] as string[];
    const measured = (
      [
        ["burn_time_s", "burn time"],
        ["burning_rate_mm2_s", "burning rate"],
        ["extinction_d_mm", "extinction diameter"],
        ["n_flames", "flames ignited"],
      ] as const
    )
      .filter(([k]) => ts.some((t) => t[k] != null))
      .map(([, l]) => l);
    return {
      accession: i.accession,
      name: i.acronym || i.accession,
      rows: {
        Type: i.project_type,
        Platform: i.platform || "—",
        Hardware: i.hardware_family || i.hardware || "—",
        "Fuel phase": i.fuel_phase || "—",
        "Fuels / materials tested": fuels.slice(0, 6).join(", ") + (fuels.length > 6 ? ` +${fuels.length - 6} more` : "") || "—",
        "Tests parsed": String(ts.length || "—"),
        "O₂ range (surrounding air)": range(vals("o2_pct"), 0, "%"),
        "O₂ in burner stream (inverse flames)": range(ts.map((t) => t.burner_o2_frac).filter((v): v is number => v != null).map((v) => v * 100), 0, "%"),
        "Pressure range": range(vals("pressure_kpa"), 0, " kPa") + (ts.some((t) => t.pressure_assumed) ? " (partly assumed)" : ""),
        "Flow speed": range(vals("flow_cm_s"), 0, " cm/s"),
        "Sample thickness": range(vals("thickness_mm"), 2, " mm"),
        "Droplet diameter": range(vals("droplet_d0_mm"), 1, " mm"),
        "Outcomes measured": measured.join(", ") || "—",
        "Varied between tests": [
          new Set(vals("o2_pct").map((v) => v.toFixed(0))).size > 1 && "O₂",
          new Set(vals("pressure_kpa").map((v) => v.toFixed(0))).size > 1 && "pressure",
          fuels.length > 1 && "fuel/material",
          new Set(ts.map((t) => t.diluent).filter(Boolean)).size > 1 && "diluent",
          new Set(vals("thickness_mm")).size > 1 && "thickness",
        ]
          .filter(Boolean)
          .join(", ") || "—",
        "Fire-safety signals": (Object.keys(FEATURE_LABEL) as FeatureKey[]).filter((k) => i.features[k].length >= 2).map((k) => FEATURE_LABEL[k]).join(" · ") || "—",
        Publications: String(i.n_publications),
        "Archive size": i.size_gb >= 1000 ? `${(i.size_gb / 1000).toFixed(1)} TB` : `${i.size_gb} GB`,
      },
    };
  });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Compare investigations</h1>
        <p className="max-w-3xl text-muted-foreground">
          Pick up to four investigations to see what they share and how they differ: conditions, hardware, what was measured, and what changed
          between tests.
        </p>
      </div>
      <CompareView items={items} initial={["PSI-25", "PSI-69", "PSI-99", "PSI-159"]} />
    </div>
  );
}
