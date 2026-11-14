import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getInvestigations, getTests } from "@/lib/data";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PYRAXIS",
  description: "AI-assisted fire-safety insights from NASA PSI microgravity combustion data.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const invs = getInvestigations();
  const stats = {
    investigations: invs.length,
    tests: getTests().filter((t) => t.row_kind === "test").length,
    tb: invs.reduce((s, i) => s + i.size_gb, 0) / 1000,
  };
  const lite = invs.map((i) => ({ accession: i.accession, name: i.acronym || i.accession, title: i.title }));

  return (
    <html lang="en" suppressHydrationWarning>
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) add attributes to <body> before React loads */}
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
        <ThemeProvider>
          <TooltipProvider delayDuration={150}>
            <SidebarProvider>
              <AppSidebar stats={stats} />
              <SidebarInset className="min-w-0">
                <TopBar invs={lite} />
                <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8">{children}</main>
                <footer className="mx-auto w-full max-w-7xl px-4 pb-8 text-xs text-muted-foreground md:px-6">
                  Data: NASA Physical Sciences Informatics (psi.nasa.gov), 24 Combustion Science investigations. Values trace to source file and row.
                </footer>
              </SidebarInset>
            </SidebarProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
