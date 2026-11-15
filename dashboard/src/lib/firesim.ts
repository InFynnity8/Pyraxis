/**
 * PYRAXIS fire simulator: a reduced-order, physics-based model of a small cabin fire.
 *
 * Domain: a 24 x 16 cm slice of a cabin or test section around a burning sample (96 x 64 cells, 2.5 mm each).
 * Gas fields: velocity (u, v), temperature rise T (1.0 ~ 1000 K above ambient), fuel vapour F, oxygen O
 * (mole fraction), smoke S, inert agent X (CO2 / N2), water mist W. Solid fuel cells carry mass M and
 * surface temperature Ts.
 *
 * Physics per step:
 *  - incompressible flow (semi-Lagrangian advection + pressure projection, "stable fluids")
 *  - buoyancy  a = g * beta * T   (g = 1 Earth, 0.38 Mars, 0.165 Moon, ~0 in orbit)
 *  - molecular diffusion D ~ 1/pressure (low pressure -> faster mixing)
 *  - one-step Arrhenius combustion  w = A * (P/P0) * F * O_eff * exp(-Ta / (T + T0))
 *  - radiative heat loss ~ T^4, stronger when the flame is sooty (radiative extinction in still air)
 *  - solid pyrolysis when surface temperature exceeds the material's threshold (endothermic)
 *  - smoke production with material-specific yield and particle size (from NASA SAME / SAME-R medians)
 *  - virtual detectors: photoelectric (needs larger particles) and ionisation (responds to fine particles)
 *  - suppression: ventilation shut-off, CO2 flood, fine water mist, nitrogen jet
 *
 * This is a teaching / exploration model: it reproduces the trends seen in NASA PSI experiments
 * (spherical oxygen-starved flames in still microgravity air, buoyant plumes in gravity, faster burning
 * in oxygen-rich air, fine-particle smoke that photoelectric detectors miss, flames that re-ignite after
 * suppression). It is not a certified fire-safety CFD code.
 */

export const NX = 96;
export const NY = 64;
export const CELL_CM = 0.25;
const N = NX * NY;
const CPS = 1 / CELL_CM; // cells per cm
const NB = new Int32Array(4);
export const K = {
  heatUp: 6, // solid surface heating rate (1/s)
  fuelPerMass: 30, // fuel vapour released per unit solid mass
  A: 13000, // pre-exponential factor
  Q: 20, // heat release
  Ta: 3.6, // activation temperature (normalised)
  nu: 2.2, // oxygen consumed per unit fuel
  rad: 1.6, // radiation coefficient
  D: 0.8, // diffusivity at 1 atm, cm^2/s
  pyro: 0.06, // pyrolysis mass scale
  wall: 0.15, // velocity kept next to a surface (no-slip boundary layer)
  nO: 1.5, // reaction order in oxygen
  pExp: 0.3, // pressure exponent of the rate
  dExp: 0.35, // diffusivity ~ 1/P^dExp
  smoulder: 14, // smoke from heated (not burning) material
};

export type MaterialId = "pmma" | "cotton" | "nomex" | "silicone" | "wire" | "foam";
export type SuppressionId = "none" | "vent_off" | "co2" | "mist" | "n2_jet";

export interface Material {
  id: MaterialId;
  name: string;
  /** pyrolysis threshold (normalised surface temperature) */
  tp: number;
  /** pyrolysis rate constant */
  kp: number;
  /** smoke yield per unit fuel burned */
  smoke: number;
  /** smoke particle size index, micrometres (SAME / SAME-R medians where measured) */
  particleUm: number;
  /** soot luminosity 0..1 (yellow vs blue flame) */
  soot: number;
  /** heat release multiplier */
  heat: number;
  /** limiting oxygen index: lowest O2 fraction (at the surface) that sustains burning */
  loi: number;
  source: string;
}

