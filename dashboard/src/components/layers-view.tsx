"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { ArrowRight, Flame, ScanEye, ShieldCheck, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EChart, axisStyle, tooltipStyle, useVizTokens } from "@/components/echart";
import type { LayersData, ModelData, RegMetrics } from "@/lib/types";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { HabitatOutlook } from "@/components/habitat-outlook";
import { DownloadCsv } from "@/components/download-csv";

const fmt = (v: number | null | undefined, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? "–" : v.toFixed(d));
const SEQ_LIGHT = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"];
const SEQ_DARK = ["#104281", "#1c5cab", "#2a78d6", "#5598e7", "#86b6ef", "#b7d3f6"];

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function LayerHeader({ icon: Icon, layer, question, source, links }: {
  icon: typeof Flame; layer: string; question: string; source: string; links: { href: string; label: string }[];
}) {
  return (
    <CardHeader className="gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-md border"><Icon className="size-4" /></span>
        <CardTitle className="text-xl">{layer}</CardTitle>
        <Badge variant="secondary" className="font-normal">{question}</Badge>
      </div>
      <CardDescription>Data: {source}</CardDescription>
      <div className="flex flex-wrap gap-3 text-sm">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
            {l.label} <ArrowRight className="size-3.5" />
          </Link>
        ))}
      </div>
    </CardHeader>
  );
}

type Rows = Record<string, unknown>[];

