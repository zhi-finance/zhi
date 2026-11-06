//! `zhi run`: the live harness loop.
//!
//! sample oracle -> build candles -> on candle close (and every poll while a position is open)
//! gather inputs -> decide -> (Synth) -> finish -> executeIntent / logGateSkip -> log everything.

use crate::chain::{self, ExchangePrecompile, GuardrailVault, EXCHANGE};
use crate::market::{self, OracleKey, SynthClient};
use alloy::network::EthereumWallet;
use alloy::primitives::Address;
use alloy::providers::{Provider, ProviderBuilder};
use alloy::signers::local::PrivateKeySigner;
use alloy::sol_types::SolEvent;
use anyhow::{bail, Context, Result};
use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use zhi_core::engine::{self, Action, Inputs, MarketSpec, Position};
use zhi_core::indicators::CandleBuilder;
use zhi_core::record::{input_digest, Record, TxOutcome, LOG_VERSION};
use zhi_core::ruletree::{self, RuleTree, VaultBounds};
use zhi_core::Fx;

pub struct RunConfig {
    pub tree_path: PathBuf,
    pub vault: Address,
    pub rpc: String,
    pub lcd: String,
    pub chronos: String,
    pub warmup_market: Option<String>,
    pub harness_key: Option<String>,
    pub synth: SynthClient,
    pub log_dir: PathBuf,
    pub poll_sec: u64,
    pub dry_run: bool,
    pub quote_decimals: u32,
    pub once: bool,
}

pub struct Logger {
    file: std::fs::File,
}

impl Logger {
    pub fn open(dir: &PathBuf, vault: &Address) -> Result<(Logger, PathBuf)> {
        std::fs::create_dir_all(dir)?;
        let path = dir.join(format!("{}.jsonl", format!("{vault:#x}").to_lowercase()));
        let file = std::fs::OpenOptions::new().create(true).append(true).open(&path)?;
        Ok((Logger { file }, path))
    }