export const MATERIALS: Record<MaterialId, Material> = {
  pmma: { id: "pmma", name: "Acrylic (PMMA)", tp: 0.34, kp: 1.2, smoke: 0.5, particleUm: 1.5, soot: 0.65, heat: 1.0, loi: 0.155,
    source: "BASS / BASS-II: 58 of 63 acrylic samples kept burning in ISS-like air" },
  cotton: { id: "cotton", name: "Cotton fabric", tp: 0.3, kp: 1.6, smoke: 0.55, particleUm: 1.21, soot: 0.45, heat: 0.9, loi: 0.165,
    source: "SAME-R lampwick (cotton): particle size index 1.21 µm; SIBAL cotton/fiberglass burned in all 12 BASS tests" },
  nomex: { id: "nomex", name: "Nomex (flight-suit fabric)", tp: 0.5, kp: 0.6, smoke: 0.5, particleUm: 1.3, soot: 0.5, heat: 0.75, loi: 0.29,
    source: "BASS: only 1 of 6 Nomex tests sustained a flame in ISS air" },
  silicone: { id: "silicone", name: "Silicone rubber", tp: 0.5, kp: 0.9, smoke: 1.0, particleUm: 1.73, soot: 0.55, heat: 0.85, loi: 0.24,
    source: "SAME-R silicone: highest smoke mass (107 mg/m³), particle size index 1.73 µm" },
  wire: { id: "wire", name: "Wire insulation (Teflon / Kapton)", tp: 0.55, kp: 0.7, smoke: 0.08, particleUm: 0.72, soot: 0.25, heat: 0.7, loi: 0.38,
    source: "SAME-R Teflon / Kapton: finest particles (~0.7 µm), low smoke mass; ISS obscuration detector responded in only ~38% of tests" },
  foam: { id: "foam", name: "Polyurethane foam", tp: 0.26, kp: 1.8, smoke: 0.85, particleUm: 1.68, soot: 0.7, heat: 1.05, loi: 0.17,
    source: "SAME-R Pyrell PU foam: 88.6 mg/m³ smoke, particle size index 1.68 µm" },
};

export interface SuppressionInfo {
  id: SuppressionId;
  name: string;
  how: string;
}
export const SUPPRESSION: Record<SuppressionId, SuppressionInfo> = {
  none: { id: "none", name: "No suppression", how: "Watch the fire develop." },
  vent_off: { id: "vent_off", name: "Shut off ventilation", how: "ISS first response. In microgravity, still air starves a flame (BASS: cutting the air flow put out 44 flames)." },
  co2: { id: "co2", name: "CO₂ extinguisher", how: "A CO₂ cloud dilutes the oxygen around the flame (ISS portable extinguisher)." },
  mist: { id: "mist", name: "Fine water mist", how: "Water droplets absorb heat as they evaporate and displace oxygen (ISS water-mist extinguisher)." },
  n2_jet: { id: "n2_jet", name: "Nitrogen jet", how: "A gas jet aimed at the flame. In BASS it put out only 2 of 18 flames: the jet also stirs fresh air in." },
};

export interface SimConfig {
  o2: number; // mole fraction 0..1
  pressureKpa: number;
  gravity: number; // in Earth g
  ventCmS: number;
  material: MaterialId;
  suppression: SuppressionId;
  autoSuppress: boolean;
  responseDelayS: number;
  /** igniter = brief hot wire (BASS-style test); overheat = an electrical fault that keeps heating the sample */
  heatSource?: "igniter" | "overheat";
}

export interface SimEvent {
  t: number;
  kind: "ignition" | "alarm-photo" | "alarm-ion" | "suppression" | "extinguished" | "reignition" | "burnout" | "self-extinguished";
  text: string;
}

export interface SimStats {
  t: number;
  phase: "igniting" | "burning" | "smouldering" | "extinguished" | "burned out" | "self-extinguished";
  hrr: number; // relative heat release
  peakHrr: number;
  flameCells: number;
  fuelLeft: number; // 0..1
  smokeSpread: number; // fraction of cabin with visible smoke
  o2Min: number;
  photo: number; // detector signal / threshold
  ion: number;
  photoAlarmAt: number | null;
  ionAlarmAt: number | null;
  suppressedAt: number | null;
  extinguishedAt: number | null;
  reignitions: number;
  hotSpots: number; // solid cells still above pyrolysis temperature
  detectorAt: "ceiling" | "exhaust";
}

