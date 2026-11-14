import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { search, type Hit } from "@/lib/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Answer providers, tried in order until one succeeds (configure in dashboard/.env.local):
 *   1. Claude        - ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN)
 *   2. Groq          - GROQ_API_KEY      (OpenAI-compatible chat endpoint)
 *   3. Hugging Face  - HF_TOKEN          (Inference Providers router, OpenAI-compatible chat endpoint)
 *   4. Search only   - no key: the page shows the best-matching source passages
 * ASK_AI=off forces search-only (e.g. a demo without network).
 */
const CLAUDE_MODEL = "claude-opus-5-5";

type ProviderId = "claude" | "groq" | "huggingface";
interface CompatProvider {
  id: Exclude<ProviderId, "claude">;
  label: string;
  url: string;
  key: () => string | undefined;
  model: () => string;
}
const COMPAT: CompatProvider[] = [
  {
    id: "groq",
    label: "Groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: () => process.env.GROQ_API_KEY,
    model: () => process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    url: "https://router.huggingface.co/v1/chat/completions",
    key: () => process.env.HF_TOKEN,
    model: () => process.env.HF_MODEL || "openai/gpt-oss-120b:fastest",
  },
];
const LABEL: Record<ProviderId, string> = { claude: "Claude", groq: "Groq", huggingface: "Hugging Face" };

const SYSTEM = `You answer questions about NASA Physical Sciences Informatics (PSI) microgravity combustion investigations for fire-safety engineers and researchers.

Rules:
- Use ONLY the numbered sources provided with the question. Do not use outside knowledge for facts, numbers or claims.
- Cite every factual sentence with the source number(s) in square brackets, e.g. [2] or [1][4].
- If the sources do not contain the answer, say so plainly and state what the sources do cover. Never guess.
- Keep units exactly as the sources give them. Say when a value is assumed, approximate or a model prediction.
- Be concise: 2-6 sentences, or a short list when comparing investigations. Plain language; define acronyms on first use only if the sources do.`;

export interface AskSource {
  n: number;
  id: number;
  acc: string | null;
  name: string;
  kind: string;
  title: string;
  snippet: string;
  source: string;
  href: string;
}
export interface AskResponse {
  mode: "ai" | "search";
  answer: string | null;
  sources: AskSource[];
  note?: string;
  model?: string;
  provider?: ProviderId;
}

const toSource = (h: Hit, n: number): AskSource => ({
  n,
  id: h.id,
  acc: h.acc,
  name: h.name,
  kind: h.kind,
  title: h.title,
  snippet: h.text.length > 700 ? h.text.slice(0, 700) + "…" : h.text,
  source: h.source,
  href: h.href,
});

const off = () => process.env.ASK_AI === "off";
const hasClaude = () => !off() && !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/** Configured providers in the order they are tried. */
function chain(): { id: ProviderId; model: string }[] {
  if (off()) return [];
  const out: { id: ProviderId; model: string }[] = [];
  if (hasClaude()) out.push({ id: "claude", model: CLAUDE_MODEL });
  for (const p of COMPAT) if (p.key()) out.push({ id: p.id, model: p.model() });
  return out;
}

export async function GET() {
  const c = chain();
  return NextResponse.json({
    ai: c.length > 0,
    provider: c[0]?.id ?? null,
    model: c[0]?.model ?? null,
    chain: c.map((p) => `${LABEL[p.id]} (${p.model})`),
  });
}

type Answer = { text: string; model: string; provider: ProviderId } | { refused: true };

class ProviderError extends Error {
  constructor(
    public provider: ProviderId,
    public status: number,
    public detail: string,
  ) {
    super(`${LABEL[provider]} ${status}: ${detail}`);
  }
}

async function askClaude(prompt: string): Promise<Answer> {
  const client = new Anthropic();
  const res = await client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // if the model declines, the API retries on a fallback model inside the same call
    output_config: { effort: "low" }, // short grounded answers: low effort keeps latency down
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  if (res.stop_reason === "refusal") return { refused: true };
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
  return { text, model: res.model, provider: "claude" };
}

/** Groq / Hugging Face: OpenAI-compatible chat completions over plain fetch (no extra library). */
async function askCompat(p: CompatProvider, prompt: string): Promise<Answer> {
  const r = await fetch(p.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${p.key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: p.model(),
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
      max_tokens: 2000,
      temperature: 0.2,
      stream: false,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new ProviderError(p.id, r.status, (await r.text()).slice(0, 300));
  const data = await r.json();
  const text = String(data?.choices?.[0]?.message?.content ?? "").trim();
  return { text, model: String(data?.model ?? p.model()), provider: p.id };
}

function explain(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected.";
  if (err instanceof Anthropic.RateLimitError) return "Claude is rate limited right now.";
  if (err instanceof Anthropic.APIError) return `Claude returned an error (${err.status}).`;
  if (err instanceof ProviderError) {
    const name = LABEL[err.provider];
    if (err.status === 401 || err.status === 403) return `The ${name} key was rejected.`;
    if (err.status === 402) return `The ${name} account is out of credits.`;
    if (err.status === 429) return `${name} is rate limiting requests right now (free-tier limit).`;
    if (err.status === 404) return `${name} doesn't serve the configured model.`;
    return `${name} returned an error (${err.status}).`;
  }
  if (err instanceof Error && err.name === "TimeoutError") return "The AI service took too long to answer.";
  return "The AI service could not be reached.";
}

export async function POST(req: Request) {
  let question = "";
  try {
    question = String((await req.json())?.question ?? "").trim();
  } catch {
    return NextResponse.json({ error: 'Send JSON: {"question": "..."}' }, { status: 400 });
  }
  if (question.length < 3) return NextResponse.json({ error: "Type a question of at least a few words." }, { status: 400 });
  if (question.length > 600) return NextResponse.json({ error: "Keep the question under 600 characters." }, { status: 400 });

  const hits = search(question, 8);
  const sources = hits.map((h, i) => toSource(h, i + 1));
  if (!hits.length) {
    return NextResponse.json<AskResponse>({ mode: "search", answer: null, sources, note: "No passages matched. Try naming an investigation (e.g. FLEX, BASS-II, SAME) or a quantity (oxygen, pressure, extinction)." });
  }

  const order = chain();
  if (!order.length) {
    return NextResponse.json<AskResponse>({ mode: "search", answer: null, sources, note: "AI answers are off on this server (no API key set). Showing the most relevant source passages." });
  }

  const prompt = `Sources:\n\n${hits.map((h, i) => `[${i + 1}] ${h.title} (source: ${h.source})\n${h.text}`).join("\n\n")}\n\nQuestion: ${question}`;
  const problems: string[] = [];
  for (const { id } of order) {
    try {
      const a = id === "claude" ? await askClaude(prompt) : await askCompat(COMPAT.find((p) => p.id === id)!, prompt);
      if ("refused" in a) {
        problems.push(`${LABEL[id]} declined this question.`);
        continue;
      }
      if (a.text) return NextResponse.json<AskResponse>({ mode: "ai", answer: a.text, sources, model: a.model, provider: a.provider });
      problems.push(`${LABEL[id]} returned an empty answer.`);
    } catch (err) {
      console.error("[ask]", err);
      problems.push(explain(err));
    }
  }
  return NextResponse.json<AskResponse>({ mode: "search", answer: null, sources, note: `${problems.join(" ")} Showing the source passages instead.` });
}
