//! Market data sources. Everything returned here is logged verbatim, so replay never touches
//! the network.
//!
//! - Live price: the Injective oracle precompile (0x67), i.e. the *same* reference the vault
//!   checks deviation and freshness against. Candles are built locally from these samples.
//! - Book: Injective LCD derivative orderbook (best bid / ask -> SPREAD_BPS).
//! - Warm-up history: Injective indexer chart API (chronos) candles. Testnet markets have
//!   little history, so the default warm-up source is the mainnet market for the same asset.
//!
//! Chain Stream (gRPC) is the production transport for trades/book/oracle; the LCD + precompile
//! poller implements the same `inputs` contract and is what the MVP ships.

use crate::chain::{OraclePrecompile, ORACLE};
use alloy::providers::Provider;
use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::time::Duration;
use zhi_core::indicators::Candle;
use zhi_core::Fx;

pub struct OracleKey {
    pub oracle_type: u8,
    pub base: String,
    pub quote: String,
}

pub async fn oracle_price<P: Provider>(p: &P, k: &OracleKey) -> Result<(Fx, u64)> {
    let o = OraclePrecompile::new(ORACLE, p);
    let s = o.oraclePricePairState(k.oracle_type, k.base.clone(), k.quote.clone()).call().await?;
    let ts = s.baseTimestamp.min(if s.quoteTimestamp == 0 { s.baseTimestamp } else { s.quoteTimestamp });
    Ok((crate::chain::fx_from_u256(s.pairPrice), ts))
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("zhi-harness/0.1")
        .build()
        .expect("http client")
}

/// Best bid / ask in human price units. LCD returns chain format (price * 10^quoteDecimals).
pub async fn best_bid_ask(lcd: &str, market_id: &str, quote_decimals: u32) -> Result<(Option<Fx>, Option<Fx>)> {
    let url = format!("{lcd}/injective/exchange/v1beta1/derivative/orderbook/{market_id}?limit=1");
    let v: Value = http().get(&url).send().await?.error_for_status()?.json().await?;
    let scale = Fx::from_int(10i64.pow(quote_decimals));
    let top = |side: &str| -> Option<Fx> {
        let p = v.get(side)?.as_array()?.first()?.get("p")?.as_str()?;
        p.parse::<Fx>().ok().map(|x| x.div(scale))
    };
    Ok((top("buys_price_level"), top("sells_price_level")))
}

/// Closed candles from the Injective chart API, oldest first.
pub async fn chronos_candles(api: &str, market_id: &str, resolution_min: u64, count: u64, to: u64) -> Result<Vec<Candle>> {
    let url = format!("{api}/api/chart/v1/derivative/history?marketId={market_id}&resolution={resolution_min}&countback={count}&to={to}");
    let v: Value = http().get(&url).send().await?.error_for_status()?.json().await.context("chronos json")?;
    let arr = |k: &str| v.get(k).and_then(|x| x.as_array()).cloned().unwrap_or_default();
    let (t, o, h, l, c) = (arr("t"), arr("o"), arr("h"), arr("l"), arr("c"));
    let num = |x: &Value| -> Result<Fx> { x.to_string().trim_matches('"').parse::<Fx>().map_err(|e| anyhow!("{e}")) };
    let tf = resolution_min * 60;
    let mut out = Vec::with_capacity(t.len());
    for i in 0..t.len() {
        let ts = t[i].as_u64().ok_or_else(|| anyhow!("bad t"))?;
        // the in-progress candle is excluded: only fully closed buckets are deterministic
        if ts + tf > to {
            continue;
        }
        out.push(Candle { t: ts - ts % tf, o: num(&o[i])?, h: num(&h[i])?, l: num(&l[i])?, c: num(&c[i])? });
    }
    Ok(out)
}

/// Default warm-up source per testnet market: the mainnet market for the same asset.
pub fn default_warmup_market(testnet_market: &str) -> Option<&'static str> {
    match testnet_market {
        // BTC/USDC PERP
        "0xfd704649cf3a516c0c145ab0111717c44640d8dbe52a462ae35cadf2f6df1515" => {
            Some("0x0ee7ca44147bab6ec81ac293b5fe7915488e612af59964b2d663d6008d861dee")
        }
        // ETH/USDC PERP
        "0x135de28700392fb1c17d40d5170a74f30055a4ad522feddafec42fbbbb780897" => {
            Some("0xe9c90a90ec75194ba9693f12b58a88a06937599e00c2adbc565a7b1a6ffbe4ed")
        }
        // INJ/USDC PERP
        "0xdc70164d7120529c3cd84278c98df4151210c0447a65a2aab03459cf328de41e" => {
            Some("0x790aee464fbbd02cf4476444554c71d1225f7edfe15e6dc7f874c455fd883d31")
        }
        _ => None,
    }
}

/// Synth SN50 client. Returns the raw body on HTTP 200, `None` otherwise (fail closed).
pub struct SynthClient {
    pub base: String,
    pub key: Option<String>,
    /// Serve a captured response instead of calling the API (demo / offline). Logged as such.
    pub file: Option<String>,
    pub timeout: Duration,
}

impl SynthClient {
    pub async fn fetch(&self, asset: &str, horizon: &str, start_time: Option<&str>) -> Option<String> {
        if let Some(f) = &self.file {
            return std::fs::read_to_string(f).ok();
        }
        let key = self.key.as_ref()?;
        let mut url = format!("{}/insights/prediction-percentiles?asset={asset}&horizon={horizon}", self.base);
        if let Some(st) = start_time {
            url.push_str(&format!("&start_time={st}"));
        }
        let c = reqwest::Client::builder().timeout(self.timeout).build().ok()?;
        let r = c.get(&url).header("Authorization", format!("Apikey {key}")).send().await.ok()?;
        if !r.status().is_success() {
            tracing::warn!(status = %r.status(), "synth non-200 -> SYNTH_UNAVAILABLE");
            return None;
        }
        r.text().await.ok()
    }
}