const P0 = 101.3;

export class FireSim {
  cfg: SimConfig;
  mat: Material;
  u = new Float32Array(N); v = new Float32Array(N);
  u0 = new Float32Array(N); v0 = new Float32Array(N);
  T = new Float32Array(N); F = new Float32Array(N); O = new Float32Array(N);
  S = new Float32Array(N); X = new Float32Array(N); W = new Float32Array(N);
  tmp = new Float32Array(N); p = new Float32Array(N); div = new Float32Array(N);
  w = new Float32Array(N); // reaction rate (for rendering)
  solid = new Uint8Array(N); M = new Float32Array(N); Ts = new Float32Array(N);
  t = 0;
  ventOn = true;
  igniteUntil = 1.6;
  heaterOn = true;
  suppressing = 0; // seconds of active discharge left
  events: SimEvent[] = [];
  stats: SimStats;
  private fuel0 = 1;
  private litFor = 0;
  private outFor = 0;
  private everLit = false;
  private wasOut = false;
  private pendingSuppressAt: number | null = null;

  constructor(cfg: SimConfig) {
    this.cfg = { ...cfg };
    this.mat = MATERIALS[cfg.material];
    this.stats = this.blankStats();
    this.reset();
  }

  private blankStats(): SimStats {
    return { t: 0, phase: "igniting", hrr: 0, peakHrr: 0, flameCells: 0, fuelLeft: 1, smokeSpread: 0, o2Min: this.cfg.o2, photo: 0, ion: 0,
      photoAlarmAt: null, ionAlarmAt: null, suppressedAt: null, extinguishedAt: null, reignitions: 0, hotSpots: 0,
      detectorAt: this.cfg.gravity > 0.05 ? "ceiling" : "exhaust" };
  }

