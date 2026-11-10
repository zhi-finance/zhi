"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, ShieldCheck, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { erc20Abi, parseUnits, type Hex } from "viem";
import { useConnection, useReadContract, useReadContracts } from "wagmi";
import { readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { fetchAgentCard } from "@/lib/agents";
import { ADDR, IDENTITY_REGISTRY, INVARIANT_SKIPS, USDC, USDC_DECIMALS, addrUrl, injectiveTestnet, tokenUrl, txUrl } from "@/lib/chain";
import { fetchVaultEvents, type VaultEvent } from "@/lib/events";
import { ago, errMsg, fx, num, short, usd } from "@/lib/format";
import { guardrailVaultAbi, zhiAttestorAbi } from "@/lib/generated";
import { hashRuleTree } from "@/lib/ruletree/canonical";
import { wagmiConfig } from "./providers";
import { describeCondition } from "./terminal/tree-preview";
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Field, Skeleton, Stat, inputCls } from "./ui";

const fns = [
  "owner", "harness", "agentId", "subaccountId", "feeRecipient", "equity", "epochStartEquity", "frozen", "unfreezeEta", "creditReduceOnly",
  "nextNonce", "executions", "intentsSubmitted", "adherenceSkips", "bounds", "lastEntryAt", "debt", "totalShares", "isFlat",
] as const;

