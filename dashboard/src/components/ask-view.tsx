"use client";

import Link from "next/link";
import { Fragment, useRef, useState, type ReactNode } from "react";
import { ArrowUp, FileText, Loader2, Sparkles, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AskResponse, AskSource } from "@/app/api/ask/route";

const EXAMPLES = [
  "Which experiments tested elevated oxygen concentrations?",
  "How did FLEX extinguish flames with helium and carbon dioxide?",
  "What materials were burned in SAFFIRE?",
  "How was smoke measured in SAME and SAME-R?",
  "What do we know about fire safety at Moon-base atmosphere?",
  "How does airflow affect flame spread over solids in BASS-II?",
];

const KIND_LABEL: Record<string, string> = {
  overview: "Overview",
  objectives: "Objectives",
  hypothesis: "Hypothesis",
  approach: "Approach",
  earth: "Earth benefits",
  publications: "Publications",
  tests: "Test table",
  findings: "Finding",
  model: "Model",
  document: "Document",
};

type Turn = { id: number; question: string; res?: AskResponse; error?: string };

export function AskView() {
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function ask(question: string) {
    const text = question.trim();
    if (text.length < 3 || busy) return;
    const id = Date.now();
    setTurns((t) => [{ id, question: text }, ...t]);
    setQ("");
    setBusy(true);
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text }) });
      const body = await r.json();
      setTurns((t) => t.map((x) => (x.id === id ? (r.ok ? { ...x, res: body } : { ...x, error: body.error ?? "Something went wrong." }) : x)));
    } catch {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: "Couldn't reach the server. Check that the dashboard is running." } : x)));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0 space-y-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(q);
          }}
          className="rounded-lg border bg-card p-2 focus-within:ring-2 focus-within:ring-ring/40"
        >
          <label htmlFor="ask-input" className="sr-only">
            Your question
          </label>
          <textarea
            id="ask-input"
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(q);
              }
            }}
            rows={2}
            maxLength={600}
            placeholder="e.g. Which investigations studied flame extinction at low oxygen?"
            className="block w-full resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between gap-2 px-1 pt-1">
            <span className="text-xs text-muted-foreground">Enter to ask · Shift+Enter for a new line</span>
            <Button type="submit" size="sm" disabled={busy || q.trim().length < 3} aria-label="Ask">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
              Ask
            </Button>
          </div>
        </form>

        {turns.length === 0 && (
          <div className="space-y-3">
            <div className="eyebrow">Try one of these</div>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <button
                  key={e}
                  onClick={() => ask(e)}
                  className="rounded-full border px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-8">
          {turns.map((t) => (
            <TurnView key={t.id} turn={t} onRetry={() => ask(t.question)} />
          ))}
        </div>
      </div>

      <aside className="space-y-4 text-sm">
        <Card className="gap-2 py-4">
          <CardContent className="space-y-2 px-4 text-muted-foreground">
            <div className="eyebrow">What it searches</div>
            <ul className="space-y-1">
              <li>24 investigation records</li>
              <li>Parsed test tables (1,709 rows)</li>
              <li>186 reports, papers and presentations</li>
              <li>NASA official challenge resources (Researcher&apos;s Guide, fact sheets)</li>
              <li>Project findings and model results (all three layers)</li>
            </ul>
            <p className="pt-1 text-xs">Answers use only these sources. Check important numbers against the cited passage.</p>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function TurnView({ turn, onRetry }: { turn: Turn; onRetry: () => void }) {
  const [active, setActive] = useState<number | null>(null);
  const refs = useRef<Record<number, HTMLDivElement | null>>({});
  const jump = (n: number) => {
    setActive(n);
    refs.current[n]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <section className="space-y-3" aria-live="polite">
      <h2 className="text-lg font-semibold tracking-tight">{turn.question}</h2>

      {!turn.res && !turn.error && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Searching the archive…
        </div>
      )}

      {turn.error && (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-destructive">{turn.error}</span>
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RotateCcw className="size-3.5" /> Retry
          </Button>
        </div>
      )}

      {turn.res && (
        <>
          {turn.res.answer ? (
            <Card className="py-4">
              <CardContent className="space-y-2 px-4 text-[15px] leading-relaxed">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Sparkles className="size-3.5" style={{ color: "var(--series-1)" }} /> Answer written from the sources below
                </div>
                <Answer text={turn.res.answer} onCite={jump} />
              </CardContent>
            </Card>
          ) : (
            turn.res.note && <p className="text-sm text-muted-foreground">{turn.res.note}</p>
          )}

          {turn.res.sources.length > 0 && (
            <div className="space-y-2">
              <div className="eyebrow">Sources ({turn.res.sources.length})</div>
              <div className="grid gap-2 md:grid-cols-2">
                {turn.res.sources.map((s) => (
                  <SourceCard key={s.n} s={s} active={active === s.n} innerRef={(el) => (refs.current[s.n] = el)} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SourceCard({ s, active, innerRef }: { s: AskSource; active: boolean; innerRef: (el: HTMLDivElement | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div ref={innerRef} className={cn("min-w-0 rounded-lg border bg-card p-3 text-sm transition-colors", active && "border-foreground/40 bg-secondary/60")}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border font-mono text-[11px]">{s.n}</span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={s.href} className="font-medium hover:underline">
              {s.title}
            </Link>
            <Badge variant="secondary" className="font-normal">
              {KIND_LABEL[s.kind] ?? s.kind}
            </Badge>
          </div>
          <p className={cn("whitespace-pre-line text-muted-foreground", !open && "line-clamp-4")}>{s.snippet}</p>
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1 font-mono text-[11px] text-muted-foreground" title={s.source}>
              <FileText className="size-3 shrink-0" />
              <span className="truncate">{s.source}</span>
            </span>
            <button onClick={() => setOpen((o) => !o)} className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline">
              {open ? "Less" : "More"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Minimal renderer: paragraphs, "- " lists, **bold**, and [n] citations as buttons. */
function Answer({ text, onCite }: { text: string; onCite: (n: number) => void }) {
  const inline = (s: string): ReactNode[] =>
    s.split(/(\[\d+\]|\*\*[^*]+\*\*)/g).map((part, i) => {
      const cite = part.match(/^\[(\d+)\]$/);
      if (cite)
        return (
          <button
            key={i}
            onClick={() => onCite(Number(cite[1]))}
            className="mx-0.5 inline-flex h-4.5 min-w-4.5 -translate-y-0.5 items-center justify-center rounded border px-1 align-middle font-mono text-[10px] text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            aria-label={`Source ${cite[1]}`}
          >
            {cite[1]}
          </button>
        );
      if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
      return <Fragment key={i}>{part}</Fragment>;
    });

  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length)
      blocks.push(
        <ul key={`l${blocks.length}`} className="list-disc space-y-1 pl-5">
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>,
      );
    list = [];
  };
  for (const line of text.split("\n")) {
    const li = line.match(/^\s*[-*]\s+(.*)/) ?? line.match(/^\s*\d+\.\s+(.*)/);
    if (li) list.push(li[1]);
    else {
      flush();
      if (line.trim()) blocks.push(<p key={`p${blocks.length}`}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className="space-y-2">{blocks}</div>;
}
