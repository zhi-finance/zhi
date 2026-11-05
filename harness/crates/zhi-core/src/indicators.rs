//! Fixed-point indicators over closed candles. Deterministic: same closes, same values.

use crate::fixed::Fx;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Candle {
    /// bucket open time (unix seconds, aligned to the timeframe)
    pub t: u64,
    pub o: Fx,
    pub h: Fx,
    pub l: Fx,
    pub c: Fx,
}

/// Builds fixed-timeframe candles from price samples. Gaps are forward-filled with the previous
/// close so indicator periods always mean wall-clock time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CandleBuilder {
    pub tf: u64,
    pub closed: Vec<Candle>,
    pub open: Option<Candle>,
    pub max_len: usize,
}

impl CandleBuilder {
    pub fn new(tf: u64, max_len: usize) -> Self {
        Self { tf, closed: Vec::new(), open: None, max_len }
    }

    /// Seed with historical closed candles (oldest first). Gaps are filled.
    pub fn seed(&mut self, candles: &[Candle]) {
        for c in candles {
            let _ = self.push_closed(*c);
        }
    }

    fn push_closed(&mut self, c: Candle) -> Vec<Candle> {
        let mut pushed = Vec::new();
        if let Some(last) = self.closed.last().copied() {
            if c.t <= last.t {
                return pushed;
            }
            let mut t = last.t + self.tf;
            while t < c.t {
                pushed.push(Candle { t, o: last.c, h: last.c, l: last.c, c: last.c });
                t += self.tf;
            }
        }
        pushed.push(c);
        self.closed.extend_from_slice(&pushed);
        if self.closed.len() > self.max_len {
            let drop = self.closed.len() - self.max_len;
            self.closed.drain(..drop);
        }
        pushed
    }

    /// Feed one price sample. Returns the candles that closed because of it.
    pub fn on_sample(&mut self, ts: u64, px: Fx) -> Vec<Candle> {
        let bucket = ts - ts % self.tf;
        let mut closed_now = Vec::new();
        match self.open {
            Some(mut o) if o.t == bucket => {
                o.h = o.h.max(px);
                o.l = o.l.min(px);
                o.c = px;
                self.open = Some(o);
            }
            Some(o) if bucket > o.t => {
                closed_now = self.push_closed(o);
                self.open = Some(Candle { t: bucket, o: px, h: px, l: px, c: px });
            }
            Some(_) => {} // late sample for an older bucket: ignored
            None => self.open = Some(Candle { t: bucket, o: px, h: px, l: px, c: px }),
        }
        closed_now
    }

    pub fn closes(&self) -> Vec<Fx> {
        self.closed.iter().map(|c| c.c).collect()
    }
}

pub fn sma(xs: &[Fx], n: usize) -> Option<Fx> {
    if n == 0 || xs.len() < n {
        return None;
    }
    let s = xs[xs.len() - n..].iter().fold(Fx::ZERO, |a, &b| a + b);
    Some(s.div_int(n as i128))
}

/// EMA seeded with the SMA of the first `n` values, alpha = 2 / (n + 1).
pub fn ema(xs: &[Fx], n: usize) -> Option<Fx> {
    if n == 0 || xs.len() < n {
        return None;
    }
    let alpha = Fx::from_int(2).div(Fx::from_int(n as i64 + 1));
    let mut e = xs[..n].iter().fold(Fx::ZERO, |a, &b| a + b).div_int(n as i128);
    for &x in &xs[n..] {
        e = e + alpha.mul(x - e);
    }
    Some(e)
}

