"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, ShieldAlert, Wind } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FireSim, MATERIALS, NX, NY, SUPPRESSION, type MaterialId, type SimConfig, type SimEvent, type SimStats, type SuppressionId } from "@/lib/firesim";

export interface EvidencePoint { o2: number; p: number; phase: string | null; acr: string }
export interface EvidenceGrid { o2: number[]; p: number[]; mean: number[][]; sd: number[][] }

interface Atmos { o2: number; pressureKpa: number; gravity: number; ventCmS: number }
const PRESETS: Record<string, { label: string; note: string; a: Atmos }> = {
  iss: { label: "ISS cabin", note: "21% O₂ · 101 kPa · microgravity · 10 cm/s ventilation", a: { o2: 0.21, pressureKpa: 101.3, gravity: 0, ventCmS: 10 } },
  iss_still: { label: "ISS, fans off", note: "21% O₂ · microgravity · still air", a: { o2: 0.21, pressureKpa: 101.3, gravity: 0, ventCmS: 0 } },
  moon: { label: "Moon base", note: "34% O₂ · 70 kPa (10.2 psi) · 1/6 g", a: { o2: 0.34, pressureKpa: 70.3, gravity: 0.165, ventCmS: 5 } },
  rover: { label: "Pressurized rover", note: "34% O₂ · 70 kPa · 1/6 g · tight cabin, 3 cm/s air", a: { o2: 0.34, pressureKpa: 70.3, gravity: 0.165, ventCmS: 3 } },
  mars: { label: "Mars habitat", note: "34% O₂ · 70 kPa (assumed = Moon) · 0.38 g", a: { o2: 0.34, pressureKpa: 70.3, gravity: 0.38, ventCmS: 5 } },
  suit: { label: "Spacesuit / airlock", note: "100% O₂ · 30 kPa (4.3 psi) · microgravity", a: { o2: 1.0, pressureKpa: 29.6, gravity: 0, ventCmS: 3 } },
  earth: { label: "Earth room", note: "21% O₂ · 101 kPa · 1 g · still air", a: { o2: 0.21, pressureKpa: 101.3, gravity: 1, ventCmS: 0 } },
  apollo1: { label: "Apollo 1 cabin (1967)", note: "100% O₂ · 115 kPa (16.7 psi) · 1 g on the pad", a: { o2: 1.0, pressureKpa: 115, gravity: 1, ventCmS: 2 } },
};

const SCALE = 6; // display pixels per cell
const MAX_T = 60;

function lookupGrid(g: EvidenceGrid | null, o2pct: number, p: number) {
  if (!g) return null;
  if (o2pct < g.o2[0] || o2pct > g.o2[g.o2.length - 1] || p < g.p[0] || p > g.p[g.p.length - 1]) return null;
  const xi = g.o2.reduce((b, v, i) => (Math.abs(v - o2pct) < Math.abs(g.o2[b] - o2pct) ? i : b), 0);
  const yi = g.p.reduce((b, v, i) => (Math.abs(v - p) < Math.abs(g.p[b] - p) ? i : b), 0);
  return { mean: g.mean[yi][xi], sd: g.sd[yi][xi] };
}

