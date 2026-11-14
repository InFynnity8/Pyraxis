import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getInvestigations, getTests } from "@/lib/data";
import { FEATURE_LABEL } from "@/lib/habitats";
import type { FeatureKey } from "@/lib/types";
import { DownloadCsv } from "@/components/download-csv";

export function generateStaticParams() {
  return getInvestigations().map((i) => ({ acc: i.accession }));
}

export default async function Page({ params }: { params: Promise<{ acc: string }> }) {
  const { acc } = await params;
  const invs = getInvestigations();
  const inv = invs.find((i) => i.accession === acc);
  if (!inv) notFound();
  const tests = getTests().filter((t) => t.accession === acc);
  const byAcc = Object.fromEntries(invs.map((i) => [i.accession, i.acronym || i.accession]));

  const fmt = (v: number | null | undefined, d = 1) => (v == null ? "—" : v.toFixed(d));

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href="/investigations" className="text-sm text-muted-foreground hover:underline">
          ← All investigations
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {inv.acronym || inv.accession} <span className="text-muted-foreground">· {inv.accession}</span>
        </h1>
        <p className="text-muted-foreground">{inv.title}</p>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">{inv.project_type}</Badge>
          {inv.platform && <Badge variant="outline">{inv.platform}</Badge>}
          {inv.fuel_phase && <Badge variant="outline">Fuel: {inv.fuel_phase}</Badge>}
          {inv.start && <Badge variant="outline">{inv.start} → {inv.end ?? "?"}</Badge>}
          <a href={inv.psi_url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            Open in PSI ↗
          </a>
        </div>
        {inv.note && <p className="rounded-md border-l-4 bg-secondary/60 p-3 text-sm" style={{ borderColor: "var(--series-1)" }}>{inv.note}</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Objectives</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-line text-sm leading-relaxed">{inv.objectives}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fire-safety signals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(Object.keys(FEATURE_LABEL) as FeatureKey[])
              .filter((k) => inv.features[k].length)
              .map((k) => (
                <div key={k}>
                  <div className="font-medium">{FEATURE_LABEL[k]}</div>
                  <div className="text-xs text-muted-foreground">matched: {inv.features[k].join(", ")}</div>
                </div>
              ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hypothesis</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-line text-sm leading-relaxed">{inv.hypothesis}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Approach & hardware</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-relaxed">
            <p className="whitespace-pre-line">{inv.approach}</p>
            <p className="text-muted-foreground">
              {inv.hardware}
              {inv.hardware_family && ` · ${inv.hardware_family}`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Earth benefits</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-line text-sm leading-relaxed">{inv.earth_benefits}</CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Data archive</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="num">
              {inv.n_files.toLocaleString()} files · {inv.size_gb >= 1000 ? `${(inv.size_gb / 1000).toFixed(2)} TB` : `${inv.size_gb} GB`}
            </div>
            {Object.entries(inv.file_categories)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <div key={k} className="flex justify-between text-muted-foreground">
                  <span>{k}</span>
                  <span className="num">{v.toLocaleString()}</span>
                </div>
              ))}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Publications ({inv.n_publications})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {inv.publications.slice(0, 12).map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
            {inv.related.length > 0 && (
              <div className="pt-3 text-sm">
                Related:{" "}
                {inv.related.map((r) => (
                  <Link key={r} href={`/investigations/${r}`} className="mr-2 underline underline-offset-2">
                    {byAcc[r] ?? r}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {tests.length > 0 && (
        <Card className="py-0">
          <CardHeader className="flex-row items-center justify-between gap-2 pt-6">
            <CardTitle className="text-base">Parsed test conditions ({tests.length})</CardTitle>
            <DownloadCsv rows={tests as unknown as Record<string, unknown>[]} filename={`${acc}_tests.csv`} />
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Test</TableHead>
                  <TableHead>Fuel / material</TableHead>
                  <TableHead className="text-right">O₂ %</TableHead>
                  <TableHead className="text-right">kPa</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead className="pr-4">Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tests.slice(0, 60).map((t, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-4 font-mono text-xs">{t.test_id}</TableCell>
                    <TableCell className="max-w-64 truncate text-sm">{t.material || t.fuel}</TableCell>
                    <TableCell className="num text-right">
                      {t.o2_pct != null ? (
                        fmt(t.o2_pct)
                      ) : t.burner_o2_frac != null ? (
                        <span title="Inverse flame: this oxygen flows from the burner; the surrounding gas is fuel">
                          {fmt(t.burner_o2_frac * 100)}
                          <span className="text-muted-foreground">†</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="num text-right">
                      {fmt(t.pressure_kpa, 0)}
                      {t.pressure_assumed && <span title="assumed ISS cabin pressure">*</span>}
                    </TableCell>
                    <TableCell className="text-sm">{t.outcome}</TableCell>
                    <TableCell className="pr-4 text-xs text-muted-foreground" title={t.source_file}>
                      row {t.source_row}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="px-4 py-3 text-xs text-muted-foreground">
              {tests.length > 60 && `Showing 60 of ${tests.length} (download the CSV for all). `}
              {tests.some((t) => t.pressure_assumed) && "* pressure not in source table; ISS cabin pressure assumed. "}
              {tests.some((t) => t.burner_o2_frac != null) &&
                "† inverse flame: oxygen flows from the burner and the surrounding gas is fuel, so this O₂ is the burner stream, not the air (kept off the map for that reason). "}
              Source{new Set(tests.map((t) => t.source_file)).size > 1 ? "s" : ""}: {[...new Set(tests.map((t) => t.source_file.split("/").pop()))].join(" · ")}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
