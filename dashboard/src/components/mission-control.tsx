"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Habitat } from "@/lib/types";
import type { Ranked } from "@/lib/habitats";

export interface HabitatView {
  habitat: Habitat;
  ranked: Ranked[];
  nearTests: number;
  nearInvestigations: number;
  nearSolid: number;
  burnRate: { mean: number; sd: number; vsIssPct: number } | null;
}
type Lite = { accession: string; name: string; title: string; subarea: string; microgravity: boolean };

export function MissionControl({ views, invs, totalTests }: { views: HabitatView[]; invs: Record<string, Lite>; totalTests: number }) {
  const router = useRouter();
  const [id, setId] = useState(views[0].habitat.id);
  const v = views.find((x) => x.habitat.id === id)!;
  const h = v.habitat;
  const pct = (100 * v.nearTests) / totalTests;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Which fire-safety evidence exists for your crew habitat?</h1>
        <p className="max-w-3xl text-muted-foreground">
          24 NASA combustion investigations, {totalTests.toLocaleString()} individual tests, ranked for the atmosphere your crew will breathe.
          Pick a habitat.
        </p>
        <ToggleGroup type="single" value={id} onValueChange={(x) => x && setId(x)} variant="outline" className="flex-wrap justify-start">
          {views.map((x) => (
            <ToggleGroupItem key={x.habitat.id} value={x.habitat.id} className="px-4">
              {x.habitat.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </section>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{h.name}</CardTitle>
          <CardDescription>
            <span className="num">{h.o2_pct}% O₂</span> · <span className="num">{h.pressure_kpa.toFixed(0)} kPa ({(h.pressure_kpa / 6.89476).toFixed(1)} psi)</span> ·{" "}
            {h.gravity} · O₂ partial pressure <span className="num">{((h.o2_pct / 100) * h.pressure_kpa).toFixed(1)} kPa</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{h.blurb}</CardContent>
      </Card>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Tests near this atmosphere" value={v.nearTests.toLocaleString()} sub={`${pct.toFixed(1)}% of all tests · ±5% O₂, ±25% pressure`} alert={v.nearTests < 50} />
        <Stat label="Investigations with such tests" value={String(v.nearInvestigations)} sub="of 24 combustion investigations" alert={v.nearInvestigations < 3} />
        <Stat label="Solid-material tests here" value={String(v.nearSolid)} sub="fabrics, plastics: what cabins are made of" alert={v.nearSolid === 0} />
        <Stat
          label="Predicted droplet burning rate"
          value={v.burnRate ? `${v.burnRate.vsIssPct >= 0 ? "+" : ""}${v.burnRate.vsIssPct.toFixed(0)}%` : "n/a"}
          sub={v.burnRate ? `vs ISS · K = ${v.burnRate.mean.toFixed(2)} ± ${(1.96 * v.burnRate.sd).toFixed(2)} mm²/s (95%)` : "outside model scope"}
          alert={!!v.burnRate && v.burnRate.vsIssPct > 10}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Most relevant investigations for {h.name.toLowerCase()}</CardTitle>
          <CardDescription>
            Click a row to open the investigation. Every point of the score comes from a listed reason. Hover a reason to see its evidence.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="divide-y">
            {v.ranked.map((r, i) => {
              const inv = invs[r.accession];
              return (
                <li
                  key={r.accession}
                  onClick={() => router.push(`/investigations/${r.accession}`)}
                  className="group -mx-3 grid cursor-pointer grid-cols-[2rem_1fr] gap-3 rounded-md px-3 py-3 transition-colors hover:bg-secondary/60 md:grid-cols-[2rem_14rem_1fr_9rem_1rem] md:items-center"
                >
                  <span className="num text-muted-foreground">{i + 1}</span>
                  <div className="min-w-0">
                    <Link href={`/investigations/${r.accession}`} className="font-medium hover:underline">
                      {inv.name}
                    </Link>
                    <div className="truncate text-xs text-muted-foreground" title={inv.title}>
                      {inv.title}
                    </div>
                  </div>
                  <div className="col-start-2 flex flex-wrap gap-1.5 md:col-start-auto">
                    {r.contributions.slice(0, 4).map((c) => (
                      <Tooltip key={c.key}>
                        <TooltipTrigger asChild>
                          <Badge variant="secondary" className="cursor-help font-normal">
                            {c.label}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <div className="font-medium">+{c.points.toFixed(1)} pts</div>
                          <div className="text-xs opacity-80">{c.evidence.join(" · ")}</div>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                  <div className="col-start-2 flex items-center gap-2 md:col-start-auto">
                    <div className="h-1.5 flex-1 rounded-full bg-secondary" aria-hidden>
                      <div className="h-1.5 rounded-full" style={{ width: `${r.score}%`, background: "var(--series-1)" }} />
                    </div>
                    <span className="num w-8 text-right text-sm">{r.score}</span>
                  </div>
                  <ChevronRight className="hidden size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 md:block" aria-hidden />
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub, alert }: { label: string; value: string; sub: string; alert?: boolean }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="space-y-1 px-4">
        <div className="eyebrow">{label}</div>
        <div className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
          {value}
          {alert && (
            <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: "color-mix(in srgb, var(--status-warning) 18%, transparent)", color: "var(--foreground)" }}>
              ⚠ data gap
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}