function Gauge({ label, value, alarmAt, hint }: { label: string; value: number; alarmAt: number | null; hint: string }) {
  const pct = Math.min(100, value * 100);
  const on = alarmAt !== null;
  return (
    <div title={hint}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={on ? "font-semibold text-[var(--status-critical)]" : "text-muted-foreground"}>{on ? `ALARM at ${alarmAt!.toFixed(1)} s` : `${Math.round(pct)}% of threshold`}</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${pct}%`, background: on ? "var(--status-critical)" : "var(--series-1)" }} />
      </div>
    </div>
  );
}

const PHASE_STYLE: Record<SimStats["phase"], string> = {
  igniting: "bg-amber-500/20 text-amber-600 dark:text-amber-300",
  burning: "bg-orange-500/20 text-orange-600 dark:text-orange-300",
  smouldering: "bg-zinc-500/20 text-zinc-600 dark:text-zinc-300",
  extinguished: "bg-sky-500/20 text-sky-700 dark:text-sky-300",
  "burned out": "bg-zinc-500/20 text-zinc-600 dark:text-zinc-300",
  "self-extinguished": "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
};

interface Shared { material: MaterialId; suppression: SuppressionId; autoSuppress: boolean; responseDelayS: number; heatSource: "igniter" | "overheat"; view: "flame" | "temperature" | "oxygen" }

function SimPanel({ id, preset, onPreset, shared, running, speed, resetKey, suppressKey, evidence, grid }: {
  id: string; preset: string; onPreset: (p: string) => void; shared: Shared; running: boolean; speed: number; resetKey: number; suppressKey: number;
  evidence: EvidencePoint[]; grid: EvidenceGrid | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<FireSim | null>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<ImageData | null>(null);
  const glowRef = useRef<HTMLCanvasElement | null>(null);
  const glowImgRef = useRef<ImageData | null>(null);
  const [atm, setAtm] = useState<Atmos>(PRESETS[preset].a);
  const [stats, setStats] = useState<SimStats | null>(null);
  const [events, setEvents] = useState<SimEvent[]>([]);
  const [hrr, setHrr] = useState<number[]>([]);

  useEffect(() => { setAtm(PRESETS[preset].a); }, [preset]);

  const cfg: SimConfig = useMemo(() => ({ ...atm, material: shared.material, suppression: shared.suppression, autoSuppress: shared.autoSuppress, responseDelayS: shared.responseDelayS, heatSource: shared.heatSource }),
    [atm, shared.material, shared.suppression, shared.autoSuppress, shared.responseDelayS, shared.heatSource]);

  // (re)create the simulation whenever its configuration or the reset button changes
  useEffect(() => {
    simRef.current = new FireSim(cfg);
    setStats({ ...simRef.current.stats }); setEvents([]); setHrr([]);
  }, [cfg, resetKey]);

  useEffect(() => { if (suppressKey > 0) simRef.current?.suppressNow(); }, [suppressKey]);

  const draw = useCallback(() => {
    const sim = simRef.current, cv = canvasRef.current;
    if (!sim || !cv) return;
    if (!offRef.current) { offRef.current = document.createElement("canvas"); offRef.current.width = NX; offRef.current.height = NY; }
    const off = offRef.current, octx = off.getContext("2d")!;
    if (!imgRef.current) imgRef.current = octx.createImageData(NX, NY);
    sim.render(imgRef.current.data, shared.view);
    octx.putImageData(imgRef.current, 0, 0);
    const ctx = cv.getContext("2d")!;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, 0, 0, cv.width, cv.height);
    // bloom: blur only the flame's light and add it back, so hot gas glows like a real flame
    if (shared.view === "flame") {
      if (!glowRef.current) { glowRef.current = document.createElement("canvas"); glowRef.current.width = NX; glowRef.current.height = NY; }
      const gctx = glowRef.current.getContext("2d")!;
      if (!glowImgRef.current) glowImgRef.current = gctx.createImageData(NX, NY);
      sim.render(glowImgRef.current.data, "flame", true);
      gctx.putImageData(glowImgRef.current, 0, 0);
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.8; ctx.filter = "blur(10px)"; ctx.drawImage(glowRef.current, 0, 0, cv.width, cv.height);
      ctx.globalAlpha = 0.45; ctx.filter = "blur(3px)"; ctx.drawImage(glowRef.current, 0, 0, cv.width, cv.height);
      ctx.restore();
    }
    // overlays
    const W = cv.width, H = cv.height, s = W / NX;
    ctx.font = "11px ui-sans-serif, system-ui";
    // ventilation arrows
    if (sim.cfg.ventCmS > 0) {
      ctx.strokeStyle = sim.ventOn ? "rgba(140,190,255,.55)" : "rgba(140,140,140,.35)"; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 2;
      for (const y of [0.25, 0.5, 0.75]) { const yy = H * y; ctx.beginPath(); ctx.moveTo(6, yy); ctx.lineTo(26, yy); ctx.stroke(); ctx.beginPath(); ctx.moveTo(26, yy - 4); ctx.lineTo(32, yy); ctx.lineTo(26, yy + 4); ctx.fill(); }
      ctx.fillText(sim.ventOn ? `air ${sim.cfg.ventCmS} cm/s` : "fans OFF", 6, H * 0.25 - 8);
    }
    // gravity arrow
    if (sim.cfg.gravity > 0.01) {
      const len = 10 + 26 * Math.min(1, sim.cfg.gravity);
      ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(W - 18, 10); ctx.lineTo(W - 18, 10 + len); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W - 23, 10 + len - 6); ctx.lineTo(W - 18, 10 + len); ctx.lineTo(W - 13, 10 + len - 6); ctx.fill();
      ctx.fillText(`${sim.cfg.gravity.toFixed(sim.cfg.gravity < 0.5 ? 2 : 0)} g`, W - 54, 22);
    } else { ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.fillText("µg", W - 24, 18); }
    // detectors
    const st = sim.stats;
    const det = st.detectorAt === "ceiling" ? { x: 48 * s, y: 3 * s } : { x: (NX - 3) * s, y: 32 * s };
    const alarm = st.photoAlarmAt !== null || st.ionAlarmAt !== null;
    ctx.beginPath(); ctx.arc(det.x, det.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = alarm ? (Math.floor(sim.t * 4) % 2 ? "#ff3b3b" : "#7a1010") : "rgba(220,220,220,.8)"; ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.fillText("detectors", det.x - (st.detectorAt === "ceiling" ? 24 : 58), det.y + (st.detectorAt === "ceiling" ? 20 : -12));
    // extinguisher nozzle
    if (st.suppressedAt !== null && sim.cfg.suppression !== "vent_off" && sim.suppressing > 0) {
      ctx.fillStyle = "rgba(120,220,255,.9)"; ctx.fillRect(2, 26 * s, 3 * s, 13 * s);
    }
    // scale bar: 4 cm = 16 cells
    ctx.strokeStyle = "rgba(255,255,255,.6)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(10, H - 12); ctx.lineTo(10 + 16 * s, H - 12); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.fillText("4 cm", 12, H - 16);
    ctx.fillText(`t = ${sim.t.toFixed(1)} s`, W - 70, H - 10);
  }, [shared.view]);

  // animation loop
  useEffect(() => {
    let raf = 0, frame = 0;
    const loop = () => {
      const sim = simRef.current;
      if (sim && running && sim.t < MAX_T) {
        for (let i = 0; i < speed; i++) sim.step(0.016);
        frame++;
        if (frame % 6 === 0) {
          setStats({ ...sim.stats });
          setEvents([...sim.events]);
          setHrr((h) => (h.length > 220 ? [...h.slice(1), sim.stats.hrr] : [...h, sim.stats.hrr]));
        }
      }
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, speed, draw]);

  // evidence anchor: real NASA tests near this atmosphere, and the droplet model at it
  const near = useMemo(() => evidence.filter((e) => Math.abs(e.o2 - atm.o2 * 100) <= 5 && Math.abs(Math.log(e.p / atm.pressureKpa)) <= Math.log(1.25)), [evidence, atm]);
  const nearSolid = near.filter((e) => e.phase === "solid").length;
  const gp = lookupGrid(grid, atm.o2 * 100, atm.pressureKpa);
  const conf = near.length >= 100 ? { t: "strong", c: "text-emerald-600 dark:text-emerald-400" } : near.length >= 10 ? { t: "thin", c: "text-amber-600 dark:text-amber-400" } : { t: "none: extrapolation", c: "text-[var(--status-critical)]" };
  const byInv = Object.entries(near.reduce<Record<string, number>>((a, e) => ((a[e.acr] = (a[e.acr] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 4);

  const maxH = Math.max(1e-6, ...hrr);
  return (
    <Card className="gap-3">
      <CardHeader className="gap-2 pb-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Scenario {id}</CardTitle>
          <Select value={preset} onValueChange={onPreset}>
            <SelectTrigger className="h-8 w-[210px]"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(PRESETS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <CardDescription>{PRESETS[preset].note}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <canvas ref={canvasRef} width={NX * SCALE} height={NY * SCALE} className="aspect-[3/2] w-full rounded-lg border bg-[#0e1016]" aria-label={`Fire simulation, scenario ${id}`} />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {stats && <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${PHASE_STYLE[stats.phase]}`}>{stats.phase}</span>}
          {stats && <span className="text-xs text-muted-foreground">fuel left {Math.round(stats.fuelLeft * 100)}% · smoke-filled {Math.round(stats.smokeSpread * 100)}% · lowest O₂ {(stats.o2Min * 100).toFixed(0)}%</span>}
        </div>
        {stats && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Gauge label="Photoelectric detector" value={stats.photo} alarmAt={stats.photoAlarmAt} hint="Sees smoke by light scattering; weak for very fine particles" />
            <Gauge label="Ionisation detector" value={stats.ion} alarmAt={stats.ionAlarmAt} hint="Counts charged particles; sensitive to fine smoke" />
          </div>
        )}
        <svg viewBox="0 0 220 36" className="h-9 w-full" preserveAspectRatio="none" aria-label="Heat release over time">
          <polyline fill="none" stroke="var(--series-2)" strokeWidth="1.5" points={hrr.map((h, i) => `${i},${34 - (h / maxH) * 32}`).join(" ")} />
          <text x="218" y="8" fontSize="6" textAnchor="end" fill="currentColor" opacity="0.6">heat release</text>
        </svg>
        <details className="rounded-md border px-3 py-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Custom atmosphere</summary>
          <div className="mt-3 space-y-3">
            {([
              ["Oxygen", "o2", 0.1, 1, 0.01, (v: number) => `${Math.round(v * 100)}%`],
              ["Pressure", "pressureKpa", 20, 130, 1, (v: number) => `${v.toFixed(0)} kPa`],
              ["Gravity", "gravity", 0, 1, 0.005, (v: number) => (v < 0.01 ? "µg" : `${v.toFixed(2)} g`)],
              ["Ventilation", "ventCmS", 0, 30, 1, (v: number) => `${v} cm/s`],
            ] as const).map(([label, key, min, max, step, fmt]) => (
              <div key={key}>
                <div className="flex justify-between text-xs"><span>{label}</span><span className="tabular-nums text-muted-foreground">{fmt(atm[key])}</span></div>
                <Slider min={min} max={max} step={step} value={[atm[key]]} onValueChange={([v]) => setAtm((a) => ({ ...a, [key]: v }))} className="mt-1.5" />
              </div>
            ))}
          </div>
        </details>
        <div className="rounded-md border p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">Evidence behind this scenario</span>
            <span className={`text-xs font-semibold ${conf.c}`}>{conf.t}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            <b className="text-foreground">{near.length}</b> real NASA tests within ±5% O₂ and ±25% pressure ({nearSolid} with solid materials)
            {byInv.length ? `: ${byInv.map(([a, n]) => `${a} ${n}`).join(", ")}` : ""}.
            {gp ? ` Droplet model at this air: K = ${gp.mean.toFixed(2)} ± ${(1.96 * gp.sd).toFixed(2)} mm²/s.` : " Outside the droplet model's range."}
          </p>
        </div>
        <ol className="max-h-32 space-y-0.5 overflow-auto text-xs">
          {events.map((e, i) => (
            <li key={i} className="flex gap-2"><span className="w-12 shrink-0 tabular-nums text-muted-foreground">{e.t.toFixed(1)} s</span><span className={e.kind.startsWith("alarm") || e.kind === "reignition" ? "font-medium text-[var(--status-critical)]" : ""}>{e.text}</span></li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export function FireSimulator({ evidence, grid }: { evidence: EvidencePoint[]; grid: EvidenceGrid | null }) {
  const [a, setA] = useState("iss");
  const [b, setB] = useState("moon");
  const [shared, setShared] = useState<Shared>({ material: "pmma", suppression: "co2", autoSuppress: true, responseDelayS: 3, heatSource: "igniter", view: "flame" });
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [resetKey, setResetKey] = useState(0);
  const [suppressKey, setSuppressKey] = useState(0);
  const set = <K extends keyof Shared>(k: K, v: Shared[K]) => setShared((s) => ({ ...s, [k]: v }));
  const mat = MATERIALS[shared.material];

  const STORIES: { label: string; a: string; b: string; s: Partial<Shared> }[] = [
    { label: "ISS vs Moon base", a: "iss", b: "moon", s: { material: "pmma", suppression: "none", heatSource: "igniter" } },
    { label: "Fans off: ISS vs Earth", a: "iss", b: "earth", s: { material: "pmma", suppression: "vent_off", autoSuppress: true, heatSource: "igniter" } },
    { label: "Hidden smoke: overheated wiring", a: "iss", b: "iss_still", s: { material: "wire", suppression: "none", heatSource: "overheat" } },
    { label: "Flight-suit fabric: ISS vs Moon", a: "iss", b: "moon", s: { material: "nomex", suppression: "none", heatSource: "igniter" } },
    { label: "Apollo 1 vs today's ISS", a: "apollo1", b: "iss", s: { material: "cotton", suppression: "none", heatSource: "igniter" } },
    { label: "Nitrogen jet vs CO₂", a: "iss", b: "iss", s: { material: "pmma", suppression: "n2_jet", autoSuppress: true, heatSource: "igniter" } },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">Guided comparisons</div>
            <div className="flex flex-wrap gap-2">
              {STORIES.map((s) => (
                <Button key={s.label} variant="outline" size="sm" onClick={() => { setA(s.a); setB(s.b); setShared((x) => ({ ...x, ...s.s })); setResetKey((k) => k + 1); setRunning(true); }}>{s.label}</Button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1 text-sm"><span className="text-xs text-muted-foreground">Burning material</span>
              <Select value={shared.material} onValueChange={(v) => set("material", v as MaterialId)}>
                <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.values(MATERIALS).map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="space-y-1 text-sm"><span className="text-xs text-muted-foreground">How it starts</span>
              <Select value={shared.heatSource} onValueChange={(v) => set("heatSource", v as Shared["heatSource"])}>
                <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="igniter">Brief ignition (BASS-style hot wire)</SelectItem>
                  <SelectItem value="overheat">Electrical overheat (keeps heating)</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1 text-sm"><span className="text-xs text-muted-foreground">Response</span>
              <Select value={shared.suppression} onValueChange={(v) => set("suppression", v as SuppressionId)}>
                <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.values(SUPPRESSION).map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <div className="space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">Crew response: {shared.autoSuppress ? `${shared.responseDelayS} s after first alarm` : "manual"}</span>
              <div className="flex items-center gap-2">
                <ToggleGroup type="single" value={shared.autoSuppress ? "auto" : "manual"} onValueChange={(v) => v && set("autoSuppress", v === "auto")} variant="outline" size="sm">
                  <ToggleGroupItem value="auto">Auto</ToggleGroupItem>
                  <ToggleGroupItem value="manual">Manual</ToggleGroupItem>
                </ToggleGroup>
                <Slider min={0} max={15} step={1} value={[shared.responseDelayS]} onValueChange={([v]) => set("responseDelayS", v)} className="w-24" disabled={!shared.autoSuppress} />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setRunning((r) => !r)}>{running ? <Pause className="size-4" /> : <Play className="size-4" />}{running ? "Pause" : "Run"}</Button>
            <Button size="sm" variant="outline" onClick={() => { setResetKey((k) => k + 1); setRunning(true); }}><RotateCcw className="size-4" />Restart both</Button>
            <Button size="sm" variant="outline" disabled={shared.suppression === "none"} onClick={() => setSuppressKey((k) => k + 1)}><ShieldAlert className="size-4" />Suppress now</Button>
            <ToggleGroup type="single" value={String(speed)} onValueChange={(v) => v && setSpeed(Number(v))} variant="outline" size="sm">
              <ToggleGroupItem value="1">1×</ToggleGroupItem><ToggleGroupItem value="2">2×</ToggleGroupItem><ToggleGroupItem value="4">4×</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup type="single" value={shared.view} onValueChange={(v) => v && set("view", v as Shared["view"])} variant="outline" size="sm">
              <ToggleGroupItem value="flame">Flame & smoke</ToggleGroupItem><ToggleGroupItem value="temperature">Temperature</ToggleGroupItem><ToggleGroupItem value="oxygen">Oxygen</ToggleGroupItem>
            </ToggleGroup>
            <span className="text-xs text-muted-foreground"><Wind className="mr-1 inline size-3.5" />{SUPPRESSION[shared.suppression].how}</span>
          </div>
          <p className="text-xs text-muted-foreground"><b className="text-foreground">{mat.name}:</b> {mat.source}. Oxygen limit used: {Math.round(mat.loi * 100)}% O₂.</p>
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <SimPanel id="A" preset={a} onPreset={setA} shared={shared} running={running} speed={speed} resetKey={resetKey} suppressKey={suppressKey} evidence={evidence} grid={grid} />
        <SimPanel id="B" preset={b} onPreset={setB} shared={shared} running={running} speed={speed} resetKey={resetKey} suppressKey={suppressKey} evidence={evidence} grid={grid} />
      </div>
    </div>
  );
}
