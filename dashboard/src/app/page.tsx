import { getInvestigations, getModel, getTests } from "@/lib/data";
import { HABITATS, PHASE_GROUP, nearHabitat, rank } from "@/lib/habitats";
import { MissionControl, type HabitatView } from "@/components/mission-control";

const MODEL_NAME: Record<string, string> = {
  moon: "Moon base / rover (expected)",
  rover: "Moon base / rover (expected)",
  mars: "Mars habitat (assumed = Moon)",
  iss: "ISS cabin",
  earth: "Earth sea level",
};

export default function Page() {
  const invs = getInvestigations();
  const tests = getTests();
  const model = getModel();
  const iss = model.habitats["ISS cabin"].burning_rate.mean;

  const views: HabitatView[] = HABITATS.map((h) => {
    const near = tests.filter((t) => t.row_kind === "test" && nearHabitat(t, h));
    const pred = model.habitats[MODEL_NAME[h.id]];
    return {
      habitat: h,
      ranked: rank(invs, tests, h).slice(0, 10),
      nearTests: near.length,
      nearInvestigations: new Set(near.map((t) => t.acronym)).size,
      nearSolid: near.filter((t) => PHASE_GROUP(t.fuel_phase) === "Solid materials").length,
      burnRate: pred ? { mean: pred.burning_rate.mean, sd: pred.burning_rate.sd, vsIssPct: (100 * (pred.burning_rate.mean - iss)) / iss } : null,
    };
  });

  const lite = Object.fromEntries(
    invs.map((i) => [i.accession, { accession: i.accession, name: i.acronym || i.accession, title: i.title, subarea: i.subarea, microgravity: i.microgravity }]),
  );

  return <MissionControl views={views} invs={lite} totalTests={tests.filter((t) => t.row_kind === "test").length} />;
}
