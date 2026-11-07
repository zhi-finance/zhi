// Canonical JSON + keccak256. Byte-for-byte equal to harness/crates/zhi-core/src/canonical.rs:
//  - object keys sorted, no whitespace
//  - numbers in minimal decimal form, never exponent ("3.0" -> "3", 1e-4 -> "0.0001")
//  - strings JSON-escaped (UTF-8 passes through)
import { keccak256, toBytes } from "viem";

function numberToCanonical(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`non-finite number ${n}`);
  if (Object.is(n, -0) || n === 0) return "0";
  const s = String(n);
  if (!/e/i.test(s)) return s;
  // expand exponent form exactly (only reachable for |n| < 1e-6 or >= 1e21)
  const [mant, expStr] = s.toLowerCase().split("e");
  const exp = Number(expStr);
  const neg = mant.startsWith("-");
  const [i, f = ""] = mant.replace("-", "").split(".");
  const digits = i + f;
  const point = i.length + exp;
  let out: string;
  if (point <= 0) out = "0." + "0".repeat(-point) + digits;
  else if (point >= digits.length) out = digits + "0".repeat(point - digits.length);
  else out = digits.slice(0, point) + "." + digits.slice(point);
  out = out.includes(".") ? out.replace(/0+$/, "").replace(/\.$/, "") : out;
  return (neg ? "-" : "") + out.replace(/^0+(?=\d)/, "");
}

export function canonicalJson(v: unknown): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "boolean":
      return v ? "true" : "false";
    case "number":
      return numberToCanonical(v);
    case "string":
      return JSON.stringify(v);
    case "object": {
      if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
      return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(o[k])).join(",") + "}";
    }
    default:
      throw new Error(`unsupported JSON value: ${typeof v}`);
  }
}

export function hashRuleTree(tree: unknown): `0x${string}` {
  return keccak256(toBytes(canonicalJson(tree)));
}

export function hashText(s: string): `0x${string}` {
  return keccak256(toBytes(s));
}
