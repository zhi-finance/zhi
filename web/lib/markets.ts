import type { MarketChoice } from "./ruletree/compile";

export interface MarketInfo extends MarketChoice {
  supported: boolean;
  oracleTypeId: number | null;
  oracleType: string;
  oracleBase: string;
  oracleQuote: string;
  priceTickStr: string;
  qtyTickStr: string;
  quoteDenom: string;
  markPrice: number | null;
}

export async function fetchMarkets(): Promise<MarketInfo[]> {
  const r = await fetch("/api/markets");
  const j = (await r.json()) as { markets: MarketInfo[]; error?: string };
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j.markets;
}
