"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Moon, Search, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { NAV } from "@/components/app-sidebar";

type Lite = { accession: string; name: string; title: string };

const TITLES: Record<string, string> = Object.fromEntries(NAV.flatMap((g) => g.items.map((i) => [i.href, i.label])));

export function TopBar({ invs }: { invs: Lite[] }) {
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !(e.target as HTMLElement)?.closest("input,textarea"))) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const seg = "/" + (path.split("/")[1] ?? "");
  const section = TITLES[seg] ?? "Mission Control";
  const detail = path.startsWith("/investigations/") ? invs.find((i) => i.accession === path.split("/")[2])?.name : null;
  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur md:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-4!" />
      <nav aria-label="Breadcrumb" className="min-w-0 truncate text-sm">
        <span className={detail ? "text-muted-foreground" : "font-medium"}>{section}</span>
        {detail && (
          <>
            <span className="mx-2 text-muted-foreground">/</span>
            <span className="font-medium">{detail}</span>
          </>
        )}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 gap-2 text-muted-foreground sm:w-60 sm:justify-start" onClick={() => setOpen(true)}>
          <Search className="size-4" />
          <span className="hidden sm:inline">Search investigations…</span>
          <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={mounted && resolvedTheme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          title="Toggle theme"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          {mounted && resolvedTheme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </Button>
      </div>

      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Jump to a page or investigation">
        <CommandInput placeholder="Type an acronym, topic or page…" />
        <CommandList>
          <CommandEmpty>No match.</CommandEmpty>
          <CommandGroup heading="Pages">
            {NAV.flatMap((g) => g.items).map((n) => (
              <CommandItem key={n.href} value={`page ${n.label}`} onSelect={() => go(n.href)}>
                <n.icon className="size-4" />
                {n.label}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Investigations">
            {invs.map((i) => (
              <CommandItem key={i.accession} value={`${i.name} ${i.accession} ${i.title}`} onSelect={() => go(`/investigations/${i.accession}`)}>
                <span className="w-28 shrink-0 font-medium">{i.name}</span>
                <span className="truncate text-muted-foreground">{i.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </header>
  );
}