    pub fn write(&mut self, r: &Record) -> Result<()> {
        let line = serde_json::to_string(r)?;
        writeln!(self.file, "{line}")?;
        self.file.flush()?;
        Ok(())
    }
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

pub async fn run(cfg: RunConfig) -> Result<()> {
    let tree_json = std::fs::read_to_string(&cfg.tree_path).context("read rule tree")?;

    // Signer is only needed to send transactions.
    let signer: Option<PrivateKeySigner> = match (&cfg.harness_key, cfg.dry_run) {
        (Some(k), _) => Some(k.parse().context("HARNESS_PRIVATE_KEY")?),
        (None, true) => None,
        (None, false) => bail!("HARNESS_PRIVATE_KEY required unless --dry-run"),
    };
    let wallet = signer.clone().map(EthereumWallet::from);
    let url = cfg.rpc.parse()?;
    let provider = match wallet {
        Some(w) => ProviderBuilder::new().wallet(w).connect_http(url).erased(),
        None => ProviderBuilder::new().connect_http(url).erased(),
    };
    let vault = GuardrailVault::new(cfg.vault, &provider);

    // ---- read the vault: market spec + bounds, and validate the tree against them
    let b = vault.bounds().call().await.context("vault.bounds")?;
    let vb = VaultBounds {
        max_notional: chain::fx_from_u256(b.maxNotional),
        max_leverage: Fx::from_scaled(b.maxLeverageX100 as i128, 2),
        max_daily_dd_pct: Fx::from_scaled(b.maxDailyDdBps as i128, 2),
        max_deviation_bps: Fx::from_int(b.maxDeviationBps as i64),
        cooldown_sec: b.cooldownSec as u64,
    };
    let (tree, hash): (RuleTree, String) = ruletree::load(&tree_json, Some(&vb)).map_err(|issues| {
        anyhow::anyhow!("rule tree rejected:\n{}", issues.iter().map(|i| format!("  {}: {}", i.path, i.message)).collect::<Vec<_>>().join("\n"))
    })?;
    let market_id = chain::b256(&tree.market.market_id)?;
    let m = vault.getMarket(market_id).call().await.context("vault.getMarket")?;
    if !m.allowed {
        bail!("market {} is not on the vault allowlist", tree.market.market_id);
    }
    if !vault.ruleTree(chain::b256(&hash)?).call().await? {
        tracing::warn!(%hash, "rule tree hash is NOT registered on the vault: every intent will skip BAD_RULETREE");
    }
    if let Some(s) = &signer {
        let h = vault.harness().call().await?;
        if h != s.address() {
            bail!("vault harness is {h}, this key is {}", s.address());
        }
    }
    let spec = MarketSpec {
        market_id: tree.market.market_id.to_lowercase(),
        price_tick: chain::fx_from_u256(m.minPriceTick),
        qty_tick: chain::fx_from_u256(m.minQtyTick),
        margin_tick: Fx::from_scaled(1, cfg.quote_decimals),
        max_oracle_age_sec: b.maxOracleAgeSec as u64,
    };
    let okey = OracleKey { oracle_type: m.oracleType, base: m.oracleBase.clone(), quote: m.oracleQuote.clone() };
    let subaccount = vault.subaccountId().call().await?;

    let (mut log, log_path) = Logger::open(&cfg.log_dir, &cfg.vault)?;
    tracing::info!(%hash, log = %log_path.display(), "harness starting");
    let tf = tree.timeframe.secs();
    let max_candles = 1000;
    log.write(&Record::Header {
        v: LOG_VERSION,
        vault: format!("{:#x}", cfg.vault),
        rule_tree_hash: hash.clone(),
        rule_tree: serde_json::from_str(&tree_json)?,
        spec: spec.clone(),
        timeframe_sec: tf,
        max_candles,
        harness: concat!("zhi-harness/", env!("CARGO_PKG_VERSION")).into(),
    })?;

    // ---- warm-up
    let mut builder = CandleBuilder::new(tf, max_candles);
    let wm = cfg.warmup_market.clone().or_else(|| market::default_warmup_market(&spec.market_id).map(String::from));
    if let Some(wm) = wm {
        match market::chronos_candles(&cfg.chronos, &wm, tf / 60, 400, now()).await {
            Ok(cs) if !cs.is_empty() => {
                tracing::info!(n = cs.len(), market = %wm, "warm-up candles");
                builder.seed(&cs);
                log.write(&Record::Warmup { source: format!("{}#{}", cfg.chronos, wm), candles: cs })?;
            }
            Ok(_) => tracing::warn!("warm-up source returned no candles; indicators warm up live"),
            Err(e) => tracing::warn!(error = %e, "warm-up failed; indicators warm up live"),
        }
    }

    let exch = ExchangePrecompile::new(EXCHANGE, &provider);
    let mut ticker = tokio::time::interval(Duration::from_secs(cfg.poll_sec));
    loop {
        ticker.tick().await;
        let ts = now();
        let (px, oracle_ts) = match market::oracle_price(&provider, &okey).await {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(error = %e, "oracle read failed");
                continue;
            }
        };
        let closed = builder.on_sample(ts, px);
        for c in &closed {
            log.write(&Record::Candle { candle: *c })?;
        }

        // ---- inputs from chain
        let pos = read_position(&exch, &subaccount, &spec.market_id).await;
        let has_position = matches!(pos, Ok(Some(_)));
        if closed.is_empty() && !has_position && !cfg.once {
            continue; // entries are evaluated on candle close; exits on every poll
        }
        let (eq, eq_ok) = match vault.equity().call().await {
            Ok(r) => (chain::fx_from_u256(r.eq), r.ok),
            Err(_) => (Fx::ZERO, false),
        };
        let last_entry_at = vault.lastEntryAt().call().await.unwrap_or(0);
        let position = match pos {
            Ok(p) => p.map(|(is_long, q, e)| Position { is_long, quantity: q, entry_price: e, opened_at: last_entry_at }),
            Err(e) => {
                tracing::warn!(error = %e, "position read failed; skipping tick (fail closed)");
                continue;
            }
        };
        let (bid, ask) = market::best_bid_ask(&cfg.lcd, &spec.market_id, cfg.quote_decimals).await.unwrap_or((None, None));
        let inputs = Inputs {
            ts,
            block: provider.get_block_number().await.unwrap_or(0),
            best_bid: bid,
            best_ask: ask,
            oracle_price: px,
            oracle_ts,
            equity: if eq_ok { eq } else { Fx::ZERO },
            position,
            last_entry_at,
            nonce: vault.nextNonce().call().await?,
            vault_frozen: vault.frozen().call().await? || vault.creditReduceOnly().call().await?,
        };

        let closes = builder.closes();
        let digest = input_digest(&inputs, closes.len(), builder.closed.last());
        let pre = engine::decide(&tree, &spec, &closes, &inputs);
        let synth_raw = if engine::needs_synth(&tree, &pre) {
            let g = tree.synth_gate.as_ref().unwrap();
            cfg.synth.fetch(&g.asset, g.horizon.as_str(), None).await
        } else {
            None
        };
        let ev = engine::finish(&tree, &hash, &spec, &inputs, pre, synth_raw.as_deref());
        tracing::info!(decision = ?ev.decision, gate = ?ev.gate.as_ref().map(|g| &g.detail), px = %px, "tick");

        let tx = match (&ev.action, cfg.dry_run) {
            (Action::None, _) => None,
            (_, true) => Some(TxOutcome { tx_hash: String::new(), status: "dry_run".into(), onchain_skip: None, block: None }),
            (Action::Submit { intent, .. }, false) => Some(submit(&vault, intent).await),
            (Action::GateSkip { intent, reason, .. }, false) => Some(gate_skip(&vault, intent, reason.onchain_code()).await),
        };
        if let Some(t) = &tx {
            tracing::info!(status = %t.status, tx = %t.tx_hash, skip = ?t.onchain_skip.map(chain::skip_name), "intent");
        }
        log.write(&Record::Tick { inputs, input_digest: digest, synth_raw, evaluation: ev, tx })?;
        if cfg.once {
            return Ok(());
        }
    }
}

