//! `zhi attest`: build an agent's epoch report from on-chain evidence, score it, hash it, and
//! (with --post) publish it through the ZhiAttestor to the ERC-8004 Reputation Registry.
//!
//! The report is reproducible by anyone: it is derived from vault events, vault counters and the
//! daily equity snapshots recorded in the state file (which are themselves on-chain reads).

use crate::chain::{self, GuardrailVault, ZhiAttestor};
use alloy::network::EthereumWallet;
use alloy::primitives::{Address, U256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::rpc::types::Filter;
use alloy::signers::local::PrivateKeySigner;
use alloy::sol_types::SolEvent;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;
use zhi_core::canonical::{canonical_json, hex32, keccak256};
use zhi_core::score::{compute, ScoreInputs};
use zhi_core::Fx;

pub struct AttestConfig {
    pub rpc: String,
    pub vault: Address,
    pub attestor: Option<Address>,
    pub from_block: u64,
    pub state_dir: PathBuf,
    pub report_dir: PathBuf,
    pub report_base_url: Option<String>,
    pub harness_log: Option<PathBuf>,
    pub post: bool,
    pub attester_key: Option<String>,
    pub pinata_jwt: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct State {
    /// epoch day -> end-of-day equity (18dp string)
    equity: BTreeMap<u64, Fx>,
    first_seen: u64,
    last_block: u64,
}

pub async fn attest(cfg: AttestConfig) -> Result<Value> {
    let signer: Option<PrivateKeySigner> = cfg.attester_key.as_ref().map(|k| k.parse()).transpose()?;
    let url = cfg.rpc.parse()?;
    let provider = match signer.clone() {
        Some(s) => ProviderBuilder::new().wallet(EthereumWallet::from(s)).connect_http(url).erased(),
        None => ProviderBuilder::new().connect_http(url).erased(),
    };
    let vault = GuardrailVault::new(cfg.vault, &provider);
    let agent_id: U256 = vault.agentId().call().await?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_secs();
    let epoch = now / 86400;

    // ---- equity snapshot (state file)
    std::fs::create_dir_all(&cfg.state_dir)?;
    let state_path = cfg.state_dir.join(format!("{:#x}.json", cfg.vault).to_lowercase());
    let mut st: State = std::fs::read_to_string(&state_path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let eq = vault.equity().call().await?;
    let equity = chain::fx_from_u256(eq.eq);
    if eq.ok {
        st.equity.insert(epoch, equity);
    }
    if st.first_seen == 0 {
        st.first_seen = now;
    }

    // ---- events
    let latest = provider.get_block_number().await?;
    let mut events = Vec::new();
    let (mut entries, mut exits_won, mut exits) = (Vec::<(bool, Fx)>::new(), 0u32, 0u32);
    let mut frozen_events = 0u32;
    let mut from = cfg.from_block.max(st.last_block.saturating_sub(0));
    if from == 0 {
        from = latest.saturating_sub(50_000);
    }
    let mut start = from;
    while start <= latest {
        let end = (start + 9_999).min(latest);
        let logs = provider.get_logs(&Filter::new().address(cfg.vault).from_block(start).to_block(end)).await?;
        for l in logs {
            let blk = l.block_number.unwrap_or(0);
            let tx = l.transaction_hash.map(|h| format!("{h:#x}")).unwrap_or_default();
            if let Ok(e) = GuardrailVault::ExecutionLogged::decode_log(&l.inner) {
                let px = chain::fx_from_u256(e.worstPrice);
                if e.reduceOnly {
                    exits += 1;
                    if let Some((long, entry)) = entries.pop() {
                        if (long && px > entry) || (!long && px < entry) {
                            exits_won += 1;
                        }
                    }
                } else {
                    entries.push((e.isBuy, px));
                }
                events.push(json!({"type":"ExecutionLogged","block":blk,"tx":tx,"nonce":e.nonce,"isBuy":e.isBuy,"reduceOnly":e.reduceOnly,
                    "quantity":chain::fx_from_u256(e.quantity),"worstPrice":px,"notional":chain::fx_from_u256(e.notional),
                    "synthHash":format!("{:#x}",e.synthHash),"intentHash":format!("{:#x}",e.intentHash)}));
            } else if let Ok(e) = GuardrailVault::TradeSkipped::decode_log(&l.inner) {
                events.push(json!({"type":"TradeSkipped","block":blk,"tx":tx,"nonce":e.nonce,"reason":chain::skip_name(e.reason),
                    "synthHash":format!("{:#x}",e.synthHash),"intentHash":format!("{:#x}",e.intentHash)}));
            } else if let Ok(e) = GuardrailVault::Frozen::decode_log(&l.inner) {
                frozen_events += 1;
                events.push(json!({"type":"Frozen","block":blk,"tx":tx,"equity":chain::fx_from_u256(e.equity),
                    "epochStartEquity":chain::fx_from_u256(e.epochStartEquity)}));
            }
        }
        start = end + 1;
    }
    st.last_block = latest;
    std::fs::write(&state_path, serde_json::to_string_pretty(&st)?)?;

    // ---- metrics
    let intents = vault.intentsSubmitted().call().await?;
    let inv_skips = vault.adherenceSkips().call().await?;
    let start_eq = chain::fx_from_u256(vault.epochStartEquity().call().await?);
    let daily: Vec<Fx> = st.equity.values().copied().collect();
    let prev = st.equity.range(..epoch).next_back().map(|(_, v)| *v);
    let pnl_bps = match prev {
        Some(p) if p > 0 => (equity - p).div(p).mul_int(10_000),
        _ => Fx::ZERO,
    };
    let dd_bps = if start_eq > 0 && equity < start_eq { (start_eq - equity).div(start_eq).mul_int(10_000) } else { Fx::ZERO };
    let days_live = ((now - st.first_seen) / 86400 + 1) as u32;
    let inputs = ScoreInputs {
        daily_equity: daily,
        days_live,
        closed_trades: exits,
        winning_trades: exits_won,
        intents_submitted: intents,
        invariant_skips: inv_skips,
        repayment_rate: None,
    };
    let breakdown = compute(&inputs);
    let log_root = match &cfg.harness_log {
        Some(p) => std::fs::read(p).ok().map(|b| hex32(&keccak256(&b))),
        None => None,
    };

    let report = json!({
        "schema": "zhi.epoch-report/1.0",
        "agentId": agent_id.to_string(),
        "vault": format!("{:#x}", cfg.vault),
        "epoch": epoch,
        "blocks": {"from": from, "to": latest},
        "metrics": {"pnlBps": pnl_bps, "maxDdBps": dd_bps, "adherence": breakdown.adherence, "equity": equity,
                     "intentsSubmitted": intents, "invariantSkips": inv_skips, "closedTrades": exits, "wins": exits_won,
                     "frozenEvents": frozen_events, "daysLive": days_live},
        "score": breakdown,
        "scoreInputs": inputs,
        "harnessLogRoot": log_root,
        "events": events,
    });
    let canon = canonical_json(&report).map_err(anyhow::Error::msg)?;
    let report_hash = hex32(&keccak256(canon.as_bytes()));
    std::fs::create_dir_all(&cfg.report_dir)?;
    let fname = format!("{}-{epoch}.json", format!("{:#x}", cfg.vault).to_lowercase());
    std::fs::write(cfg.report_dir.join(&fname), &canon)?;

    let uri = if let Some(jwt) = &cfg.pinata_jwt {
        pin_to_ipfs(jwt, &canon, &fname).await.context("pin report to IPFS")?
    } else if let Some(base) = &cfg.report_base_url {
        format!("{}/{fname}", base.trim_end_matches('/'))
    } else {
        format!("file://{}", cfg.report_dir.join(&fname).display())
    };

    let mut tx_hash = None;
    if cfg.post {
        let att = cfg.attestor.context("--attestor required with --post")?;
        let a = ZhiAttestor::new(att, &provider);
        let to_i128 = |f: Fx| f.raw() / zhi_core::fixed::SCALE;
        let r = ZhiAttestor::EpochReport {
            pnlBps: to_i128(pnl_bps),
            maxDdBps: to_i128(dd_bps) as u128,
            adherenceX1e4: to_i128(breakdown.adherence.mul_int(10_000)) as u128,
            score: breakdown.score,
            daysLive: days_live,
            closedTrades: exits,
            reportHash: report_hash.parse()?,
            postedAt: 0,
        };
        let pending = a.postEpoch(agent_id, epoch, r, uri.clone()).send().await?;
        let receipt = pending.get_receipt().await?;
        tx_hash = Some(format!("{:#x}", receipt.transaction_hash));
    }

    Ok(json!({"agentId": agent_id.to_string(), "epoch": epoch, "score": breakdown.score, "reportHash": report_hash,
              "reportURI": uri, "posted": tx_hash, "events": report["events"].as_array().map(|a| a.len())}))
}

async fn pin_to_ipfs(jwt: &str, body: &str, name: &str) -> Result<String> {
    let v: Value = reqwest::Client::new()
        .post("https://api.pinata.cloud/pinning/pinJSONToIPFS")
        .bearer_auth(jwt)
        .json(&json!({"pinataContent": serde_json::from_str::<Value>(body)?, "pinataMetadata": {"name": name}}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(format!("ipfs://{}", v["IpfsHash"].as_str().context("IpfsHash")?))
}
