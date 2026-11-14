import { AskView } from "@/components/ask-view";

export const metadata = { title: "Ask the data · PYRAXIS" };

export default function Page() {
  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow">Ask the data</div>
        <h1 className="text-2xl font-semibold tracking-tight">Ask the combustion archive</h1>
        <p className="max-w-3xl text-muted-foreground">
          Ask in plain language. Answers are built only from PSI investigation records, parsed test tables and the downloaded reports and papers,
          and every claim cites its source.
        </p>
      </div>
      <AskView />
    </div>
  );
}
