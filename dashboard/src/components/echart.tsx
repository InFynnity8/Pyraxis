"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import type { EChartsOption } from "echarts";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

export interface VizTokens {
  s1: string;
  s2: string;
  s3: string;
  s4: string;
  text: string;
  muted: string;
  axis: string;
  grid: string;
  card: string;
  zone: string;
  zoneLine: string;
  critical: string;
}

/** Read the CSS data-viz tokens so charts follow the light/dark theme exactly like the UI does. */
export function useVizTokens(): VizTokens | null {
  const { resolvedTheme } = useTheme();
  const [t, setT] = useState<VizTokens | null>(null);
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    setT({
      s1: v("--series-1"),
      s2: v("--series-2"),
      s3: v("--series-3"),
      s4: v("--series-4"),
      text: v("--foreground"),
      muted: v("--muted-foreground"),
      axis: v("--viz-axis"),
      grid: v("--viz-grid"),
      card: v("--card"),
      zone: v("--viz-zone"),
      zoneLine: v("--viz-zone-line"),
      critical: v("--status-critical"),
    });
  }, [resolvedTheme]);
  return t;
}

export function EChart({ option, height = 420, ariaLabel }: { option: EChartsOption; height?: number; ariaLabel: string }) {
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ReactECharts option={option} notMerge style={{ height: "100%", width: "100%" }} opts={{ renderer: "svg" }} />
    </div>
  );
}

/** Shared axis styling: recessive solid grid, muted axis ink. */
export const axisStyle = (t: VizTokens) => ({
  axisLine: { lineStyle: { color: t.grid } },
  axisTick: { show: false },
  axisLabel: { color: t.axis, fontSize: 11 },
  nameTextStyle: { color: t.axis, fontSize: 12 },
  splitLine: { lineStyle: { color: t.grid, type: "solid" as const } },
});

export const tooltipStyle = (t: VizTokens) => ({
  backgroundColor: t.card,
  borderColor: t.grid,
  textStyle: { color: t.text, fontSize: 12 },
  extraCssText: "border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.25);",
});
