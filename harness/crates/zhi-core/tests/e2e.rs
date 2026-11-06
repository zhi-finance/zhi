use serde_json::Value;
use zhi_core::canonical::hash_value;
use zhi_core::engine::{decide, finish, needs_synth, Action, Decision, Inputs, MarketSpec, Position};
use zhi_core::indicators::{Candle, CandleBuilder};
use zhi_core::record::{input_digest, replay, Record};
use zhi_core::ruletree::{load, validate, VaultBounds};
use zhi_core::synth::GateSkip;
use zhi_core::Fx;

const TREE: &str = include_str!("../../../../fixtures/ruletree.example.json");
const TREE_HASH: &str = include_str!("../../../../fixtures/ruletree.example.hash");

fn fx(s: &str) -> Fx {
    s.parse().unwrap()
}

fn spec() -> MarketSpec {
    MarketSpec {
        market_id: "0xfd704649cf3a516c0c145ab0111717c44640d8dbe52a462ae35cadf2f6df1515".into(),
        price_tick: fx("1"),
        qty_tick: fx("0.0001"),
        margin_tick: fx("0.000001"),
        max_oracle_age_sec: 120,
    }
}

/// Gentle uptrend with chop: EMA20 > EMA50 and RSI in the high 50s / low 60s.
fn candles(n: u64) -> Vec<Candle> {
    let mut out = Vec::new();
    let mut px = 74_000i64;
    for i in 0..n {
        px += match i % 4 {
            0 => 30,
            1 => -12,
            2 => 22,
            _ => -25,
        };
        let c = Fx::from_int(px);
        out.push(Candle { t: 1_794_000_000 + i * 300, o: c, h: c, l: c, c });
    }
    out
}

fn bullish_synth(center: i64) -> String {
    let lv = [-900, -400, -100, 30, 120, 220, 350, 650, 1100];
    let keys = ["0.005", "0.05", "0.2", "0.35", "0.5", "0.65", "0.8", "0.95", "0.995"];
    let step: Vec<String> = keys.iter().zip(lv).map(|(k, d)| format!("\"{k}\":{}", center + d)).collect();
    format!("{{\"current_price\":{center},\"forecast_future\":{{\"percentiles\":[{{{}}}]}}}}", step.join(","))
}

fn inputs(ts: u64, px: i64) -> Inputs {
    Inputs {
        ts,
        block: 1,
        best_bid: Some(Fx::from_int(px - 15)),
        best_ask: Some(Fx::from_int(px + 15)),
        oracle_price: Fx::from_int(px),
        oracle_ts: ts - 2,
        equity: Fx::from_int(10_000),
        position: None,
        last_entry_at: 0,
        nonce: 3,
        vault_frozen: false,
    }
}

#[test]
fn example_tree_validates_and_hash_is_stable() {
    let (t, h) = load(TREE, None).expect("valid");
    assert_eq!(h, TREE_HASH.trim(), "fixture hash (shared with the TypeScript compiler)");
    // reformatting the document does not change the hash
    let v: Value = serde_json::from_str(TREE).unwrap();
    let compact = serde_json::to_string(&v).unwrap();
    assert_eq!(load(&compact, None).unwrap().1, h);
    // vault bounds check
    let tight = VaultBounds {
        max_notional: fx("1000"),
        max_leverage: fx("5"),
        max_daily_dd_pct: fx("4"),
        max_deviation_bps: fx("50"),
        cooldown_sec: 60,
    };
    let issues = validate(&t, Some(&tight));
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].path, "sizing.maxNotionalUsd");
}

#[test]
fn unknown_keys_and_out_of_bounds_fail() {
    let mut v: Value = serde_json::from_str(TREE).unwrap();
    v["sizing"]["recipient"] = Value::String("0xattacker".into());
    assert!(load(&v.to_string(), None).is_err(), "unknown keys fail");

    let mut v: Value = serde_json::from_str(TREE).unwrap();
    v["sizing"]["leverage"] = serde_json::json!(50);
    let issues = load(&v.to_string(), None).unwrap_err();
    assert!(issues.iter().any(|i| i.path == "sizing.leverage"));

    let mut v: Value = serde_json::from_str(TREE).unwrap();
    v["synthGate"]["asset"] = Value::String("DOGE".into());
    assert!(load(&v.to_string(), None).unwrap_err().iter().any(|i| i.path == "synthGate.asset"));

    let mut v: Value = serde_json::from_str(TREE).unwrap();
    v["market"]["class"] = Value::String("equity".into());
    v["synthGate"] = Value::Null;
    assert!(load(&v.to_string(), None).unwrap_err().iter().any(|i| i.message.contains("ORACLE_LIVE")));
}

