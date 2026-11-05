//! Bittensor Synth (SN50) gate, PRD §9.
//!
//! The gate is a pure function of the *raw response bytes* plus the current price, so a replay
//! of the logged body reproduces the verdict exactly. The response hash (keccak256 of the raw
//! body) goes into the intent and is emitted on-chain by the vault.
//!
//! Response shape (api.synthdata.co swagger, `types.PredictionPercentiles`):
//! `{ "current_price": n, "forecast_future": { "percentiles": [ { "0.005": p, ..., "0.995": p }, ... ] } }`
//! one object per time step; the gate uses the last step of the horizon.

use crate::canonical::{hex32, keccak256};
use crate::fixed::Fx;
use crate::ruletree::{Side, SynthGate};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const LEVELS: [&str; 9] = ["0.005", "0.05", "0.2", "0.35", "0.5", "0.65", "0.8", "0.95", "0.995"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GateSkip {
    SynthDirection,
    SynthRegime,
    SynthUnavailable,
}

impl GateSkip {
    /// Matches ZhiTypes.Skip in Solidity.
    pub fn onchain_code(self) -> u8 {
        match self {
            GateSkip::SynthDirection => 13,
            GateSkip::SynthRegime => 14,
            GateSkip::SynthUnavailable => 15,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GateVerdict {
    pub pass: bool,
    pub skip: Option<GateSkip>,
    /// probability the price finishes in the trade's direction
    pub p_dir: Option<Fx>,
    /// (p95 - p05) / P0 * 1e4
    pub band90_bps: Option<Fx>,
    /// keccak256 of the raw response body, or zero when unavailable
    pub synth_hash: String,
    pub detail: String,
}

/// Plug-in point for other subnets (PRD §9 "VerifierAdapter"). Each adapter is fail-closed and
/// its verdict is logged separately.
pub trait VerifierAdapter {
    fn name(&self) -> &'static str;
    fn verdict(&self, raw: Option<&str>, side: Side, p0: Fx) -> GateVerdict;
}

pub struct SynthAdapter<'a> {
    pub cfg: &'a SynthGate,
}

impl VerifierAdapter for SynthAdapter<'_> {
    fn name(&self) -> &'static str {
        "synth-sn50"
    }

    fn verdict(&self, raw: Option<&str>, side: Side, p0: Fx) -> GateVerdict {
        evaluate(self.cfg, raw, side, p0)
    }
}

pub const ZERO_HASH: &str = "0x0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Debug, Clone)]
pub struct Forecast {
    pub current_price: Fx,
    /// (level, price) for the last time step, levels ascending
    pub last: Vec<(Fx, Fx)>,
}

pub fn parse(raw: &str) -> Result<Forecast, String> {
    let v: Value = serde_json::from_str(raw).map_err(|e| format!("json: {e}"))?;
    let num = |x: &Value| -> Result<Fx, String> {
        match x {
            Value::Number(n) => n.to_string().parse().map_err(|e| format!("{e}")),
            _ => Err("not a number".into()),
        }
    };
    let current_price = num(v.get("current_price").ok_or("missing current_price")?)?;
    let steps = v
        .get("forecast_future")
        .and_then(|f| f.get("percentiles"))
        .and_then(|p| p.as_array())
        .ok_or("missing forecast_future.percentiles")?;
    let last = steps.last().ok_or("empty percentiles")?;
    let mut pts = Vec::with_capacity(9);
    for lvl in LEVELS {
        let p = num(last.get(lvl).ok_or_else(|| format!("missing level {lvl}"))?)?;
        pts.push((lvl.parse::<Fx>().unwrap(), p));
    }
    for w in pts.windows(2) {
        if w[1].1 < w[0].1 {
            return Err("percentiles not monotonic".into());
        }
    }
    if pts[0].1 <= 0 {
        return Err("non-positive price".into());
    }
    Ok(Forecast { current_price, last: pts })
}

/// Forecast CDF at price x by linear interpolation between percentile points. Below the 0.5th
/// percentile it returns 0.005, above the 99.5th it returns 0.995 (tails are not extrapolated).
pub fn cdf(f: &Forecast, x: Fx) -> Fx {
    let pts = &f.last;
    if x <= pts[0].1 {
        return pts[0].0;
    }
    if x >= pts[pts.len() - 1].1 {
        return pts[pts.len() - 1].0;
    }
    for w in pts.windows(2) {
        let ((l0, p0), (l1, p1)) = (w[0], w[1]);
        if x >= p0 && x <= p1 {
            if p1 == p0 {
                return l1;
            }
            return l0 + (l1 - l0).mul(x - p0).div(p1 - p0); // multiply first: exact for decimal inputs
        }
    }
    pts[pts.len() - 1].0
}

pub fn evaluate(cfg: &SynthGate, raw: Option<&str>, side: Side, p0: Fx) -> GateVerdict {
    let unavailable = |detail: String, hash: String| GateVerdict {
        pass: false,
        skip: Some(GateSkip::SynthUnavailable),
        p_dir: None,
        band90_bps: None,
        synth_hash: hash,
        detail,
    };
    let Some(raw) = raw else {
        return unavailable("no response (timeout / http error)".into(), ZERO_HASH.into());
    };
    let hash = hex32(&keccak256(raw.as_bytes()));
    let f = match parse(raw) {
        Ok(f) => f,
        Err(e) => return unavailable(format!("malformed: {e}"), hash),
    };
    if p0 <= 0 {
        return unavailable("no reference price".into(), hash);
    }
    let fp0 = cdf(&f, p0);
    let p_dir = match side {
        Side::Long => Fx::ONE - fp0,
        Side::Short => fp0,
    };
    let p05 = f.last[1].1;
    let p95 = f.last[7].1;
    let band = (p95 - p05).div(p0).mul_int(10_000);

    let (pass, skip, detail) = if p_dir < cfg.min_direction_prob {
        (false, Some(GateSkip::SynthDirection), format!("P(dir)={p_dir} < {}", cfg.min_direction_prob))
    } else if band > cfg.max_band90_bps {
        (false, Some(GateSkip::SynthRegime), format!("B90={band}bps > {}", cfg.max_band90_bps))
    } else {
        (true, None, format!("P(dir)={p_dir} B90={band}bps"))
    };
    GateVerdict { pass, skip, p_dir: Some(p_dir), band90_bps: Some(band), synth_hash: hash, detail }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ruletree::{Horizon, OnMissing};

    fn cfg() -> SynthGate {
        SynthGate {
            asset: "BTC".into(),
            horizon: Horizon::H1,
            min_direction_prob: "0.6".parse().unwrap(),
            max_band90_bps: Fx::from_int(180),
            on_missing: OnMissing::Skip,
        }
    }

    /// Bullish, tight distribution centered ~0.4% above 75,000.
    pub fn bullish() -> String {
        r#"{"current_price":75000,"forecast_future":{"percentiles":[
          {"0.005":74000,"0.05":74500,"0.2":74800,"0.35":74950,"0.5":75050,"0.65":75150,"0.8":75300,"0.95":75600,"0.995":76000},
          {"0.005":74200,"0.05":74700,"0.2":74950,"0.35":75100,"0.5":75300,"0.65":75450,"0.8":75600,"0.95":75900,"0.995":76300}
        ]}}"#
            .into()
    }

    #[test]
    fn direction_passes_and_hash_is_body_hash() {
        let raw = bullish();
        let v = evaluate(&cfg(), Some(&raw), Side::Long, Fx::from_int(75000));
        // P0 = 75,000 sits between 0.2 (74,950) and 0.35 (75,100): F = 0.2 + .15 * 50/150 = 0.25
        assert_eq!(v.p_dir.unwrap(), "0.75".parse::<Fx>().unwrap());
        assert!(v.pass, "{}", v.detail);
        assert_eq!(v.synth_hash, hex32(&keccak256(raw.as_bytes())));
        // B90 = (75,900 - 74,700) / 75,000 * 1e4 = 160 bps
        assert_eq!(v.band90_bps.unwrap(), Fx::from_int(160));
    }

    #[test]
    fn short_mirrors_long() {
        let v = evaluate(&cfg(), Some(&bullish()), Side::Short, Fx::from_int(75000));
        assert_eq!(v.skip, Some(GateSkip::SynthDirection));
    }

    #[test]
    fn wide_band_is_regime_skip() {
        let mut c = cfg();
        c.max_band90_bps = Fx::from_int(150);
        let v = evaluate(&c, Some(&bullish()), Side::Long, Fx::from_int(75000));
        assert_eq!(v.skip, Some(GateSkip::SynthRegime));
    }

    #[test]
    fn fails_closed() {
        assert_eq!(evaluate(&cfg(), None, Side::Long, Fx::from_int(1)).skip, Some(GateSkip::SynthUnavailable));
        let v = evaluate(&cfg(), Some("{\"error\":1}"), Side::Long, Fx::from_int(1));
        assert_eq!(v.skip, Some(GateSkip::SynthUnavailable));
        assert_ne!(v.synth_hash, ZERO_HASH, "malformed bodies are still hashed as evidence");
    }
}