  reset(cfg?: Partial<SimConfig>) {
    if (cfg) this.cfg = { ...this.cfg, ...cfg };
    this.mat = MATERIALS[this.cfg.material];
    for (const a of [this.u, this.v, this.T, this.F, this.S, this.X, this.W, this.p, this.M, this.Ts, this.w]) a.fill(0);
    this.O.fill(this.cfg.o2);
    this.solid.fill(0);
    // sample: a 4 cm x 1 cm slab, a third of the way along the duct
    const x0 = 26, x1 = 42, y0 = 30, y1 = 34;
    let n = 0;
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) { const k = i + j * NX; this.solid[k] = 1; this.M[k] = 1; n++; }
    this.fuel0 = n;
    this.t = 0; this.ventOn = true; this.igniteUntil = this.cfg.heatSource === "overheat" ? 1e9 : 1.6; this.suppressing = 0;
    this.heaterOn = true;
    this.events = []; this.litFor = 0; this.outFor = 0; this.everLit = false; this.wasOut = false; this.pendingSuppressAt = null;
    this.stats = this.blankStats();
    const vent = this.cfg.ventCmS * CPS;
    for (let k = 0; k < N; k++) if (!this.solid[k]) this.u[k] = vent;
  }

  /** Start suppression now (manual button) */
  suppressNow() {
    if (this.cfg.suppression === "none" || this.stats.suppressedAt !== null) return;
    this.stats.suppressedAt = this.t;
    this.suppressing = this.cfg.suppression === "vent_off" ? 0 : 5;
    this.heaterOn = false; // crew procedure: remove power from the faulty equipment
    if (this.cfg.suppression === "vent_off") this.ventOn = false;
    this.events.push({ t: this.t, kind: "suppression", text: SUPPRESSION[this.cfg.suppression].name });
  }

  setVent(on: boolean) { this.ventOn = on; }

  // ------------------------------------------------------------------ helpers
  private idx(i: number, j: number) { return i + j * NX; }

  private advect(d: Float32Array, d0: Float32Array, dt: number, bcValue: number) {
    const u = this.u, v = this.v;
    for (let j = 1; j < NY - 1; j++) {
      for (let i = 1; i < NX - 1; i++) {
        const k = i + j * NX;
        if (this.solid[k]) { d[k] = d0[k]; continue; }
        let x = i - dt * u[k], y = j - dt * v[k];
        if (x < 0.5) { d[k] = bcValue; continue; } // upstream inflow carries ambient value
        if (x > NX - 1.5) x = NX - 1.5;
        if (y < 0.5) y = 0.5; if (y > NY - 1.5) y = NY - 1.5;
        const i0 = x | 0, j0 = y | 0, s1 = x - i0, t1 = y - j0, s0 = 1 - s1, t0 = 1 - t1;
        const a = i0 + j0 * NX;
        d[k] = s0 * (t0 * d0[a] + t1 * d0[a + NX]) + s1 * (t0 * d0[a + 1] + t1 * d0[a + 1 + NX]);
      }
    }
  }

  private diffuse(d: Float32Array, d0: Float32Array, a: number, iters: number) {
    if (a <= 0) { d.set(d0); return; }
    d.set(d0);
    const c = 1 + 4 * a;
    for (let it = 0; it < iters; it++) {
      for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
        const k = i + j * NX;
        if (this.solid[k]) continue;
        d[k] = (d0[k] + a * (d[k - 1] + d[k + 1] + d[k - NX] + d[k + NX])) / c;
      }
    }
  }

  private project() {
    const u = this.u, v = this.v, p = this.p, div = this.div;
    for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
      const k = i + j * NX;
      div[k] = this.solid[k] ? 0 : -0.5 * (u[k + 1] - u[k - 1] + v[k + NX] - v[k - NX]);
      p[k] = 0;
    }
    for (let it = 0; it < 10; it++) {
      for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
        const k = i + j * NX;
        if (this.solid[k]) continue;
        p[k] = (div[k] + p[k - 1] + p[k + 1] + p[k - NX] + p[k + NX]) * 0.25;
      }
      for (let j = 0; j < NY; j++) { p[j * NX + NX - 1] = 0; p[j * NX] = p[j * NX + 1]; } // open outlet, inflow wall
      for (let i = 0; i < NX; i++) { p[i] = p[i + NX]; p[i + (NY - 1) * NX] = p[i + (NY - 2) * NX]; }
    }
    for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
      const k = i + j * NX;
      if (this.solid[k]) { u[k] = 0; v[k] = 0; continue; }
      u[k] -= 0.5 * (p[k + 1] - p[k - 1]);
      v[k] -= 0.5 * (p[k + NX] - p[k - NX]);
    }
  }

  private boundaries() {
    const vent = this.ventOn ? this.cfg.ventCmS * CPS : 0;
    for (let j = 0; j < NY; j++) {
      const l = j * NX, r = l + NX - 1;
      this.u[l] = vent; this.v[l] = 0; this.u[r] = this.u[r - 1]; this.v[r] = this.v[r - 1];
      this.T[l] = 0; this.F[l] = 0; this.O[l] = this.cfg.o2; this.S[l] = 0; this.X[l] = 0; this.W[l] = 0;
      for (const f of [this.T, this.F, this.O, this.S, this.X, this.W]) f[r] = f[r - 1];
    }
    for (let i = 0; i < NX; i++) {
      const top = i, bot = i + (NY - 1) * NX;
      this.u[top] = 0; this.v[top] = 0; this.u[bot] = 0; this.v[bot] = 0;
      this.T[top] = this.T[top + NX] * 0.5; this.T[bot] = this.T[bot - NX] * 0.5; // walls absorb heat
      for (const f of [this.F, this.O, this.S, this.X, this.W]) { f[top] = f[top + NX]; f[bot] = f[bot - NX]; }
    }
  }

  /** Ghost values inside solid cells: gas touching the surface sits at the surface temperature;
   *  species take the average of the open neighbours (zero-flux walls). Without this the sample
   *  would act as an ice-cold, oxygen-free sink. */
  private fillGhosts() {
    for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
      const k = i + j * NX;
      if (!this.solid[k]) continue;
      let n = 0, f = 0, o = 0, sm = 0, x = 0, w = 0;
      for (let q = 0; q < 4; q++) {
        const kk = q === 0 ? k - 1 : q === 1 ? k + 1 : q === 2 ? k - NX : k + NX;
        if (this.solid[kk]) continue;
        n++; f += this.F[kk]; o += this.O[kk]; sm += this.S[kk]; x += this.X[kk]; w += this.W[kk];
      }
      this.T[k] = this.Ts[k];
      if (n) { this.F[k] = f / n; this.O[k] = o / n; this.S[k] = sm / n; this.X[k] = x / n; this.W[k] = w / n; }
    }
  }

  // ------------------------------------------------------------------ main step
  step(dt = 0.01) {
    const c = this.cfg, m = this.mat;
    const pr = c.pressureKpa / P0;
    const gCells = c.gravity * 981 * CPS; // cells/s^2

    // --- suppression scheduling
    if (c.autoSuppress && c.suppression !== "none" && this.stats.suppressedAt === null && this.pendingSuppressAt === null) {
      const first = [this.stats.photoAlarmAt, this.stats.ionAlarmAt].filter((x): x is number => x !== null);
      if (first.length) this.pendingSuppressAt = Math.min(...first) + c.responseDelayS;
    }
    if (this.pendingSuppressAt !== null && this.t >= this.pendingSuppressAt && this.stats.suppressedAt === null) this.suppressNow();

    // --- forces: buoyancy, damping (turbulent drag), agent jets
    const damp = Math.exp(-6 * dt);
    const jet = this.suppressing > 0 && (c.suppression === "co2" || c.suppression === "mist" || c.suppression === "n2_jet");
    for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
      const k = i + j * NX;
      if (this.solid[k]) continue;
      this.v[k] -= gCells * 0.5 * this.T[k] * dt; // rows grow downward: negative v = up
      this.u[k] = c.ventCmS * CPS * (this.ventOn ? 1 : 0) + (this.u[k] - c.ventCmS * CPS * (this.ventOn ? 1 : 0)) * damp;
      this.v[k] *= damp;
    }
    if (jet) {
      // nozzle upstream-left of the sample, aimed at it
      const speed = (c.suppression === "n2_jet" ? 240 : 90) * CPS;
      for (let j = 26; j < 39; j++) for (let i = 4; i < 9; i++) {
        const k = i + j * NX;
        this.u[k] = speed;
        if (c.suppression === "co2") this.X[k] = 0.9;
        if (c.suppression === "n2_jet") this.X[k] = 0.16;
        if (c.suppression === "mist") this.W[k] = 1.2;
      }
      this.suppressing -= dt;
    }
    // no-slip: gas next to the sample is slowed (boundary layer) - this is where real flames anchor
    for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
      const k = i + j * NX;
      if (this.solid[k]) continue;
      if (this.solid[k - 1] || this.solid[k + 1] || this.solid[k - NX] || this.solid[k + NX]) { this.u[k] *= K.wall; this.v[k] *= K.wall; }
      else if (this.solid[k - 2] || this.solid[k + 2] || this.solid[k - 2 * NX] || this.solid[k + 2 * NX]) { this.u[k] *= 0.5 + 0.5 * K.wall; this.v[k] *= 0.5 + 0.5 * K.wall; }
    }
    this.boundaries();

    // --- advect velocity
    this.u0.set(this.u); this.v0.set(this.v);
    this.advect(this.u, this.u0, dt, this.ventOn ? c.ventCmS * CPS : 0);
    this.advect(this.v, this.v0, dt, 0);
    this.boundaries();
    this.project();

    // --- scalars: advect + diffuse (diffusivity ~ 1/pressure)
    const Dcells = (K.D / Math.pow(Math.max(pr, 0.15), K.dExp)) * CPS * CPS; // cm^2/s -> cells^2/s
    const a = Dcells * dt;
    this.fillGhosts();
    const scal: [Float32Array, number, number][] = [[this.T, 0, 1], [this.F, 0, 0.8], [this.O, c.o2, 0.8], [this.S, 0, 0.4], [this.X, 0, 0.6], [this.W, 0, 0.05]];
    for (const [f, bc, dscale] of scal) {
      this.tmp.set(f);
      this.advect(f, this.tmp, dt, bc);
      this.tmp.set(f);
      this.diffuse(f, this.tmp, a * dscale, 2);
    }

    // --- igniter: a hot wire at the upstream edge of the sample for the first seconds
    if (this.t < this.igniteUntil && this.heaterOn) {
      const overheat = this.cfg.heatSource === "overheat";
      const tw = overheat ? 1.6 : 2.2; // a glowing wire vs an igniter coil
      for (let j = 28; j < 36; j++) for (let i = 22; i < 26; i++) { const k = i + j * NX; this.T[k] = Math.max(this.T[k], tw); }
    }

    // --- solid fuel: heating, pyrolysis, burnout
    let fuelLeft = 0, hot = 0;
    for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
      const k = i + j * NX;
      if (!this.solid[k]) continue;
      // average gas temperature of exposed faces
      const nb = NB;
      nb[0] = k - 1; nb[1] = k + 1; nb[2] = k - NX; nb[3] = k + NX;
      let tg = 0, tmax = 0, nOpen = 0, wsum = 0, oSurf = 0;
      for (let q = 0; q < 4; q++) { const kk = nb[q]; if (!this.solid[kk]) { tg += this.T[kk]; if (this.T[kk] > tmax) tmax = this.T[kk]; wsum += this.W[kk]; oSurf += Math.min(1, this.X[kk]) + 0.6 * Math.min(1, this.W[kk]); nOpen++; } }
      if (nOpen === 0) { fuelLeft += this.M[k]; continue; }
      tg /= nOpen;
      // the surface is heated mainly by the hottest adjacent gas (flame stand-off ~ 1 cell)
      const tSurf = 0.5 * (tg + tmax);
      this.Ts[k] += K.heatUp * (tSurf - this.Ts[k]) * dt;
      // water mist on the surface cools it hard
      this.Ts[k] -= 3 * wsum * this.Ts[k] * dt;
      if (this.Ts[k] > m.tp) {
        hot++;
        // flammability limit: below the material's oxygen index the flame cannot feed itself
        // ambient oxygen, diluted by any CO2 / N2 / water vapour reaching the surface (oSurf = agent sum)
        const oLoc = c.o2 * (1 - Math.min(0.95, oSurf / nOpen)) * Math.pow(pr, 0.08);
        const margin = (oLoc - m.loi) / 0.025;
        const gate = margin <= 0 ? 0 : margin >= 1 ? 1 : margin * margin * (3 - 2 * margin);
        const mdot = m.kp * (this.Ts[k] - m.tp) * Math.min(1, this.M[k] * 4) * (this.t < this.igniteUntil && this.cfg.heatSource !== "overheat" ? Math.max(gate, 0.25) : gate);
        const dm = Math.min(this.M[k], mdot * dt * K.pyro);
        this.M[k] -= dm;
        this.Ts[k] -= dm * 1.5; // endothermic gasification
        const share = (dm * K.fuelPerMass) / nOpen;
        // overheated material smokes before (or without) flaming: pyrolysis aerosol
        const smoulder = (Math.max(m.smoke, 0.25) * m.kp * (this.Ts[k] - m.tp) * dt * K.smoulder) / nOpen;
        for (let q = 0; q < 4; q++) { const kk = nb[q]; if (!this.solid[kk]) { this.F[kk] += share; this.S[kk] += smoulder; } }
        if (this.M[k] <= 0.001) { this.solid[k] = 0; this.M[k] = 0; this.u[k] = 0; this.v[k] = 0; this.O[k] = 0; }
      }
      fuelLeft += this.M[k];
    }

    // --- combustion, radiation, mist
    let hrr = 0, flame = 0, o2min = 1;
    // flammability rises with O2 concentration (order nO) more than with pressure (NASA-STD-6001 trend)
    const A = K.A * Math.pow(pr, K.pExp);
    const Ta = K.Ta, T0 = 0.15;
    for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
      const k = i + j * NX;
      if (this.solid[k]) { this.w[k] = 0; continue; }
      const xi = Math.min(1, this.X[k]);
      const oEff = this.O[k] * (1 - xi);
      let wr = A * this.F[k] * Math.pow(oEff, K.nO) * Math.exp(-Ta / (this.T[k] + T0));
      wr = Math.min(wr, this.F[k] / dt, oEff / (K.nu * dt));
      this.F[k] -= wr * dt;
      this.O[k] = Math.max(0, this.O[k] - K.nu * wr * dt);
      // heat release; inert agent (CO2 especially) soaks up heat
      const cp = 1 + (c.suppression === "co2" ? 2.2 : 1.2) * xi;
      this.T[k] += (K.Q * m.heat * wr * dt) / cp;
      this.S[k] += m.smoke * wr * dt * 2.2;
      this.w[k] = wr;
      // radiative loss: sootier flames radiate more
      const tt = this.T[k];
      this.T[k] -= K.rad * (0.35 + m.soot) * tt * tt * tt * tt * dt;
      // water mist: evaporative cooling + O2 displacement
      if (this.W[k] > 0.001) {
        const ev = Math.min(this.W[k], 2.5 * this.W[k] * (tt + 0.05) * dt);
        this.W[k] -= ev;
        this.T[k] -= ev * 3.2;
        this.O[k] *= 1 - 0.4 * ev;
      }
      if (this.T[k] < 0) this.T[k] = 0;
      if (this.T[k] > 3) this.T[k] = 3;
      if (wr > 0.02) { flame++; hrr += wr; }
      if (this.O[k] < o2min && (i > 20 && i < 70)) o2min = this.O[k];
    }

    // --- detectors
    const d = m.particleUm;
    const photoEff = (d * d) / (d * d + 1.1 * 1.1); // light scattering falls off for fine particles
    const ionEff = 1 / Math.sqrt(Math.max(d, 0.3)); // ion chambers count particles: favour fine smoke
    let sDet = 0;
    const atCeiling = c.gravity > 0.05;
    if (atCeiling) { for (let i = 40; i < 56; i++) for (let j = 1; j < 4; j++) sDet += this.S[i + j * NX]; sDet /= 48; }
    else { for (let j = 24; j < 40; j++) for (let i = NX - 5; i < NX - 1; i++) sDet += this.S[i + j * NX]; sDet /= 64; }
    const photo = (sDet * photoEff) / 0.035, ion = (sDet * ionEff) / 0.045;
    if (photo >= 1 && this.stats.photoAlarmAt === null) { this.stats.photoAlarmAt = this.t; this.events.push({ t: this.t, kind: "alarm-photo", text: "Photoelectric detector alarm" }); }
    if (ion >= 1 && this.stats.ionAlarmAt === null) { this.stats.ionAlarmAt = this.t; this.events.push({ t: this.t, kind: "alarm-ion", text: "Ionisation detector alarm" }); }

    // --- smoke spread
    let smoky = 0;
    for (let k = 0; k < N; k++) if (this.S[k] > 0.02) smoky++;

    // --- flame state machine
    const burning = flame >= 3;
    if (burning) { this.litFor += dt; this.outFor = 0; } else { this.outFor += dt; }
    if (!this.everLit && this.litFor > 0.4) { this.everLit = true; this.events.push({ t: this.t, kind: "ignition", text: "Flame established" }); }
    let phase: SimStats["phase"] = this.stats.phase;
    if (this.everLit) {
      if (burning) {
        if (this.wasOut) { this.stats.reignitions++; this.events.push({ t: this.t, kind: "reignition", text: "Re-ignition: the hot sample lit again" }); this.wasOut = false; }
        phase = "burning";
      } else if (this.outFor > 1.5 && !this.wasOut && this.t > this.igniteUntil) {
        this.wasOut = true;
        if (fuelLeft / this.fuel0 < 0.03) { phase = "burned out"; this.events.push({ t: this.t, kind: "burnout", text: "Fuel burned out" }); }
        else if (this.stats.suppressedAt !== null) { phase = "extinguished"; this.stats.extinguishedAt = this.t; this.events.push({ t: this.t, kind: "extinguished", text: "Flame extinguished" }); }
        else { phase = "self-extinguished"; this.stats.extinguishedAt = this.t; this.events.push({ t: this.t, kind: "self-extinguished", text: "Flame went out on its own" }); }
      }
    } else if (this.cfg.heatSource === "overheat" && this.heaterOn && !burning) {
      phase = "smouldering";
    } else if (this.t > Math.min(this.igniteUntil, this.t) + 1.5 && !burning && (this.cfg.heatSource !== "overheat" || !this.heaterOn)) {
      if (phase !== "self-extinguished") this.events.push({ t: this.t, kind: "self-extinguished", text: "Did not ignite / not self-sustaining" });
      phase = "self-extinguished"; this.wasOut = true;
    }

    this.t += dt;
    const st = this.stats;
    st.t = this.t; st.phase = phase; st.hrr = hrr; st.peakHrr = Math.max(st.peakHrr, hrr); st.flameCells = flame;
    st.fuelLeft = fuelLeft / this.fuel0; st.smokeSpread = smoky / N; st.o2Min = Math.min(st.o2Min, o2min);
    st.photo = photo; st.ion = ion; st.hotSpots = hot; st.detectorAt = atCeiling ? "ceiling" : "exhaust";
  }

  // ------------------------------------------------------------------ rendering into RGBA (NX x NY)
  /** emissionOnly: black background + flame light only (used for the glow / bloom pass) */
  render(img: Uint8ClampedArray, view: "flame" | "oxygen" | "temperature" = "flame", emissionOnly = false) {
    const sootiness = this.mat.soot;
    // in microgravity flames are dimmer and bluer (less soot residence); gravity makes them yellow
    const lum = 0.14 + sootiness * Math.min(1.25, 0.2 + this.cfg.gravity * 1.6);
    for (let k = 0; k < N; k++) {
      const o = k * 4;
      let r = emissionOnly ? 0 : 13, g = emissionOnly ? 0 : 15, b = emissionOnly ? 0 : 21;
      if (view === "oxygen" && !emissionOnly) {
        const x = Math.min(1, this.O[k] / Math.max(this.cfg.o2, 0.05));
        r = 20 + 30 * (1 - x); g = 40 + 140 * x; b = 60 + 160 * x;
      } else if (view === "temperature" && !emissionOnly) {
        const x = Math.min(1, this.T[k] / 2);
        r = 30 + 225 * x; g = 20 + 200 * x * x; b = 60 * (1 - x) + 20;
      } else {
        if (!emissionOnly) {
          // smoke: dark, translucent grey-brown
          const sm = Math.min(0.85, this.S[k] * 2.2);
          r += (88 - r) * sm; g += (86 - g) * sm; b += (84 - b) * sm;
          // CO2 / N2 cloud (cyan) and water mist (white)
          const xa = Math.min(1, this.X[k]);
          r += (40 - r) * xa * 0.45; g += (175 - g) * xa * 0.45; b += (215 - b) * xa * 0.45;
          const wm = Math.min(1, this.W[k] * 1.5);
          r += (215 - r) * wm * 0.55; g += (228 - g) * wm * 0.55; b += (245 - b) * wm * 0.55;
        }
        // black-body glow of hot soot: deep red -> orange -> yellow -> near white
        const tt = this.T[k];
        const e = Math.max(0, tt - 0.6);
        if (e > 0) {
          const x = Math.min(1, e / 1.0);
          const ir = 255, ig = 60 + 190 * x, ib = 10 + 150 * x * x * x;
          const a = Math.min(1, e * 1.5 * lum);
          r += (ir - r) * a; g += (ig - g) * a; b += (ib - b) * a;
        }
        // blue chemiluminescence in the thin reaction zone (CH*, C2*)
        const reac = Math.min(1, this.w[k] * 2.5);
        if (reac > 0) { const a = reac * Math.max(0.1, 1 - 0.85 * lum); r += (60 - r) * a; g += (110 - g) * a; b += (255 - b) * a; }
      }
      if (this.solid[k] && !emissionOnly) {
        const ch = Math.min(1, Math.max(0, this.Ts[k] / 0.9));
        r = 96 + 110 * ch; g = 74 + 30 * ch; b = 58 - 30 * ch; // sample darkens/glows as it heats
      }
      img[o] = r; img[o + 1] = g; img[o + 2] = b; img[o + 3] = 255;
    }
  }
}
