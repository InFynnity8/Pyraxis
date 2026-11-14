import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Investigation, ModelData, TestRow } from "./types";

// Data is produced by the Python pipeline (pipeline/*.py) into public/data/*.json.
// Read at build/request time on the server - no client fetch, no loading flash.
const dir = path.join(process.cwd(), "public", "data");
const read = <T,>(f: string): T => JSON.parse(readFileSync(path.join(dir, f), "utf-8")) as T;

export const getInvestigations = () => read<Investigation[]>("investigations.json");
export const getTests = () => read<TestRow[]>("tests.json");
export const getModel = () => read<ModelData>("model.json");

export const label = (inv: Pick<Investigation, "acronym" | "accession">) => inv.acronym || inv.accession;
export const getLayers = () => read<import("./types").LayersData>("layers.json");
export const getDetection = () => read<Record<string, unknown>[]>("detection.json");
export const getSmokePoints = () => read<Record<string, unknown>[]>("smoke_points.json");
