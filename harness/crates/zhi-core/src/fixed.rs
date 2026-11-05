//! 18-decimal signed fixed-point arithmetic.
//!
//! Every value that influences a decision is an `Fx`. There are no floats anywhere on the
//! decision path, so the same inputs give bit-identical outputs on every machine (PRD §8).
//! Rounding is always explicit: division truncates toward zero unless a `_ceil`/`_floor`
//! variant is used.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::cmp::Ordering;
use std::fmt;
use std::ops::{Add, Neg, Sub};
use std::str::FromStr;

pub const SCALE: i128 = 1_000_000_000_000_000_000;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct Fx(pub i128);

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum FxError {
    #[error("invalid decimal: {0}")]
    Parse(String),
    #[error("overflow")]
    Overflow,
}

impl Fx {
    pub const ZERO: Fx = Fx(0);
    pub const ONE: Fx = Fx(SCALE);

    pub const fn from_int(i: i64) -> Fx {
        Fx(i as i128 * SCALE)
    }

    /// `n / 10^dp` exactly, e.g. `from_scaled(15, 1)` = 1.5
    pub fn from_scaled(n: i128, dp: u32) -> Fx {
        Fx(n * 10i128.pow(18 - dp))
    }

    pub fn raw(self) -> i128 {
        self.0
    }

    /// Raw value as an unsigned 18-dp integer (Injective "API format"). Negative -> 0.
    pub fn to_u256_raw(self) -> u128 {
        if self.0 < 0 {
            0
        } else {
            self.0 as u128
        }
    }

    pub fn from_u256_raw(v: u128) -> Fx {
        Fx(v as i128)
    }

    pub fn is_zero(self) -> bool {
        self.0 == 0
    }

    pub fn abs(self) -> Fx {
        Fx(self.0.abs())
    }

    pub fn mul(self, o: Fx) -> Fx {
        Fx(mul_div(self.0, o.0, SCALE, Round::Trunc))
    }

    pub fn div(self, o: Fx) -> Fx {
        assert!(o.0 != 0, "Fx division by zero");
        Fx(mul_div(self.0, SCALE, o.0, Round::Trunc))
    }

    pub fn div_ceil(self, o: Fx) -> Fx {
        assert!(o.0 != 0, "Fx division by zero");
        Fx(mul_div(self.0, SCALE, o.0, Round::Ceil))
    }

    pub fn mul_int(self, i: i128) -> Fx {
        Fx(self.0 * i)
    }

    pub fn div_int(self, i: i128) -> Fx {
        Fx(self.0 / i)
    }

    /// Round down to a multiple of `tick` (tick > 0).
    pub fn floor_to(self, tick: Fx) -> Fx {
        assert!(tick.0 > 0);
        Fx(self.0.div_euclid(tick.0) * tick.0)
    }

    /// Round up to a multiple of `tick` (tick > 0).
    pub fn ceil_to(self, tick: Fx) -> Fx {
        assert!(tick.0 > 0);
        let f = self.floor_to(tick);
        if f == self {
            f
        } else {
            Fx(f.0 + tick.0)
        }
    }

    /// Basis points: self * bps / 10_000
    pub fn bps(self, bps: i128) -> Fx {
        Fx(mul_div(self.0, bps, 10_000, Round::Trunc))
    }

    pub fn min(self, o: Fx) -> Fx {
        if self <= o {
            self
        } else {
            o
        }
    }

    pub fn max(self, o: Fx) -> Fx {
        if self >= o {
            self
        } else {
            o
        }
    }

    /// Integer square root on the 18-dp value (Newton), floor.
    pub fn sqrt(self) -> Fx {
        if self.0 <= 0 {
            return Fx::ZERO;
        }
        // sqrt(x * 1e18) in raw units: value = sqrt(raw * SCALE)
        let n = (self.0 as u128).checked_mul(SCALE as u128);
        let r = match n {
            Some(n) => isqrt_u128(n),
            None => isqrt_u128(self.0 as u128) * 1_000_000_000, // sqrt(1e18) = 1e9
        };
        Fx(r as i128)
    }
}

