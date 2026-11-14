"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface CompareItem {
  accession: string;
  name: string;
  rows: Record<string, string>;
}

export function CompareView({ items, initial }: { items: CompareItem[]; initial: string[] }) {
  const [sel, setSel] = useState<string[]>(initial);
  const toggle = (a: string) => setSel((s) => (s.includes(a) ? s.filter((x) => x !== a) : s.length >= 4 ? [...s.slice(1), a] : [...s, a]));
  const chosen = sel.map((a) => items.find((i) => i.accession === a)!).filter(Boolean);
  const keys = Object.keys(items[0].rows);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <button
            key={i.accession}
            onClick={() => toggle(i.accession)}
            aria-pressed={sel.includes(i.accession)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              sel.includes(i.accession) ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {i.name}
          </button>
        ))}
      </div>
      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44 pl-4">Attribute</TableHead>
                {chosen.map((c) => (
                  <TableHead key={c.accession} className="min-w-48">
                    {c.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => {
                const vals = chosen.map((c) => c.rows[k]);
                const same = vals.length > 1 && vals.every((v) => v === vals[0]);
                return (
                  <TableRow key={k}>
                    <TableCell className="pl-4 align-top text-sm font-medium">
                      {k}
                      {same && <div className="text-[11px] font-normal text-muted-foreground">same for all</div>}
                    </TableCell>
                    {vals.map((v, i) => (
                      <TableCell key={i} className={cn("whitespace-normal align-top text-sm", same && "text-muted-foreground")}>
                        {v}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
