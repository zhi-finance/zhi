//! The deterministic evaluator: frozen rule tree + logged inputs -> decision -> intent.
//! Zero model calls, zero floats, zero clocks: `ts` comes from the inputs.
//!
//! Two phases so the Synth call happens only when an entry is actually on the table, while
//! replay stays a pure function: `decide()` -> (if `needs_synth`) fetch raw body -> `finish()`.

use crate::fixed::Fx;
use crate::indicators::{ema, return_bps, rsi, sma, vol_bps};
use crate::intent::Intent;
use crate::ruletree::{CondValue, Indicator, Op, RuleTree, Side, SizingModel, TpType};
use crate::synth::{self, GateSkip, GateVerdict, ZERO_HASH};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MarketSpec {
    pub market_id: String,
    pub price_tick: Fx,
    pub qty_tick: Fx,
    /// quote precision for margin (USDC: 0.000001)
    pub margin_tick: Fx,
    pub max_oracle_age_sec: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    pub is_long: bool,
    pub quantity: Fx,
    pub entry_price: Fx,
    pub opened_at: u64,
}

/// Everything the decision depends on besides the candle history and the Synth body.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Inputs {
    pub ts: u64,
    pub block: u64,
    pub best_bid: Option<Fx>,
    pub best_ask: Option<Fx>,
    pub oracle_price: Fx,
    pub oracle_ts: u64,
    pub equity: Fx,
    pub position: Option<Position>,
    pub last_entry_at: u64,
    pub nonce: u64,
    pub vault_frozen: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExitReason {
    TakeProfit,
    StopLoss,
    MaxHold,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Decision {
    Hold { reason: String },
    Enter { side: Side },
    Exit { reason: ExitReason },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Action {
    None,
    /// send executeIntent
    Submit { intent: Intent, intent_hash: String },
    /// send logGateSkip so the forecast that blocked the trade is public evidence
    GateSkip { intent: Intent, intent_hash: String, reason: GateSkip },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Pre {
    pub indicators: BTreeMap<String, Option<Fx>>,
    pub conditions: Vec<Option<bool>>,
    pub decision: Decision,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Evaluation {
    pub indicators: BTreeMap<String, Option<Fx>>,
    pub conditions: Vec<Option<bool>>,
    pub decision: Decision,
    pub gate: Option<GateVerdict>,
    pub action: Action,
}

pub const INTENT_TTL_SEC: u64 = 60;

fn label(ind: Indicator, period: Option<u32>) -> String {
    match period {
        Some(p) => format!("{ind:?}({p})").to_uppercase(),
        None => format!("{ind:?}").to_uppercase(),
    }
}

fn ind_value(ind: Indicator, period: Option<u32>, closes: &[Fx], inp: &Inputs, spec: &MarketSpec) -> Option<Fx> {
    let n = period.unwrap_or(0) as usize;
    match ind {
        Indicator::Price => closes.last().copied(),
        Indicator::Ema => ema(closes, n),
        Indicator::Sma => sma(closes, n),
        Indicator::Rsi => rsi(closes, n),
        Indicator::ReturnBps => return_bps(closes, n),
        Indicator::VolBps => vol_bps(closes, n),
        Indicator::SpreadBps => match (inp.best_bid, inp.best_ask) {
            (Some(b), Some(a)) if b > 0 && a >= b => {
                let mid = (a + b).div_int(2);
                Some((a - b).div(mid).mul_int(10_000))
            }
            _ => None,
        },
        Indicator::OracleLive => {
            let live = inp.oracle_price > 0 && inp.ts >= inp.oracle_ts && inp.ts - inp.oracle_ts <= spec.max_oracle_age_sec;
            Some(if live { Fx::ONE } else { Fx::ZERO })
        }
    }
}

pub fn decide(tree: &RuleTree, spec: &MarketSpec, closes: &[Fx], inp: &Inputs) -> Pre {
    let mut indicators = BTreeMap::new();
    let mut conditions = Vec::new();
    let prev = if closes.is_empty() { closes } else { &closes[..closes.len() - 1] };

    for c in &tree.entry.all {
        let cur = ind_value(c.ind, c.period, closes, inp, spec);
        indicators.insert(label(c.ind, c.period), cur);
        let rhs_cur;
        let mut rhs_prev = None;
        let mut lhs_prev = None;
        if let Some(r) = &c.reference {
            rhs_cur = ind_value(r.ind, r.period, closes, inp, spec);
            indicators.insert(label(r.ind, r.period), rhs_cur);
            if matches!(c.op, Op::CrossesAbove | Op::CrossesBelow) {
                rhs_prev = ind_value(r.ind, r.period, prev, inp, spec);
                lhs_prev = ind_value(c.ind, c.period, prev, inp, spec);
            }
        } else {
            rhs_cur = match c.value() {
                Ok(Some(CondValue::Num(v))) => Some(v),
                _ => None,
            };
            if matches!(c.op, Op::CrossesAbove | Op::CrossesBelow) {
                rhs_prev = rhs_cur;
                lhs_prev = ind_value(c.ind, c.period, prev, inp, spec);
            }
        }
        let ok = match c.op {
            Op::Between => match (cur, c.value()) {
                (Some(x), Ok(Some(CondValue::Range(lo, hi)))) => Some(x >= lo && x <= hi),
                _ => None,
            },
            Op::Gt => cur.zip(rhs_cur).map(|(a, b)| a > b),
            Op::Gte => cur.zip(rhs_cur).map(|(a, b)| a >= b),
            Op::Lt => cur.zip(rhs_cur).map(|(a, b)| a < b),
            Op::Lte => cur.zip(rhs_cur).map(|(a, b)| a <= b),
            Op::Eq => cur.zip(rhs_cur).map(|(a, b)| a == b),
            Op::CrossesAbove => match (lhs_prev, rhs_prev, cur, rhs_cur) {
                (Some(lp), Some(rp), Some(lc), Some(rc)) => Some(lp <= rp && lc > rc),
                _ => None,
            },
            Op::CrossesBelow => match (lhs_prev, rhs_prev, cur, rhs_cur) {
                (Some(lp), Some(rp), Some(lc), Some(rc)) => Some(lp >= rp && lc < rc),
                _ => None,
            },
        };
        conditions.push(ok);
    }

    let hold = |r: &str| Decision::Hold { reason: r.to_string() };
    let decision = if let Some(p) = &inp.position {
        exit_decision(tree, p, inp).map(|reason| Decision::Exit { reason }).unwrap_or_else(|| hold("in position"))
    } else if inp.vault_frozen {
        hold("vault frozen")
    } else if inp.last_entry_at != 0 && inp.ts < inp.last_entry_at + tree.risk.cooldown_sec {
        hold("cooldown")
    } else if inp.oracle_price <= 0 || inp.ts < inp.oracle_ts || inp.ts - inp.oracle_ts > spec.max_oracle_age_sec {
        hold("oracle stale")
    } else if conditions.iter().any(|c| c.is_none()) {
        hold("insufficient data")
    } else if conditions.iter().all(|c| *c == Some(true)) {
        Decision::Enter { side: tree.entry.side }
    } else {
        hold("conditions not met")
    };
    Pre { indicators, conditions, decision }
}

fn exit_decision(tree: &RuleTree, p: &Position, inp: &Inputs) -> Option<ExitReason> {
    let px = inp.oracle_price;
    if px <= 0 {
        return None;
    }
    let hundred = Fx::from_int(100);
    let tp = tree.exit.take_profit_pct.div(hundred);
    let sl = tree.exit.stop_loss_pct.div(hundred);
    let (tp_px, sl_px) = if p.is_long {
        (p.entry_price.mul(Fx::ONE + tp), p.entry_price.mul(Fx::ONE - sl))
    } else {
        (p.entry_price.mul(Fx::ONE - tp), p.entry_price.mul(Fx::ONE + sl))
    };
    let hit_tp = if p.is_long { px >= tp_px } else { px <= tp_px };
    let hit_sl = if p.is_long { px <= sl_px } else { px >= sl_px };
    if hit_sl {
        Some(ExitReason::StopLoss)
    } else if hit_tp {
        Some(ExitReason::TakeProfit)
    } else if p.opened_at != 0 && inp.ts >= p.opened_at + tree.exit.max_hold_sec {
        Some(ExitReason::MaxHold)
    } else {
        None
    }
}

/// Whether the caller must fetch a Synth body before `finish`.
pub fn needs_synth(tree: &RuleTree, pre: &Pre) -> bool {
    matches!(pre.decision, Decision::Enter { .. }) && tree.synth_gate.is_some()
}

/// `synth_raw`: `None` = not fetched / unavailable, `Some(body)` = raw response bytes.
pub fn finish(
    tree: &RuleTree,
    rule_tree_hash: &str,
    spec: &MarketSpec,
    inp: &Inputs,
    pre: Pre,
    synth_raw: Option<&str>,
) -> Evaluation {
    let Pre { indicators, conditions, decision } = pre;
    let slip = tree.risk.max_slippage_bps.raw() / crate::fixed::SCALE; // integer bps
    let mk = |gate: Option<GateVerdict>, action: Action, decision: Decision| Evaluation {
        indicators: indicators.clone(),
        conditions: conditions.clone(),
        decision,
        gate,
        action,
    };

    match decision.clone() {
        Decision::Hold { .. } => mk(None, Action::None, decision),
        Decision::Exit { .. } => {
            let p = inp.position.as_ref().expect("exit without position");
            let is_buy = !p.is_long;
            let worst = worst_price(inp.oracle_price, slip, is_buy, spec.price_tick);
            let intent = Intent {
                rule_tree_hash: rule_tree_hash.to_string(),
                market_id: spec.market_id.clone(),
                is_buy,
                reduce_only: true,
                quantity: p.quantity,
                worst_price: worst,
                margin: Fx::ZERO,
                tp_price: Fx::ZERO,
                sl_price: Fx::ZERO,
                synth_hash: ZERO_HASH.into(),
                nonce: inp.nonce,
                deadline: inp.ts + INTENT_TTL_SEC,
            };
            let intent_hash = intent.hash();
            mk(None, Action::Submit { intent, intent_hash }, decision)
        }
        Decision::Enter { side } => {
            let is_buy = side == Side::Long;
            let p0 = inp.oracle_price;
            let worst = worst_price(p0, slip, is_buy, spec.price_tick);
            let Some((qty, margin)) = size(tree, spec, inp.equity, worst) else {
                return mk(None, Action::None, Decision::Hold { reason: "size below tick".into() });
            };
            let hundred = Fx::from_int(100);
            let tpf = tree.exit.take_profit_pct.div(hundred);
            let slf = tree.exit.stop_loss_pct.div(hundred);
            let (tp, sl) = if is_buy {
                (p0.mul(Fx::ONE + tpf).floor_to(spec.price_tick), p0.mul(Fx::ONE - slf).ceil_to(spec.price_tick))
            } else {
                (p0.mul(Fx::ONE - tpf).ceil_to(spec.price_tick), p0.mul(Fx::ONE + slf).floor_to(spec.price_tick))
            };
            let tp = if tree.exit.order_types.tp == TpType::LimitPostOnly { tp } else { Fx::ZERO };

            let gate = tree.synth_gate.as_ref().map(|g| synth::evaluate(g, synth_raw, side, p0));
            let synth_hash = gate.as_ref().map(|g| g.synth_hash.clone()).unwrap_or_else(|| ZERO_HASH.into());
            let intent = Intent {
                rule_tree_hash: rule_tree_hash.to_string(),
                market_id: spec.market_id.clone(),
                is_buy,
                reduce_only: false,
                quantity: qty,
                worst_price: worst,
                margin,
                tp_price: tp,
                sl_price: sl,
                synth_hash,
                nonce: inp.nonce,
                deadline: inp.ts + INTENT_TTL_SEC,
            };
            let intent_hash = intent.hash();
            let action = match &gate {
                Some(g) if !g.pass => Action::GateSkip { intent, intent_hash, reason: g.skip.expect("skip reason") },
                _ => Action::Submit { intent, intent_hash },
            };
            mk(gate, action, decision)
        }
    }
}

/// Oracle +/- slippage, rounded *against* the trader onto the price tick so the vault's
/// deviation check (which uses maxDeviationBps >= maxSlippageBps) still passes.
fn worst_price(p0: Fx, slip_bps: i128, is_buy: bool, tick: Fx) -> Fx {
    if is_buy {
        (p0 + p0.bps(slip_bps)).floor_to(tick)
    } else {
        (p0 - p0.bps(slip_bps)).ceil_to(tick)
    }
}

/// Returns (quantity, margin) on tick, with notional <= caps and notional / margin <= leverage.
pub fn size(tree: &RuleTree, spec: &MarketSpec, equity: Fx, worst: Fx) -> Option<(Fx, Fx)> {
    let s = &tree.sizing;
    if worst <= 0 || equity <= 0 {
        return None;
    }
    let target = match s.model {
        SizingModel::PctEquity => equity.mul(s.pct.unwrap_or(Fx::ZERO)).div(Fx::from_int(100)).mul(s.leverage),
        SizingModel::FixedUsd => s.usd.unwrap_or(Fx::ZERO),
    };
    let notional = target.min(s.max_notional_usd);
    let qty = notional.div(worst).floor_to(spec.qty_tick);
    if qty <= 0 {
        return None;
    }
    let actual = qty.mul(worst);
    let margin = actual.div_ceil(s.leverage).ceil_to(spec.margin_tick);
    if margin > equity {
        return None;
    }
    Some((qty, margin))
}
