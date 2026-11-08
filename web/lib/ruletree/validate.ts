// Deterministic validation. Same rules as validate() in ruletree.rs; runs after the LLM in the
// compiler, again in the harness on load, and the vault is the final check on-chain.
import {
  BOUNDS,
  INDICATORS,
  OPS,
  PERIOD_INDICATORS,
  SCHEMA_ID,
  TIMEFRAMES,
  synthHorizons,
  type Condition,
  type Issue,
  type RuleTree,
  type VaultBounds,
} from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isHex32 = (s: unknown) => typeof s === "string" && /^0x[0-9a-fA-F]{64}$/.test(s);
const decimals = (n: number) => (String(n).split(".")[1] ?? "").length;

/** Structural check: required keys, allowed keys only (deny_unknown_fields), enum values. */
function shape(v: unknown, path: string, spec: Record<string, "req" | "opt">, issues: Issue[]): v is Obj {
  if (!isObj(v)) {
    issues.push({ path, message: "must be an object" });
    return false;
  }
  for (const k of Object.keys(v)) {
    if (!(k in spec)) issues.push({ path: path ? `${path}.${k}` : k, message: "unknown field" });
  }
  for (const [k, need] of Object.entries(spec)) {
    if (need === "req" && !(k in v)) issues.push({ path: path ? `${path}.${k}` : k, message: "missing field" });
  }
  return true;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string, issues: Issue[]): v is T {
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    issues.push({ path, message: `must be one of ${allowed.join(", ")}` });
    return false;
  }
  return true;
}

function inRange(v: unknown, [lo, hi]: readonly [number, number], path: string, issues: Issue[], extra = "") {
  if (!isNum(v) || v < lo || v > hi) issues.push({ path, message: `${lo}..=${hi}${extra}` });
}

