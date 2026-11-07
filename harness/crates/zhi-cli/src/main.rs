//! `zhi` — the Zhi harness CLI.
//!
//!   zhi hash <tree.json>                       canonical keccak256 the operator signs
//!   zhi validate <tree.json>                   schema + bounds validation
//!   zhi run --tree t.json --vault 0x..         live harness (Injective EVM)
//!   zhi replay <log.jsonl> [--from] [--to]     bit-for-bit replay of a decision log
//!   zhi backtest --tree t.json --days 30       with / without the Synth gate
//!   zhi attest --vault 0x.. [--post]           epoch report + Zhi Score -> ERC-8004
//!   zhi status --vault 0x..                    vault state at a glance
//!   zhi poke --vault 0x..                      permissionless circuit breaker

mod attest;
mod backtest;
mod chain;
mod market;
mod runner;

use alloy::network::EthereumWallet;
use alloy::primitives::Address;
use alloy::providers::{Provider, ProviderBuilder};
use alloy::signers::local::PrivateKeySigner;
use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::time::Duration;
use zhi_core::engine::MarketSpec;
use zhi_core::Fx;

const TESTNET_RPC: &str = "https://k8s.testnet.json-rpc.injective.network";
const TESTNET_LCD: &str = "https://testnet.sentry.lcd.injective.network";
const MAINNET_CHRONOS: &str = "https://sentry.exchange.grpc-web.injective.network";
const SYNTH_API: &str = "https://api.synthdata.co";

