export type FeatureKey =
  | "prevention"
  | "detection"
  | "suppression"
  | "high_o2"
  | "reduced_pressure"
  | "partial_gravity"
  | "airflow"
  | "modeling"
  | "crew_materials";

export interface Investigation {
  accession: string;
  acronym: string | null;
  title: string;
  project_type: string;
  microgravity: boolean;
  subarea: string;
  platform: string;
  hardware: string;
  hardware_link: string | null;
  hardware_family: string | null;
  fuel_phase: string | null;
  note: string | null;
  pi: string;
  start: string | null;
  end: string | null;
  keywords: string[];
  related: string[];
  objectives: string;
  hypothesis: string;
  approach: string;
  earth_benefits: string;
  publications: string[];
  n_publications: number;
  features: Record<FeatureKey, string[]>;
  n_files: number;
  size_gb: number;
  file_categories: Record<string, number>;
  has_experimental_table: boolean;
  has_analyzed_data: boolean;
  psi_url: string;
  thumbnail: string | null;
}

export interface TestRow {
  accession: string;
  acronym: string;
  test_id: string | null;
  row_kind: "test" | "daily_summary" | "matrix";
  fuel: string | null;
  fuel_phase: string | null;
  material: string | null;
  thickness_mm: number | null;
  droplet_d0_mm: number | null;
  o2_frac: number | null;
  o2_pct: number | null;
  /** Inverse flames only: O2 fraction in the burner stream (the surrounding air is fuel/N2, so o2_pct is null). */
  burner_o2_frac?: number | null;
  flame_type?: string | null;
  pressure_kpa: number | null;
  pressure_psi: number | null;
  o2_partial_kpa: number | null;
  diluent: string | null;
  flow_cm_s: number | null;
  flow_direction: string | null;
  gravity: string;
  outcome: string;
  burn_time_s: number | null;
  burning_rate_mm2_s: number | null;
  extinction_d_mm: number | null;
  n_flames: number | null;
  notes: string | null;
  pressure_assumed: boolean;
  source_file: string;
  source_row: number;
}

export interface Habitat {
  id: string;
  name: string;
  short: string;
  o2_pct: number;
  pressure_kpa: number;
  gravity: string;
  blurb: string;
  weights: Partial<Record<FeatureKey, number>>;
}

export interface ModelData {
  habitats: Record<
    string,
    {
      o2_pct: number;
      pressure_kpa: number;
      gravity: string;
      inside_training_range: boolean;
      burning_rate: { mean: number; sd: number };
      extinction_d: { mean: number; sd: number };
      p_clean_extinction?: number;
      p_cool_flame?: number;
      cool_flame_inside_range?: boolean;
    }
  >;
  habitat_assumptions?: Record<string, string>;
  grid: {
    o2_pct: number[];
    pressure_kpa: number[];
    burning_rate_mean: number[][];
    burning_rate_sd: number[][];
    assumptions: string;
  };
  coverage: { o2_pct: number[]; pressure_kpa: number[]; density: number[][] };
  training_range: { o2_pct: number[]; pressure_kpa: number[] };
  report: {
    n_rows_total: number;
    validation: string;
    features: string[];
    models: Record<string, { target: string; n: number; folds: number; metrics: Record<string, Record<string, number | null> | number> }>;
    habitat_coverage: Record<string, { tests_within_5pctO2_25pctP: number; by_investigation: Record<string, number> }>;
  };
}

// ---- Fire-safety layers (pipeline/train_models.py -> layers.json) ----
export interface ClfMetrics {
  gp: { AUC: number | null; accuracy: number; brier?: number };
  logistic: { AUC: number | null; accuracy: number };
  majority_class_accuracy: number;
  base_rate_brier?: number;
}
export interface RegMetrics {
  gp: { MAE: number; R2: number; "95%_interval_coverage": number };
  boosting?: { MAE: number; R2: number };
  linear: { MAE: number; R2: number };
  mean: { MAE: number; R2: number };
}
export interface LayersData {
  prevention: {
    question: string;
    source: string;
    n: number;
    positives: number;
    folds: number;
    metrics: ClfMetrics;
    flow_cm_s: number[];
    curves: Record<string, { shape: string; size_cm: number; p_burn: number[] }>;
    points?: { material: string; o2_pct: number; flow_cm_s: number; burned: boolean; notes: string }[];
    materials: {
      material: string;
      tests: number;
      sustained: number;
      did_not_sustain: number;
      model_p_burn_iss_air?: number;
      lowest_o2_pct_that_burned: number | null;
      extinguished_by_low_flow: number;
      flow_at_low_flow_extinction_cm_s: number | null;
      extinguished_by_n2: number;
    }[];
    limits: string;
  };
  detection: {
    question: string;
    source: string;
    smoke_tests: number;
    detectors: Record<string, string>;
    by_material: ({ material: string; tests: number; smoke_mass_mg_m3_median: number | null; particle_count_per_cc_median: number | null; diameter_index_um_median: number | null } & Record<string, number | string | null>)[];
    smoke_mass_model: { target: string; n: number; folds: number; metrics: RegMetrics | Record<string, never>; features: string[] };
    smoke_point_model: { target: string; n: number; folds: number; metrics: RegMetrics };
    smoke_points: { fuel: string; fuel_mole_frac: number; count: number; median: number; min: number; max: number }[];
    smoke_point_curves?: { fuel: string; fuel_mole_frac: number; air_cm_s: number[]; mean: number[]; lo: number[]; hi: number[]; points: number[][] }[];
    smoke_mass_predictions?: ({ material: string; tests: number } & Record<"low" | "typical" | "high", { heater_rt_r0: number; mg_m3: number; lo: number; hi: number }>)[];
    limits: string;
  };
  suppression: {
    question: string;
    source: string;
    models: Record<string, { target: string; n: number; folds: number; metrics: Record<string, Record<string, number | null> | number> }>;
    training_data?: Record<string, number>;
    diluents: { diluent: string; tests: number; extinguished: number; median_extinction_d_mm: number | null }[];
    cool_flame: { tests: number; cool_flame_after_hot_extinction: number; reignitions_tests: number };
    nitrogen_on_solids: { tests_extinguished_by_n2: number; tests_extinguished_by_low_flow: number; tests_burned_out?: number; n2_jet_attempts?: number; n2_jet_extinguished?: number; n2_jet_partial?: number };
  };
}
