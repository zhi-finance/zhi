import { createPublicClient, decodeEventLog, http, type Hex } from "viem";
import { guardrailVaultAbi } from "./generated";
import { EXPLORER_API, RPC, SKIP_REASONS, injectiveTestnet } from "./chain";

export const publicClient = createPublicClient({ chain: injectiveTestnet, transport: http(RPC) });

export type VaultEvent =
  | { kind: "exec"; block: number; tx: string; ts?: number; nonce: bigint; isBuy: boolean; reduceOnly: boolean; quantity: bigint; worstPrice: bigint; notional: bigint; leverageX100: bigint; synthHash: Hex; intentHash: Hex }
  | { kind: "skip"; block: number; tx: string; ts?: number; nonce: bigint; reason: string; synthHash: Hex; intentHash: Hex }
  | { kind: "frozen"; block: number; tx: string; ts?: number; equity: bigint; epochStartEquity: bigint }
  | { kind: "other"; block: number; tx: string; ts?: number; name: string; args: Record<string, unknown> };

function decode(topics: Hex[], data: Hex, block: number, tx: string, ts?: number): VaultEvent | null {
  try {
    const ev = decodeEventLog({ abi: guardrailVaultAbi, topics: topics as [Hex, ...Hex[]], data });
    const a = ev.args as unknown as Record<string, never>;
    if (ev.eventName === "ExecutionLogged") return { kind: "exec", block, tx, ts, ...(a as object) } as VaultEvent;
    if (ev.eventName === "TradeSkipped") return { kind: "skip", block, tx, ts, nonce: a.nonce, reason: SKIP_REASONS[Number(a.reason)] ?? "UNKNOWN", synthHash: a.synthHash, intentHash: a.intentHash };
    if (ev.eventName === "Frozen") return { kind: "frozen", block, tx, ts, equity: a.equity, epochStartEquity: a.epochStartEquity };
    return { kind: "other", block, tx, ts, name: ev.eventName, args: a };
  } catch {
    return null;
  }
}

interface BlockscoutLog { topics: (Hex | null)[]; data: Hex; block_number: number; transaction_hash: string; block_timestamp?: string }

/** Full event history: Blockscout first (no range limit), chunked RPC as a fallback. */
export async function fetchVaultEvents(vault: Hex, maxPages = 5): Promise<VaultEvent[]> {
  try {
    const out: VaultEvent[] = [];
    let params = "";
    for (let p = 0; p < maxPages; p++) {
      const r = await fetch(`${EXPLORER_API}/addresses/${vault}/logs${params}`, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`blockscout ${r.status}`);
      const j = (await r.json()) as { items: BlockscoutLog[]; next_page_params: Record<string, string> | null };
      for (const l of j.items) {
        const ts = l.block_timestamp ? Math.floor(Date.parse(l.block_timestamp) / 1000) : undefined;
        const e = decode(l.topics.filter(Boolean) as Hex[], l.data, l.block_number, l.transaction_hash, ts);
        if (e) out.push(e);
      }
      if (!j.next_page_params) break;
      params = "?" + new URLSearchParams(j.next_page_params).toString();
    }
    return out;
  } catch {
    const latest = await publicClient.getBlockNumber();
    const out: VaultEvent[] = [];
    for (let i = 0n; i < 5n; i++) {
      const to = latest - i * 10_000n;
      const logs = await publicClient.getLogs({ address: vault, fromBlock: to - 9_999n, toBlock: to });
      for (const l of logs.reverse()) {
        const e = decode(l.topics as Hex[], l.data, Number(l.blockNumber), l.transactionHash ?? "");
        if (e) out.push(e);
      }
    }
    return out;
  }
}
