"use client";

import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EChart, axisStyle, tooltipStyle, useVizTokens } from "@/components/echart";
import type { ModelData } from "@/lib/types";
import { HabitatOutlook } from "@/components/habitat-outlook";

const SEQ_DARK = ["#104281", "#1c5cab", "#2a78d6", "#5598e7", "#86b6ef", "#b7d3f6"]; // blue ramp, dark surface: low=dark
const SEQ_LIGHT = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"]; // light surface: low=light

export function ModelView({ m }: { m: ModelData }) {
  const t = useVizTokens();
  const [layer, setLayer] = useState<"mean" | "sd">("mean");
  const habs = Object.entries(m.habitats);

  const whisker: EChartsOption | null = useMemo(() => {
    if (!t) return null;
    const names = habs.map(([n]) => n);
    return {
      animation: false,
      grid: { left: 200, right: 40, top: 16, bottom: 48 },
      tooltip: {
        ...tooltipStyle(t),
        formatter: (p: unknown) => {
          const i = (p as { dataIndex: number }).dataIndex;
          const [n, h] = habs[i];
          return `<b>${n}</b><br/>K = ${h.burning_rate.mean.toFixed(3)} mm²/s<br/>95% interval ± ${(1.96 * h.burning_rate.sd).toFixed(3)}<br/>${h.inside_training_range ? "inside training data range" : "<b>extrapolation</b>: outside training data"}`;
        },
      },
      xAxis: { type: "value", name: "Droplet burning-rate constant K (mm²/s)", nameLocation: "middle", nameGap: 30, min: 0, ...axisStyle(t) },
      yAxis: { type: "category", data: names, inverse: true, ...axisStyle(t), splitLine: { show: false } },
      series: [
        {
          type: "custom",
          renderItem: (_params, api) => {
            const i = api.value(0) as number;
            const [, h] = habs[i];
            const lo = api.coord([Math.max(0, h.burning_rate.mean - 1.96 * h.burning_rate.sd), i]);
            const hi = api.coord([h.burning_rate.mean + 1.96 * h.burning_rate.sd, i]);
            const mid = api.coord([h.burning_rate.mean, i]);
            const c = h.inside_training_range ? t.s1 : t.axis;
            return {
              type: "group",
              children: [
                { type: "line", shape: { x1: lo[0], y1: lo[1], x2: hi[0], y2: hi[1] }, style: { stroke: c, lineWidth: 2 } },
                { type: "line", shape: { x1: lo[0], y1: lo[1] - 5, x2: lo[0], y2: lo[1] + 5 }, style: { stroke: c, lineWidth: 2 } },
                { type: "line", shape: { x1: hi[0], y1: hi[1] - 5, x2: hi[0], y2: hi[1] + 5 }, style: { stroke: c, lineWidth: 2 } },
                {
                  type: "circle",
                  shape: { cx: mid[0], cy: mid[1], r: 6 },
                  style: { fill: h.inside_training_range ? c : t.card, stroke: c, lineWidth: 2 },
                },
              ],
            };
          },
          encode: { x: 1, y: 0 },
          data: habs.map((_, i) => [i, habs[i][1].burning_rate.mean]),
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, m]);

  const heat: EChartsOption | null = useMemo(() => {
    if (!t) return null;
    const g = m.grid;
    const z = layer === "mean" ? g.burning_rate_mean : g.burning_rate_sd.map((r) => r.map((v) => 1.96 * v));
    const data: [number, number, number][] = [];
    z.forEach((row, yi) => row.forEach((v, xi) => data.push([xi, yi, v])));
    const vals = data.map((d) => d[2]);
    const dark = document.documentElement.classList.contains("dark");
    const xIdx = (o2: number) => g.o2_pct.reduce((b, v, i) => (Math.abs(v - o2) < Math.abs(g.o2_pct[b] - o2) ? i : b), 0);
    const yIdx = (p: number) => g.pressure_kpa.reduce((b, v, i) => (Math.abs(v - p) < Math.abs(g.pressure_kpa[b] - p) ? i : b), 0);
    const marks = habs
      .filter(([n]) => !n.startsWith("Mars") && !n.startsWith("Spacesuit") && !n.startsWith("Earth"))
      .map(([n, h]) => ({ name: n.split(" (")[0], coord: [xIdx(h.o2_pct), yIdx(h.pressure_kpa)] }));
    return {
      animation: false,
      grid: { left: 64, right: 24, top: 16, bottom: 88 },
      tooltip: {
        ...tooltipStyle(t),
        formatter: (p: unknown) => {
          const d = (p as { data: number[] }).data;
          if (!Array.isArray(d)) return (p as { name: string }).name;
          return `O₂ ${g.o2_pct[d[0]]}% · ${g.pressure_kpa[d[1]]} kPa<br/>${layer === "mean" ? "K" : "95% ±"} = ${d[2].toFixed(3)} mm²/s`;
        },
      },
      xAxis: { type: "category", data: g.o2_pct.map(String), name: "Oxygen (%)", nameLocation: "middle", nameGap: 28, ...axisStyle(t), splitLine: { show: false } },
      yAxis: { type: "category", data: g.pressure_kpa.map((v) => v.toFixed(0)), name: "Pressure (kPa)", nameLocation: "middle", nameGap: 44, ...axisStyle(t), splitLine: { show: false } },
      visualMap: {
        min: Math.min(...vals),
        max: Math.max(...vals),
        orient: "horizontal",
        left: "center",
        bottom: 0,
        calculable: false,
        itemHeight: 220,
        itemWidth: 10,
        precision: 2,
        textStyle: { color: t.axis },
        inRange: { color: dark ? SEQ_DARK : SEQ_LIGHT },
        text: [layer === "mean" ? "faster burning" : "more uncertain", layer === "mean" ? "slower" : "confident"],
      },
      series: [
        {
          type: "heatmap",
          data,
          itemStyle: { borderColor: t.card, borderWidth: 0.5 },
          markPoint: {
            symbol: "pin",
            symbolSize: 34,
            itemStyle: { color: t.zoneLine },
            label: { show: true, formatter: "{b}", position: "top", color: t.text, fontWeight: 600, distance: 4 },
            data: marks,
          },
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, m, layer]);

  const models = m.report.models;
  const metricRow = (name: string, label: string) => {
    const mm = models[name].metrics as Record<string, Record<string, number | null>>;
    return { label, n: models[name].n, mm };
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Burning rate by habitat</CardTitle>
            <CardDescription>
              Methanol droplet, 2 mm, nitrogen diluent. Dot = prediction, whiskers = 95% interval. A hollow dot means the habitat is outside the
              tested conditions, so the value is an extrapolation.
            </CardDescription>
          </CardHeader>
          <CardContent>{whisker && <EChart option={whisker} height={300} ariaLabel="Predicted burning rate with 95% intervals for each habitat" />}</CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-2">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Prediction surface</CardTitle>
              <CardDescription>{m.grid.assumptions}</CardDescription>
            </div>
            <ToggleGroup type="single" value={layer} onValueChange={(v) => v && setLayer(v as "mean" | "sd")} variant="outline" size="sm">
              <ToggleGroupItem value="mean">Prediction</ToggleGroupItem>
              <ToggleGroupItem value="sd">Uncertainty</ToggleGroupItem>
            </ToggleGroup>
          </CardHeader>
          <CardContent>{heat && <EChart option={heat} height={300} ariaLabel="Heatmap of predicted burning rate over oxygen and pressure" />}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Habitat outlook: all four suppression models</CardTitle>
          <CardDescription>How fast it burns, when the flame dies, whether it dies cleanly, and whether an invisible cool flame lingers.</CardDescription>
        </CardHeader>
        <CardContent>
          <HabitatOutlook m={m} />
        </CardContent>
      </Card>

      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle className="text-base">How good are the models?</CardTitle>
          <CardDescription>
            {m.report.validation}. Each model is compared with simple baselines and only counts as useful if it beats them.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Target</TableHead>
                <TableHead className="text-right">n</TableHead>
                <TableHead className="text-right">Gaussian process</TableHead>
                <TableHead className="text-right">Linear / logistic</TableHead>
                <TableHead className="text-right">Naive baseline</TableHead>
                <TableHead className="pr-4 text-right">95% interval coverage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[metricRow("burning_rate", "Burning rate K (R²)"), metricRow("extinction_d", "Extinction diameter (R²)")].map((r) => (
                <TableRow key={r.label}>
                  <TableCell className="pl-4">{r.label}</TableCell>
                  <TableCell className="num text-right">{r.n}</TableCell>
                  <TableCell className="num text-right font-medium">{r.mm.gp.R2?.toFixed(2)}</TableCell>
                  <TableCell className="num text-right">{r.mm.linear.R2?.toFixed(2)}</TableCell>
                  <TableCell className="num text-right">{r.mm.mean.R2?.toFixed(2)}</TableCell>
                  <TableCell className="num pr-4 text-right">{((r.mm.gp["95%_interval_coverage"] ?? 0) * 100).toFixed(0)}%</TableCell>
                </TableRow>
              ))}
              {(() => {
                const o = models.outcome.metrics as Record<string, Record<string, number | null> | number>;
                const gp = o.gp as Record<string, number>, lr = o.logistic as Record<string, number>;
                return (
                  <TableRow>
                    <TableCell className="pl-4">Extinction vs disruption (AUC · acc.)</TableCell>
                    <TableCell className="num text-right">{models.outcome.n}</TableCell>
                    <TableCell className="num text-right font-medium">
                      {gp.AUC.toFixed(2)} · {(gp.accuracy * 100).toFixed(0)}%
                    </TableCell>
                    <TableCell className="num text-right">
                      {lr.AUC.toFixed(2)} · {(lr.accuracy * 100).toFixed(0)}%
                    </TableCell>
                    <TableCell className="num text-right">— · {((o.majority_class_accuracy as number) * 100).toFixed(0)}%</TableCell>
                    <TableCell className="pr-4 text-right">—</TableCell>
                  </TableRow>
                );
              })()}
              {models.cool_flame &&
                (() => {
                  const o = models.cool_flame.metrics as Record<string, Record<string, number | null> | number>;
                  const gp = o.gp as Record<string, number>, lr = o.logistic as Record<string, number>;
                  return (
                    <TableRow>
                      <TableCell className="pl-4">Cool flame survives (AUC · acc.)</TableCell>
                      <TableCell className="num text-right">{models.cool_flame.n}</TableCell>
                      <TableCell className="num text-right font-medium">
                        {gp.AUC.toFixed(2)} · {(gp.accuracy * 100).toFixed(0)}%
                      </TableCell>
                      <TableCell className="num text-right">
                        {lr.AUC.toFixed(2)} · {(lr.accuracy * 100).toFixed(0)}%
                      </TableCell>
                      <TableCell className="num text-right">— · {((o.majority_class_accuracy as number) * 100).toFixed(0)}%</TableCell>
                      <TableCell className="pr-4 text-right">—</TableCell>
                    </TableRow>
                  );
                })()}
            </TableBody>
          </Table>
          <p className="px-4 py-3 text-xs text-muted-foreground">
            Read honestly: with FLEX and CFI data the GP matches or beats every baseline, but linear regression is close behind on both
            regression targets, so the GP&apos;s main extra value is its uncertainty estimate. Intervals that cover less than 95% are slightly over-confident.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