export function validate(doc: unknown, vault?: VaultBounds): Issue[] {
  const issues: Issue[] = [];
  if (!shape(doc, "", { schema: "req", agent: "req", source: "req", market: "req", timeframe: "req", entry: "req", synthGate: "req", sizing: "req", exit: "req", risk: "req" }, issues)) return issues;
  const t = doc as unknown as RuleTree;
  if (t.schema !== SCHEMA_ID) issues.push({ path: "schema", message: `must be ${SCHEMA_ID}` });

  if (shape(t.agent, "agent", { registry: "req", agentId: "req" }, issues)) {
    if (typeof t.agent.registry !== "string") issues.push({ path: "agent.registry", message: "string" });
    if (t.agent.agentId !== null && !(Number.isInteger(t.agent.agentId) && t.agent.agentId >= 0)) issues.push({ path: "agent.agentId", message: "integer or null" });
  }
  if (shape(t.source, "source", { type: "req", inputHash: "req", compiledAt: "req", compiler: "req" }, issues)) {
    oneOf(t.source.type, ["natural_language", "url", "memo"] as const, "source.type", issues);
    if (!isHex32(t.source.inputHash)) issues.push({ path: "source.inputHash", message: "must be a 0x-prefixed keccak256" });
  }
  if (shape(t.market, "market", { ticker: "req", marketId: "req", type: "req", class: "opt" }, issues)) {
    if (!isHex32(t.market.marketId)) issues.push({ path: "market.marketId", message: "must be a 0x-prefixed 32-byte hex id" });
    oneOf(t.market.type, ["derivative", "binary", "spot"] as const, "market.type", issues);
    if (t.market.class !== undefined) oneOf(t.market.class, ["crypto", "commodity", "equity"] as const, "market.class", issues);
  }
  oneOf(t.timeframe, TIMEFRAMES, "timeframe", issues);

  if (shape(t.entry, "entry", { side: "req", all: "req" }, issues)) {
    oneOf(t.entry.side, ["long", "short"] as const, "entry.side", issues);
    if (!Array.isArray(t.entry.all) || t.entry.all.length === 0 || t.entry.all.length > BOUNDS.maxConditions) {
      issues.push({ path: "entry.all", message: `1..=${BOUNDS.maxConditions} conditions` });
    } else {
      t.entry.all.forEach((c, i) => validateCondition(c, `entry.all[${i}]`, issues));
    }
    if ((t.market?.class === "equity" || t.market?.class === "commodity") && Array.isArray(t.entry.all)) {
      const has = t.entry.all.some((c) => c?.ind === "ORACLE_LIVE" && c?.op === "eq");
      if (!has) issues.push({ path: "entry.all", message: 'iAsset markets require {"ind":"ORACLE_LIVE","op":"eq","value":1}' });
    }
  }

  if (t.synthGate !== null) {
    if (shape(t.synthGate, "synthGate", { asset: "req", horizon: "req", minDirectionProb: "req", maxBand90Bps: "req", onMissing: "req" }, issues)) {
      const g = t.synthGate;
      oneOf(g.horizon, ["1h", "24h"] as const, "synthGate.horizon", issues);
      oneOf(g.onMissing, ["skip"] as const, "synthGate.onMissing", issues);
      const hs = synthHorizons(g.asset);
      if (hs.length === 0) issues.push({ path: "synthGate.asset", message: `${g.asset} is not covered by Synth; set synthGate to null` });
      else if (!hs.includes(g.horizon)) issues.push({ path: "synthGate.horizon", message: `${g.asset} only has ${hs.join(", ")}` });
      inRange(g.minDirectionProb, BOUNDS.minDirProb, "synthGate.minDirectionProb", issues);
      inRange(g.maxBand90Bps, BOUNDS.bandBps, "synthGate.maxBand90Bps", issues);
    }
  }

  if (shape(t.sizing, "sizing", { model: "req", pct: "opt", usd: "opt", maxNotionalUsd: "req", leverage: "req" }, issues)) {
    const s = t.sizing;
    inRange(s.leverage, BOUNDS.leverage, "sizing.leverage", issues, ", max 2 decimals");
    if (isNum(s.leverage) && decimals(s.leverage) > 2 && !issues.some((i) => i.path === "sizing.leverage")) issues.push({ path: "sizing.leverage", message: "max 2 decimals" });
    if (oneOf(s.model, ["pct_equity", "fixed_usd"] as const, "sizing.model", issues)) {
      if (s.model === "pct_equity" && !(isNum(s.pct) && s.pct >= BOUNDS.pct[0] && s.pct <= BOUNDS.pct[1])) issues.push({ path: "sizing.pct", message: `required for pct_equity, ${BOUNDS.pct[0]}..=${BOUNDS.pct[1]}` });
      if (s.model === "fixed_usd" && !(isNum(s.usd) && s.usd > 0)) issues.push({ path: "sizing.usd", message: "required for fixed_usd, > 0" });
    }
    if (!isNum(s.maxNotionalUsd) || s.maxNotionalUsd <= 0) issues.push({ path: "sizing.maxNotionalUsd", message: "> 0" });
    if (t.market?.type === "binary" && s.leverage !== 1) issues.push({ path: "sizing.leverage", message: "binary options are fully collateralized: leverage must be 1" });
  }

  if (shape(t.exit, "exit", { takeProfitPct: "req", stopLossPct: "req", maxHoldSec: "req", orderTypes: "req" }, issues)) {
    inRange(t.exit.takeProfitPct, BOUNDS.tpPct, "exit.takeProfitPct", issues);
    inRange(t.exit.stopLossPct, BOUNDS.slPct, "exit.stopLossPct", issues);
    if (!Number.isInteger(t.exit.maxHoldSec)) issues.push({ path: "exit.maxHoldSec", message: "integer seconds" });
    else inRange(t.exit.maxHoldSec, BOUNDS.holdSec, "exit.maxHoldSec", issues);
    if (shape(t.exit.orderTypes, "exit.orderTypes", { tp: "req", sl: "req" }, issues)) {
      oneOf(t.exit.orderTypes.tp, ["limit_post_only", "market"] as const, "exit.orderTypes.tp", issues);
      oneOf(t.exit.orderTypes.sl, ["market_with_worst_price"] as const, "exit.orderTypes.sl", issues);
    }
  }

  if (shape(t.risk, "risk", { maxDailyDrawdownPct: "req", maxSlippageBps: "req", cooldownSec: "req" }, issues)) {
    inRange(t.risk.maxDailyDrawdownPct, BOUNDS.ddPct, "risk.maxDailyDrawdownPct", issues);
    inRange(t.risk.maxSlippageBps, BOUNDS.slipBps, "risk.maxSlippageBps", issues);
    if (!Number.isInteger(t.risk.cooldownSec)) issues.push({ path: "risk.cooldownSec", message: "integer seconds" });
    else inRange(t.risk.cooldownSec, BOUNDS.cooldown, "risk.cooldownSec", issues);
  }

  if (vault && issues.length === 0) {
    if (t.sizing.maxNotionalUsd > vault.maxNotional) issues.push({ path: "sizing.maxNotionalUsd", message: `exceeds vault maxNotional ${vault.maxNotional}` });
    if (t.sizing.leverage > vault.maxLeverage) issues.push({ path: "sizing.leverage", message: `exceeds vault max leverage ${vault.maxLeverage}` });
    if (t.risk.maxDailyDrawdownPct > vault.maxDailyDdPct) issues.push({ path: "risk.maxDailyDrawdownPct", message: `exceeds vault freeze level ${vault.maxDailyDdPct}%` });
    if (t.risk.maxSlippageBps > vault.maxDeviationBps) issues.push({ path: "risk.maxSlippageBps", message: `exceeds vault maxDeviationBps ${vault.maxDeviationBps}` });
    if (t.risk.cooldownSec < vault.cooldownSec) issues.push({ path: "risk.cooldownSec", message: `below vault cooldown ${vault.cooldownSec}s` });
  }
  return issues;
}

