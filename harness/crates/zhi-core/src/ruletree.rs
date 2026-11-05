//! Rule tree DSL v1 (`zhi.ruletree/1.0`, PRD §6).
//!
//! A rule tree is a closed, typed program: enumerated indicators, bounded numbers, no free text
//! that reaches execution. Unknown keys fail (`deny_unknown_fields`). The validator here runs in
//! the harness on load; the web compiler runs the same rules (`web/lib/ruletree/validate.ts`).

use crate::canonical::hash_value;
use crate::fixed::Fx;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const SCHEMA_ID: &str = "zhi.ruletree/1.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuleTree {
    pub schema: String,
    pub agent: Agent,
    pub source: Source,
    pub market: Market,
    pub timeframe: Timeframe,
    pub entry: Entry,
    #[serde(rename = "synthGate")]
    pub synth_gate: Option<SynthGate>,
    pub sizing: Sizing,
    pub exit: Exit,
    pub risk: Risk,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Agent {
    pub registry: String,
    #[serde(rename = "agentId")]
    pub agent_id: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    #[serde(rename = "type")]
    pub kind: SourceType,
    #[serde(rename = "inputHash")]
    pub input_hash: String,
    #[serde(rename = "compiledAt")]
    pub compiled_at: String,
    pub compiler: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceType {
    NaturalLanguage,
    Url,
    Memo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Market {
    pub ticker: String,
    #[serde(rename = "marketId")]
    pub market_id: String,
    #[serde(rename = "type")]
    pub kind: MarketType,
    /// crypto | commodity | equity. Equity and commodity iAssets get the oracle-liveness rule.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class: Option<AssetClass>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MarketType {
    Derivative,
    Binary,
    Spot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssetClass {
    Crypto,
    Commodity,
    Equity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Timeframe {
    #[serde(rename = "1m")]
    M1,
    #[serde(rename = "5m")]
    M5,
    #[serde(rename = "15m")]
    M15,
    #[serde(rename = "1h")]
    H1,
    #[serde(rename = "4h")]
    H4,
}

impl Timeframe {
    pub fn secs(self) -> u64 {
        match self {
            Timeframe::M1 => 60,
            Timeframe::M5 => 300,
            Timeframe::M15 => 900,
            Timeframe::H1 => 3600,
            Timeframe::H4 => 14400,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub side: Side,
    pub all: Vec<Condition>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    Long,
    Short,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Indicator {
    Price,
    Ema,
    Sma,
    Rsi,
    SpreadBps,
    ReturnBps,
    VolBps,
    OracleLive,
}

impl Indicator {
    pub fn needs_period(self) -> bool {
        matches!(self, Indicator::Ema | Indicator::Sma | Indicator::Rsi | Indicator::ReturnBps | Indicator::VolBps)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Op {
    Gt,
    Gte,
    Lt,
    Lte,
    Eq,
    Between,
    CrossesAbove,
    CrossesBelow,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Condition {
    pub ind: Indicator,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub period: Option<u32>,
    pub op: Op,
    /// number, or [lo, hi] for `between`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
    #[serde(rename = "ref", default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<IndRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct IndRef {
    pub ind: Indicator,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub period: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CondValue {
    Num(Fx),
    Range(Fx, Fx),
}

impl Condition {
    pub fn value(&self) -> Result<Option<CondValue>, String> {
        let fxv = |v: &Value| -> Result<Fx, String> {
            match v {
                Value::Number(n) => n.to_string().parse().map_err(|e| format!("{e}")),
                _ => Err("expected number".into()),
            }
        };
        match &self.value {
            None => Ok(None),
            Some(Value::Array(a)) if a.len() == 2 => Ok(Some(CondValue::Range(fxv(&a[0])?, fxv(&a[1])?))),
            Some(v @ Value::Number(_)) => Ok(Some(CondValue::Num(fxv(v)?))),
            Some(_) => Err("value must be a number or [lo, hi]".into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SynthGate {
    pub asset: String,
    pub horizon: Horizon,
    #[serde(rename = "minDirectionProb")]
    pub min_direction_prob: Fx,
    #[serde(rename = "maxBand90Bps")]
    pub max_band90_bps: Fx,
    #[serde(rename = "onMissing")]
    pub on_missing: OnMissing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Horizon {
    #[serde(rename = "1h")]
    H1,
    #[serde(rename = "24h")]
    H24,
}

impl Horizon {
    pub fn as_str(self) -> &'static str {
        match self {
            Horizon::H1 => "1h",
            Horizon::H24 => "24h",
        }
    }
}

/// Fail closed is the only option (PRD principle 3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OnMissing {
    Skip,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sizing {
    pub model: SizingModel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pct: Option<Fx>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usd: Option<Fx>,
    #[serde(rename = "maxNotionalUsd")]
    pub max_notional_usd: Fx,
    pub leverage: Fx,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SizingModel {
    PctEquity,
    FixedUsd,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Exit {
    #[serde(rename = "takeProfitPct")]
    pub take_profit_pct: Fx,
    #[serde(rename = "stopLossPct")]
    pub stop_loss_pct: Fx,
    #[serde(rename = "maxHoldSec")]
    pub max_hold_sec: u64,
    #[serde(rename = "orderTypes")]
    pub order_types: OrderTypes,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OrderTypes {
    pub tp: TpType,
    pub sl: SlType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TpType {
    LimitPostOnly,
    Market,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlType {
    MarketWithWorstPrice,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Risk {
    #[serde(rename = "maxDailyDrawdownPct")]
    pub max_daily_drawdown_pct: Fx,
    #[serde(rename = "maxSlippageBps")]
    pub max_slippage_bps: Fx,
    #[serde(rename = "cooldownSec")]
    pub cooldown_sec: u64,
}

// ------------------------------------------------------------------ bounds & validation

/// Hard schema bounds (operator presets may be tighter). Shared with the web validator.
pub struct SchemaBounds;
impl SchemaBounds {
    pub const PERIOD: (u32, u32) = (2, 500);
    pub const LEVERAGE: (i64, i64) = (1, 20);
    pub const PCT: (&'static str, &'static str) = ("0.1", "100");
    pub const TP_PCT: (&'static str, &'static str) = ("0.1", "50");
    pub const SL_PCT: (&'static str, &'static str) = ("0.1", "50");
    pub const HOLD_SEC: (u64, u64) = (60, 30 * 86400);
    pub const DD_PCT: (&'static str, &'static str) = ("0.5", "50");
    pub const SLIP_BPS: (i64, i64) = (1, 1000);
    pub const COOLDOWN: (u64, u64) = (0, 86400);
    pub const MIN_DIR_PROB: (&'static str, &'static str) = ("0.5", "0.99");
    pub const BAND_BPS: (i64, i64) = (10, 5000);
    pub const MAX_CONDITIONS: usize = 12;
}

/// On-chain vault bounds the tree must fit inside ("a tree that could never pass is rejected").
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VaultBounds {
    pub max_notional: Fx,
    pub max_leverage: Fx,
    pub max_daily_dd_pct: Fx,
    pub max_deviation_bps: Fx,
    pub cooldown_sec: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Issue {
    pub path: String,
    pub message: String,
}

/// Synth SN50 coverage (PRD §9, Synth swagger 2026-11): asset -> horizons.
pub fn synth_horizons(asset: &str) -> &'static [Horizon] {
    match asset {
        "BTC" | "ETH" | "SOL" | "XRP" | "HYPE" | "XAU" => &[Horizon::H1, Horizon::H24],
        "SP500" | "NVDA" | "GOOGL" | "TSLA" | "AAPL" | "SPCX" | "WTIOIL" => &[Horizon::H24],
        _ => &[],
    }
}

fn fx(s: &str) -> Fx {
    s.parse().unwrap()
}

fn decimals(v: Fx) -> u32 {
    let s = v.to_string();
    s.split('.').nth(1).map(|f| f.len() as u32).unwrap_or(0)
}

pub fn validate(t: &RuleTree, vault: Option<&VaultBounds>) -> Vec<Issue> {
    let mut out = Vec::new();
    let mut err = |path: &str, msg: String| out.push(Issue { path: path.into(), message: msg });
    let in_range = |v: Fx, lo: Fx, hi: Fx| v >= lo && v <= hi;

    if t.schema != SCHEMA_ID {
        err("schema", format!("must be {SCHEMA_ID}"));
    }
    if !is_hex(&t.market.market_id, 32) {
        err("market.marketId", "must be a 0x-prefixed 32-byte hex id".into());
    }
    if !is_hex(&t.source.input_hash, 32) {
        err("source.inputHash", "must be a 0x-prefixed keccak256".into());
    }
    if t.entry.all.is_empty() || t.entry.all.len() > SchemaBounds::MAX_CONDITIONS {
        err("entry.all", format!("1..={} conditions", SchemaBounds::MAX_CONDITIONS));
    }
    for (i, c) in t.entry.all.iter().enumerate() {
        let p = format!("entry.all[{i}]");
        validate_condition(c, &p, &mut err);
    }

    // iAsset liveness rule: equity/commodity markets must carry ORACLE_LIVE == 1
    if matches!(t.market.class, Some(AssetClass::Equity) | Some(AssetClass::Commodity)) {
        let has = t.entry.all.iter().any(|c| c.ind == Indicator::OracleLive && c.op == Op::Eq);
        if !has {
            err("entry.all", "iAsset markets require {\"ind\":\"ORACLE_LIVE\",\"op\":\"eq\",\"value\":1}".into());
        }
    }

    if let Some(g) = &t.synth_gate {
        let hs = synth_horizons(&g.asset);
        if hs.is_empty() {
            err("synthGate.asset", format!("{} is not covered by Synth; set synthGate to null", g.asset));
        } else if !hs.contains(&g.horizon) {
            err("synthGate.horizon", format!("{} only has {:?}", g.asset, hs));
        }
        let (lo, hi) = SchemaBounds::MIN_DIR_PROB;
        if !in_range(g.min_direction_prob, fx(lo), fx(hi)) {
            err("synthGate.minDirectionProb", format!("{lo}..={hi}"));
        }
        let (lo, hi) = SchemaBounds::BAND_BPS;
        if !in_range(g.max_band90_bps, Fx::from_int(lo), Fx::from_int(hi)) {
            err("synthGate.maxBand90Bps", format!("{lo}..={hi}"));
        }
    }

    let s = &t.sizing;
    let (lo, hi) = SchemaBounds::LEVERAGE;
    if !in_range(s.leverage, Fx::from_int(lo), Fx::from_int(hi)) || decimals(s.leverage) > 2 {
        err("sizing.leverage", format!("{lo}..={hi}, max 2 decimals"));
    }
    match s.model {
        SizingModel::PctEquity => match s.pct {
            Some(p) if in_range(p, fx(SchemaBounds::PCT.0), fx(SchemaBounds::PCT.1)) => {}
            _ => err("sizing.pct", format!("required for pct_equity, {}..={}", SchemaBounds::PCT.0, SchemaBounds::PCT.1)),
        },
        SizingModel::FixedUsd => match s.usd {
            Some(u) if u > 0 => {}
            _ => err("sizing.usd", "required for fixed_usd, > 0".into()),
        },
    }
    if s.max_notional_usd <= 0 {
        err("sizing.maxNotionalUsd", "> 0".into());
    }
    if t.market.kind == MarketType::Binary && s.leverage != 1 {
        err("sizing.leverage", "binary options are fully collateralized: leverage must be 1".into());
    }

    let e = &t.exit;
    if !in_range(e.take_profit_pct, fx(SchemaBounds::TP_PCT.0), fx(SchemaBounds::TP_PCT.1)) {
        err("exit.takeProfitPct", format!("{}..={}", SchemaBounds::TP_PCT.0, SchemaBounds::TP_PCT.1));
    }
    if !in_range(e.stop_loss_pct, fx(SchemaBounds::SL_PCT.0), fx(SchemaBounds::SL_PCT.1)) {
        err("exit.stopLossPct", format!("{}..={}", SchemaBounds::SL_PCT.0, SchemaBounds::SL_PCT.1));
    }
    if e.max_hold_sec < SchemaBounds::HOLD_SEC.0 || e.max_hold_sec > SchemaBounds::HOLD_SEC.1 {
        err("exit.maxHoldSec", format!("{:?}", SchemaBounds::HOLD_SEC));
    }

    let r = &t.risk;
    if !in_range(r.max_daily_drawdown_pct, fx(SchemaBounds::DD_PCT.0), fx(SchemaBounds::DD_PCT.1)) {
        err("risk.maxDailyDrawdownPct", format!("{}..={}", SchemaBounds::DD_PCT.0, SchemaBounds::DD_PCT.1));
    }
    let (lo, hi) = SchemaBounds::SLIP_BPS;
    if !in_range(r.max_slippage_bps, Fx::from_int(lo), Fx::from_int(hi)) {
        err("risk.maxSlippageBps", format!("{lo}..={hi}"));
    }
    if r.cooldown_sec > SchemaBounds::COOLDOWN.1 {
        err("risk.cooldownSec", format!("{:?}", SchemaBounds::COOLDOWN));
    }

    if let Some(v) = vault {
        if s.max_notional_usd > v.max_notional {
            err("sizing.maxNotionalUsd", format!("exceeds vault maxNotional {}", v.max_notional));
        }
        if s.leverage > v.max_leverage {
            err("sizing.leverage", format!("exceeds vault max leverage {}", v.max_leverage));
        }
        if r.max_daily_drawdown_pct > v.max_daily_dd_pct {
            err("risk.maxDailyDrawdownPct", format!("exceeds vault freeze level {}%", v.max_daily_dd_pct));
        }
        if r.max_slippage_bps > v.max_deviation_bps {
            err("risk.maxSlippageBps", format!("exceeds vault maxDeviationBps {}", v.max_deviation_bps));
        }
        if r.cooldown_sec < v.cooldown_sec {
            err("risk.cooldownSec", format!("below vault cooldown {}s", v.cooldown_sec));
        }
    }
    out
}

fn validate_condition(c: &Condition, p: &str, err: &mut impl FnMut(&str, String)) {
    let (lo, hi) = SchemaBounds::PERIOD;
    let check_period = |ind: Indicator, period: Option<u32>, path: &str, err: &mut dyn FnMut(&str, String)| {
        match (ind.needs_period(), period) {
            (true, Some(n)) if n >= lo && n <= hi => {}
            (true, _) => err(path, format!("{ind:?} needs period {lo}..={hi}")),
            (false, Some(_)) => err(path, format!("{ind:?} takes no period")),
            (false, None) => {}
        }
    };
    check_period(c.ind, c.period, &format!("{p}.period"), err);
    let val = match c.value() {
        Ok(v) => v,
        Err(e) => {
            err(&format!("{p}.value"), e);
            return;
        }
    };
    match c.op {
        Op::Between => match val {
            Some(CondValue::Range(a, b)) if a <= b && c.reference.is_none() => {}
            _ => err(&format!("{p}.value"), "between needs value [lo, hi] with lo <= hi and no ref".into()),
        },
        Op::Eq => {
            if c.ind != Indicator::OracleLive || val != Some(CondValue::Num(Fx::ONE)) {
                err(&format!("{p}.op"), "eq is only allowed as ORACLE_LIVE eq 1".into());
            }
        }
        _ => match (&val, &c.reference) {
            (Some(CondValue::Num(_)), None) => {}
            (None, Some(r)) => check_period(r.ind, r.period, &format!("{p}.ref.period"), err),
            _ => err(p, "needs exactly one of value (number) or ref".into()),
        },
    }
    if c.ind == Indicator::Rsi {
        let ok = match val {
            Some(CondValue::Num(v)) => v >= 0 && v <= 100,
            Some(CondValue::Range(a, b)) => a >= 0 && b <= 100,
            None => true,
        };
        if !ok {
            err(&format!("{p}.value"), "RSI values are 0..=100".into());
        }
    }
    if c.ind == Indicator::OracleLive && c.op != Op::Eq {
        err(&format!("{p}.op"), "ORACLE_LIVE only supports eq 1".into());
    }
}

fn is_hex(s: &str, bytes: usize) -> bool {
    s.len() == 2 + bytes * 2 && s.starts_with("0x") && s[2..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Parse, validate and hash a rule tree document. The hash covers the canonical JSON of the
/// document exactly as signed.
pub fn load(json: &str, vault: Option<&VaultBounds>) -> Result<(RuleTree, String), Vec<Issue>> {
    let v: Value = serde_json::from_str(json).map_err(|e| vec![Issue { path: "$".into(), message: e.to_string() }])?;
    let t: RuleTree =
        serde_json::from_value(v.clone()).map_err(|e| vec![Issue { path: "$".into(), message: e.to_string() }])?;
    let issues = validate(&t, vault);
    if !issues.is_empty() {
        return Err(issues);
    }
    let h = hash_value(&v).map_err(|e| vec![Issue { path: "$".into(), message: e }])?;
    Ok((t, h))
}