export function AgentView({ vault }: { vault: Hex }) {
  const conn = useConnection();
  const reads = useReadContracts({
    contracts: fns.map((functionName) => ({ address: vault, abi: guardrailVaultAbi, functionName, chainId: injectiveTestnet.id })),
    query: { refetchInterval: 10_000 },
  });
  const v = Object.fromEntries(fns.map((f, i) => [f, reads.data?.[i]?.status === "success" ? reads.data[i].result : undefined])) as Record<(typeof fns)[number], unknown>;
  const agentId = v.agentId as bigint | undefined;

  const card = useQuery({ queryKey: ["card", agentId?.toString()], queryFn: () => fetchAgentCard(agentId!), enabled: agentId !== undefined });
  const events = useQuery({ queryKey: ["events", vault], queryFn: () => fetchVaultEvents(vault), refetchInterval: 20_000 });
  const ruleHash = card.data?.zhi?.ruleTreeHash;
  const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
  const reg = useReadContract({ address: vault, abi: guardrailVaultAbi, functionName: "ruleTree", args: [ruleHash ?? ZERO32], chainId: injectiveTestnet.id, query: { enabled: !!ruleHash } });
  const sh = useReadContract({ address: vault, abi: guardrailVaultAbi, functionName: "shares", args: [conn.address ?? "0x0000000000000000000000000000000000000000"], chainId: injectiveTestnet.id, query: { enabled: !!conn.address, refetchInterval: 15_000 } });
  const sc = useReadContract({ address: ADDR.attestor, abi: zhiAttestorAbi, functionName: "scoreOf", args: [agentId ?? 0n], chainId: injectiveTestnet.id, query: { enabled: !!ADDR.attestor && agentId !== undefined, refetchInterval: 60_000 } });
  const registered = reg.data;
  const myShares = sh.data ?? 0n;
  const score = sc.data;

  if (reads.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (reads.error || v.owner === undefined) {
    return <ErrorBox onRetry={() => reads.refetch()}>This address is not a Zhi Guardrail Vault on Injective testnet, or the RPC is unreachable.</ErrorBox>;
  }

  const [eqRaw, eqOk] = (v.equity as readonly [bigint, boolean]) ?? [0n, false];
  const equity = eqOk ? fx(eqRaw) : null;
  const start = fx(v.epochStartEquity as bigint);
  const dd = equity !== null && start > 0 && equity < start ? ((start - equity) / start) * 100 : 0;
  const b = v.bounds as readonly [bigint, number, number, number, number, number];
  const ddLimit = b[2] / 100;
  const frozen = Boolean(v.frozen);
  const isOwner = conn.address?.toLowerCase() === (v.owner as string).toLowerCase();
  const intents = Number(v.intentsSubmitted ?? 0);
  const adherence = intents ? (1 - Number(v.adherenceSkips) / intents) * 100 : 100;
  const tree = card.data?.zhi?.ruleTree;
  const treeHashOk = tree && ruleHash ? hashRuleTree(tree) === ruleHash : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[clamp(2rem,4vw,3rem)] font-medium tracking-[-0.035em]">{card.data?.name ?? `Agent #${agentId?.toString()}`}</h1>
            {frozen ? <Badge tone="danger">frozen</Badge> : v.creditReduceOnly ? <Badge tone="warn">reduce-only</Badge> : <Badge tone="accent">active</Badge>}
            {tree?.synthGate ? <Badge tone="accent">Synth SN50 verified</Badge> : tree ? <Badge tone="warn">unverified</Badge> : null}
          </div>
          <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-xs text-muted">
            <a className="hover:text-foreground" href={addrUrl(vault)} target="_blank" rel="noreferrer">vault {short(vault, 6)}</a>
            <span>operator {short(v.owner as string)}</span>
            <span>harness {short(v.harness as string)}</span>
            {agentId !== undefined && (
              <a className="hover:text-foreground" href={tokenUrl(IDENTITY_REGISTRY, agentId)} target="_blank" rel="noreferrer">ERC-8004 #{agentId.toString()}</a>
            )}
          </p>
          <p className="mt-1 font-mono text-xs text-muted">fee recipient {v.feeRecipient as string}</p>
        </div>
        <PokeButton vault={vault} frozen={frozen} breach={dd >= ddLimit} />
      </div>

      <Card>
        <dl className="grid grid-cols-2 gap-6 p-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Equity" value={equity === null ? "unreadable" : usd(equity)} hint={`epoch start ${usd(start)}`} />
          <Stat label="Daily drawdown" value={`${dd.toFixed(2)}%`} hint={`freezes at ${ddLimit}%`} tone={dd >= ddLimit * 0.75 ? "danger" : undefined} />
          <Stat label="Executed / intents" value={`${Number(v.executions)} / ${intents}`} hint={`next nonce ${String(v.nextNonce)}`} />
          <Stat label="Contract adherence" value={`${adherence.toFixed(1)}%`} hint={`${Number(v.adherenceSkips)} invariant skips`} />
          <Stat label="Zhi Score" value={score && score[0] ? score[0] : "pending"} hint={score && score[0] ? `${score[1]}d · ${score[2]} trades` : "after first attested epoch + 72h"} tone="accent" />
          <Stat label="Last entry" value={Number(v.lastEntryAt) ? ago(Number(v.lastEntryAt)) : "never"} hint={v.isFlat ? "flat" : "position open"} />
        </dl>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Card>
          <CardHeader title="Evidence" desc="Every execution and every skip, straight from vault events. Nothing here is self-reported." action={<Badge>{events.data?.length ?? 0} events</Badge>} />
          <EventFeed q={events} />
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="On-chain bounds"
              desc="Tighten instantly; loosen only after a 24h timelock."
            />
            <dl className="grid grid-cols-2 gap-4 p-4 text-sm">
              <Stat label="Max notional" value={usd(fx(b[0]), 0)} />
              <Stat label="Max leverage" value={`${b[1] / 100}×`} />
              <Stat label="Daily DD freeze" value={`${b[2] / 100}%`} />
              <Stat label="Oracle deviation" value={`${b[3]} bps`} />
              <Stat label="Cooldown" value={`${b[4]} s`} />
              <Stat label="Oracle max age" value={`${b[5]} s`} />
            </dl>
          </Card>

          <Card>
            <CardHeader
              title="Signed rule tree"
              action={
                registered === undefined ? null : registered && treeHashOk ? (
                  <Badge tone="accent"><ShieldCheck aria-hidden className="size-3" /> signed + registered</Badge>
                ) : (
                  <Badge tone="danger">hash mismatch</Badge>
                )
              }
            />
            {card.isLoading ? (
              <div className="p-4"><Skeleton className="h-32 w-full" /></div>
            ) : tree ? (
              <div className="space-y-2 p-4 text-sm">
                <p className="text-muted">{card.data?.description}</p>
                <p><span className="text-muted">Market</span> <span className="font-mono">{tree.market.ticker}</span> · {tree.entry.side} · {tree.timeframe}</p>
                <ul className="space-y-1 font-mono text-xs">
                  {tree.entry.all.map((c, i) => (
                    <li key={i} className="rounded-lg border border-border bg-background px-3 py-1.5">{describeCondition(c)}</li>
                  ))}
                </ul>
                {tree.synthGate && (
                  <p className="text-xs text-muted">
                    Synth gate: P(direction) ≥ {tree.synthGate.minDirectionProb}, 90% band ≤ {tree.synthGate.maxBand90Bps} bps ({tree.synthGate.asset} {tree.synthGate.horizon})
                  </p>
                )}
                <p className="text-xs text-muted">
                  {tree.sizing.leverage}× · TP {tree.exit.takeProfitPct}% · SL {tree.exit.stopLossPct}% · max notional {usd(tree.sizing.maxNotionalUsd, 0)}
                </p>
                <p className="break-all font-mono text-[11px] text-muted">{ruleHash}</p>
              </div>
            ) : (
              <Empty title="No agent card">This agent was registered without a Zhi card. Its rule tree hash is still enforced by the vault.</Empty>
            )}
          </Card>

          {isOwner && <OwnerActions vault={vault} frozen={frozen} flat={Boolean(v.isFlat)} debt={v.debt as bigint} myShares={myShares} unfreezeEta={Number(v.unfreezeEta ?? 0)} onDone={() => reads.refetch()} />}
        </div>
      </div>
    </div>
  );
}

