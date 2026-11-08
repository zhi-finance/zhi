// Deterministic half of the compiler: LLM draft -> rule tree.
// The model only proposes values; this file decides what is accepted. Every leaf gets a
// provenance flag shown in the diff preview:
//   grounded (green)  value came from the text, with a quoted span as evidence
//   default  (yellow) not grounded -> operator preset default (PRD §7 "Ambiguity")
//   clamped  (red)    the text asked for more than the operator's preset allows
import { hashRuleTree } from "./canonical";
import { BOUNDS, INDICATORS, OPS, PERIOD_INDICATORS, SCHEMA_ID, TIMEFRAMES, synthHorizons, type Condition, type Indicator, type Issue, type RuleTree, type Timeframe } from "./types";
import { validate } from "./validate";

export type FlagKind = "grounded" | "default" | "clamped";
export interface Flag {
  kind: FlagKind;
  note: string;
}

export interface MarketChoice {
  ticker: string;
  marketId: string;
  type: "derivative" | "binary" | "spot";
  class: "crypto" | "commodity" | "equity";
  synthAsset: string | null;
}

/** Operator presets: defaults + the ceilings the compiler will never exceed. */
export interface Presets {
  timeframe: Timeframe;
  leverage: number;
  maxLeverage: number;
  pct: number;
  maxPct: number;
  maxNotionalUsd: number;
  takeProfitPct: number;
  stopLossPct: number;
  maxHoldSec: number;
  maxDailyDrawdownPct: number;
  maxSlippageBps: number;
  cooldownSec: number;
  minDirectionProb: number;
  maxBand90Bps: number;
}

export const DEFAULT_PRESETS: Presets = {
  timeframe: "5m",
  leverage: 3,
  maxLeverage: 3,
  pct: 10,
  maxPct: 25,
  maxNotionalUsd: 2500,
  takeProfitPct: 3,
  stopLossPct: 1.5,
  maxHoldSec: 86400,
  maxDailyDrawdownPct: 4,
  maxSlippageBps: 35,
  cooldownSec: 180,
  minDirectionProb: 0.6,
  maxBand90Bps: 180,
};

type N = number | null;
export interface Draft {
  side: "long" | "short" | null;
  timeframe: Timeframe | null;
  conditions: { ind: Indicator; period: N; op: (typeof OPS)[number]; value: N; valueHi: N; refInd: Indicator | null; refPeriod: N }[];
  synth: { enabled: boolean | null; horizon: "1h" | "24h" | null; minDirectionProb: N; maxBand90Bps: N };
  sizing: { model: "pct_equity" | "fixed_usd" | null; pct: N; usd: N; maxNotionalUsd: N; leverage: N };
  exit: { takeProfitPct: N; stopLossPct: N; maxHoldSec: N; tp: "limit_post_only" | "market" | null };
  risk: { maxDailyDrawdownPct: N; maxSlippageBps: N; cooldownSec: N };
  evidence: { field: string; quote: string }[];
  ignoredInstructions: string[];
  summary: string;
}

const nullable = (t: string | string[]) => ({ type: Array.isArray(t) ? [...t, "null"] : [t, "null"] });
const enumNullable = (vals: readonly string[]) => ({ anyOf: [{ type: "string", enum: [...vals] }, { type: "null" }] });

/** JSON Schema handed to the model as structured output. Intentionally loose on numbers:
 *  bounds are enforced deterministically below, not trusted to the model. */
export const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["side", "timeframe", "conditions", "synth", "sizing", "exit", "risk", "evidence", "ignoredInstructions", "summary"],
  properties: {
    side: enumNullable(["long", "short"]),
    timeframe: enumNullable(TIMEFRAMES),
    conditions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ind", "period", "op", "value", "valueHi", "refInd", "refPeriod"],
        properties: {
          ind: { type: "string", enum: INDICATORS.filter((i) => i !== "ORACLE_LIVE") },
          period: nullable("integer"),
          op: { type: "string", enum: OPS.filter((o) => o !== "eq") },
          value: nullable("number"),
          valueHi: nullable("number"),
          refInd: enumNullable(INDICATORS.filter((i) => i !== "ORACLE_LIVE")),
          refPeriod: nullable("integer"),
        },
      },
    },
    synth: {
      type: "object",
      additionalProperties: false,
      required: ["enabled", "horizon", "minDirectionProb", "maxBand90Bps"],
      properties: { enabled: nullable("boolean"), horizon: enumNullable(["1h", "24h"]), minDirectionProb: nullable("number"), maxBand90Bps: nullable("number") },
    },
    sizing: {
      type: "object",
      additionalProperties: false,
      required: ["model", "pct", "usd", "maxNotionalUsd", "leverage"],
      properties: { model: enumNullable(["pct_equity", "fixed_usd"]), pct: nullable("number"), usd: nullable("number"), maxNotionalUsd: nullable("number"), leverage: nullable("number") },
    },
    exit: {
      type: "object",
      additionalProperties: false,
      required: ["takeProfitPct", "stopLossPct", "maxHoldSec", "tp"],
      properties: { takeProfitPct: nullable("number"), stopLossPct: nullable("number"), maxHoldSec: nullable("integer"), tp: enumNullable(["limit_post_only", "market"]) },
    },
    risk: {
      type: "object",
      additionalProperties: false,
      required: ["maxDailyDrawdownPct", "maxSlippageBps", "cooldownSec"],
      properties: { maxDailyDrawdownPct: nullable("number"), maxSlippageBps: nullable("number"), cooldownSec: nullable("integer") },
    },
    evidence: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["field", "quote"], properties: { field: { type: "string" }, quote: { type: "string" } } },
    },
    ignoredInstructions: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
} as const;

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

