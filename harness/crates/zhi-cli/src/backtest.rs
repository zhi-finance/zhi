//! `zhi backtest`: replay a rule tree over Injective candle history, with and without the Synth
//! gate (REQ-12). The gate's value is shown, not asserted: same tree, same candles, two runs.
//! Historical forecasts come from Synth's `start_time` parameter (needs SYNTH_API_KEY).

use crate::market::{self, SynthClient};
use anyhow::{bail, Result};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use zhi_core::engine::{self, Action, Inputs, MarketSpec, Position};
use zhi_core::indicators::{Candle, CandleBuilder};
use zhi_core::ruletree::RuleTree;
use zhi_core::Fx;

pub struct BacktestConfig {
    pub chronos: String,
    pub market: String,
    pub days: u64,
    pub start_equity: Fx,
    pub fee_bps: i128,
    pub spread_bps: i128,
    pub warmup: usize,
}

#[derive(Debug, Default, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunStats {
    pub label: String,
    pub trades: u32,
    pub wins: u32,
    pub hit_rate_pct: Fx,
    pub return_pct: Fx,
    pub max_drawdown_pct: Fx,
    pub final_equity: Fx,
    pub skips: BTreeMap<String, u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestReport {
    pub market: String,
    pub candles: usize,
    pub from: u64,
    pub to: u64,
    pub without_gate: RunStats,
    pub with_gate: Option<RunStats>,
    pub note: String,
}

pub async fn fetch_history(cfg: &BacktestConfig, tf: u64) -> Result<Vec<Candle>> {
    let need = (cfg.days * 86400 / tf) as usize + cfg.warmup;
    let mut to = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_secs();
    let mut all: Vec<Candle> = Vec::new();
    for _ in 0..40 {
        let batch = market::chronos_candles(&cfg.chronos, &cfg.market, tf / 60, 1000, to).await?;
        if batch.is_empty() {
            break;
        }
        let first = batch[0].t;
        all.splice(0..0, batch);
        if all.len() >= need || first <= tf {
            break;
        }
        to = first;
    }
    all.sort_by_key(|c| c.t);
    all.dedup_by_key(|c| c.t);
    if all.len() < cfg.warmup + 10 {
        bail!("not enough history ({} candles)", all.len());
    }
    Ok(all)
}

pub async fn run(tree: &RuleTree, hash: &str, spec: &MarketSpec, cfg: &BacktestConfig, synth: &SynthClient) -> Result<BacktestReport> {
    let tf = tree.timeframe.secs();
    let history = fetch_history(cfg, tf).await?;
    let mut no_gate_tree = tree.clone();
    no_gate_tree.synth_gate = None;
    let without = simulate(&no_gate_tree, hash, spec, cfg, &history, None).await;
    let with_gate = if tree.synth_gate.is_some() && (synth.key.is_some() || synth.file.is_some()) {
        let mut s = simulate(tree, hash, spec, cfg, &history, Some(synth)).await;
        s.label = "with Synth gate".into();
        Some(s)
    } else {
        None
    };
    Ok(BacktestReport {
        market: cfg.market.clone(),
        candles: history.len(),
        from: history.first().map(|c| c.t).unwrap_or(0),
        to: history.last().map(|c| c.t).unwrap_or(0),
        without_gate: RunStats { label: "without gate".into(), ..without },
        with_gate,
        note: if tree.synth_gate.is_some() && synth.key.is_none() && synth.file.is_none() {
            "set SYNTH_API_KEY to run the gated variant against historical Synth forecasts".into()
        } else {
            "fills at candle close; taker fee per side; exits checked on candle close".into()
        },
    })
}

