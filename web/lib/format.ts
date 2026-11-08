import { formatUnits } from "viem";

export const short = (a?: string, n = 4) => (a ? `${a.slice(0, 2 + n)}…${a.slice(-n)}` : "—");

/** 18-dp fixed-point bigint -> number (display only; never used for decisions). */
export const fx = (v: bigint | undefined) => (v === undefined ? 0 : Number(formatUnits(v, 18)));

export function usd(n: number, dp = 2) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function num(n: number, dp = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: dp });
}

export function ago(tsSec: number) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - tsSec);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function errMsg(e: unknown): string {
  const m = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? String(e);
  if (/user rejected|denied/i.test(m)) return "You rejected the request in your wallet.";
  return m.split("\n")[0].slice(0, 220);
}