/// Wilder's RSI. Needs n + 1 closes.
pub fn rsi(xs: &[Fx], n: usize) -> Option<Fx> {
    if n == 0 || xs.len() < n + 1 {
        return None;
    }
    let mut gain = Fx::ZERO;
    let mut loss = Fx::ZERO;
    for w in xs[..=n].windows(2) {
        let d = w[1] - w[0];
        if d > 0 {
            gain = gain + d;
        } else {
            loss = loss + (-d);
        }
    }
    let nn = n as i128;
    let mut ag = gain.div_int(nn);
    let mut al = loss.div_int(nn);
    for w in xs[n..].windows(2) {
        let d = w[1] - w[0];
        let (g, l) = if d > 0 { (d, Fx::ZERO) } else { (Fx::ZERO, -d) };
        ag = (ag.mul_int(nn - 1) + g).div_int(nn);
        al = (al.mul_int(nn - 1) + l).div_int(nn);
    }
    if al.is_zero() {
        return Some(Fx::from_int(100));
    }
    let rs = ag.div(al);
    Some(Fx::from_int(100) - Fx::from_int(100).div(Fx::ONE + rs))
}

/// Return over n candles, in bps.
pub fn return_bps(xs: &[Fx], n: usize) -> Option<Fx> {
    if xs.len() < n + 1 {
        return None;
    }
    let a = xs[xs.len() - 1 - n];
    let b = xs[xs.len() - 1];
    if a.is_zero() {
        return None;
    }
    Some((b - a).div(a).mul_int(10_000))
}

/// Population standard deviation of per-candle returns over n candles, in bps.
pub fn vol_bps(xs: &[Fx], n: usize) -> Option<Fx> {
    if n < 2 || xs.len() < n + 1 {
        return None;
    }
    let w = &xs[xs.len() - 1 - n..];
    let rets: Vec<Fx> = w.windows(2).map(|p| (p[1] - p[0]).div(p[0]).mul_int(10_000)).collect();
    let mean = rets.iter().fold(Fx::ZERO, |a, &b| a + b).div_int(rets.len() as i128);
    let var = rets.iter().fold(Fx::ZERO, |a, &r| a + (r - mean).mul(r - mean)).div_int(rets.len() as i128);
    Some(var.sqrt())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fxs(v: &[i64]) -> Vec<Fx> {
        v.iter().map(|&x| Fx::from_int(x)).collect()
    }

    #[test]
    fn sma_ema_basic() {
        let xs = fxs(&[1, 2, 3, 4, 5]);
        assert_eq!(sma(&xs, 5).unwrap(), Fx::from_int(3));
        // seed 2 (sma of 1,2,3), alpha = 0.5: 2 + .5*(4-2) = 3, 3 + .5*(5-3) = 4
        assert_eq!(ema(&xs, 3).unwrap(), Fx::from_int(4));
        assert!(ema(&xs, 6).is_none());
    }

    #[test]
    fn rsi_extremes() {
        assert_eq!(rsi(&fxs(&[1, 2, 3, 4, 5, 6]), 5).unwrap(), Fx::from_int(100));
        let r = rsi(&fxs(&[6, 5, 4, 3, 2, 1]), 5).unwrap();
        assert_eq!(r, Fx::ZERO);
        let mixed = rsi(&fxs(&[10, 11, 10, 11, 10, 11]), 5).unwrap();
        assert_eq!(mixed, Fx::from_int(60)); // 3 gains of 1, 2 losses of 1 -> RS 1.5 -> 60
    }

    #[test]
    fn candle_builder_closes_and_fills_gaps() {
        let mut b = CandleBuilder::new(300, 1000);
        assert!(b.on_sample(1000 * 300 + 5, Fx::from_int(100)).is_empty());
        b.on_sample(1000 * 300 + 200, Fx::from_int(105));
        let closed = b.on_sample(1003 * 300 + 1, Fx::from_int(99));
        assert_eq!(closed.len(), 1);
        assert_eq!(closed[0].h, Fx::from_int(105));
        assert_eq!(closed[0].c, Fx::from_int(105));
        let closed = b.on_sample(1004 * 300, Fx::from_int(98));
        // 1001 and 1002 forward-filled, then 1003 closes
        assert_eq!(closed.len(), 3);
        assert_eq!(closed[0].c, Fx::from_int(105));
        assert_eq!(closed[2].c, Fx::from_int(99));
    }
}
