import { getDetection, getLayers, getModel, getSmokePoints, getTests } from "@/lib/data";
import { LayersView } from "@/components/layers-view";

export const metadata = { title: "Fire-safety layers · PYRAXIS" };

export default function Page() {
  const L = getLayers();
  const M = getModel();
  const downloads = {
    bass: getTests().filter((t) => t.accession === "PSI-26") as unknown as Record<string, unknown>[],
    detection: getDetection(),
    smokePoints: getSmokePoints(),
  };
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fire-safety layers</h1>
        <p className="max-w-3xl text-muted-foreground">
          Spacecraft fire safety works in three layers: stop fires starting, notice them early, and put them out for good. Each layer below is built from
          different PSI investigations, with a model checked against simple baselines on tests it never saw.
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          <a href="#prevention" className="text-primary underline-offset-4 hover:underline">Prevention</a>
          <a href="#detection" className="text-primary underline-offset-4 hover:underline">Detection</a>
          <a href="#suppression" className="text-primary underline-offset-4 hover:underline">Suppression</a>
          <a href="#equipment" className="text-primary underline-offset-4 hover:underline">From data to equipment</a>
        </div>
      </div>
      <LayersView L={L} M={M} downloads={downloads} />
    </div>
  );
}
