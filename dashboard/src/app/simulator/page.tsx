import { getModel, getTests } from "@/lib/data";
import { FireSimulator, type EvidenceGrid, type EvidencePoint } from "@/components/fire-simulator";

export const metadata = { title: "Fire simulator · PYRAXIS" };

export default function Page() {
  // slim evidence set: every test with a known surrounding-air oxygen and pressure
  const evidence: EvidencePoint[] = getTests()
    .filter((t) => t.o2_pct != null && t.pressure_kpa != null)
    .map((t) => ({ o2: t.o2_pct as number, p: t.pressure_kpa as number, phase: t.fuel_phase, acr: t.acronym }));
  const m = getModel();
  const grid: EvidenceGrid | null = m.grid
    ? { o2: m.grid.o2_pct, p: m.grid.pressure_kpa, mean: m.grid.burning_rate_mean, sd: m.grid.burning_rate_sd }
    : null;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fire simulator</h1>
        <p className="max-w-4xl text-muted-foreground">
          Light a sample in any habitat&apos;s air and watch the whole chain: ignition, how gravity and ventilation shape the flame, when each smoke
          detector trips, and whether the crew&apos;s response puts it out. Run two atmospheres side by side. Every scenario shows how many real NASA
          tests sit near it, so you can see where the simulation stands on evidence and where it extrapolates.
        </p>
      </div>
      <FireSimulator evidence={evidence} grid={grid} />
      <details className="rounded-lg border p-4 text-sm text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">How the simulation works, and its limits</summary>
        <div className="mt-3 space-y-2">
          <p>
            A reduced-order physics model of a 24 × 16 cm slice of cabin around a burning sample (96 × 64 cells), solved live in your browser:
            incompressible air flow with buoyancy that scales with gravity, one-step combustion whose rate rises with oxygen concentration,
            diffusion that speeds up at low pressure, radiative heat loss, solid fuel that gasifies when hot, smoke transport, two virtual detectors
            and four suppression systems.
          </p>
          <p>
            <b className="text-foreground">Calibrated against NASA PSI data:</b> material oxygen limits follow BASS (acrylic burned down to 16.7% O₂, Nomex
            rarely burned in air); smoke yields and particle sizes come from SAME/SAME-R; photoelectric detectors lose sensitivity for the fine
            Teflon/Kapton particles, as SAME found; still air starves flames in microgravity and a nitrogen jet rarely puts them out, as in BASS.
            Partial gravity (Moon, Mars) is bounded by the microgravity and 1 g behaviour, as the challenge suggests: PSI has no partial-gravity data yet.
          </p>
          <p>
            <b className="text-foreground">Limits:</b> two-dimensional, laminar, and centimetre-scale. It shows trends and comparisons, not certified
            predictions of real fire size or timing. Use the evidence meter: where it says &ldquo;none&rdquo;, the scenario is extrapolation.
          </p>
        </div>
      </details>
    </div>
  );
}