fn isqrt_u128(n: u128) -> u128 {
    if n < 2 {
        return n;
    }
    let mut x = 1u128 << ((128 - n.leading_zeros()).div_ceil(2));
    loop {
        let y = (x + n / x) / 2;
        if y >= x {
            return x;
        }
        x = y;
    }
}

#[derive(Clone, Copy)]
enum Round {
    Trunc,
    Ceil,
}

/// a * b / d with a 256-bit intermediate so 18-dp products never overflow.
fn mul_div(a: i128, b: i128, d: i128, round: Round) -> i128 {
    let neg = (a < 0) ^ (b < 0) ^ (d < 0);
    let (a, b, d) = (a.unsigned_abs(), b.unsigned_abs(), d.unsigned_abs());
    let (hi, lo) = mul_u128(a, b);
    let (q, r) = div_u256_by_u128(hi, lo, d);
    let mut q = q as i128;
    if r != 0 && matches!(round, Round::Ceil) && !neg {
        q += 1;
    }
    if neg {
        -q
    } else {
        q
    }
}

fn mul_u128(a: u128, b: u128) -> (u128, u128) {
    let (a1, a0) = (a >> 64, a & u64::MAX as u128);
    let (b1, b0) = (b >> 64, b & u64::MAX as u128);
    let p00 = a0 * b0;
    let p01 = a0 * b1;
    let p10 = a1 * b0;
    let p11 = a1 * b1;
    let mid = (p00 >> 64) + (p01 & u64::MAX as u128) + (p10 & u64::MAX as u128);
    let lo = (p00 & u64::MAX as u128) | (mid << 64);
    let hi = p11 + (p01 >> 64) + (p10 >> 64) + (mid >> 64);
    (hi, lo)
}

/// (hi:lo) / d, requires the quotient to fit in u128 (true for all Zhi magnitudes).
fn div_u256_by_u128(hi: u128, lo: u128, d: u128) -> (u128, u128) {
    assert!(hi < d, "Fx overflow in mul_div");
    // long division bit by bit (256 iterations max, deterministic and fast enough)
    let mut rem: u128 = hi;
    let mut q: u128 = 0;
    for i in (0..128).rev() {
        let carry = rem >> 127;
        rem = (rem << 1) | ((lo >> i) & 1);
        q <<= 1;
        if carry == 1 || rem >= d {
            rem = rem.wrapping_sub(d);
            q |= 1;
        }
    }
    (q, rem)
}

impl Add for Fx {
    type Output = Fx;
    fn add(self, o: Fx) -> Fx {
        Fx(self.0.checked_add(o.0).expect("Fx add overflow"))
    }
}

impl Sub for Fx {
    type Output = Fx;
    fn sub(self, o: Fx) -> Fx {
        Fx(self.0.checked_sub(o.0).expect("Fx sub overflow"))
    }
}

impl Neg for Fx {
    type Output = Fx;
    fn neg(self) -> Fx {
        Fx(-self.0)
    }
}

impl FromStr for Fx {
    type Err = FxError;