fn run(synth: Option<&str>, px: i64) -> (zhi_core::engine::Evaluation, Vec<Record>) {
    let (tree, hash) = load(TREE, None).unwrap();
    let mut b = CandleBuilder::new(300, 600);
    let cs = candles(120);
    b.seed(&cs);
    let ts = cs.last().unwrap().t + 300 + 5;
    let inp = inputs(ts, px);
    let closes = b.closes();
    let pre = decide(&tree, &spec(), &closes, &inp);
    assert_eq!(pre.decision, Decision::Enter { side: zhi_core::ruletree::Side::Long }, "{:?}", pre);
    assert!(needs_synth(&tree, &pre));
    let ev = finish(&tree, &hash, &spec(), &inp, pre, synth);

    let records = vec![
        Record::Header {
            v: 1,
            vault: "0xvault".into(),
            rule_tree_hash: hash.clone(),
            rule_tree: serde_json::from_str(TREE).unwrap(),
            spec: spec(),
            timeframe_sec: 300,
            max_candles: 600,
            harness: "test".into(),
        },
        Record::Warmup { source: "test".into(), candles: cs.clone() },
        Record::Tick {
            input_digest: input_digest(&inp, closes.len(), b.closed.last()),
            inputs: inp,
            synth_raw: synth.map(|s| s.to_string()),
            evaluation: ev.clone(),
            tx: None,
        },
    ];
    (ev, records)
}

#[test]
fn entry_with_synth_agreement_submits_bounded_intent() {
    let raw = bullish_synth(75_000);
    let (ev, records) = run(Some(&raw), 75_000);
    let Action::Submit { intent, intent_hash } = &ev.action else { panic!("expected submit: {:?}", ev.action) };
    // 10% of 10k equity x 3 = 3,000 -> capped at maxNotionalUsd 2,500
    // worst = 75,000 * 1.0035 = 75,262.5 -> floor to tick = 75,262; qty = 2500/75262 floored = 0.0332
    assert_eq!(intent.worst_price, fx("75262"));
    assert_eq!(intent.quantity, fx("0.0332"));
    let notional = intent.quantity.mul(intent.worst_price);
    assert!(notional <= fx("2500"));
    assert!(notional.div(intent.margin) <= fx("3"), "leverage within tree");
    assert_eq!(intent.tp_price, fx("77250"));
    assert_eq!(intent.sl_price, fx("73875"));
    assert_eq!(intent.synth_hash, ev.gate.as_ref().unwrap().synth_hash);
    assert_eq!(intent_hash, &intent.hash());
    assert_eq!(intent.nonce, 3);

    let rep = replay(&records, None, None).unwrap();
    assert_eq!(rep.ticks, 1);
    assert!(rep.mismatches.is_empty(), "{:?}", rep.mismatches);
}

#[test]
fn synth_disagreement_becomes_gate_skip_with_hash() {
    // forecast centered 1% below: P(up) small
    let raw = bullish_synth(74_000);
    let (ev, records) = run(Some(&raw), 75_000);
    match &ev.action {
        Action::GateSkip { reason, intent, .. } => {
            assert_eq!(*reason, GateSkip::SynthDirection);
            assert_ne!(intent.synth_hash, zhi_core::synth::ZERO_HASH);
        }
        a => panic!("expected gate skip, got {a:?}"),
    }
    assert!(replay(&records, None, None).unwrap().mismatches.is_empty());
}

#[test]
fn synth_outage_fails_closed() {
    let (ev, _) = run(None, 75_000);
    assert!(matches!(ev.action, Action::GateSkip { reason: GateSkip::SynthUnavailable, .. }));
}

#[test]
fn replay_detects_tampering() {
    let raw = bullish_synth(75_000);
    let (_, mut records) = run(Some(&raw), 75_000);
    if let Record::Tick { synth_raw, .. } = &mut records[2] {
        *synth_raw = Some(bullish_synth(74_000)); // swap the forecast after the fact
    }
    let rep = replay(&records, None, None).unwrap();
    assert_eq!(rep.mismatches.len(), 1);
}

#[test]
fn exits_take_priority_and_are_reduce_only() {
    let (tree, hash) = load(TREE, None).unwrap();
    let mut b = CandleBuilder::new(300, 600);
    b.seed(&candles(120));
    let mut inp = inputs(1_800_000_000, 73_800);
    inp.position = Some(Position { is_long: true, quantity: fx("0.0332"), entry_price: fx("75000"), opened_at: 1_799_990_000 });
    let pre = decide(&tree, &spec(), &b.closes(), &inp);
    assert_eq!(pre.decision, Decision::Exit { reason: zhi_core::engine::ExitReason::StopLoss });
    let ev = finish(&tree, &hash, &spec(), &inp, pre, None);
    let Action::Submit { intent, .. } = ev.action else { panic!() };
    assert!(intent.reduce_only && !intent.is_buy);
    assert_eq!(intent.margin, Fx::ZERO);
    // 73,800 * (1 - 0.0035) = 73,541.7 -> ceil to tick
    assert_eq!(intent.worst_price, fx("73542"));
}

#[test]
fn canonical_hash_of_fixture_matches_independent_python() {
    // python3 -c "import json;d=json.load(open('fixtures/ruletree.example.json'));..." (see README)
    let v: Value = serde_json::from_str(TREE).unwrap();
    assert_eq!(hash_value(&v).unwrap(), TREE_HASH.trim());
}
