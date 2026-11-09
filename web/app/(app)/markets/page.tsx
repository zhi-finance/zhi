import type { Metadata } from "next";
import { Suspense } from "react";
import { MarketTerminalClient } from "@/components/markets/market-terminal-client";

export const metadata: Metadata = { title: "Markets" };

export default function MarketsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted">Loading markets…</div>}>
      <MarketTerminalClient />
    </Suspense>
  );
}
