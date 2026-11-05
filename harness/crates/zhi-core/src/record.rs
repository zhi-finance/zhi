//! Decision log (JSONL) and bit-for-bit replay (PRD §8, REQ-03).
//!
//! The log carries every input the evaluator saw: the frozen rule tree, market spec, warm-up
//! candles, each closed candle, and per tick the chain/oracle/book inputs plus the raw Synth
//! body. `replay` re-runs the evaluator over those records and must reproduce every logged
//! evaluation (and therefore every intent hash) exactly. Any mismatch is a release blocker.

use crate::canonical::{canonical_json, hex32, keccak256};
use crate::engine::{decide, finish, needs_synth, Evaluation, Inputs, MarketSpec};
use crate::indicators::{Candle, CandleBuilder};
use crate::ruletree::RuleTree;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const LOG_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxOutcome {
    pub tx_hash: String,
    /// executed | skipped | gate_logged | reverted | dry_run
    pub status: String,
    pub onchain_skip: Option<u8>,
    pub block: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Record {
    Header {
        v: u32,
        vault: String,
        rule_tree_hash: String,
        rule_tree: Value,
        spec: MarketSpec,
        timeframe_sec: u64,
        max_candles: usize,
        harness: String,
    },
    Warmup {
        source: String,
        candles: Vec<Candle>,
    },
    Candle {
        candle: Candle,
    },
    Tick {
        inputs: Inputs,
        input_digest: String,
        synth_raw: Option<String>,
        evaluation: Evaluation,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tx: Option<TxOutcome>,
    },
}

pub fn input_digest(inputs: &Inputs, closes_len: usize, last_close: Option<&Candle>) -> String {
    let v = serde_json::json!({ "inputs": inputs, "closesLen": closes_len, "lastCandle": last_close });
    hex32(&keccak256(canonical_json(&v).expect("canonical").as_bytes()))
}

#[derive(Debug, Default, Serialize)]
pub struct ReplayReport {
    pub ticks: usize,
    pub intents: usize,
    pub mismatches: Vec<String>,
}

/// Re-run every tick from the log. Pure: no network, no clock.
pub fn replay(records: &[Record], from_ts: Option<u64>, to_ts: Option<u64>) -> Result<ReplayReport, String> {
    let mut report = ReplayReport::default();
    let mut ctx: Option<(RuleTree, String, MarketSpec, CandleBuilder)> = None;

    for (i, r) in records.iter().enumerate() {
        match r {
            Record::Header { rule_tree, rule_tree_hash, spec, timeframe_sec, max_candles, .. } => {
                let tree: RuleTree = serde_json::from_value(rule_tree.clone()).map_err(|e| format!("rec {i}: {e}"))?;
                let h = crate::canonical::hash_value(rule_tree)?;
                if &h != rule_tree_hash {
                    report.mismatches.push(format!("rec {i}: rule tree hash {h} != logged {rule_tree_hash}"));
                }
                ctx = Some((tree, h, spec.clone(), CandleBuilder::new(*timeframe_sec, *max_candles)));
            }
            Record::Warmup { candles, .. } => {
                let (_, _, _, b) = ctx.as_mut().ok_or("warmup before header")?;
                b.seed(candles);
            }
            Record::Candle { candle } => {
                let (_, _, _, b) = ctx.as_mut().ok_or("candle before header")?;
                b.seed(std::slice::from_ref(candle));
            }
            Record::Tick { inputs, input_digest: logged_digest, synth_raw, evaluation, .. } => {
                let (tree, hash, spec, b) = ctx.as_ref().ok_or("tick before header")?;
                if from_ts.is_some_and(|f| inputs.ts < f) || to_ts.is_some_and(|t| inputs.ts > t) {
                    continue;
                }
                report.ticks += 1;
                let closes = b.closes();
                let d = input_digest(inputs, closes.len(), b.closed.last());
                if &d != logged_digest {
                    report.mismatches.push(format!("rec {i} ts {}: input digest {d} != {logged_digest}", inputs.ts));
                }
                let pre = decide(tree, spec, &closes, inputs);
                let raw = if needs_synth(tree, &pre) { synth_raw.as_deref() } else { None };
                let ev = finish(tree, hash, spec, inputs, pre, raw);
                if !matches!(ev.action, crate::engine::Action::None) {
                    report.intents += 1;
                }
                let a = canonical_json(&serde_json::to_value(&ev).unwrap())?;
                let b2 = canonical_json(&serde_json::to_value(evaluation).unwrap())?;
                if a != b2 {
                    report.mismatches.push(format!("rec {i} ts {}: evaluation differs\n  replay: {a}\n  logged: {b2}", inputs.ts));
                }
            }
        }
    }
    Ok(report)
}

pub fn parse_jsonl(s: &str) -> Result<Vec<Record>, String> {
    s.lines()
        .filter(|l| !l.trim().is_empty())
        .enumerate()
        .map(|(i, l)| serde_json::from_str(l).map_err(|e| format!("line {}: {e}", i + 1)))
        .collect()
}
