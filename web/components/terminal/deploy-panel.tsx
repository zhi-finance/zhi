"use client";

import { Check, Copy, Download, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { erc20Abi, parseEventLogs, parseUnits, type Hex } from "viem";
import { useConnection } from "wagmi";
import { readContract, signTypedData, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { ADDR, DEFAULT_HARNESS, FAUCET, IDENTITY_REGISTRY, USDC, USDC_DECIMALS, injectiveTestnet, tokenUrl, txUrl } from "@/lib/chain";
import { errMsg, short } from "@/lib/format";
import { guardrailVaultAbi, zhiFactoryAbi } from "@/lib/generated";
import type { MarketInfo } from "@/lib/markets";
import type { RuleTree } from "@/lib/ruletree/types";
import { wagmiConfig } from "../providers";
import { Button, ErrorBox, Field, inputCls } from "../ui";

type StepKey = "create" | "sign" | "fund";
type Status = "idle" | "pending" | "done" | "error" | "skipped";

export function vaultBoundsFor(tree: RuleTree, market: MarketInfo) {
  return {
    maxNotional: parseUnits(String(tree.sizing.maxNotionalUsd), 18),
    maxLeverageX100: Math.round(tree.sizing.leverage * 100),
    maxDailyDdBps: Math.round(tree.risk.maxDailyDrawdownPct * 100),
    // the vault's oracle band must admit the tree's worst price (oracle +/- slippage)
    maxDeviationBps: Math.max(tree.risk.maxSlippageBps, 50),
    cooldownSec: tree.risk.cooldownSec,
    maxOracleAgeSec: market.class === "crypto" ? 120 : 300,
  };
}

function agentCard(tree: RuleTree, hash: Hex, summary: string) {
  const card = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: `Zhi · ${tree.market.ticker} ${tree.entry.side}`,
    description: summary || "Zhi agent: signed rule tree, Synth-gated entries, Guardrail Vault enforcement.",
    services: [{ name: "zhi-harness", endpoint: "zhi.attestor.v1" }],
    zhi: { ruleTreeHash: hash, ruleTree: tree },
  };
  const bytes = new TextEncoder().encode(JSON.stringify(card));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return `data:application/json;base64,${btoa(bin)}`;
}

export function DeployPanel({ tree, hash, market, summary }: { tree: RuleTree; hash: Hex; market: MarketInfo; summary: string }) {
  const conn = useConnection();
  const [harness, setHarness] = useState<string>(DEFAULT_HARNESS ?? "");
  const [amount, setAmount] = useState("100");
  const [status, setStatus] = useState<Record<StepKey, Status>>({ create: "idle", sign: "idle", fund: "idle" });
  const [txs, setTxs] = useState<Partial<Record<StepKey, string>>>({});
  const [vault, setVault] = useState<Hex | null>(null);
  const [agentId, setAgentId] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const busy = Object.values(status).includes("pending");

  const harnessValid = /^0x[0-9a-fA-F]{40}$/.test(harness);
  const set = (k: StepKey, s: Status) => setStatus((p) => ({ ...p, [k]: s }));

  async function run() {
    setError(null);
    if (!ADDR.factory) return setError("Zhi is not deployed on this network yet (no factory address).");
    if (!conn.address) return setError("Connect a wallet first.");
    let v = vault;
    try {
      if (status.create !== "done") {
        set("create", "pending");
        const h = await writeContract(wagmiConfig, {
          address: ADDR.factory,
          abi: zhiFactoryAbi,
          functionName: "createAgent",
          chainId: injectiveTestnet.id,
          args: [
            {
              harness: harness as Hex,
              bounds: vaultBoundsFor(tree, market),
              markets: [
                {
                  marketId: tree.market.marketId as Hex,
                  isBinary: tree.market.type === "binary",
                  oracleType: market.oracleTypeId ?? 0,
                  oracleBase: market.oracleBase,
                  oracleQuote: market.oracleQuote,
                  minPriceTick: parseUnits(market.priceTickStr, 18),
                  minQtyTick: parseUnits(market.qtyTickStr, 18),
                },
              ],
              agentURI: agentCard(tree, hash, summary),
            },
          ],
        });
        setTxs((p) => ({ ...p, create: h }));
        const r = await waitForTransactionReceipt(wagmiConfig, { hash: h });
        const ev = parseEventLogs({ abi: zhiFactoryAbi, logs: r.logs, eventName: "AgentCreated" })[0];
        if (!ev) throw new Error("AgentCreated event not found in receipt");
        v = ev.args.vault;
        setVault(v);
        setAgentId(ev.args.agentId);
        try {
          localStorage.setItem(`zhi:tree:${v.toLowerCase()}`, JSON.stringify({ tree, hash, summary }));
        } catch {}
        set("create", "done");
      }
      if (!v) throw new Error("no vault");

      if (status.sign !== "done") {
        set("sign", "pending");
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
        const sig = await signTypedData(wagmiConfig, {
          domain: { name: "ZhiGuardrailVault", version: "1", chainId: injectiveTestnet.id, verifyingContract: v },
          types: { RuleTreeApproval: [{ name: "ruleTreeHash", type: "bytes32" }, { name: "deadline", type: "uint256" }] },
          primaryType: "RuleTreeApproval",
          message: { ruleTreeHash: hash, deadline },
        });
        const h = await writeContract(wagmiConfig, { address: v, abi: guardrailVaultAbi, functionName: "registerRuleTree", args: [hash, deadline, sig], chainId: injectiveTestnet.id });
        setTxs((p) => ({ ...p, sign: h }));
        await waitForTransactionReceipt(wagmiConfig, { hash: h });
        set("sign", "done");
      }

      const amt = amount.trim() ? parseUnits(amount.trim(), USDC_DECIMALS) : 0n;
      if (amt === 0n) {
        set("fund", "skipped");
      } else if (status.fund !== "done") {
        set("fund", "pending");
        const bal = await readContract(wagmiConfig, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [conn.address] });
        if (bal < amt) throw new Error(`Your wallet holds ${Number(bal) / 1e6} testnet USDC. Get more from the faucet, or deploy with 0 and fund later.`);
        const allowance = await readContract(wagmiConfig, { address: USDC, abi: erc20Abi, functionName: "allowance", args: [conn.address, v] });
        if (allowance < amt) {
          const a = await writeContract(wagmiConfig, { address: USDC, abi: erc20Abi, functionName: "approve", args: [v, amt], chainId: injectiveTestnet.id });
          await waitForTransactionReceipt(wagmiConfig, { hash: a });
        }
        const h = await writeContract(wagmiConfig, { address: v, abi: guardrailVaultAbi, functionName: "deposit", args: [amt, conn.address], chainId: injectiveTestnet.id });
        setTxs((p) => ({ ...p, fund: h }));
        await waitForTransactionReceipt(wagmiConfig, { hash: h });
        set("fund", "done");
      }
    } catch (e) {
      setStatus((p) => {
        const k = (Object.keys(p) as StepKey[]).find((x) => p[x] === "pending");
        return k ? { ...p, [k]: "error" } : p;
      });
      setError(errMsg(e));
    }
  }

  function download() {
    const blob = new Blob([JSON.stringify(tree, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ruletree-${hash.slice(2, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const cmd = vault ? `zhi run --tree ruletree-${hash.slice(2, 10)}.json --vault ${vault}` : "";
  const finished = status.sign === "done" && (status.fund === "done" || status.fund === "skipped");

  const steps: { k: StepKey; label: string; desc: string }[] = [
    { k: "create", label: "Create vault + ERC-8004 identity", desc: "Guardrail Vault clone with on-chain bounds; agent NFT minted to you, vault set as fee recipient" },
    { k: "sign", label: "Sign rule tree (EIP-712) and register", desc: `ruleTreeHash ${short(hash, 6)}` },
    { k: "fund", label: "Deposit first-loss capital", desc: "USDC moves into the vault's exchange subaccount" },
  ];

  return (
    <div className="space-y-4 p-4">
      {!ADDR.factory && <ErrorBox>Protocol contracts are not deployed on this network yet. Deploy with contracts/script/Deploy.s.sol, then run pnpm sync.</ErrorBox>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Harness address" htmlFor="harness" hint="The only key that can call executeIntent. It cannot withdraw or change limits." error={harness && !harnessValid ? "Enter a 0x address" : undefined}>
          <div className="flex gap-2">
            <input id="harness" className={inputCls + " font-mono"} value={harness} onChange={(e) => setHarness(e.target.value.trim())} placeholder="0x…" spellCheck={false} autoComplete="off" disabled={status.create === "done"} />
            {conn.address && status.create !== "done" && (
              <Button variant="secondary" type="button" onClick={() => setHarness(conn.address!)} className="shrink-0">
                Use mine
              </Button>
            )}
          </div>
        </Field>
        <Field label="Deposit (testnet USDC)" htmlFor="amount" hint={<>Needs testnet USDC. <a className="underline" href={FAUCET} target="_blank" rel="noreferrer">Faucet</a></>}>
          <input id="amount" className={inputCls + " font-mono"} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} disabled={status.fund === "done"} />
        </Field>
      </div>

      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={s.k} className="flex items-start gap-3 rounded-xl border border-border px-4 py-3">
            <span aria-hidden className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full font-mono text-[11px] ${status[s.k] === "done" ? "bg-ok text-background" : status[s.k] === "error" ? "bg-seal text-white" : "border border-border text-muted"}`}>
              {status[s.k] === "done" ? <Check className="size-3" /> : status[s.k] === "pending" ? <span className="size-2.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {s.label} <span className="sr-only">status: {status[s.k]}</span>
              </p>
              <p className="text-xs text-muted">{s.desc}</p>
            </div>
            {txs[s.k] && (
              <a href={txUrl(txs[s.k]!)} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 font-mono text-xs text-muted hover:text-foreground">
                {short(txs[s.k], 4)} <ExternalLink aria-hidden className="size-3" />
              </a>
            )}
          </li>
        ))}
      </ol>

      {error && <ErrorBox onRetry={busy ? undefined : run}>{error}</ErrorBox>}

      {!finished ? (
        <Button onClick={run} loading={busy} disabled={!conn.isConnected || !harnessValid || !ADDR.factory || !market.supported} className="w-full">
          {!conn.isConnected ? "Connect a wallet to deploy" : !market.supported ? "This market is not supported by USDC vaults" : status.create === "done" ? "Continue" : "Deploy agent"}
        </Button>
      ) : (
        <div className="fade-in space-y-3 rounded-md border border-ok/40 bg-ok-soft p-4">
          <p className="font-medium">Agent live on Injective testnet</p>
          <p className="text-sm text-muted">
            Vault <span className="font-mono">{short(vault!, 6)}</span>
            {agentId !== null && (
              <>
                {" · "}ERC-8004 agent{" "}
                <a className="font-mono underline" href={tokenUrl(IDENTITY_REGISTRY, agentId)} target="_blank" rel="noreferrer">
                  #{agentId.toString()}
                </a>
              </>
            )}
          </p>
          <p className="text-sm">Start the harness with this rule tree:</p>
          <div className="flex items-center gap-2 rounded-md border border-border bg-background p-2">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs">{cmd}</code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(cmd).then(() => setCopied(true))}
              className="grid size-9 shrink-0 place-items-center rounded hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Copy command"
            >
              {copied ? <Check aria-hidden className="size-4 text-ok" /> : <Copy aria-hidden className="size-4" />}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={download}>
              <Download aria-hidden className="size-4" /> Download rule tree
            </Button>
            <Link href={`/agents/${vault}`} className="inline-flex min-h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-ok-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Open agent
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