async fn simulate(
    tree: &RuleTree,
    hash: &str,
    spec: &MarketSpec,
    cfg: &BacktestConfig,
    history: &[Candle],
    synth: Option<&SynthClient>,
) -> RunStats {
    let tf = tree.timeframe.secs();
    let mut b = CandleBuilder::new(tf, 1000);
    b.seed(&history[..cfg.warmup]);
    let mut cash = cfg.start_equity;
    let mut pos: Option<Position> = None;
    let mut margin_locked = Fx::ZERO;
    let mut last_entry = 0u64;
    let mut peak = cfg.start_equity;
    let mut mdd = Fx::ZERO;
    let mut stats = RunStats::default();
    let mut synth_cache: HashMap<u64, Option<String>> = HashMap::new();
    let fee = |notional: Fx| notional.bps(cfg.fee_bps);

    for c in &history[cfg.warmup..] {
        b.seed(std::slice::from_ref(c));
        let ts = c.t + tf;
        let px = c.c;
        let unreal = pos.as_ref().map(|p| {
            let d = if p.is_long { px - p.entry_price } else { p.entry_price - px };
            d.mul(p.quantity)
        });
        let equity = cash + margin_locked + unreal.unwrap_or(Fx::ZERO);
        peak = peak.max(equity);
        if peak > 0 {
            mdd = mdd.max((peak - equity).div(peak));
        }
        let half = px.bps(cfg.spread_bps).div_int(2);
        let inputs = Inputs {
            ts,
            block: 0,
            best_bid: Some(px - half),
            best_ask: Some(px + half),
            oracle_price: px,
            oracle_ts: ts,
            equity,
            position: pos.clone(),
            last_entry_at: last_entry,
            nonce: 0,
            vault_frozen: false,
        };
        let pre = engine::decide(tree, spec, &b.closes(), &inputs);
        let raw = if engine::needs_synth(tree, &pre) {
            let g = tree.synth_gate.as_ref().unwrap();
            let hour = ts - ts % 3600;
            if !synth_cache.contains_key(&hour) {
                let iso = iso8601(ts);
                let body = match synth {
                    Some(s) => s.fetch(&g.asset, g.horizon.as_str(), Some(&iso)).await,
                    None => None,
                };
                synth_cache.insert(hour, body);
            }
            synth_cache.get(&hour).cloned().flatten()
        } else {
            None
        };
        let ev = engine::finish(tree, hash, spec, &inputs, pre, raw.as_deref());
        match ev.action {
            Action::Submit { intent, .. } if intent.reduce_only => {
                if let Some(p) = pos.take() {
                    let d = if p.is_long { px - p.entry_price } else { p.entry_price - px };
                    let pnl = d.mul(p.quantity) - fee(px.mul(p.quantity));
                    cash = cash + margin_locked + pnl;
                    margin_locked = Fx::ZERO;
                    stats.trades += 1;
                    if pnl > 0 {
                        stats.wins += 1;
                    }
                }
            }
            Action::Submit { intent, .. } => {
                let notional = px.mul(intent.quantity);
                cash = cash - intent.margin - fee(notional);
                margin_locked = intent.margin;
                last_entry = ts;
                pos = Some(Position { is_long: intent.is_buy, quantity: intent.quantity, entry_price: px, opened_at: ts });
            }
            Action::GateSkip { reason, .. } => {
                *stats.skips.entry(format!("{reason:?}")).or_default() += 1;
            }
            Action::None => {}
        }
    }
    let final_eq = cash + margin_locked
        + pos
            .as_ref()
            .map(|p| {
                let px = history.last().unwrap().c;
                (if p.is_long { px - p.entry_price } else { p.entry_price - px }).mul(p.quantity)
            })
            .unwrap_or(Fx::ZERO);
    stats.final_equity = final_eq;
    stats.return_pct = (final_eq - cfg.start_equity).div(cfg.start_equity).mul_int(100);
    stats.max_drawdown_pct = mdd.mul_int(100);
    stats.hit_rate_pct = if stats.trades == 0 {
        Fx::ZERO
    } else {
        Fx::from_int(stats.wins as i64).div(Fx::from_int(stats.trades as i64)).mul_int(100)
    };
    stats
}

/// Unix seconds -> "YYYY-MM-DDTHH:MM:SSZ" (civil-from-days, no chrono dependency).
pub fn iso8601(ts: u64) -> String {
    let days = (ts / 86400) as i64;
    let secs = ts % 86400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", secs / 3600, (secs % 3600) / 60, secs % 60)
}

#[cfg(test)]
mod tests {
    #[test]
    fn iso() {
        assert_eq!(super::iso8601(0), "1970-01-01T00:00:00Z");
        assert_eq!(super::iso8601(1_794_305_682), "2026-11-10T10:14:42Z");
    }
}
