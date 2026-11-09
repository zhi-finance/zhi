"use client";

import dynamic from "next/dynamic";

// Entirely live data (prices, book, favourites in localStorage): render on the client only.
export const MarketTerminalClient = dynamic(() => import("./market-terminal").then((m) => m.MarketTerminal), {
  ssr: false,
  loading: () => <div className="p-6 text-sm text-muted">Loading Injective markets…</div>,
});