export interface CompileResult {
  tree: RuleTree;
  hash: `0x${string}`;
  flags: Record<string, Flag>;
  issues: Issue[];
  ignoredInstructions: string[];
  summary: string;
}

export function buildTree(draft: Draft, market: MarketChoice, presets: Presets, source: { type: RuleTree["source"]["type"]; inputHash: `0x${string}`; compiledAt: string }, registry: string): CompileResult {
  const flags: Record<string, Flag> = {};
  const evidence = new Map(draft.evidence.map((e) => [e.field, e.quote]));
  const quote = (path: string) => evidence.get(path) ?? evidence.get(path.split(".").pop() ?? "");

  /** Pick the model's value if present (clamped to [lo, hi]), else the preset default. */
  function pick(path: string, v: number | null, dflt: number, lo: number, hi: number, dp = 4): number {
    if (v === null || !Number.isFinite(v)) {
      flags[path] = { kind: "default", note: `not in the text; operator default ${dflt}` };
      return dflt;
    }
    const x = round(v, dp);
    if (x > hi || x < lo) {
      const c = Math.min(hi, Math.max(lo, x));
      flags[path] = { kind: "clamped", note: `text asked for ${v}; clamped to ${c} (operator preset)` };
      return c;
    }
    const q = quote(path);
    flags[path] = { kind: "grounded", note: q ? `"${q}"` : "from the text" };
    return x;
  }

  const side = draft.side ?? "long";
  flags["entry.side"] = draft.side ? { kind: "grounded", note: quote("entry.side") ? `"${quote("entry.side")}"` : "from the text" } : { kind: "default", note: "no direction in the text; defaulted to long" };
  const timeframe = draft.timeframe ?? presets.timeframe;
  flags["timeframe"] = draft.timeframe ? { kind: "grounded", note: "from the text" } : { kind: "default", note: `operator default ${presets.timeframe}` };

  // ---- conditions
  const all: Condition[] = [];
  draft.conditions.slice(0, BOUNDS.maxConditions - 1).forEach((c, i) => {
    const p = `entry.all[${all.length}]`;
    const cond: Condition = { ind: c.ind, op: c.op };
    if (PERIOD_INDICATORS.has(c.ind)) cond.period = Math.min(BOUNDS.period[1], Math.max(BOUNDS.period[0], Math.round(c.period ?? 14)));
    if (c.refInd) {
      cond.ref = { ind: c.refInd };
      if (PERIOD_INDICATORS.has(c.refInd)) cond.ref.period = Math.min(BOUNDS.period[1], Math.max(BOUNDS.period[0], Math.round(c.refPeriod ?? 50)));
    }
    if (c.op === "between") {
      if (c.value === null) return void (flags[`dropped[${i}]`] = { kind: "clamped", note: `dropped ${c.ind} between: no bounds in the text` });
      let lo = c.value, hi = c.valueHi ?? c.value;
      if (lo > hi) [lo, hi] = [hi, lo];
      if (c.ind === "RSI") [lo, hi] = [Math.max(0, lo), Math.min(100, hi)];
      cond.value = [round(lo, 4), round(hi, 4)];
      delete cond.ref;
    } else if (!cond.ref) {
      if (c.value === null) return void (flags[`dropped[${i}]`] = { kind: "clamped", note: `dropped ${c.ind} ${c.op}: no threshold or reference in the text` });
      cond.value = c.ind === "RSI" ? Math.min(100, Math.max(0, round(c.value, 4))) : round(c.value, 4);
    }
    all.push(cond);
    flags[p] = { kind: "grounded", note: quote(p) ? `"${quote(p)}"` : "from the text" };
  });
  if (all.length === 0) {
    all.push({ ind: "EMA", period: 20, op: "gt", ref: { ind: "EMA", period: 50 } });
    flags["entry.all[0]"] = { kind: "default", note: "no entry rule in the text; default trend filter EMA(20) > EMA(50)" };
  }
  if (market.class !== "crypto") {
    all.push({ ind: "ORACLE_LIVE", op: "eq", value: 1 });
    flags[`entry.all[${all.length - 1}]`] = { kind: "default", note: "inserted automatically: iAsset entries need a live oracle" };
  }

  // ---- synth gate
  let synthGate: RuleTree["synthGate"] = null;
  const horizons = market.synthAsset ? synthHorizons(market.synthAsset) : [];
  if (horizons.length > 0 && draft.synth.enabled !== false) {
    const wanted = draft.synth.horizon && horizons.includes(draft.synth.horizon) ? draft.synth.horizon : horizons[0];
    synthGate = {
      asset: market.synthAsset!,
      horizon: wanted,
      minDirectionProb: pick("synthGate.minDirectionProb", draft.synth.minDirectionProb, presets.minDirectionProb, BOUNDS.minDirProb[0], BOUNDS.minDirProb[1], 2),
      maxBand90Bps: pick("synthGate.maxBand90Bps", draft.synth.maxBand90Bps, presets.maxBand90Bps, BOUNDS.bandBps[0], BOUNDS.bandBps[1], 0),
      onMissing: "skip",
    };
    flags["synthGate.horizon"] = draft.synth.horizon === wanted ? { kind: "grounded", note: "from the text" } : { kind: "default", note: `${market.synthAsset} gate on ${wanted}` };
  } else {
    flags["synthGate"] = horizons.length === 0
      ? { kind: "default", note: `${market.ticker} is not covered by Synth SN50: agent shown as unverified` }
      : { kind: "clamped", note: "the text disabled the Synth gate: agent shown as unverified" };
  }

  // ---- sizing / exit / risk (clamped to the operator's presets, never above schema bounds)
  const binary = market.type === "binary";
  const leverage = binary ? 1 : pick("sizing.leverage", draft.sizing.leverage, presets.leverage, 1, Math.min(presets.maxLeverage, BOUNDS.leverage[1]), 2);
  const model = draft.sizing.model ?? "pct_equity";
  const sizing: RuleTree["sizing"] = model === "fixed_usd"
    ? { model, usd: pick("sizing.usd", draft.sizing.usd, presets.maxNotionalUsd / 2, 1, presets.maxNotionalUsd, 2), maxNotionalUsd: 0, leverage }
    : { model, pct: pick("sizing.pct", draft.sizing.pct, presets.pct, BOUNDS.pct[0], presets.maxPct, 2), maxNotionalUsd: 0, leverage };
  sizing.maxNotionalUsd = pick("sizing.maxNotionalUsd", draft.sizing.maxNotionalUsd, presets.maxNotionalUsd, 1, presets.maxNotionalUsd, 2);

  const tree: RuleTree = {
    schema: SCHEMA_ID,
    agent: { registry, agentId: null },
    source: { type: source.type, inputHash: source.inputHash, compiledAt: source.compiledAt, compiler: "zhi-compiler/1.0" },
    market: { ticker: market.ticker, marketId: market.marketId.toLowerCase(), type: market.type, class: market.class },
    timeframe,
    entry: { side, all },
    synthGate,
    sizing,
    exit: {
      takeProfitPct: pick("exit.takeProfitPct", draft.exit.takeProfitPct, presets.takeProfitPct, BOUNDS.tpPct[0], BOUNDS.tpPct[1], 2),
      stopLossPct: pick("exit.stopLossPct", draft.exit.stopLossPct, presets.stopLossPct, BOUNDS.slPct[0], BOUNDS.slPct[1], 2),
      maxHoldSec: Math.round(pick("exit.maxHoldSec", draft.exit.maxHoldSec, presets.maxHoldSec, BOUNDS.holdSec[0], BOUNDS.holdSec[1], 0)),
      orderTypes: { tp: draft.exit.tp ?? "limit_post_only", sl: "market_with_worst_price" },
    },
    risk: {
      maxDailyDrawdownPct: pick("risk.maxDailyDrawdownPct", draft.risk.maxDailyDrawdownPct, presets.maxDailyDrawdownPct, BOUNDS.ddPct[0], presets.maxDailyDrawdownPct, 2),
      maxSlippageBps: pick("risk.maxSlippageBps", draft.risk.maxSlippageBps, presets.maxSlippageBps, BOUNDS.slipBps[0], presets.maxSlippageBps, 0),
      cooldownSec: Math.round(pick("risk.cooldownSec", draft.risk.cooldownSec, presets.cooldownSec, presets.cooldownSec, BOUNDS.cooldown[1], 0)),
    },
  };

  const issues = validate(tree);
  return { tree, hash: hashRuleTree(tree), flags, issues, ignoredInstructions: draft.ignoredInstructions, summary: draft.summary };
}
