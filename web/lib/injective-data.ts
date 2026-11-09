// Real Injective market data. Nothing here is mocked.
//  - Market list, 24h stats and candles: Injective MAINNET indexer (live, liquid price history)
//  - Order book and trades: Injective TESTNET (the market a Zhi agent actually trades today)
//  - Reference price the vault checks: testnet oracle precompile (lib/live.ts)

export const MAINNET_INDEXER = "https://sentry.exchange.grpc-web.injective.network";
export const TESTNET_INDEXER = "https://k8s.testnet.exchange.grpc-web.injective.network";
export const TESTNET_LCD = "https://testnet.sentry.lcd.injective.network";

const STOCKS = new Set(["MSFT", "AMZN", "META", "COIN", "NVDA", "HOOD", "GOOGL", "TSLA", "AAPL", "PLTR", "MSTR", "CRCL", "SPY", "QQQ", "NFLX", "AMD", "INTC", "AVGO", "ORCL", "BABA", "MU", "SNDK", "SKHX", "SOXL", "SP500", "XYZ100", "IBM", "CRWV", "GME", "RDDT", "UBER", "V", "MA", "JPM", "TSM", "ARM", "SMCI"]);
const MORE = /^(XAU|XAG|GOLD|SILVER|WTI|BRENT|OIL|CL|NG|EUR|GBP|JPY|AUD|CAD|CHF|CNH|KRW|USD|XPT|XPD|COPPER)/;

export type MarketKind = "crypto" | "stocks";

export interface MainnetMarket {
  marketId: string;
  ticker: string;
  base: string;
  kind: MarketKind;
  price: number | null;
  change: number | null; // 24h %
  volume: number | null; // 24h quote volume
  high: number | null;
  low: number | null;
}

async function j<T>(url: string): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export const baseOf = (ticker: string) => ticker.split(/[/ -]/)[0].toUpperCase();

export async function fetchMainnetMarkets(): Promise<MainnetMarket[]> {
  const [mk, sum] = await Promise.all([
    j<{ markets: { marketId: string; ticker: string }[] }>(`${MAINNET_INDEXER}/api/exchange/derivative/v1/markets?marketStatus=active`),
    j<{ marketId: string; price: number; change: number; volume: number; high: number; low: number }[]>(`${MAINNET_INDEXER}/api/chronos/v1/derivative/market_summary_all?resolution=24h`),
  ]);
  const byId = new Map(sum.map((s) => [s.marketId, s]));
  return mk.markets
    .map((m) => {
      const s = byId.get(m.marketId);
      const base = baseOf(m.ticker);
      return {
        marketId: m.marketId,
        ticker: m.ticker,
        base,
        kind: (STOCKS.has(base) || MORE.test(base) ? "stocks" : "crypto") as MarketKind,
        price: s?.price ?? null,
        change: s?.change ?? null,
        volume: s?.volume ?? null,
        high: s?.high ?? null,
        low: s?.low ?? null,
      };
    })
    .filter((m) => m.price !== null)
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function fetchCandles(marketId: string, resolutionMin: number, count = 300, network: "mainnet" | "testnet" = "mainnet"): Promise<Candle[]> {
  const base = network === "mainnet" ? MAINNET_INDEXER : TESTNET_INDEXER;
  const to = Math.floor(Date.now() / 1000);
  const res = resolutionMin >= 1440 ? "1D" : String(resolutionMin);
  const d = await j<{ t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] }>(
    `${base}/api/chart/v1/derivative/history?marketId=${marketId}&resolution=${res}&countback=${count}&to=${to}`,
  );
  return (d.t ?? []).map((t, i) => ({ time: t, open: d.o[i], high: d.h[i], low: d.l[i], close: d.c[i], volume: d.v?.[i] ?? 0 }));
}

export interface Level {
  price: number;
  size: number;
}

/** Testnet order book (human units; quote has 6 decimals). */
export async function fetchTestnetBook(marketId: string, limit = 12): Promise<{ bids: Level[]; asks: Level[] }> {
  const d = await j<{ buys_price_level: { p: string; q: string }[]; sells_price_level: { p: string; q: string }[] }>(
    `${TESTNET_LCD}/injective/exchange/v1beta1/derivative/orderbook/${marketId}?limit=${limit}`,
  );
  const map = (xs: { p: string; q: string }[]) => (xs ?? []).map((x) => ({ price: Number(x.p) / 1e6, size: Number(x.q) }));
  return { bids: map(d.buys_price_level), asks: map(d.sells_price_level) };
}

export interface Trade {
  side: "buy" | "sell";
  price: number;
  size: number;
  at: number; // ms
}

export async function fetchTestnetTrades(marketId: string, limit = 30): Promise<Trade[]> {
  const d = await j<{ trades: { positionDelta: { tradeDirection: string; executionPrice: string; executionQuantity: string }; executedAt: number }[] }>(
    `${TESTNET_INDEXER}/api/exchange/derivative/v1/trades?marketIds=${marketId}&limit=${limit}`,
  );
  return (d.trades ?? []).map((t) => ({
    side: t.positionDelta.tradeDirection === "buy" ? "buy" : "sell",
    price: Number(t.positionDelta.executionPrice) / 1e6,
    size: Number(t.positionDelta.executionQuantity),
    at: t.executedAt,
  }));
}

export function fmtPrice(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const dp = n >= 1000 ? 1 : n >= 100 ? 2 : n >= 1 ? 3 : 5;
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtCompact(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
}