async fn read_position<P: Provider>(
    exch: &ExchangePrecompile::ExchangePrecompileInstance<P>,
    subaccount: &str,
    market_id: &str,
) -> Result<Option<(bool, Fx, Fx)>> {
    let ps = exch.subaccountPositions(subaccount.to_string()).call().await?;
    Ok(ps
        .into_iter()
        .find(|p| p.marketID.to_lowercase() == market_id)
        .map(|p| (p.isLong, chain::fx_from_u256(p.quantity), chain::fx_from_u256(p.entryPrice))))
}

async fn submit<P: Provider>(vault: &GuardrailVault::GuardrailVaultInstance<P>, it: &zhi_core::intent::Intent) -> TxOutcome {
    let call = vault.executeIntent(chain::to_sol_intent(it));
    outcome(call.send().await).await
}

async fn gate_skip<P: Provider>(vault: &GuardrailVault::GuardrailVaultInstance<P>, it: &zhi_core::intent::Intent, code: u8) -> TxOutcome {
    let call = vault.logGateSkip(chain::to_sol_intent(it), code);
    let mut o = outcome(call.send().await).await;
    if o.status == "skipped" {
        o.status = "gate_logged".into();
    }
    o
}

async fn outcome<N: alloy::network::Network>(
    sent: Result<alloy::providers::PendingTransactionBuilder<N>, alloy::contract::Error>,
) -> TxOutcome
where
    N::ReceiptResponse: alloy::network::ReceiptResponse,
{
    use alloy::network::ReceiptResponse;
    let pending = match sent {
        Ok(p) => p,
        Err(e) => return TxOutcome { tx_hash: String::new(), status: format!("reverted: {e}"), onchain_skip: None, block: None },
    };
    let tx_hash = format!("{:#x}", pending.tx_hash());
    let receipt = match pending.with_timeout(Some(Duration::from_secs(60))).get_receipt().await {
        Ok(r) => r,
        Err(e) => return TxOutcome { tx_hash, status: format!("unconfirmed: {e}"), onchain_skip: None, block: None },
    };
    let block = receipt.block_number();
    if !receipt.status() {
        return TxOutcome { tx_hash, status: "reverted".into(), onchain_skip: None, block };
    }
    let json = serde_json::to_value(&receipt).unwrap_or_default();
    let logs = json.pointer("/logs").and_then(|l| l.as_array()).cloned().unwrap_or_default();
    for l in logs {
        let topics: Vec<alloy::primitives::B256> = l
            .get("topics")
            .and_then(|t| t.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str()?.parse().ok()).collect())
            .unwrap_or_default();
        if topics.first() == Some(&GuardrailVault::ExecutionLogged::SIGNATURE_HASH) {
            return TxOutcome { tx_hash, status: "executed".into(), onchain_skip: None, block };
        }
        if topics.first() == Some(&GuardrailVault::TradeSkipped::SIGNATURE_HASH) {
            let data = l.get("data").and_then(|d| d.as_str()).unwrap_or("0x");
            let bytes = hex::decode(data.trim_start_matches("0x")).unwrap_or_default();
            let reason = bytes.get(31).copied();
            return TxOutcome { tx_hash, status: "skipped".into(), onchain_skip: reason, block };
        }
    }
    TxOutcome { tx_hash, status: "mined_no_event".into(), onchain_skip: None, block }
}
