import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDetection, getInvestigations, getModel, getSmokePoints, getTests } from "@/lib/data";
import { DownloadCsv } from "@/components/download-csv";

export const metadata = { title: "Method & Earth · PYRAXIS" };

const EARTH = [
  { k: "suppression", title: "Water-mist & gaseous suppression", body: "How flames die from dilution (CO₂, He) and radiative loss informs fine-water-mist extinguishers now used in buildings, ships and data centres.", ids: ["PSI-69", "PSI-68", "PSI-25"] },
  { k: "detection", title: "Smoke detection", body: "Smoke-particle size and distribution measured without buoyancy improves detector design for aircraft cabins and homes.", ids: ["PSI-102", "PSI-101", "PSI-115"] },
  { k: "prevention", title: "Material selection & fire codes", body: "Flame-spread limits for fabrics and plastics feed flammability test standards and protective clothing for firefighters.", ids: ["PSI-98", "PSI-99", "PSI-100", "PSI-26"] },
  { k: "gear", title: "Firefighter gear: protective clothing & air tanks", body: "NASA's work on flame-resistant fabrics and lightweight breathing-air tanks for astronauts led to better turnout gear and the composite air tanks firefighters carry today. Flame-spread data on fabrics (Nomex, cotton blends) is the same science.", ids: ["PSI-26", "PSI-25", "PSI-99"] },
  { k: "modeling", title: "Cleaner combustion & soot", body: "Soot formation and flame structure data validate the combustion models used to design cleaner engines and burners.", ids: ["PSI-107", "PSI-106", "PSI-10"] },
];

export default function Page() {
  const invs = getInvestigations();
  const tests = getTests();
  const m = getModel();
  const detection = getDetection();
  const smokePoints = getSmokePoints();
  const bassLabels = tests.filter((t) => t.accession === "PSI-26");
  const DOWNLOADS = [
    { title: "All tests", file: "pyraxis_tests.csv", rows: tests as unknown as Record<string, unknown>[], what: `${tests.length.toLocaleString()} rows from 24 investigations: conditions, outcomes, measured results. SI units; every row keeps its PSI source file and row.` },
    { title: "Smoke tests (Detection)", file: "pyraxis_smoke_tests.csv", rows: detection, what: `${detection.length} SAME / SAME-R tests: detector responses, smoke mass, particle counts and size, test conditions.` },
    { title: "Smoke points (Detection)", file: "pyraxis_smoke_points.csv", rows: smokePoints, what: `${smokePoints.length} SPICE flight flames: fuel, burner, air speed, smoke-point length.` },
    { title: "Solid-material burns (Prevention)", file: "pyraxis_bass_labelled.csv", rows: bassLabels as unknown as Record<string, unknown>[], what: `${bassLabels.length} BASS tests with hand-checked labels from the crew's notes (outcome, how the flame ended, what the nitrogen jet did).` },
  ];
  const name = Object.fromEntries(invs.map((i) => [i.accession, i.acronym || i.accession]));
  const steps = [
    ["Collect", `Mapped the PSI API. Inventoried 24 combustion investigations (${invs.reduce((s, i) => s + i.n_files, 0).toLocaleString()} files, ${(invs.reduce((s, i) => s + i.size_gb, 0) / 1000).toFixed(1)} TB). Downloaded only the tables, documents and instrument logs (~16 GB, about 0.1% of the archive). The ~12 TB of raw video and images stay on PSI.`],
    ["Harmonise", `Converted 17 per-investigation test tables, plus the investigators' own data summaries (CFI), crew test notes (BASS) and 1-second instrument logs (SAME), into one schema with SI units and O₂ partial pressure: ${tests.length.toLocaleString()} rows. Every value keeps its source file and row, and assumed values are flagged.`],
    ["Rank", "Each investigation gets an explainable relevance score for each habitat: keyword evidence × habitat weights, plus how many real tests sit near that habitat's atmosphere. Every point can be traced to a reason."],
    ["Predict", `Gaussian-process models give a prediction and an uncertainty, validated by ${m.report.validation}. Wide uncertainty marks a data gap.`],
  ];
  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow">Method</div>
        <h1 className="text-2xl font-semibold tracking-tight">How this works</h1>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {steps.map(([t, b], i) => (
          <Card key={t}>
            <CardHeader className="pb-1">
              <div className="eyebrow">0{i + 1}</div>
              <CardTitle className="text-base">{t}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{b}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Limits, stated plainly</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>PSI has no partial-gravity combustion data yet (LUCI and FM2 are planned). Moon and Mars are bounded by microgravity and 1 g results; ACME E-FIELD is the only stand-in.</li>
            <li>Some solid-fuel tables (BASS, SAFFIRE) give no pressure. ISS cabin pressure is assumed and marked with *.</li>
            <li>Predictions cover droplet burning (FLEX). Solid-material spread models need the raw sensor and video data (tier 2/3).</li>
            <li>Relevance tags come from rules applied to PSI text, and their evidence words are shown. An LLM extraction pass will refine them.</li>
          </ul>
        </CardContent>
      </Card>

      <div id="downloads">
        <div className="eyebrow">Open data</div>
        <h2 className="text-xl font-semibold tracking-tight">Download the data</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Everything behind the dashboard, as plain CSV files you can open in Excel, Python or R. All values come from NASA PSI; nothing is invented, and
          assumed values are flagged.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {DOWNLOADS.map((d) => (
          <Card key={d.file}>
            <CardHeader className="pb-1">
              <CardTitle className="text-base">{d.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">{d.what}</p>
              <DownloadCsv rows={d.rows} filename={d.file} label={`Download ${d.file}`} />
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <div className="eyebrow">Down to Earth</div>
        <h2 className="text-xl font-semibold tracking-tight">Where this research helps on Earth</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {EARTH.map((e) => (
          <Card key={e.k}>
            <CardHeader className="pb-1">
              <CardTitle className="text-base">{e.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">{e.body}</p>
              <div className="flex flex-wrap gap-2">
                {e.ids.map((id) => (
                  <Link key={id} href={`/investigations/${id}`} className="rounded-md border px-2 py-0.5 font-mono text-xs hover:bg-secondary">
                    {name[id]}
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
