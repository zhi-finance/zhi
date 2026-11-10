import type { Hex } from "viem";
import { ADDR, IDENTITY_REGISTRY } from "./chain";
import { publicClient } from "./events";
import { fx } from "./format";
import { guardrailVaultAbi, zhiAttestorAbi, zhiFactoryAbi } from "./generated";
import type { RuleTree } from "./ruletree/types";

export interface AgentRow {
  vault: Hex;
  operator: Hex;
  agentId: bigint;
  createdAt: number;
  equity: number | null;
  epochStartEquity: number;
  frozen: boolean;
  executions: number;
  intents: number;
  adherenceSkips: number;
  score: number;
  closedTrades: number;
}

const vaultReads = ["equity", "epochStartEquity", "frozen", "executions", "intentsSubmitted", "adherenceSkips"] as const;

export async function fetchAgents(): Promise<AgentRow[]> {
  if (!ADDR.factory) return [];
  const list = await publicClient.readContract({ address: ADDR.factory, abi: zhiFactoryAbi, functionName: "agents", args: [0n, 500n] });
  if (list.length === 0) return [];
  const calls = list.flatMap((a) => vaultReads.map((fn) => ({ address: a.vault, abi: guardrailVaultAbi, functionName: fn }) as const));
  const scoreCalls = ADDR.attestor ? list.map((a) => ({ address: ADDR.attestor!, abi: zhiAttestorAbi, functionName: "scoreOf", args: [a.agentId] }) as const) : [];
  const [res, scores] = await Promise.all([
    publicClient.multicall({ contracts: calls, allowFailure: true }),
    scoreCalls.length ? publicClient.multicall({ contracts: scoreCalls, allowFailure: true }) : Promise.resolve([]),
  ]);
  return list.map((a, i) => {
    const r = res.slice(i * vaultReads.length, (i + 1) * vaultReads.length).map((x) => (x.status === "success" ? x.result : undefined));
    const eq = r[0] as readonly [bigint, boolean] | undefined;
    const s = (scores[i]?.status === "success" ? scores[i].result : undefined) as readonly [number, number, number] | undefined;
    return {
      vault: a.vault,
      operator: a.operator,
      agentId: a.agentId,
      createdAt: Number(a.createdAt),
      equity: eq && eq[1] ? fx(eq[0]) : null,
      epochStartEquity: fx(r[1] as bigint | undefined),
      frozen: Boolean(r[2]),
      executions: Number(r[3] ?? 0),
      intents: Number(r[4] ?? 0),
      adherenceSkips: Number(r[5] ?? 0),
      score: s ? Number(s[0]) : 0,
      closedTrades: s ? Number(s[2]) : 0,
    };
  });
}

export interface AgentCard {
  name?: string;
  description?: string;
  zhi?: { ruleTreeHash: Hex; ruleTree: RuleTree };
}

const identityAbi = [
  { type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "string" }] },
] as const;

/** The ERC-8004 agent card. Zhi writes it as a data: URI holding the signed rule tree. */
export async function fetchAgentCard(agentId: bigint): Promise<AgentCard | null> {
  try {
    const uri = await publicClient.readContract({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: "tokenURI", args: [agentId] });
    if (uri.startsWith("data:application/json;base64,")) {
      const bin = atob(uri.slice("data:application/json;base64,".length));
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    }
    if (uri.startsWith("http")) return await (await fetch(uri)).json();
    return null;
  } catch {
    return null;
  }
}