#[derive(Parser)]
#[command(name = "zhi", version, about = "Zhi harness: the model plans once, the subnet verifies, the chain enforces")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Print the canonical keccak256 of a rule tree (what the operator signs with EIP-712)
    Hash { tree: PathBuf },
    /// Validate a rule tree against the schema (and optionally a vault's on-chain bounds)
    Validate {
        tree: PathBuf,
        #[arg(long)]
        vault: Option<Address>,
        #[arg(long, env = "INJ_RPC", default_value = TESTNET_RPC)]
        rpc: String,
    },
    /// Run the live harness against a Guardrail Vault
    Run {
        #[arg(long)]
        tree: PathBuf,
        #[arg(long, env = "ZHI_VAULT")]
        vault: Address,
        #[arg(long, env = "INJ_RPC", default_value = TESTNET_RPC)]
        rpc: String,
        #[arg(long, env = "INJ_LCD", default_value = TESTNET_LCD)]
        lcd: String,
        #[arg(long, env = "INJ_CHRONOS", default_value = MAINNET_CHRONOS)]
        chronos: String,
        /// market id for warm-up candles (default: mainnet market for the same asset)
        #[arg(long)]
        warmup_market: Option<String>,
        #[arg(long, env = "HARNESS_PRIVATE_KEY", hide_env_values = true)]
        harness_key: Option<String>,
        #[arg(long, env = "SYNTH_API_KEY", hide_env_values = true)]
        synth_key: Option<String>,
        #[arg(long, env = "SYNTH_API_URL", default_value = SYNTH_API)]
        synth_url: String,
        /// serve a captured Synth response from a file instead of the API (logged as such)
        #[arg(long)]
        synth_file: Option<String>,
        #[arg(long, default_value = "logs")]
        log_dir: PathBuf,
        #[arg(long, default_value_t = 5)]
        poll: u64,
        /// evaluate and log, never send transactions
        #[arg(long)]
        dry_run: bool,
        /// evaluate a single tick immediately and exit
        #[arg(long)]
        once: bool,
        #[arg(long, default_value_t = 6)]
        quote_decimals: u32,
    },
    /// Replay a decision log; exits non-zero on any mismatch (release blocker)
    Replay {
        log: PathBuf,
        #[arg(long)]
        from: Option<u64>,
        #[arg(long)]
        to: Option<u64>,
    },
    /// Backtest a rule tree over Injective candle history, with and without the Synth gate
    Backtest {
        #[arg(long)]
        tree: PathBuf,
        /// candle source market id (default: mainnet market for the tree's asset)
        #[arg(long)]
        market: Option<String>,
        #[arg(long, default_value_t = 30)]
        days: u64,
        #[arg(long, default_value = "10000")]
        equity: String,
        #[arg(long, default_value_t = 5)]
        fee_bps: i128,
        #[arg(long, default_value_t = 4)]
        spread_bps: i128,
        #[arg(long, default_value = "1")]
        price_tick: String,
        #[arg(long, default_value = "0.0001")]
        qty_tick: String,
        #[arg(long, env = "INJ_CHRONOS", default_value = MAINNET_CHRONOS)]
        chronos: String,
        #[arg(long, env = "SYNTH_API_KEY", hide_env_values = true)]
        synth_key: Option<String>,
        #[arg(long, env = "SYNTH_API_URL", default_value = SYNTH_API)]
        synth_url: String,
    },
    /// Build the epoch report + Zhi Score from on-chain evidence; --post publishes it via ZhiAttestor
    Attest {
        #[arg(long, env = "ZHI_VAULT")]
        vault: Address,
        #[arg(long, env = "ZHI_ATTESTOR")]
        attestor: Option<Address>,
        #[arg(long, env = "INJ_RPC", default_value = TESTNET_RPC)]
        rpc: String,
        #[arg(long, default_value_t = 0)]
        from_block: u64,
        #[arg(long, default_value = "state")]
        state_dir: PathBuf,
        #[arg(long, default_value = "reports")]
        report_dir: PathBuf,
        #[arg(long, env = "ZHI_REPORT_BASE_URL")]
        report_base_url: Option<String>,
        #[arg(long)]
        harness_log: Option<PathBuf>,
        #[arg(long)]
        post: bool,
        #[arg(long, env = "ATTESTER_PRIVATE_KEY", hide_env_values = true)]
        attester_key: Option<String>,
        #[arg(long, env = "PINATA_JWT", hide_env_values = true)]
        pinata_jwt: Option<String>,
    },
    /// Vault state at a glance
    Status {
        #[arg(long, env = "ZHI_VAULT")]
        vault: Address,
        #[arg(long, env = "INJ_RPC", default_value = TESTNET_RPC)]
        rpc: String,
    },
    /// Permissionless circuit breaker: enforce the drawdown freeze from any wallet
    Poke {
        #[arg(long, env = "ZHI_VAULT")]
        vault: Address,
        #[arg(long, env = "INJ_RPC", default_value = TESTNET_RPC)]
        rpc: String,
        #[arg(long, env = "PRIVATE_KEY", hide_env_values = true)]
        key: String,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with_target(false)
        .init();

    match Cli::parse().cmd {
        Cmd::Hash { tree } => {
            let s = std::fs::read_to_string(&tree)?;
            match zhi_core::ruletree::load(&s, None) {
                Ok((_, h)) => println!("{h}"),
                Err(issues) => {
                    for i in issues {
                        eprintln!("{}: {}", i.path, i.message);
                    }
                    std::process::exit(2);
                }
            }
        }
        Cmd::Validate { tree, vault, rpc } => {
            let s = std::fs::read_to_string(&tree)?;
            let vb = match vault {
                Some(v) => {
                    let p = ProviderBuilder::new().connect_http(rpc.parse()?);
                    let b = chain::GuardrailVault::new(v, &p).bounds().call().await?;
                    Some(zhi_core::ruletree::VaultBounds {
                        max_notional: chain::fx_from_u256(b.maxNotional),
                        max_leverage: Fx::from_scaled(b.maxLeverageX100 as i128, 2),
                        max_daily_dd_pct: Fx::from_scaled(b.maxDailyDdBps as i128, 2),
                        max_deviation_bps: Fx::from_int(b.maxDeviationBps as i64),
                        cooldown_sec: b.cooldownSec as u64,
                    })
                }
                None => None,
            };
            match zhi_core::ruletree::load(&s, vb.as_ref()) {
                Ok((_, h)) => println!("valid\nruleTreeHash {h}"),
                Err(issues) => {
                    for i in issues {
                        println!("{}: {}", i.path, i.message);
                    }
                    std::process::exit(2);
                }
            }
        }
        Cmd::Run { tree, vault, rpc, lcd, chronos, warmup_market, harness_key, synth_key, synth_url, synth_file, log_dir, poll, dry_run, once, quote_decimals } => {
            runner::run(runner::RunConfig {
                tree_path: tree,
                vault,
                rpc,
                lcd,
                chronos,
                warmup_market,
                harness_key,
                synth: market::SynthClient { base: synth_url, key: synth_key, file: synth_file, timeout: Duration::from_secs(3) },
                log_dir,
                poll_sec: poll,
                dry_run,
                quote_decimals,
                once,
            })
            .await?;
        }
        Cmd::Replay { log, from, to } => {
            let s = std::fs::read_to_string(&log).context("read log")?;
            let recs = zhi_core::record::parse_jsonl(&s).map_err(anyhow::Error::msg)?;
            let rep = zhi_core::record::replay(&recs, from, to).map_err(anyhow::Error::msg)?;
            println!("{}", serde_json::to_string_pretty(&rep)?);
            if !rep.mismatches.is_empty() {
                bail!("REPLAY MISMATCH: {} tick(s) differ", rep.mismatches.len());
            }
            println!("replay ok: {} ticks, {} intents reproduced bit-for-bit", rep.ticks, rep.intents);
        }
        Cmd::Backtest { tree, market, days, equity, fee_bps, spread_bps, price_tick, qty_tick, chronos, synth_key, synth_url } => {
            let s = std::fs::read_to_string(&tree)?;
            let (t, h) = zhi_core::ruletree::load(&s, None).map_err(|e| anyhow::anyhow!("{e:?}"))?;
            let mkt = market
                .or_else(|| market::default_warmup_market(&t.market.market_id.to_lowercase()).map(String::from))
                .unwrap_or(t.market.market_id.clone());
            let spec = MarketSpec {
                market_id: t.market.market_id.to_lowercase(),
                price_tick: price_tick.parse()?,
                qty_tick: qty_tick.parse()?,
                margin_tick: Fx::from_scaled(1, 6),
                max_oracle_age_sec: 3600,
            };
            let cfg = backtest::BacktestConfig {
                chronos,
                market: mkt,
                days,
                start_equity: equity.parse()?,
                fee_bps,
                spread_bps,
                warmup: 200,
            };
            let synth = market::SynthClient { base: synth_url, key: synth_key, file: None, timeout: Duration::from_secs(10) };
            let rep = backtest::run(&t, &h, &spec, &cfg, &synth).await?;
            println!("{}", serde_json::to_string_pretty(&rep)?);
        }
        Cmd::Attest { vault, attestor, rpc, from_block, state_dir, report_dir, report_base_url, harness_log, post, attester_key, pinata_jwt } => {
            let out = attest::attest(attest::AttestConfig {
                rpc,
                vault,
                attestor,
                from_block,
                state_dir,
                report_dir,
                report_base_url,
                harness_log,
                post,
                attester_key,
                pinata_jwt,
            })
            .await?;
            println!("{}", serde_json::to_string_pretty(&out)?);
        }
        Cmd::Status { vault, rpc } => {
            let p = ProviderBuilder::new().connect_http(rpc.parse()?);
            let v = chain::GuardrailVault::new(vault, &p);
            let eq = v.equity().call().await?;
            let b = v.bounds().call().await?;
            let out = serde_json::json!({
                "vault": format!("{vault:#x}"),
                "owner": format!("{:#x}", v.owner().call().await?),
                "harness": format!("{:#x}", v.harness().call().await?),
                "agentId": v.agentId().call().await?.to_string(),
                "subaccountId": v.subaccountId().call().await?,
                "equity": if eq.ok { chain::fx_from_u256(eq.eq).to_string() } else { "unreadable".into() },
                "epochStartEquity": chain::fx_from_u256(v.epochStartEquity().call().await?).to_string(),
                "frozen": v.frozen().call().await?,
                "nextNonce": v.nextNonce().call().await?,
                "executions": v.executions().call().await?,
                "intentsSubmitted": v.intentsSubmitted().call().await?,
                "adherenceSkips": v.adherenceSkips().call().await?,
                "bounds": {
                    "maxNotional": chain::fx_from_u256(b.maxNotional).to_string(),
                    "maxLeverage": Fx::from_scaled(b.maxLeverageX100 as i128, 2).to_string(),
                    "maxDailyDdPct": Fx::from_scaled(b.maxDailyDdBps as i128, 2).to_string(),
                    "maxDeviationBps": b.maxDeviationBps, "cooldownSec": b.cooldownSec, "maxOracleAgeSec": b.maxOracleAgeSec
                }
            });
            println!("{}", serde_json::to_string_pretty(&out)?);
        }
        Cmd::Poke { vault, rpc, key } => {
            let s: PrivateKeySigner = key.parse()?;
            let p = ProviderBuilder::new().wallet(EthereumWallet::from(s)).connect_http(rpc.parse()?);
            let v = chain::GuardrailVault::new(vault, &p);
            let r = v.poke().send().await?.get_receipt().await?;
            println!("poke tx {:#x}; frozen = {}", r.transaction_hash, v.frozen().call().await?);
            let _ = p.get_block_number().await;
        }
    }
    Ok(())
}
