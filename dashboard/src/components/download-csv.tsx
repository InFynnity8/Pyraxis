"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Turns rows (plain objects) into a CSV file the browser downloads. Every row keeps its source_file / source_row. */
export function DownloadCsv({ rows, filename, label = "Download CSV" }: { rows: Record<string, unknown>[]; filename: string; label?: string }) {
  const save = () => {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const cell = (v: unknown) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Button variant="outline" size="sm" onClick={save} disabled={!rows.length}>
      <Download className="size-4" /> {label}
    </Button>
  );
}
