"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface InvRow {
  accession: string;
  name: string;
  title: string;
  type: "Microgravity" | "Ground";
  subarea: string;
  fuel: string;
  hardware: string;
  nTests: number;
  o2Range: [number, number] | null;
  sizeGb: number;
  areas: ("prevention" | "detection" | "suppression")[];
}

export function InvestigationTable({ rows }: { rows: InvRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const [area, setArea] = useState("all");

  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (type === "all" || r.type === type) &&
          (area === "all" || r.areas.includes(area as InvRow["areas"][number])) &&
          (!q || `${r.name} ${r.title} ${r.subarea} ${r.fuel} ${r.hardware}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [rows, q, type, area],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input placeholder="Search name, fuel, hardware…" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-64" />
        <ToggleGroup type="single" value={type} onValueChange={(v) => v && setType(v)} variant="outline" size="sm">
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="Microgravity">Microgravity</ToggleGroupItem>
          <ToggleGroupItem value="Ground">Ground</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" value={area} onValueChange={(v) => v && setArea(v)} variant="outline" size="sm">
          <ToggleGroupItem value="all">Any area</ToggleGroupItem>
          <ToggleGroupItem value="prevention">Prevention</ToggleGroupItem>
          <ToggleGroupItem value="detection">Detection</ToggleGroupItem>
          <ToggleGroupItem value="suppression">Suppression</ToggleGroupItem>
        </ToggleGroup>
        <span className="ml-auto text-sm text-muted-foreground">{shown.length} shown</span>
      </div>
      <Card className="py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Investigation</TableHead>
                <TableHead className="hidden sm:table-cell">Fuel</TableHead>
                <TableHead className="hidden lg:table-cell">Hardware</TableHead>
                <TableHead className="hidden md:table-cell">Areas</TableHead>
                <TableHead className="text-right">Tests parsed</TableHead>
                <TableHead className="hidden sm:table-cell text-right">O₂ range</TableHead>
                <TableHead className="hidden pr-4 text-right md:table-cell">Archive</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={r.accession} className="group cursor-pointer" onClick={() => router.push(`/investigations/${r.accession}`)}>
                  <TableCell className="max-w-[16rem] whitespace-normal pl-4 sm:max-w-72">
                    <Link href={`/investigations/${r.accession}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    <div className="truncate text-xs text-muted-foreground" title={r.title}>
                      {r.accession} · {r.type} · {r.title}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{r.fuel}</TableCell>
                  <TableCell className="hidden max-w-56 truncate text-xs text-muted-foreground lg:table-cell" title={r.hardware}>
                    {r.hardware}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {r.areas.map((a) => (
                        <Badge key={a} variant="secondary" className="font-normal capitalize">
                          {a}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="num text-right">
                    <span className="inline-flex items-center gap-1">
                      {r.nTests || "—"}
                      <ChevronRight className="size-4 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100 md:hidden" />
                    </span>
                  </TableCell>
                  <TableCell className="num hidden text-right text-sm sm:table-cell">{r.o2Range ? `${r.o2Range[0].toFixed(0)}–${r.o2Range[1].toFixed(0)}%` : "—"}</TableCell>
                  <TableCell className="num hidden pr-4 text-right text-sm text-muted-foreground md:table-cell">
                    {r.sizeGb >= 1000 ? `${(r.sizeGb / 1000).toFixed(1)} TB` : `${r.sizeGb.toFixed(1)} GB`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
