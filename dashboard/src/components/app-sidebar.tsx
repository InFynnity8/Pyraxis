"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Columns3, Gauge, Layers, LineChart, Map, MessageSquareText, Table2, ExternalLink } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

export const NAV = [
  {
    group: "Explore",
    items: [
      { href: "/", label: "Mission Control", icon: Gauge },
      { href: "/map", label: "Flammability Map", icon: Map },
      { href: "/investigations", label: "Investigations", icon: Table2 },
      { href: "/compare", label: "Compare", icon: Columns3 },
    ],
  },
  {
    group: "Analyse",
    items: [
      { href: "/layers", label: "Fire-safety layers", icon: Layers },
      { href: "/ask", label: "Ask the data", icon: MessageSquareText },
      { href: "/model", label: "Predictions", icon: LineChart },
    ],
  },
  { group: "Context", items: [{ href: "/about", label: "Method & Earth", icon: BookOpen }] },
];

export function AppSidebar({ stats }: { stats: { investigations: number; tests: number; tb: number } }) {
  const path = usePathname();
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="PYRAXIS">
              <Link href="/" onClick={() => setOpenMobile(false)}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
                  <FlameMark />
                </span>
                <span className="grid leading-tight">
                  <span className="font-semibold tracking-wide">PYRAXIS</span>
                  <span className="font-mono text-[11px] text-muted-foreground">Flame in Freefall · NASA PSI</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV.map((g) => (
          <SidebarGroup key={g.group}>
            <SidebarGroupLabel className="font-mono uppercase tracking-wider">{g.group}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((n) => {
                  const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
                  return (
                    <SidebarMenuItem key={n.href}>
                      <SidebarMenuButton asChild isActive={active} tooltip={n.label}>
                        <Link href={n.href} onClick={() => setOpenMobile(false)}>
                          <n.icon />
                          <span>{n.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t">
        <div className="space-y-1 px-2 py-1 font-mono text-[11px] text-muted-foreground group-data-[collapsible=icon]:hidden">
          <Row k="investigations" v={String(stats.investigations)} />
          <Row k="tests parsed" v={stats.tests.toLocaleString()} />
          <Row k="PSI archive mapped" v={`${stats.tb.toFixed(1)} TB`} />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="NASA PSI">
              <a href="https://psi.nasa.gov" target="_blank" rel="noreferrer">
                <ExternalLink />
                <span>psi.nasa.gov</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span>{k}</span>
      <span className="text-foreground">{v}</span>
    </div>
  );
}

/** Blue microgravity sphere inside an orange 1-g teardrop - the project's visual metaphor. */
export function FlameMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z" fill="none" stroke="var(--series-2)" strokeWidth="1.8" />
      <circle cx="12" cy="14" r="3.4" fill="var(--series-1)" />
    </svg>
  );
}