function EventFeed({ q }: { q: ReturnType<typeof useQuery<VaultEvent[]>> }) {
  if (q.isLoading) return <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  if (q.error) return <div className="p-4"><ErrorBox onRetry={() => q.refetch()}>Could not load events: {(q.error as Error).message}</ErrorBox></div>;
  const list = (q.data ?? []).filter((e) => e.kind !== "other" || ["RuleTreeRegistered", "Deposited", "Withdrawn", "Unfrozen", "BoundsApplied", "BoundsTightened", "EpochRolled", "ExitOrder"].includes(e.name));
  if (list.length === 0) return <Empty title="No activity yet">Once the harness submits intents, every execution and skip appears here with its Synth forecast hash.</Empty>;
  return (
    <ol className="max-h-[560px] divide-y divide-border overflow-y-auto">
      {list.map((e, i) => (
        <li key={`${e.tx}-${i}`} className="flex items-start gap-3 px-4 py-2.5">
          <EventBadge e={e} />
          <div className="min-w-0 flex-1 text-sm">
            <EventBody e={e} />
          </div>
          <a href={txUrl(e.tx)} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted hover:text-foreground">
            {e.ts ? ago(e.ts) : `#${e.block}`} <ExternalLink aria-hidden className="size-3" />
          </a>
        </li>
      ))}
    </ol>
  );
}

function EventBadge({ e }: { e: VaultEvent }) {
  if (e.kind === "exec") return <Badge tone="accent">{e.reduceOnly ? "exit" : e.isBuy ? "long" : "short"}</Badge>;
  if (e.kind === "skip") return <Badge tone={INVARIANT_SKIPS.has(e.reason) ? "danger" : "warn"}>skip</Badge>;
  if (e.kind === "frozen") return <Badge tone="danger">frozen</Badge>;
  return <Badge>{e.name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}</Badge>;
}

function EventBody({ e }: { e: VaultEvent }) {
  if (e.kind === "exec")
    return (
      <>
        <span className="font-mono tabular">{num(fx(e.quantity), 4)} @ ≤ {usd(fx(e.worstPrice))}</span>
        <span className="text-muted"> · notional {usd(fx(e.notional))}{!e.reduceOnly && ` · ${Number(e.leverageX100) / 100}×`} · nonce {e.nonce.toString()}</span>
        {e.synthHash !== "0x0000000000000000000000000000000000000000000000000000000000000000" && <span className="block truncate font-mono text-[11px] text-muted">synth {e.synthHash}</span>}
      </>
    );
  if (e.kind === "skip")
    return (
      <>
        <span className="font-mono">{e.reason}</span>
        <span className="text-muted"> · nonce {e.nonce.toString()}{INVARIANT_SKIPS.has(e.reason) ? " · counts against adherence" : ""}</span>
        {e.synthHash !== "0x0000000000000000000000000000000000000000000000000000000000000000" && <span className="block truncate font-mono text-[11px] text-muted">synth {e.synthHash}</span>}
      </>
    );
  if (e.kind === "frozen") return <span>Drawdown breach: equity {usd(fx(e.equity))} vs epoch start {usd(fx(e.epochStartEquity))}</span>;
  return <span className="text-muted">{e.name}</span>;
}

