import { getInvestigations, getTests } from "@/lib/data";
import { InvestigationTable, type InvRow } from "@/components/investigation-table";

export const metadata = { title: "Investigations · PYRAXIS" };

export default function Page() {
  const tests = getTests();
  const rows: InvRow[] = getInvestigations().map((i) => {
    const ts = tests.filter((t) => t.accession === i.accession && t.o2_pct != null);
    const o2 = ts.map((t) => t.o2_pct!);
    return {
      accession: i.accession,
      name: i.acronym || i.accession,
      title: i.title,
      type: i.microgravity ? "Microgravity" : "Ground",
      subarea: i.subarea,
      fuel: i.fuel_phase ?? "",
      hardware: i.hardware_family ?? i.hardware,
      nTests: tests.filter((t) => t.accession === i.accession).length,
      o2Range: o2.length ? [Math.min(...o2), Math.max(...o2)] : null,
      sizeGb: i.size_gb,
      areas: (["prevention", "detection", "suppression"] as const).filter((k) => i.features[k].length >= 2),
    };
  });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Investigations</h1>
        <p className="max-w-3xl text-muted-foreground">
          All 24 PSI Combustion Science investigations. Areas are tagged from the investigation text, and each tag links back to the words that
          triggered it.
        </p>
      </div>
      <InvestigationTable rows={rows} />
    </div>
  );
}