function validateCondition(c: Condition, p: string, issues: Issue[]) {
  if (!shape(c, p, { ind: "req", period: "opt", op: "req", value: "opt", ref: "opt" }, issues)) return;
  const indOk = oneOf(c.ind, INDICATORS, `${p}.ind`, issues);
  const opOk = oneOf(c.op, OPS, `${p}.op`, issues);
  if (!indOk || !opOk) return;
  const checkPeriod = (ind: string, period: unknown, path: string) => {
    const needs = PERIOD_INDICATORS.has(ind as Condition["ind"]);
    if (needs && !(Number.isInteger(period) && (period as number) >= BOUNDS.period[0] && (period as number) <= BOUNDS.period[1])) issues.push({ path, message: `${ind} needs period ${BOUNDS.period[0]}..=${BOUNDS.period[1]}` });
    if (!needs && period !== undefined) issues.push({ path, message: `${ind} takes no period` });
  };
  checkPeriod(c.ind, c.period, `${p}.period`);
  const v = c.value;
  if (v !== undefined && !isNum(v) && !(Array.isArray(v) && v.length === 2 && v.every(isNum))) {
    issues.push({ path: `${p}.value`, message: "value must be a number or [lo, hi]" });
    return;
  }
  if (c.op === "between") {
    if (!(Array.isArray(v) && v[0] <= v[1] && c.ref === undefined)) issues.push({ path: `${p}.value`, message: "between needs value [lo, hi] with lo <= hi and no ref" });
  } else if (c.op === "eq") {
    if (c.ind !== "ORACLE_LIVE" || v !== 1) issues.push({ path: `${p}.op`, message: "eq is only allowed as ORACLE_LIVE eq 1" });
  } else {
    if (isNum(v) && c.ref === undefined) {
      /* ok */
    } else if (v === undefined && c.ref !== undefined) {
      if (shape(c.ref, `${p}.ref`, { ind: "req", period: "opt" }, issues) && oneOf(c.ref.ind, INDICATORS, `${p}.ref.ind`, issues)) checkPeriod(c.ref.ind, c.ref.period, `${p}.ref.period`);
    } else issues.push({ path: p, message: "needs exactly one of value (number) or ref" });
  }
  if (c.ind === "RSI") {
    const ok = v === undefined || (isNum(v) ? v >= 0 && v <= 100 : v[0] >= 0 && v[1] <= 100);
    if (!ok) issues.push({ path: `${p}.value`, message: "RSI values are 0..=100" });
  }
  if (c.ind === "ORACLE_LIVE" && c.op !== "eq") issues.push({ path: `${p}.op`, message: "ORACLE_LIVE only supports eq 1" });
}
