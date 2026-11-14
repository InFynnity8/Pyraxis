"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { EChartsOption } from "echarts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import dynamic from "next/dynamic";
import { axisStyle, tooltipStyle, useVizTokens } from "@/components/echart";
import { PHASE_GROUP } from "@/lib/habitats";
import type { Habitat } from "@/lib/types";

export interface MapPoint {
  acc: string;
  name: string;
  id: string | null;
  kind: "test" | "daily_summary" | "matrix";
  phase: string | null;
  what: string | null;
  o2: number;
  p: number;
  outcome: string;
  assumedP: boolean;
  diluent: string | null;
  src: string;
  notes: string | null;
}

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const GROUPS = ["Liquid droplets", "Solid materials", "Gaseous flames"] as const;
const SHAPE: Record<MapPoint["kind"], string> = { test: "circle", daily_summary: "diamond", matrix: "triangle" };
const KIND_LABEL: Record<MapPoint["kind"], string> = { test: "Individual test", daily_summary: "ISS test-day summary", matrix: "Published test-matrix point" };

export function FlammabilityMap({ points, habitats }: { points: MapPoint[]; habitats: Habitat[] }) {
  const t = useVizTokens();
  const [yMode, setYMode] = useState<"p" | "pp">("p");
  const [kinds, setKinds] = useState<string[]>(["test", "daily_summary", "matrix"]);
  const [sel, setSel] = useState<MapPoint | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");

  const shown = useMemo(() => points.filter((p) => kinds.includes(p.kind)), [points, kinds]);
  const yOf = (o2: number, p: number) => (yMode === "p" ? p : (o2 / 100) * p);

  const zoneCounts = useMemo(
    () =>
      habitats.map((h) => {
        const near = points.filter((p) => p.kind === "test" && Math.abs(p.o2 - h.o2_pct) <= 5 && Math.abs(Math.log(p.p / h.pressure_kpa)) <= Math.log(1.25));
        return { h, total: near.length, by: Object.fromEntries(GROUPS.map((g) => [g, near.filter((p) => PHASE_GROUP(p.phase) === g).length])) };
      }),
    [points, habitats],
  );

  const option: EChartsOption | null = useMemo(() => {
    if (!t) return null;
    const color = { "Liquid droplets": t.s1, "Solid materials": t.s2, "Gaseous flames": t.s3 } as const;
    const zoneData = habitats.map((h) => {
      const y0 = yOf(h.o2_pct, h.pressure_kpa / 1.25), y1 = yOf(h.o2_pct, h.pressure_kpa * 1.25);
      return [
        { name: h.short, xAxis: h.o2_pct - 5, yAxis: y0 },
        { xAxis: h.o2_pct + 5, yAxis: y1 },
      ];
    });
    return {
      animation: false,
      grid: { left: 64, right: 24, top: 40, bottom: 56 },
      legend: { top: 0, left: 0, textStyle: { color: t.text }, itemWidth: 10, itemHeight: 10, icon: "circle", data: [...GROUPS] },
      tooltip: {
        ...tooltipStyle(t),
        trigger: "item",
        formatter: (p: unknown) => {
          const d = (p as { data?: { raw?: MapPoint } }).data?.raw;
          if (!d) return (p as { name?: string }).name ?? "";
          return `<b>${d.name}</b> · ${d.id ?? ""}<br/>${d.what ?? ""}<br/>O₂ ${d.o2.toFixed(1)}% · ${d.p.toFixed(0)} kPa${d.assumedP ? " (assumed cabin)" : ""}<br/>Outcome: ${d.outcome}<br/><span style="opacity:.7">${KIND_LABEL[d.kind]} · click for source</span>`;
        },
      },
      xAxis: { type: "value", name: "Oxygen (% by volume)", nameLocation: "middle", nameGap: 32, min: 10, max: 90, ...axisStyle(t) },
      yAxis: {
        type: "log",
        logBase: 10,
        name: yMode === "p" ? "Total pressure (kPa, log)" : "O₂ partial pressure (kPa, log)",
        nameLocation: "middle",
        nameGap: 46,
        min: yMode === "p" ? 30 : 5,
        max: yMode === "p" ? 600 : 400,
        ...axisStyle(t),
      },
      series: [
        ...GROUPS.map((g) => ({
          name: g,
          type: "scatter" as const,
          symbolSize: 9,
          itemStyle: { color: color[g], opacity: 0.8, borderColor: t.card, borderWidth: 1.5 },
          emphasis: { scale: 1.6, itemStyle: { opacity: 1 } },
          data: shown
            .filter((p) => PHASE_GROUP(p.phase) === g)
            .map((p) => ({ value: [p.o2, yOf(p.o2, p.p)], symbol: SHAPE[p.kind], raw: p })),
        })),
        {
          name: "Habitat atmospheres",
          type: "scatter" as const,
          data: [],
          silent: true,
          markArea: {
            silent: true,
            itemStyle: { color: t.zone, borderColor: t.zoneLine, borderWidth: 1.5 },
            label: { show: true, position: "insideTop", color: t.text, fontWeight: 600, fontSize: 12 },
            data: zoneData as never,
          },
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, shown, yMode, habitats]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup type="multiple" value={kinds} onValueChange={(v) => v.length && setKinds(v)} variant="outline" size="sm">
          <ToggleGroupItem value="test">● Tests</ToggleGroupItem>
          <ToggleGroupItem value="daily_summary">◆ Test-day summaries</ToggleGroupItem>
          <ToggleGroupItem value="matrix">▲ Test matrix</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" value={yMode} onValueChange={(v) => v && setYMode(v as "p" | "pp")} variant="outline" size="sm">
          <ToggleGroupItem value="p">Total pressure</ToggleGroupItem>
          <ToggleGroupItem value="pp">O₂ partial pressure</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as "chart" | "table")} variant="outline" size="sm" className="ml-auto">
          <ToggleGroupItem value="chart">Chart</ToggleGroupItem>
          <ToggleGroupItem value="table">Table</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardContent className="px-3">
            {view === "chart" ? (
              option ? <ClickableChart option={option} onPick={setSel} /> : <div className="h-[380px] md:h-[520px]" aria-hidden />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Habitat zone</TableHead>
                    {GROUPS.map((g) => (
                      <TableHead key={g} className="text-right">
                        {g}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">All tests</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {zoneCounts.map((z) => (
                    <TableRow key={z.h.id}>
                      <TableCell>
                        {z.h.name} <span className="text-xs text-muted-foreground">({z.h.o2_pct}% O₂, {z.h.pressure_kpa.toFixed(0)} kPa)</span>
                      </TableCell>
                      {GROUPS.map((g) => (
                        <TableCell key={g} className="num text-right">
                          {z.by[g]}
                        </TableCell>
                      ))}
                      <TableCell className="num text-right font-medium">{z.total}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">What the map shows</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {zoneCounts.map((z) => (
                <div key={z.h.id} className="flex justify-between gap-2">
                  <span>{z.h.name}</span>
                  <span className="num font-medium text-foreground">{z.total} tests</span>
                </div>
              ))}
              <p className="pt-2 text-xs">
                Solid-material tests (fabrics, plastics) cluster at ISS air. None sit in the Moon-base zone, so the materials question for lunar
                habitats is still open.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Selected point</CardTitle>
              <CardDescription className="text-xs">Click any point on the chart.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {sel ? (
                <>
                  <Link href={`/investigations/${sel.acc}`} className="font-medium hover:underline">
                    {sel.name}
                  </Link>{" "}
                  <span className="text-muted-foreground">{sel.id}</span>
                  <div>{sel.what}</div>
                  <div className="num">
                    O₂ {sel.o2.toFixed(2)}% · {sel.p.toFixed(1)} kPa{sel.assumedP && <span className="text-muted-foreground"> (assumed ISS cabin)</span>}
                  </div>
                  {sel.diluent && <div>Diluent: {sel.diluent}</div>}
                  <div>Outcome: {sel.outcome}</div>
                  <div className="text-muted-foreground">{KIND_LABEL[sel.kind]}</div>
                  {sel.notes && <div className="text-xs text-muted-foreground">{sel.notes}</div>}
                  <div className="break-all pt-2 font-mono text-[11px] text-muted-foreground">Source: {sel.src}</div>
                </>
              ) : (
                <span className="text-muted-foreground">Nothing selected.</span>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ClickableChart({ option, onPick }: { option: EChartsOption; onPick: (p: MapPoint) => void }) {
  return (
    <div role="img" aria-label="Scatter of PSI combustion tests by oxygen and pressure with habitat zones" className="h-[380px] md:h-[520px]">
      <ReactECharts
        option={option}
        notMerge
        style={{ height: "100%", width: "100%" }}
        opts={{ renderer: "svg" }}
        onEvents={{
          click: (e: { data?: { raw?: MapPoint } }) => e.data?.raw && onPick(e.data.raw),
        }}
      />
    </div>
  );
}
