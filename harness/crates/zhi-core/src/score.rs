//! Zhi Score v1 (300-850), PRD §12. Quality x maturity, fully fixed-point so an independent
//! recomputation during the 72h challenge window matches the posted score exactly.
//!
//!   S = 300 + 550 * Q * M
//!   Q = 0.35 σ(Sharpe90 - 1) + 0.25 (1 - min(1, MDD90 / 0.30)) + 0.15 WR + 0.15 CA + 0.10 RR
//!   M = min(1, days/90) * min(1, closedTrades/200)
//! RR applies only once an agent has borrowed; before that its weight is spread pro rata.

use crate::fixed::Fx;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScoreInputs {
    /// end-of-day equity, oldest first (up to 91 points for 90 daily returns)
    pub daily_equity: Vec<Fx>,
    pub days_live: u32,
    pub closed_trades: u32,
    pub winning_trades: u32,
    pub intents_submitted: u64,
    /// NOTIONAL, LEVERAGE, MARKET_NOT_ALLOWED, PRICE_DEVIATION, BAD_RULETREE (+ OFF_TICK)
    pub invariant_skips: u64,
    /// repaid / due, only when the agent has borrowed
    pub repayment_rate: Option<Fx>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScoreBreakdown {
    pub sharpe: Fx,
    pub sharpe_term: Fx,
    pub mdd: Fx,
    pub mdd_term: Fx,
    pub win_rate: Fx,
    pub adherence: Fx,
    pub repayment: Option<Fx>,
    pub quality: Fx,
    pub maturity: Fx,
    pub score: u16,
}

fn fx(s: &str) -> Fx {
    s.parse().unwrap()
}

/// e^x via range reduction to |r| <= ln2/2 and a fixed 24-term Taylor series. Deterministic.
pub fn exp(x: Fx) -> Fx {
    let x = x.max(Fx::from_int(-40)).min(Fx::from_int(40));
    let ln2 = fx("0.693147180559945309");
    // k = round(x / ln2)
    let q = x.div(ln2);
    let k = (q + if q >= Fx::ZERO { fx("0.5") } else { fx("-0.5") }).raw() / crate::fixed::SCALE;
    let r = x - ln2.mul_int(k);
    let mut term = Fx::ONE;
    let mut sum = Fx::ONE;
    for i in 1..=24i128 {
        term = term.mul(r).div_int(i);
        sum = sum + term;
    }
    if k >= 0 {
        Fx(sum.raw() << k)
    } else {
        Fx(sum.raw() >> (-k))
    }
}

pub fn logistic(x: Fx) -> Fx {
    Fx::ONE.div(Fx::ONE + exp(-x))
}

pub fn compute(inp: &ScoreInputs) -> ScoreBreakdown {
    let eq = &inp.daily_equity[inp.daily_equity.len().saturating_sub(91)..];
    let rets: Vec<Fx> = eq.windows(2).filter(|w| w[0] > 0).map(|w| (w[1] - w[0]).div(w[0])).collect();

    let sharpe = if rets.len() >= 2 {
        let n = rets.len() as i128;
        let mean = rets.iter().fold(Fx::ZERO, |a, &b| a + b).div_int(n);
        let var = rets.iter().fold(Fx::ZERO, |a, &r| a + (r - mean).mul(r - mean)).div_int(n);
        let sd = var.sqrt();
        if sd.is_zero() {
            Fx::ZERO
        } else {
            mean.div(sd).mul(Fx::from_int(365).sqrt())
        }
    } else {
        Fx::ZERO
    };
    let sharpe_term = logistic(sharpe - Fx::ONE);

    let mut peak = Fx::ZERO;
    let mut mdd = Fx::ZERO;
    for &e in eq {
        peak = peak.max(e);
        if peak > 0 {
            mdd = mdd.max((peak - e).div(peak));
        }
    }
    let mdd_term = Fx::ONE - Fx::ONE.min(mdd.div(fx("0.30")));

    let win_rate = if inp.closed_trades == 0 {
        Fx::ZERO
    } else {
        Fx::from_int(inp.winning_trades as i64).div(Fx::from_int(inp.closed_trades as i64))
    };
    let adherence = if inp.intents_submitted == 0 {
        Fx::ONE
    } else {
        Fx::ONE - Fx::from_int(inp.invariant_skips as i64).div(Fx::from_int(inp.intents_submitted as i64))
    };

    let base = fx("0.35").mul(sharpe_term) + fx("0.25").mul(mdd_term) + fx("0.15").mul(win_rate) + fx("0.15").mul(adherence);
    let quality = match inp.repayment_rate {
        Some(rr) => base + fx("0.10").mul(rr.min(Fx::ONE)),
        None => base.div(fx("0.90")),
    };
    let maturity = Fx::ONE.min(Fx::from_int(inp.days_live as i64).div_int(90))
        .mul(Fx::ONE.min(Fx::from_int(inp.closed_trades as i64).div_int(200)));
    let s = Fx::from_int(300) + Fx::from_int(550).mul(quality).mul(maturity);
    let score = ((s + fx("0.5")).raw() / crate::fixed::SCALE).clamp(300, 850) as u16;

    ScoreBreakdown {
        sharpe,
        sharpe_term,
        mdd,
        mdd_term,
        win_rate,
        adherence,
        repayment: inp.repayment_rate,
        quality,
        maturity,
        score,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exp_and_logistic() {
        assert_eq!(exp(Fx::ZERO), Fx::ONE);
        let e = exp(Fx::ONE).to_string();
        assert!(e.starts_with("2.71828182845904"), "{e}");
        assert_eq!(logistic(Fx::ZERO).to_string(), "0.5", "Sharpe 1 scores 0.5 on that term");
    }

    #[test]
    fn young_agent_cannot_outrank_mature_one() {
        let up: Vec<Fx> = (0..=2).map(|i| Fx::from_int(10_000 + i * 300)).collect();
        let brilliant_young = compute(&ScoreInputs {
            daily_equity: up,
            days_live: 2,
            closed_trades: 15,
            winning_trades: 14,
            intents_submitted: 20,
            ..Default::default()
        });
        let steady: Vec<Fx> = (0..=90).map(|i| Fx::from_int(10_000 + i * 8 + if i % 7 == 0 { -20 } else { 0 })).collect();
        let solid_mature = compute(&ScoreInputs {
            daily_equity: steady,
            days_live: 90,
            closed_trades: 220,
            winning_trades: 120,
            intents_submitted: 400,
            invariant_skips: 2,
            ..Default::default()
        });
        assert!(solid_mature.score > brilliant_young.score, "{} vs {}", solid_mature.score, brilliant_young.score);
        assert!(brilliant_young.score < 330);
        assert!((300..=850).contains(&solid_mature.score));
    }

    #[test]
    fn deterministic() {
        let inp = ScoreInputs {
            daily_equity: (0..=60).map(|i| Fx::from_int(5_000 + (i * 37) % 113)).collect(),
            days_live: 61,
            closed_trades: 130,
            winning_trades: 70,
            intents_submitted: 300,
            invariant_skips: 3,
            repayment_rate: None,
        };
        assert_eq!(compute(&inp), compute(&inp.clone()));
    }
}