export function LayersView({ L, M, downloads }: { L: LayersData; M: ModelData; downloads?: { bass: Rows; detection: Rows; smokePoints: Rows } }) {
  const t = useVizTokens();
  const P = L.prevention, D = L.detection, S = L.suppression;

  // ---------- Prevention: every labelled BASS test, air flow x O2, burned vs did not keep burning
  const prevOpt: EChartsOption | null = useMemo(() => {
    if (!t) return null;
    const pts = P.points ?? [];
    const ser = (burned: boolean) => pts.filter((p) => p.burned === burned).map((p) => [p.flow_cm_s, p.o2_pct, p.material, p.notes]);
    return {
      animation: false,
      grid: { left: 56, right: 24, top: 40, bottom: 48 },
      legend: { top: 0, right: 0, textStyle: { color: t.muted, fontSize: 11 } },
      tooltip: {
        ...tooltipStyle(t),
        formatter: (p: unknown) => {
          const q = p as { seriesName: string; data: [number, number, string, string] };
          return `<b>${q.data[2]}</b> · ${q.seriesName}<br/>air flow ${q.data[0]} cm/s · O₂ ${q.data[1].toFixed(1)} %<br/><span style="opacity:.75">${String(q.data[3]).slice(0, 140)}</span>`;
        },
      },
      xAxis: { type: "value", name: "Air flow past the sample at ignition (cm/s)", nameLocation: "middle", nameGap: 30, min: 0, ...axisStyle(t) },
      yAxis: { type: "value", name: "O₂ (%)", min: 15, max: 24, ...axisStyle(t) },
      series: [
        { name: "kept burning", type: "scatter", symbolSize: 9, itemStyle: { color: t.s1, borderColor: t.card, borderWidth: 1.5 }, data: ser(true) },
        { name: "did not keep burning", type: "scatter", symbol: "diamond", symbolSize: 13, itemStyle: { color: t.s2, borderColor: t.card, borderWidth: 1.5 }, data: ser(false) },
      ],
    };
  }, [t, P]);

  // ---------- Detection: response rate heatmap (material x detector)
  const detKeys = Object.keys(D.detectors).filter((k) => D.by_material.some((r) => r[`${k}_response_rate`] !== null && r[`${k}_response_rate`] !== undefined));
  const detOpt: EChartsOption | null = useMemo(() => {
    if (!t) return null;
    const mats = D.by_material.map((r) => r.material);
    const data: [number, number, number | null][] = [];
    D.by_material.forEach((r, yi) => detKeys.forEach((k, xi) => data.push([xi, yi, (r[`${k}_response_rate`] as number | null) ?? null])));
    const dark = document.documentElement.classList.contains("dark");
    return {
      animation: false,
      grid: { left: 150, right: 24, top: 8, bottom: 84 },
      tooltip: {
        ...tooltipStyle(t),
        formatter: (p: unknown) => {
          const [xi, yi, v] = (p as { value: [number, number, number | null] }).value;
          return `<b>${mats[yi]}</b><br/>${D.detectors[detKeys[xi]]}<br/>responded in ${v === null ? "–" : Math.round(v * 100) + "%"} of ${D.by_material[yi].tests} tests`;
        },
      },
      xAxis: { type: "category", data: detKeys.map((k) => D.detectors[k]), ...axisStyle(t), axisLabel: { ...axisStyle(t).axisLabel, interval: 0, rotate: 20 }, splitLine: { show: false } },
      yAxis: { type: "category", data: mats, ...axisStyle(t), splitLine: { show: false } },
      visualMap: { min: 0, max: 1, show: false, inRange: { color: dark ? SEQ_DARK : SEQ_LIGHT } },
      series: [{
        type: "heatmap",
        data: data.map(([x, y, v]) => {
          const lightCell = v !== null && (dark ? v > 0.55 : v < 0.45);
          return { value: [x, y, v], label: { color: lightCell ? "#16181d" : "#f5f6f8" } };
        }), itemStyle: { borderColor: t.card, borderWidth: 2, borderRadius: 4 },
        label: {
          show: true, fontSize: 11,
          formatter: (p: unknown) => { const v = (p as { value: [number, number, number | null] }).value[2]; return v === null ? "–" : `${Math.round(v * 100)}%`; },
        },
        // label ink follows cell lightness: light cells get dark ink, dark cells get light ink
      }],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, D]);

  // ---------- Detection: smoke-point what-if (GP curve with 95% band + the flights it learned from)
  const curves = D.smoke_point_curves ?? [];
  const fuelName = (c: { fuel: string; fuel_mole_frac: number }) => `${c.fuel}${c.fuel_mole_frac < 1 ? ` ${Math.round(c.fuel_mole_frac * 100)}%` : ""}`;
  const [fuelSel, setFuelSel] = useState<string>(curves.length ? fuelName(curves[curves.length - 1]) : "");
  const spOpt: EChartsOption | null = useMemo(() => {
    if (!t || !curves.length) return null;
    const c = curves.find((x) => fuelName(x) === fuelSel) ?? curves[0];
    const flights = c.points.filter((q) => Math.abs(q[2] - 1.6) < 0.05); // same 1.6 mm burner as the model line
    const xmax = Math.ceil(Math.max(...c.air_cm_s, ...flights.map((q) => q[0])) / 10) * 10;
    return {
      animation: false,
      grid: { left: 56, right: 24, top: 28, bottom: 48 },
      legend: { top: 0, right: 0, textStyle: { color: t.muted, fontSize: 11 }, data: ["model", "95% range", "ISS flights (1.6 mm burner)"] },
      tooltip: { ...tooltipStyle(t), trigger: "axis", formatter: (ps: unknown) => {
        const arr = ps as { seriesName: string; data: number[] }[];
        const line = arr.find((q) => q.seriesName === "model");
        if (!line) return "";
        const i = c.air_cm_s.indexOf(line.data[0]);
        return `<b>${fuelName(c)}</b> · air ${line.data[0]} cm/s<br/>predicted smoke point ${line.data[1]} mm<br/>95% range ${c.lo[i]}–${c.hi[i]} mm`;
      } },
      xAxis: { type: "value", name: "Air speed around the flame (cm/s)", nameLocation: "middle", nameGap: 30, min: 0, max: xmax, ...axisStyle(t) },
      yAxis: { type: "value", name: "Smoke point (mm)", min: 0, ...axisStyle(t) },
      series: [
        { name: "model", type: "line", data: c.air_cm_s.map((a, i) => [a, c.mean[i]]), symbol: "none", lineStyle: { width: 2, color: t.s2 }, itemStyle: { color: t.s2 } },
        { name: "95% range", type: "line", data: c.air_cm_s.map((a, i) => [a, c.hi[i]]), symbol: "none", lineStyle: { width: 1, type: "dashed", color: t.s2 }, itemStyle: { color: t.s2 } },
        { name: "95% range", type: "line", data: c.air_cm_s.map((a, i) => [a, Math.max(0, c.lo[i])]), symbol: "none", lineStyle: { width: 1, type: "dashed", color: t.s2 } },
        { name: "ISS flights (1.6 mm burner)", type: "scatter", data: flights.map((q) => [q[0], q[1]]), symbolSize: 8, itemStyle: { color: t.s1, borderColor: t.card, borderWidth: 1.5 } },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, D, fuelSel]);

  const sm = D.smoke_mass_model.metrics as RegMetrics;
  const spm = D.smoke_point_model.metrics;
  const sMod = S.models;
  const r2 = (k: string, m = "gp") => (sMod[k]?.metrics?.[m] as Record<string, number> | undefined)?.R2;
  const auc = (k: string, m = "gp") => (sMod[k]?.metrics?.[m] as Record<string, number | null> | undefined)?.AUC ?? null;

  // ---------- From data to equipment (numbers read from the data, not typed in)
  const rate = (mat: string, k: string) => {
    const v = D.by_material.find((r) => r.material === mat)?.[`${k}_response_rate`] as number | null | undefined;
    return v == null ? "–" : `${Math.round(v * 100)}%`;
  };
  const dil = (g: string) => {
    const d = S.diluents.find((x) => x.diluent === g);
    return d ? `${Math.round((100 * d.extinguished) / d.tests)}%` : "–";
  };
  const moon = M.habitats["Moon base / rover (expected)"];
  const equipment = [
    { layer: "Detection", title: "Detectors that see small particles",
      body: `Teflon and Kapton insulation make the finest smoke. The ISS photoelectric obscuration signal responded in only ${rate("Teflon", "iss_obscuration")} / ${rate("Kapton", "iss_obscuration")} of those tests, while ionisation detector B responded in ${rate("Teflon", "ion_b")} / ${rate("Kapton", "ion_b")}. Cabin detectors should combine sensing methods.`,
      evidence: "SAME, SAME-R (PSI-102, PSI-101)" },
    { layer: "Detection", title: "Alarm thresholds that ignore dust",
      body: "DAFT flew the same particle counters (P-Trak, DustTrak) to measure ordinary ISS cabin dust. That background is what a smoke alarm must not trigger on, and lunar dust will raise it further.",
      evidence: "DAFT / DAFT-2 (PSI-47)" },
    { layer: "Suppression", title: "Choice of suppressant gas",
      body: `In FLEX, droplet flames went out in ${dil("He")} of helium-diluted tests, ${dil("CO2")} with CO₂ and ${dil("N2")} with nitrogen (different oxygen levels, so a guide, not a ranking).`,
      evidence: "FLEX (PSI-69)" },
    { layer: "Suppression", title: "Hold the suppressant until the fuel is cold",
      body: `An invisible cool flame kept burning after the visible flame died in ${S.cool_flame.cool_flame_after_hot_extinction} of ${S.cool_flame.tests} CFI tests, and ${S.cool_flame.reignitions_tests} tests re-ignited. Systems should not stand down when the light goes out.`,
      evidence: "CFI (PSI-39), CFI-G (PSI-159)" },
    { layer: "Suppression", title: "Ventilation shut-off as a first response",
      body: `In microgravity still air starves a flame: cutting the air flow put out ${S.nitrogen_on_solids.tests_extinguished_by_low_flow} BASS flames, while a nitrogen jet put out only ${S.nitrogen_on_solids.n2_jet_extinguished ?? S.nitrogen_on_solids.tests_extinguished_by_n2} of ${S.nitrogen_on_solids.n2_jet_attempts ?? "?"} it was aimed at (the jet can even feed the flame by stirring in air). Shut ventilation first.`,
      evidence: "BASS (PSI-26)" },
    { layer: "Suppression", title: "Expect bursting droplets in Moon-base air",
      body: moon && moon.p_clean_extinction != null
        ? `Our models predict only ${Math.round(moon.p_clean_extinction * 100)}% of burning fuel droplets go out cleanly in Moon-base air (vs ${Math.round((M.habitats["ISS cabin"]?.p_clean_extinction ?? 0) * 100)}% on the ISS); most burst and scatter fuel. Suppression must cover a spread-out fire, not a point.`
        : "Droplets in high-oxygen air tend to burst and scatter fuel.",
      evidence: "FLEX (PSI-69) + outcome model" },
    { layer: "Prevention", title: "Material screening for still, oxygen-rich air",
      body: "ACME's Burning Rate Emulator used gas burners to mimic burning solids in still air, at up to 40% O₂, as a function of material properties (heat of combustion and gasification). It's the bridge from today's 1-atm material tests to Moon-base air, where no real solid has been tested in the public archive.",
      evidence: "ACME BRE (PSI-20); BASS, Saffire" },
    { layer: "Prevention", title: "Partial gravity: bound it, then test it",
      body: "PSI has no Moon- or Mars-gravity combustion data yet (LUCI and FM2 are planned). ACME E-FIELD mimicked partial gravity with an electric field acting on the flame's ions; microgravity and Earth results bound what to expect in between.",
      evidence: "ACME E-FIELD (PSI-22)" },
  ];

  return (
    <div className="space-y-6">
      {/* ---------------- PREVENTION ---------------- */}
      <Card id="prevention">
        <LayerHeader icon={ShieldCheck} layer="1 · Prevention" question={P.question} source={P.source}
          links={[{ href: "/map", label: "Where tests exist (Flammability Map)" }, { href: "/investigations", label: "BASS, BASS-II, Saffire, ACME BRE" }]} />
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Labelled solid-material burns" value={`${P.n}`} hint={`${P.n - P.positives} failed to keep burning`} />
            <Stat label="Model ranking skill (AUC)" value={fmt(P.metrics.gp.AUC)} hint={`logistic ${fmt(P.metrics.logistic.AUC)} · 0.5 = guessing`} />
            <Stat label="Probability error (Brier)" value={fmt(P.metrics.gp.brier, 3)} hint={`base rate ${fmt(P.metrics.base_rate_brier, 3)} · lower is better`} />
            <Stat label="Validation" value={`${P.folds}-fold`} hint="grouped by blocks of runs" />
          </div>
          {prevOpt && <EChart option={prevOpt} height={340} ariaLabel="Each BASS test by air flow and oxygen, marked by whether the material kept burning" />}
          <p className="text-sm text-muted-foreground">
            Each point is one BASS test aboard the ISS. Almost everything kept burning in ISS-like air, even at 16–17 % oxygen. The failures were
            mostly Nomex fabric (4 of 6 tests) and a few samples hit by strong air flow (15–30 cm/s). In microgravity a gentle breeze feeds a flame
            and still air starves it, so cabin ventilation is part of fire prevention.
          </p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead><TableHead className="text-right">Tests</TableHead><TableHead className="text-right">Kept burning</TableHead><TableHead className="text-right">Model: P(burns) in ISS air</TableHead>
                  <TableHead className="text-right">Lowest O₂ that burned</TableHead><TableHead className="text-right">Went out when flow cut</TableHead><TableHead className="text-right">Put out by N₂</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {P.materials.map((m) => (
                  <TableRow key={m.material}>
                    <TableCell>{m.material}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.tests}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.sustained}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.model_p_burn_iss_air === undefined ? "–" : `${Math.round(m.model_p_burn_iss_air * 100)}%`}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.lowest_o2_pct_that_burned === null ? "–" : `${fmt(m.lowest_o2_pct_that_burned, 1)} %`}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.extinguished_by_low_flow}{m.flow_at_low_flow_extinction_cm_s !== null ? ` (≈${fmt(m.flow_at_low_flow_extinction_cm_s, 1)} cm/s)` : ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.extinguished_by_n2}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Limit: {P.limits}</p>
            {downloads && <DownloadCsv rows={downloads.bass} filename="pyraxis_bass_labelled.csv" label="Download BASS tests + labels (CSV)" />}
          </div>
        </CardContent>
      </Card>

      {/* ---------------- DETECTION ---------------- */}
      <Card id="detection">
        <LayerHeader icon={ScanEye} layer="2 · Detection" question={D.question} source={D.source}
          links={[{ href: "/ask", label: "Ask: how was smoke measured in SAME?" }, { href: "/investigations", label: "SAME, SAME-R, SPICE, DAFT" }]} />
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Smoke tests (SAME + SAME-R)" value={`${D.smoke_tests}`} hint={`${D.by_material.length} materials, 5 detector types`} />
            <Stat label="Smoke-amount model (R²)" value={sm?.gp ? fmt(sm.gp.R2) : "–"} hint={sm?.gp ? `n=${D.smoke_mass_model.n} · linear ${fmt(sm.linear.R2)} · mean ${fmt(sm.mean.R2)}` : "not enough rows"} />
            <Stat label="Smoke flames (SPICE)" value={`${D.smoke_point_model.n}`} hint="sootiness of gas fuels on ISS" />
            <Stat label="Smoke-point model (R²)" value={fmt(spm.gp.R2)} hint={`MAE ${fmt(spm.gp.MAE, 1)} mm · linear ${fmt(spm.linear.R2)}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-1 text-sm font-medium">Which detector reacted to which smoke</div>
              {detOpt && <EChart option={detOpt} height={360} ariaLabel="Share of smoke tests in which each detector type responded, by material" />}
            </div>
            <div>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">What-if: when does this fuel start to smoke? (SPICE model)</div>
                <ToggleGroup type="single" value={fuelSel} onValueChange={(v) => v && setFuelSel(v)} variant="outline" size="sm">
                  {curves.map((c) => (
                    <ToggleGroupItem key={fuelName(c)} value={fuelName(c)} className="px-2 text-xs">{fuelName(c)}</ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              {spOpt && <EChart option={spOpt} height={320} ariaLabel="Predicted smoke point versus air speed for the selected fuel, with 95% range and measured ISS flights" />}
              <p className="text-xs text-muted-foreground">Solid line = model prediction for the 1.6 mm burner, dashed = 95 % range, dots = real ISS flights with that burner. Shorter smoke point = sootier flame = more smoke to detect, sooner.</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material heated</TableHead><TableHead className="text-right">Tests</TableHead><TableHead className="text-right">Smoke mass (mg/m³)</TableHead>
                  <TableHead className="text-right">Particles (per cm³)</TableHead><TableHead className="text-right">Particle size index (µm)</TableHead><TableHead className="text-right">Model: smoke at low / typical / high heat (mg/m³)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {D.by_material.map((r) => (
                  <TableRow key={r.material}>
                    <TableCell>{r.material}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.tests}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.smoke_mass_mg_m3_median, 1)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.particle_count_per_cc_median === null ? "–" : Math.round(r.particle_count_per_cc_median).toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.diameter_index_um_median, 2)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(() => {
                        const pr = (D.smoke_mass_predictions ?? []).find((x) => x.material === r.material);
                        return pr ? `${fmt(pr.low.mg_m3, 1)} / ${fmt(pr.typical.mg_m3, 1)} / ${fmt(pr.high.mg_m3, 1)}` : "–";
                      })()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Limit: {D.limits}</p>
            {downloads && (
              <div className="flex flex-wrap gap-2">
                <DownloadCsv rows={downloads.detection} filename="pyraxis_smoke_tests.csv" label="Smoke tests (CSV)" />
                <DownloadCsv rows={downloads.smokePoints} filename="pyraxis_smoke_points.csv" label="Smoke points (CSV)" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ---------------- SUPPRESSION ---------------- */}
      <Card id="suppression">
        <LayerHeader icon={Flame} layer="3 · Suppression" question={S.question} source={S.source}
          links={[{ href: "/model", label: "Predictions with uncertainty" }, { href: "/map", label: "Moon / Mars atmosphere gaps" }]} />
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Droplet tests used" value={`${Object.values(S.training_data ?? {}).reduce((a, b) => a + b, 0)}`}
              hint={Object.entries(S.training_data ?? {}).map(([k, v]) => `${k} ${v}`).join(" · ")} />
            <Stat label="Extinction size model (R²)" value={fmt(r2("extinction_d"))} hint={`boosting ${fmt(r2("extinction_d", "boosting"))} · linear ${fmt(r2("extinction_d", "linear"))}`} />
            <Stat label="Burning-rate model (R²)" value={fmt(r2("burning_rate"))} hint={`boosting ${fmt(r2("burning_rate", "boosting"))} · linear ${fmt(r2("burning_rate", "linear"))}`} />
            <Stat label="Flame goes out vs breaks up (AUC)" value={fmt(auc("outcome"))} hint={`cool-flame model AUC ${fmt(auc("cool_flame"))}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="overflow-x-auto">
              <div className="mb-1 text-sm font-medium">FLEX: diluent gas vs how flames ended</div>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Diluent</TableHead><TableHead className="text-right">Tests</TableHead><TableHead className="text-right">Flame went out</TableHead><TableHead className="text-right">Median extinction size</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {S.diluents.map((d) => (
                    <TableRow key={d.diluent}>
                      <TableCell>{d.diluent}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.tests}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.extinguished} ({Math.round((100 * d.extinguished) / d.tests)}%)</TableCell>
                      <TableCell className="text-right tabular-nums">{d.median_extinction_d_mm === null ? "–" : `${fmt(d.median_extinction_d_mm, 2)} mm`}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border p-3">
                <div className="font-medium">Does it stay out? Cool flames (CFI)</div>
                <p className="text-muted-foreground">
                  In <b className="text-foreground">{S.cool_flame.cool_flame_after_hot_extinction} of {S.cool_flame.tests}</b> analysed CFI tests an invisible
                  &ldquo;cool flame&rdquo; kept burning after the visible flame went out, and <b className="text-foreground">{S.cool_flame.reignitions_tests}</b> tests re-ignited.
                  A suppression system must hold the atmosphere until the fuel is cold, not until the light is gone.
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <div className="font-medium">Solids (BASS)</div>
                <p className="text-muted-foreground">
                  The crew aimed a nitrogen jet at <b className="text-foreground">{S.nitrogen_on_solids.n2_jet_attempts ?? "–"}</b> burning samples: it put out only{" "}
                  <b className="text-foreground">{S.nitrogen_on_solids.n2_jet_extinguished ?? S.nitrogen_on_solids.tests_extinguished_by_n2}</b> (and part of the flame in{" "}
                  {S.nitrogen_on_solids.n2_jet_partial ?? "–"}). Cutting the air flow put out <b className="text-foreground">{S.nitrogen_on_solids.tests_extinguished_by_low_flow}</b>:
                  in microgravity, stopping ventilation is itself a suppressant. (Labels hand-checked against every crew note.)
                </p>
              </div>
            </div>
          </div>
          <div>
            <div className="mb-1 text-sm font-medium">Model predictions for each habitat (all four suppression models)</div>
            <HabitatOutlook m={M} />
          </div>
        </CardContent>
      </Card>

      {/* ---------------- FROM DATA TO EQUIPMENT ---------------- */}
      <Card id="equipment">
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md border"><Wrench className="size-4" /></span>
            <CardTitle className="text-xl">From data to equipment</CardTitle>
            <Badge variant="secondary" className="font-normal">Which PSI research informs next-generation fire-safety controls?</Badge>
          </div>
          <CardDescription>What each finding above implies for the hardware and procedures of a Moon base, rover or spacecraft. Each card names its evidence.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {equipment.map((e) => (
              <div key={e.title} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">{e.title}</div>
                  <Badge variant="outline" className="shrink-0 font-normal">{e.layer}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{e.body}</p>
                <div className="mt-2 text-xs text-muted-foreground">Evidence: <span className="text-foreground">{e.evidence}</span></div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