    /// Parses plain decimals ("74378.5", "-0.25", "3") and exponent forms ("1e-4", "2.5E3").
    fn from_str(s: &str) -> Result<Fx, FxError> {
        let err = || FxError::Parse(s.to_string());
        let s = s.trim();
        if s.is_empty() {
            return Err(err());
        }
        let (mant, exp) = match s.find(['e', 'E']) {
            Some(i) => (&s[..i], s[i + 1..].parse::<i32>().map_err(|_| err())?),
            None => (s, 0),
        };
        let (neg, mant) = match mant.strip_prefix('-') {
            Some(m) => (true, m),
            None => (false, mant.strip_prefix('+').unwrap_or(mant)),
        };
        let (int_part, frac_part) = match mant.find('.') {
            Some(i) => (&mant[..i], &mant[i + 1..]),
            None => (mant, ""),
        };
        if int_part.is_empty() && frac_part.is_empty() {
            return Err(err());
        }
        if !int_part.chars().all(|c| c.is_ascii_digit()) || !frac_part.chars().all(|c| c.is_ascii_digit()) {
            return Err(err());
        }
        // digits as one integer with an implied decimal point
        let digits = format!("{int_part}{frac_part}");
        let point = frac_part.len() as i32 - exp; // number of decimals
        let digits = digits.trim_start_matches('0');
        let digits = if digits.is_empty() { "0" } else { digits };
        let shift = 18 - point;
        let raw: i128 = if shift >= 0 {
            let base: i128 = digits.parse().map_err(|_| FxError::Overflow)?;
            base.checked_mul(10i128.checked_pow(shift as u32).ok_or(FxError::Overflow)?)
                .ok_or(FxError::Overflow)?
        } else {
            // more than 18 decimals: truncate extra precision
            let cut = (-shift) as usize;
            if digits.len() <= cut {
                0
            } else {
                digits[..digits.len() - cut].parse().map_err(|_| FxError::Overflow)?
            }
        };
        Ok(Fx(if neg { -raw } else { raw }))
    }
}

impl fmt::Display for Fx {
    /// Canonical minimal decimal: no exponent, no trailing zeros, no trailing ".".
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let neg = self.0 < 0;
        let a = self.0.unsigned_abs();
        let int = a / SCALE as u128;
        let frac = a % SCALE as u128;
        if neg && a != 0 {
            write!(f, "-")?;
        }
        if frac == 0 {
            write!(f, "{int}")
        } else {
            let fs = format!("{frac:018}");
            write!(f, "{int}.{}", fs.trim_end_matches('0'))
        }
    }
}

impl fmt::Debug for Fx {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Fx({self})")
    }
}

impl PartialOrd<i64> for Fx {
    fn partial_cmp(&self, o: &i64) -> Option<Ordering> {
        Some(self.0.cmp(&(*o as i128 * SCALE)))
    }
}

impl PartialEq<i64> for Fx {
    fn eq(&self, o: &i64) -> bool {
        self.0 == *o as i128 * SCALE
    }
}

/// Serialized as a JSON *string* in logs so precision survives any JSON tooling.
impl Serialize for Fx {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for Fx {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Fx, D::Error> {
        let v = serde_json::Value::deserialize(d)?;
        let s = match &v {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Number(n) => n.to_string(),
            _ => return Err(serde::de::Error::custom("expected decimal string or number")),
        };
        s.parse().map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fx(s: &str) -> Fx {
        s.parse().unwrap()
    }

    #[test]
    fn parse_and_display_roundtrip() {
        for s in ["0", "1", "-1", "74378.5", "0.000001", "123456789.123456789123456789", "1e-4", "2.5E3"] {
            let v = fx(s);
            let again: Fx = v.to_string().parse().unwrap();
            assert_eq!(v, again, "{s}");
        }
        assert_eq!(fx("3.0").to_string(), "3");
        assert_eq!(fx("1e-4").to_string(), "0.0001");
        assert_eq!(fx("2.5E3").to_string(), "2500");
        assert_eq!(fx("-0.50").to_string(), "-0.5");
    }

    #[test]
    fn arithmetic_is_exact_and_explicitly_rounded() {
        assert_eq!(fx("74378.5").mul(fx("0.1")), fx("7437.85"));
        assert_eq!(fx("1").div(fx("3")).to_string(), "0.333333333333333333");
        assert_eq!(fx("1").div_ceil(fx("3")).to_string(), "0.333333333333333334");
        assert_eq!(fx("75012.7").floor_to(fx("1")), fx("75012"));
        assert_eq!(fx("75012.2").ceil_to(fx("1")), fx("75013"));
        assert_eq!(fx("0.12345").floor_to(fx("0.0001")), fx("0.1234"));
        assert_eq!(fx("10000").bps(35), fx("35"));
        assert_eq!(fx("2").sqrt().to_string(), "1.414213562373095048");
        // large values do not overflow thanks to the 256-bit intermediate
        assert_eq!(fx("1000000000").mul(fx("1000000000")), fx("1000000000000000000"));
    }
}
