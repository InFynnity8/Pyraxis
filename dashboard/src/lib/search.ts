import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

/** One citable passage, produced by pipeline/build_search_index.py. */
export interface Chunk {
  id: number;
  acc: string | null;
  name: string;
  kind: string;
  title: string;
  text: string;
  source: string;
  href: string;
}

export interface Hit extends Chunk {
  score: number;
}

const STOP = new Set(
  "a an and are as at be by can could did do does for from had has have how i if in into is it its may might of on or our should so than that the their them then there these they this to was we were what when where which who why will with would you your about any all also more most much many not no only other some such very".split(
    " ",
  ),
);

/** Lower-case word tokens; keeps chemistry/units like o2, co2, kpa, 34%. Light plural stemming. */
export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9][a-z0-9.%+-]*/g) ?? [])
    .map((t) => t.replace(/[.\-+]+$/, ""))
    .map((t) => (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

interface Index {
  chunks: Chunk[];
  tf: Map<string, number>[];
  len: number[];
  df: Map<string, number>;
  avg: number;
  names: { name: string; tokens: string[] }[];
}

let INDEX: Index | null = null;

function load(): Index {
  if (INDEX) return INDEX;
  const chunks: Chunk[] = JSON.parse(readFileSync(path.join(process.cwd(), "data", "search_chunks.json"), "utf-8"));
  const df = new Map<string, number>();
  const tf: Map<string, number>[] = [];
  const len: number[] = [];
  for (const c of chunks) {
    // Title counted twice so headings weigh more than body text.
    const toks = tokenize(`${c.title} ${c.title} ${c.text}`);
    const m = new Map<string, number>();
    for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1);
    for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    tf.push(m);
    len.push(toks.length);
  }
  const avg = len.reduce((a, b) => a + b, 0) / Math.max(1, len.length);
  const names = [...new Set(chunks.filter((c) => c.acc).map((c) => c.name))].map((name) => ({ name, tokens: tokenize(name) }));
  INDEX = { chunks, tf, len, df, avg, names };
  return INDEX;
}

/**
 * BM25 ranking (k1=1.4, b=0.75) plus two boosts:
 *  - investigation named in the question (e.g. "FLEX", "BASS-II") -> its passages x1.6
 *  - curated passages (metadata, test summaries, findings) x1.25 over raw document text
 * Results are diversified: at most 2 passages from the same document.
 */
export function search(question: string, k = 8): Hit[] {
  const ix = load();
  const q = [...new Set(tokenize(question))];
  if (!q.length) return [];
  const N = ix.chunks.length;
  const qLower = question.toLowerCase();
  const named = new Set(
    ix.names.filter((n) => n.tokens.length && new RegExp(`\\b${n.name.toLowerCase().replace(/[^a-z0-9]+/g, "[^a-z0-9]*")}\\b`).test(qLower)).map((n) => n.name),
  );
  const scored: Hit[] = [];
  ix.chunks.forEach((c, i) => {
    let s = 0;
    for (const t of q) {
      const f = ix.tf[i].get(t);
      if (!f) continue;
      const df = ix.df.get(t) ?? 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      s += (idf * f * 2.4) / (f + 1.4 * (1 - 0.75 + (0.75 * ix.len[i]) / ix.avg));
    }
    if (s <= 0) return;
    if (named.has(c.name)) s *= 1.6;
    if (c.kind !== "document") s *= 1.25;
    scored.push({ ...c, score: s });
  });
  scored.sort((a, b) => b.score - a.score);
  const perDoc = new Map<string, number>();
  const seenText = new Set<string>(); // PSI files the same PDF under several investigations (e.g. SAFFIRE-I/II/III)
  const out: Hit[] = [];
  for (const h of scored) {
    const fingerprint = h.text.slice(0, 240);
    if (seenText.has(fingerprint)) continue;
    seenText.add(fingerprint);
    const doc = h.source.split("#")[0] + h.kind;
    if ((perDoc.get(doc) ?? 0) >= 2) continue;
    perDoc.set(doc, (perDoc.get(doc) ?? 0) + 1);
    out.push(h);
    if (out.length >= k) break;
  }
  return out;
}
