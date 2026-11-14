import { getModel } from "@/lib/data";
import { ModelView } from "@/components/model-view";

export const metadata = { title: "Predictions · PYRAXIS" };

export default function Page() {
  const m = getModel();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Predictions with uncertainty</h1>
        <p className="max-w-3xl text-muted-foreground">
          Gaussian-process models trained on {m.report.models.burning_rate.n} FLEX and CFI droplet tests predict how fast fuel burns, and when flames go
          out, in habitat atmospheres. Wide uncertainty means the data is thin there. Those are the places a new experiment would teach us most.
        </p>
      </div>
      <ModelView m={m} />
    </div>
  );
}
