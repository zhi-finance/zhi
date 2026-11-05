//! Canonical JSON and keccak256 hashing (PRD §6: "sorted keys, no whitespace, so the same tree
//! always has the same hash").
//!
//! Rules (mirrored byte-for-byte by `web/lib/ruletree/canonical.ts`):
//! - objects: keys sorted by code point, no whitespace
//! - numbers: minimal decimal form, no exponent, no trailing zeros ("3.0" -> "3", "1e-4" -> "0.0001")
//! - strings: JSON escaping of `"` `\` and control characters only (UTF-8 passes through)

use crate::fixed::Fx;
use serde_json::Value;
use tiny_keccak::{Hasher, Keccak};

pub fn canonical_json(v: &Value) -> Result<String, String> {
    let mut out = String::new();
    write(v, &mut out)?;
    Ok(out)
}

fn write(v: &Value, out: &mut String) -> Result<(), String> {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            let fx: Fx = n.to_string().parse().map_err(|e| format!("number {n}: {e}"))?;
            // guard: canonical numbers must round-trip exactly (no hidden precision loss)
            let back: Fx = fx.to_string().parse().unwrap();
            if back != fx {
                return Err(format!("number {n} not representable"));
            }
            out.push_str(&fx.to_string());
        }
        Value::String(s) => out.push_str(&serde_json::to_string(s).map_err(|e| e.to_string())?),
        Value::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write(x, out)?;
            }
            out.push(']');
        }
        Value::Object(m) => {
            let mut keys: Vec<&String> = m.keys().collect();
            // JS sorts by UTF-16 code units; identical to byte order for the ASCII keys the
            // schema allows (unknown keys are rejected before hashing).
            keys.sort();
            out.push('{');
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(k).unwrap());
                out.push(':');
                write(&m[*k], out)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

pub fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut k = Keccak::v256();
    let mut out = [0u8; 32];
    k.update(data);
    k.finalize(&mut out);
    out
}

pub fn hex32(h: &[u8; 32]) -> String {
    format!("0x{}", hex::encode(h))
}

/// keccak256 of the canonical JSON, 0x-prefixed.
pub fn hash_value(v: &Value) -> Result<String, String> {
    Ok(hex32(&keccak256(canonical_json(v)?.as_bytes())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorted_minimal() {
        let v: Value = serde_json::from_str(r#"{ "b": 3.0, "a": [1e-4, "x\"y"], "c": {"z": null, "y": true} }"#).unwrap();
        assert_eq!(canonical_json(&v).unwrap(), r#"{"a":[0.0001,"x\"y"],"b":3,"c":{"y":true,"z":null}}"#);
    }

    #[test]
    fn whitespace_and_order_do_not_change_hash() {
        let a: Value = serde_json::from_str(r#"{"x":1,"y":[2,3]}"#).unwrap();
        let b: Value = serde_json::from_str("{\n  \"y\": [2, 3.00],\n  \"x\": 1.0\n}").unwrap();
        assert_eq!(hash_value(&a).unwrap(), hash_value(&b).unwrap());
    }
}
