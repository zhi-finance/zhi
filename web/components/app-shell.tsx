"use client";

import { useQuery } from "@tanstack/react-query";
import { BookOpen, CandlestickChart, Droplets, PanelLeft, Plus, Trophy, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { fetchMainnetMarkets } from "@/lib/injective-data";
import { ConnectButton } from "./connect-button";
import { SealMark } from "./fx/seal-mark";
import { cx } from "./ui";

const NAV = [
  { href: "/markets", label: "Markets", icon: CandlestickChart },
  { href: "/agents", label: "Leaderboard", icon: Trophy },
  { href: "/portfolio", label: "My agents", icon: Wallet },
  { href: "/docs", label: "Docs", icon: BookOpen },
];

export function useMainnetMarkets() {
  return useQuery({ queryKey: ["mainnet-markets"], queryFn: fetchMainnetMarkets, refetchInterval: 30_000, staleTime: 20_000 });
}

function Ticker() {
  const q = useMainnetMarkets();
  const PIN = ["BTC", "ETH", "SOL", "INJ", "HYPE", "XRP", "TAO", "NVDA", "TSLA", "AAPL", "META", "COIN", "MSTR", "XAU", "DOGE", "SUI"];
  const all = q.data ?? [];
  const pinned = PIN.flatMap((b) => all.filter((m) => m.base === b).slice(0, 1));
  const top = [...pinned, ...all.filter((m) => !PIN.includes(m.base) && m.kind === "crypto")].slice(0, 26);
  if (top.length === 0) return <div className="h-10 border-b border-border" />;
  const row = [...top, ...top];
  return (
    <div className="relative h-10 overflow-hidden border-b border-border [mask-image:linear-gradient(90deg,transparent,black_4%,black_96%,transparent)]" aria-label="24h change on Injective mainnet">
      <ul className="marquee flex h-full w-max items-center gap-6 whitespace-nowrap px-4 text-[13px]" style={{ ["--marquee-duration" as string]: "90s" }}>
        {row.map((m, i) => (
          <li key={i} aria-hidden={i >= top.length}>
            <Link href={`/markets?m=${encodeURIComponent(m.base)}`} className="hover:underline">
              <span className="text-muted">{m.base}</span>{" "}
              <span className={cx("font-mono tabular", (m.change ?? 0) >= 0 ? "text-ok" : "text-seal")}>
                {(m.change ?? 0) >= 0 ? "+" : ""}
                {(m.change ?? 0).toFixed(2)}%
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="flex min-h-[100svh]">
      <aside className={cx("sticky top-0 hidden h-[100svh] shrink-0 flex-col border-r border-border bg-background md:flex", collapsed ? "w-[68px]" : "w-[240px]")}>
        <div className="flex h-16 items-center gap-2.5 px-4">
          <Link href="/" className="flex items-center gap-2.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Zhi home">
            <SealMark size={26} />
            {!collapsed && <span className="text-[17px] font-semibold tracking-tight">Zhi</span>}
          </Link>
        </div>
        <div className="px-3">
          <Link
            href="/terminal"
            className={cx("flex h-10 items-center gap-2 rounded-lg bg-foreground text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", collapsed ? "justify-center" : "px-3")}
            aria-label="New agent"
          >
            <Plus aria-hidden className="size-4" /> {!collapsed && "New agent"}
          </Link>
        </div>
        <Suspense fallback={<div className="mt-4 h-40" />}>
          <SideNav collapsed={collapsed} />
        </Suspense>
        <div className="mt-auto space-y-3 border-t border-border p-3">
          {!collapsed && (
            <a href="https://testnet.faucet.injective.network" target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted hover:bg-surface hover:text-foreground">
              <Droplets aria-hidden className="size-3.5" /> Testnet INJ + USDC faucet
            </a>
          )}
          <div className={collapsed ? "hidden" : ""}>
            <ConnectButton />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 bg-background/90 backdrop-blur">
          <div className="flex h-14 items-center gap-3 border-b border-border px-4">
            <button onClick={() => setCollapsed((c) => !c)} className="hidden size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:grid" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              <PanelLeft aria-hidden className="size-4" />
            </button>
            <Link href="/" className="flex items-center gap-2 md:hidden">
              <SealMark size={24} />
              <span className="font-semibold">Zhi</span>
            </Link>
            <Suspense fallback={null}>
              <MobileNav />
            </Suspense>
            <span className="label ml-auto hidden items-center gap-2 sm:flex">
              <span aria-hidden className="pulse-dot size-1.5 rounded-full bg-ok" /> Injective EVM testnet · 1439
            </span>
            <div className="md:hidden">
              <ConnectButton />
            </div>
          </div>
          <Ticker />
        </header>
        <div id="app-main" className="min-w-0 flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}


function SideNav({ collapsed }: { collapsed: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="App" className="mt-4 space-y-0.5 px-3">
      {NAV.map((n) => {
        const active = path.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            title={collapsed ? n.label : undefined}
            className={cx(
              "flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-surface-2 text-foreground" : "text-muted hover:bg-surface hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            <n.icon aria-hidden className="size-4 shrink-0" />
            {!collapsed && n.label}
          </Link>
        );
      })}
    </nav>
  );
}

function MobileNav() {
  const path = usePathname();
  return (
    <nav aria-label="App mobile" className="flex gap-1 overflow-x-auto md:hidden">
      {NAV.slice(0, 3).map((n) => (
        <Link key={n.href} href={n.href} className={cx("rounded-md px-2.5 py-1.5 text-sm", path.startsWith(n.href) ? "bg-surface-2" : "text-muted")}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
