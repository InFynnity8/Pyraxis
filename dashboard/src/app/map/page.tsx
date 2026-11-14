import { getTests } from "@/lib/data";
import { HABITATS } from "@/lib/habitats";
import { FlammabilityMap, type MapPoint } from "@/components/flammability-map";
import { DownloadCsv } from "@/components/download-csv";

export const metadata = { title: "Flammability Map · PYRAXIS" };

export default function Page() {
  const all = getTests();
  const pts: MapPoint[] = all
    .filter((t) => t.o2_pct != null && t.pressure_kpa != null)
    .map((t) => ({
      acc: t.accession,
      name: t.acronym,
      id: t.test_id,
      kind: t.row_kind,
      phase: t.fuel_phase,
      what: t.material || t.fuel,
      o2: t.o2_pct!,
      p: t.pressure_kpa!,
      outcome: t.outcome,
      assumedP: t.pressure_assumed,
      diluent: t.diluent,
      src: `${t.source_file} · row ${t.source_row}`,
      notes: t.notes,
    }));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Flammability map</h1>
        <p className="max-w-3xl text-muted-foreground">
          Every PSI combustion test with a known oxygen level and pressure, plotted against the atmospheres crews will live in. The shaded boxes are
          habitat atmospheres (±5% O₂, ±25% pressure). Click a point to see where it came from. Oxygen here is the surrounding air; inverse flames
          (where oxygen flows from the burner, up to 85% in CFI-G) are listed under Compare instead.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <DownloadCsv rows={all as unknown as Record<string, unknown>[]} filename="pyraxis_tests.csv" label={`Download all ${all.length.toLocaleString()} test rows (CSV)`} />
          <span>One clean table from 24 investigations, SI units, every row traceable to its PSI source file and row. More datasets: <a href="/about#downloads" className="text-primary underline-offset-4 hover:underline">Download the data</a>.</span>
        </div>
      </div>
      {/* Earth sea level and ISS share one atmosphere, so they are drawn as one zone. Rover and Mars share the Moon-base atmosphere. */}
      <FlammabilityMap
        points={pts}
        habitats={HABITATS.filter((h) => h.id === "moon" || h.id === "iss").map((h) =>
          h.id === "iss" ? { ...h, name: "ISS / Earth air", short: "ISS · Earth" } : { ...h, name: "Moon base / rover / Mars", short: "Moon · Mars" },
        )}
      />
    </div>
  );
}
