// zhi.ruletree/1.0 — TypeScript mirror of harness/crates/zhi-core/src/ruletree.rs.
// The Rust harness is the authority at runtime; this file must accept and reject exactly the
// same documents. Shared fixture: fixtures/ruletree.example.json (+ .hash).

export const SCHEMA_ID = "zhi.ruletree/1.0";

export const INDICATORS = ["PRICE", "EMA", "SMA", "RSI", "SPREAD_BPS", "RETURN_BPS", "VOL_BPS", "ORACLE_LIVE"] as const;
export const OPS = ["gt", "gte", "lt", "lte", "eq", "between", "crosses_above", "crosses_below"] as const;
export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h"] as const;

export type Indicator = (typeof INDICATORS)[number];
export type Op = (typeof OPS)[number];
export type Timeframe = (typeof TIMEFRAMES)[number];
export type Side = "long" | "short";

export const PERIOD_INDICATORS: ReadonlySet<Indicator> = new Set(["EMA", "SMA", "RSI", "RETURN_BPS", "VOL_BPS"]);

export interface IndRef {
  ind: Indicator;
  period?: number;
}

export interface Condition {
  ind: Indicator;
  period?: number;
  op: Op;
  value?: number | [number, number];
  ref?: IndRef;
}

export interface SynthGate {
  asset: string;
  horizon: "1h" | "24h";
  minDirectionProb: number;
  maxBand90Bps: number;
  onMissing: "skip";
}

export interface RuleTree {
  schema: typeof SCHEMA_ID;
  agent: { registry: string; agentId: number | null };
  source: { type: "natural_language" | "url" | "memo"; inputHash: string; compiledAt: string; compiler: string };
  market: { ticker: string; marketId: string; type: "derivative" | "binary" | "spot"; class?: "crypto" | "commodity" | "equity" };
  timeframe: Timeframe;
  entry: { side: Side; all: Condition[] };
  synthGate: SynthGate | null;
  sizing: { model: "pct_equity" | "fixed_usd"; pct?: number; usd?: number; maxNotionalUsd: number; leverage: number };
  exit: {
    takeProfitPct: number;
    stopLossPct: number;
    maxHoldSec: number;
    orderTypes: { tp: "limit_post_only" | "market"; sl: "market_with_worst_price" };
  };
  risk: { maxDailyDrawdownPct: number; maxSlippageBps: number; cooldownSec: number };
}

/** Hard schema bounds — identical to SchemaBounds in Rust. */
export const BOUNDS = {
  period: [2, 500],
  leverage: [1, 20],
  pct: [0.1, 100],
  tpPct: [0.1, 50],
  slPct: [0.1, 50],
  holdSec: [60, 30 * 86400],
  ddPct: [0.5, 50],
  slipBps: [1, 1000],
  cooldown: [0, 86400],
  minDirProb: [0.5, 0.99],
  bandBps: [10, 5000],
  maxConditions: 12,
} as const;

/** Synth SN50 coverage (asset -> horizons). Mirrors synth_horizons() in Rust. */
export function synthHorizons(asset: string): ("1h" | "24h")[] {
  if (["BTC", "ETH", "SOL", "XRP", "HYPE", "XAU"].includes(asset)) return ["1h", "24h"];
  if (["SP500", "NVDA", "GOOGL", "TSLA", "AAPL", "SPCX", "WTIOIL"].includes(asset)) return ["24h"];
  return [];
}

/** On-chain vault bounds a tree must fit inside. */
export interface VaultBounds {
  maxNotional: number;
  maxLeverage: number;
  maxDailyDdPct: number;
  maxDeviationBps: number;
  cooldownSec: number;
}

export interface Issue {
  path: string;
  message: string;
}