function PokeButton({ vault, frozen, breach }: { vault: Hex; frozen: boolean; breach: boolean }) {
  const conn = useConnection();
  const [state, setState] = useState<{ busy: boolean; msg?: string; err?: string }>({ busy: false });
  async function poke() {
    setState({ busy: true });
    try {
      const h = await writeContract(wagmiConfig, { address: vault, abi: guardrailVaultAbi, functionName: "poke", chainId: injectiveTestnet.id });
      await waitForTransactionReceipt(wagmiConfig, { hash: h });
      setState({ busy: false, msg: "poke() confirmed" });
    } catch (e) {
      setState({ busy: false, err: errMsg(e) });
    }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant={breach && !frozen ? "danger" : "secondary"} onClick={poke} loading={state.busy} disabled={!conn.isConnected || frozen} title="Anyone can enforce the drawdown freeze">
        <Zap aria-hidden className="size-4" /> {frozen ? "Vault frozen" : "poke()"}
      </Button>
      <p className="max-w-60 text-right text-xs text-muted">{state.err ? <span className="text-seal">{state.err}</span> : state.msg ?? "Permissionless circuit breaker. Any wallet can call it."}</p>
    </div>
  );
}

function OwnerActions({ vault, frozen, flat, debt, myShares, unfreezeEta, onDone }: { vault: Hex; frozen: boolean; flat: boolean; debt: bigint; myShares: bigint; unfreezeEta: number; onDone: () => void }) {
  const conn = useConnection();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function tx(label: string, fn: () => Promise<Hex>) {
    setBusy(label);
    setErr(null);
    try {
      const h = await fn();
      await waitForTransactionReceipt(wagmiConfig, { hash: h });
      onDone();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function deposit() {
    const amt = parseUnits(amount || "0", USDC_DECIMALS);
    if (amt === 0n) return setErr("Enter an amount");
    await tx("deposit", async () => {
      const allowance = await readContract(wagmiConfig, { address: USDC, abi: erc20Abi, functionName: "allowance", args: [conn.address!, vault] });
      if (allowance < amt) {
        const a = await writeContract(wagmiConfig, { address: USDC, abi: erc20Abi, functionName: "approve", args: [vault, amt], chainId: injectiveTestnet.id });
        await waitForTransactionReceipt(wagmiConfig, { hash: a });
      }
      return writeContract(wagmiConfig, { address: vault, abi: guardrailVaultAbi, functionName: "deposit", args: [amt, conn.address!], chainId: injectiveTestnet.id });
    });
  }

  const now = useNowSec();
  return (
    <Card>
      <CardHeader title="Operator" desc="Only the owner sees this. The harness key can never do any of it." />
      <div className="space-y-4 p-4">
        <Field label="Deposit testnet USDC" htmlFor="dep">
          <div className="flex gap-2">
            <input id="dep" className={inputCls + " font-mono"} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="100" />
            <Button onClick={deposit} loading={busy === "deposit"} disabled={frozen || !!busy}>Deposit</Button>
          </div>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!flat || debt > 0n || myShares === 0n || !!busy}
            loading={busy === "withdraw"}
            title={!flat ? "Withdrawals need a flat vault" : debt > 0n ? "Repay credit first" : undefined}
            onClick={() => tx("withdraw", () => writeContract(wagmiConfig, { address: vault, abi: guardrailVaultAbi, functionName: "withdraw", args: [myShares, conn.address!], chainId: injectiveTestnet.id }))}
          >
            Withdraw all
          </Button>
          {frozen && (
            unfreezeEta === 0 ? (
              <Button variant="secondary" loading={busy === "req"} disabled={!!busy} onClick={() => tx("req", () => writeContract(wagmiConfig, { address: vault, abi: guardrailVaultAbi, functionName: "requestUnfreeze", chainId: injectiveTestnet.id }))}>
                Request unfreeze (24h)
              </Button>
            ) : (
              <Button variant="secondary" loading={busy === "unf"} disabled={!!busy || now < unfreezeEta} onClick={() => tx("unf", () => writeContract(wagmiConfig, { address: vault, abi: guardrailVaultAbi, functionName: "unfreeze", chainId: injectiveTestnet.id }))}>
                {now < unfreezeEta ? `Unfreeze in ${Math.ceil((unfreezeEta - now) / 3600)}h` : "Unfreeze"}
              </Button>
            )
          )}
        </div>
        {err && <ErrorBox>{err}</ErrorBox>}
      </div>
    </Card>
  );
}

/** Wall clock in seconds, updated every 30s (kept out of render for purity). */
function useNowSec() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
