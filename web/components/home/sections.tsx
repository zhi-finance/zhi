"use client";

import { ArrowRight, ArrowUpRight, Plus } from "lucide-react";
import { motion, useInView, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRef, useState } from "react";
import { useReadContracts } from "wagmi";
import { SealMark } from "@/components/fx/seal-mark";
import { cx } from "@/components/ui";
import { addrUrl, injectiveTestnet } from "@/lib/chain";
import { fx } from "@/lib/format";
import { guardrailVaultAbi } from "@/lib/generated";
import { useBtcOracle } from "@/lib/live";

const DEMO_VAULT = "0x9e229Bd01D43b2Ce6774c67c3843B316285E8f26" as const;
const ease = [0.2, 0.8, 0.2, 1] as const;

function Heading({ n, label, children, aside }: { n: string; label: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-end">
      <div>
        <p className="label">{n} — {label}</p>
        <h2 className="mt-4 text-[clamp(2.2rem,4.6vw,3.8rem)] font-medium leading-[1.02] tracking-[-0.035em]">{children}</h2>
      </div>
      {aside && <div className="max-w-md text-muted lg:justify-self-end">{aside}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ 03 the rule lives in the vault */

const RULES = [
  { code: "FROZEN", sol: "if ((frozen || creditReduceOnly) && !it.reduceOnly)\n    return _skip(it, Skip.FROZEN);", plain: "A frozen vault only accepts trades that close positions. Nothing new opens until the owner waits out a 24-hour unfreeze." },
  { code: "BAD_RULETREE", sol: "if (!ruleTree[it.ruleTreeHash])\n    return _skip(it, Skip.BAD_RULETREE);", plain: "Every intent has to cite a rule tree the owner signed with EIP-712. A compromised harness can't make up a strategy." },
  { code: "NOTIONAL", sol: "uint256 notional = it.quantity * it.worstPrice / 1e18;\nif (notional > bounds.maxNotional)\n    return _skip(it, Skip.NOTIONAL);", plain: "Size is computed at the worst acceptable price, so the cap holds even if the market moves against the fill." },
  { code: "LEVERAGE", sol: "if (it.margin == 0 || notional * 100 / it.margin > bounds.maxLeverageX100)\n    return _skip(it, Skip.LEVERAGE);", plain: "Leverage is notional divided by the margin the intent posts. Zero margin is rejected outright." },
  { code: "PRICE_DEVIATION", sol: "(uint256 refPx, bool fresh) = _oracleRef(m);\nif (dev * 1e4 / refPx > bounds.maxDeviationBps)\n    return _skip(it, Skip.PRICE_DEVIATION);", plain: "The worst price is checked against Injective's own oracle precompile (0x67), so a market order can't fill far from fair value." },
  { code: "DRAWDOWN", sol: "if (_drawdownBreached(eq)) _freeze(eq);\n// anyone can enforce it:\nfunction poke() external { … }", plain: "Equity is read through the exchange precompile every time. Breach the daily limit and the vault freezes, even if the harness is offline, because anyone can call poke()." },
] as const;

export function RuleLives() {
  const [sel, setSel] = useState(3);
  const r = RULES[sel];
  return (
    <section className="mx-auto max-w-7xl px-5 pt-32">
      <Heading n="03" label="Guardrail Vault" aside={<>Not in the AI, not in a bot&apos;s config. In a Solidity contract on Injective that re-checks every order. Failing a check never reverts: the skip is logged and kept as evidence.</>}>
        The rule lives <span className="serif">in the vault.</span>
      </Heading>
      <div className="mt-12 grid overflow-hidden rounded-2xl border border-border lg:grid-cols-[2fr_3fr]">
        <ul className="divide-y divide-border border-b border-border lg:border-b-0 lg:border-r" role="tablist" aria-label="Vault checks">
          {RULES.map((x, i) => (
            <li key={x.code}>
              <button
                role="tab"
                aria-selected={i === sel}
                onClick={() => setSel(i)}
                onMouseEnter={() => setSel(i)}
                className={cx("flex w-full items-center gap-4 px-6 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", i === sel ? "bg-surface-2" : "hover:bg-surface")}
              >
                <span className="font-mono text-xs text-faint">0x{(i * 2 + 1).toString(16).padStart(2, "0")}</span>
                <span className={cx("font-mono text-sm", i === sel ? "text-foreground" : "text-muted")}>{x.code}</span>
                {i === sel && <ArrowRight aria-hidden className="ml-auto size-4 text-muted" />}
              </button>
            </li>
          ))}
        </ul>
        <div className="bg-surface p-6 sm:p-8" role="tabpanel">
          <p className="label">GuardrailVault.sol · executeIntent</p>
          <motion.pre key={r.code} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className="mt-4 overflow-x-auto rounded-lg border border-border bg-background p-5 font-mono text-[13px] leading-6 text-foreground">
            {r.sol}
          </motion.pre>
          <p className="mt-6 max-w-xl leading-relaxed text-muted">{r.plain}</p>
          <p className="label mt-6">on failure → TradeSkipped({r.code}) · returns false · nonce consumed</p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ 04 not a mockup */

export function LiveProof() {
  const oracle = useBtcOracle();
  const r = useReadContracts({
    contracts: (["equity", "frozen", "executions", "intentsSubmitted", "bounds", "agentId", "feeRecipient"] as const).map((functionName) => ({ address: DEMO_VAULT, abi: guardrailVaultAbi, functionName, chainId: injectiveTestnet.id })),
    query: { refetchInterval: 15_000 },
  });
  const d = r.data?.map((x) => (x.status === "success" ? x.result : undefined));
  const eq = d?.[0] as readonly [bigint, boolean] | undefined;
  const b = d?.[4] as readonly [bigint, number, number, number, number, number] | undefined;
  const rows: [string, string][] = [
    ["status", d === undefined ? "—" : d[1] ? "frozen" : "active"],
    ["agent (ERC-8004)", d?.[5] !== undefined ? `#${String(d[5])}` : "—"],
    ["equity", eq ? `$${fx(eq[0]).toFixed(2)}` : "—"],
    ["intents · executed", d ? `${String(d[3])} · ${String(d[2])}` : "—"],
    ["max position", b ? `$${fx(b[0]).toLocaleString()}` : "—"],
    ["max leverage", b ? `${b[1] / 100}×` : "—"],
    ["freezes at", b ? `−${b[2] / 100}% / day` : "—"],
    ["oracle band", b ? `±${(b[3] / 100).toFixed(2)}%` : "—"],
    ["fee recipient", d?.[6] ? String(d[6]) : "—"],
  ];
  return (
    <section className="mx-auto max-w-7xl px-5 pt-32">
      <Heading n="04" label="Live" aside="Every number below is read from Injective testnet as you load this page. Nothing here is mocked.">
        Not a mockup. <span className="text-muted">The chain, <span className="serif">right now.</span></span>
      </Heading>
      <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-[3fr_2fr]">
        <div className="bg-background p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-lg font-medium">Agent #72 · BTC/USDC perpetual</p>
            <a href={addrUrl(DEMO_VAULT)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-muted hover:text-foreground">
              vault {DEMO_VAULT.slice(0, 8)}…{DEMO_VAULT.slice(-6)} <ArrowUpRight aria-hidden className="size-3" />
            </a>
          </div>
          <dl className="mt-6 divide-y divide-border border-y border-border">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[10rem_1fr] gap-4 py-3 text-sm">
                <dt className="label self-center">{k}</dt>
                <dd className={cx("truncate font-mono tabular", k === "status" && v === "active" && "text-ok", k === "status" && v === "frozen" && "text-seal")}>{v}</dd>
              </div>
            ))}
          </dl>
          <Link href={`/agents/${DEMO_VAULT}`} className="group mt-6 inline-flex items-center gap-1.5 text-sm font-medium hover:underline">
            Open its evidence feed <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
        <div className="flex flex-col justify-between bg-background p-6 sm:p-8">
          <div>
            <p className="label">BTC / USDC · Injective oracle precompile 0x67</p>
            <p className="mt-4 font-mono text-[clamp(2.4rem,5vw,3.6rem)] leading-none tracking-tight tabular">
              {oracle.data ? `$${oracle.data.price.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : "—"}
            </p>
            <p className="mt-3 text-sm text-muted">The exact price the vault checks every order against. Chainlink Data Streams, delivered on-chain by Injective.</p>
          </div>
          <p className="label mt-10">block {oracle.data ? `#${oracle.data.block.toLocaleString()}` : "—"} · refreshes every 6s</p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ 05 capital */

const TIERS = [
  ["0", "< 600", "—", "0×", "—", "—"],
  ["1", "600–699", "30d · 100 trades", "1×", "$10,000", "12%"],
  ["2", "700–779", "60d · 200 trades", "2×", "$50,000", "10%"],
  ["3", "≥ 780", "90d · 300 trades", "3×", "$250,000", "8%"],
];

export function Capital() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20%" });
  const reduced = useReducedMotion();
  return (
    <section className="mx-auto max-w-7xl px-5 pt-32">
      <Heading n="05" label="Zhi Score" aside="Each day, an agent's fills and skips are hashed into a report and posted to its ERC-8004 identity. The score (300–850) can be recomputed by anyone and only counts after a 72-hour challenge window.">
        Behaviour becomes <span className="serif">capital.</span>
      </Heading>
      <div ref={ref} className="mt-12 overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">Credit tiers by Zhi Score</caption>
          <thead>
            <tr className="border-b border-border">
              {["Tier", "Zhi Score", "History", "Credit vs your capital", "Max credit", "Borrow APR"].map((h) => (
                <th key={h} scope="col" className="label px-6 py-4 text-left font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TIERS.map((t, i) => (
              <motion.tr
                key={t[0]}
                initial={reduced ? false : { opacity: 0, x: -8 }}
                animate={inView || reduced ? { opacity: 1, x: 0 } : {}}
                transition={{ duration: 0.5, delay: i * 0.08, ease }}
                className="border-b border-border last:border-b-0"
              >
                {t.map((c, j) => (
                  <td key={j} className={cx("px-6 py-5 font-mono tabular", j === 0 && "text-muted")}>{c}</td>
                ))}
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-5 max-w-2xl text-sm text-muted">
        Credit always sits behind your own capital. It is sized so a vault freezing at its drawdown limit loses at most half of your stake first: <span className="font-mono text-foreground">d(1 + k) ≤ 0.5</span>. Lenders aren&apos;t exposed unless the market gaps past that buffer.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ FAQ */

const FAQ = [
  ["Can the AI run off with my money?", "No. The AI only writes a rule tree, once, which you read and sign. It never holds a key. Only your vault can place orders, and it re-checks every limit itself."],
  ["What if someone hacks the harness?", "The harness key can only submit intents. It can't withdraw, change limits or unfreeze. At worst it trades badly inside your limits until you rotate the key."],
  ["Why Bittensor?", "Synth (subnet 50) is a network of competing models forecasting price distributions. Zhi checks the forecast agrees with each entry and that volatility is calm. If not, or if Synth is down, the trade is skipped."],
  ["What is poke()?", "A public emergency brake. If a vault has lost more than its daily limit, anyone can call poke() and it freezes, even when its harness is offline."],
  ["Where does my agent trade?", "On Injective's native on-chain orderbook, through the exchange precompile. No bridges, no AMMs, no exchange accounts."],
  ["Does this make money?", "Zhi makes agents safe and verifiable, not profitable. A bad strategy can still lose money, but never more than its limits allow."],
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="mx-auto max-w-7xl px-5 pt-32">
      <div className="grid gap-10 lg:grid-cols-[2fr_3fr]">
        <div>
          <p className="label">06 — Questions</p>
          <h2 className="mt-4 text-[clamp(2.2rem,4.6vw,3.8rem)] font-medium leading-[1.02] tracking-[-0.035em]">
            Straight <span className="serif">answers.</span>
          </h2>
        </div>
        <ul className="border-t border-border">
          {FAQ.map(([q, a], i) => (
            <li key={q} className="border-b border-border">
              <h3>
                <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} aria-controls={`faq-${i}`} className="flex min-h-16 w-full items-center justify-between gap-6 text-left text-[17px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {q}
                  <Plus aria-hidden className={cx("size-4 shrink-0 text-muted transition-transform duration-300", open === i && "rotate-45")} />
                </button>
              </h3>
              <motion.div id={`faq-${i}`} initial={false} animate={{ height: open === i ? "auto" : 0, opacity: open === i ? 1 : 0 }} transition={{ duration: 0.3, ease }} className="overflow-hidden">
                <p className="max-w-xl pb-6 leading-relaxed text-muted">{a}</p>
              </motion.div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ closing */

export function FinalCta() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-25%" });
  const reduced = useReducedMotion();
  return (
    <section className="mx-auto max-w-7xl px-5 py-32">
      <div ref={ref} className="relative overflow-hidden rounded-3xl border border-border bg-surface px-6 py-20 sm:px-16">
        <div aria-hidden className="dots absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_right,black,transparent_70%)]" />
        <div className="relative grid items-center gap-12 lg:grid-cols-[3fr_2fr]">
          <div>
            <h2 className="text-[clamp(2.6rem,6vw,5rem)] font-medium leading-[0.98] tracking-[-0.045em]">
              Sign once. <span className="serif">Sleep.</span>
            </h2>
            <ol className="mt-8 grid max-w-xl gap-4 text-sm sm:grid-cols-3">
              {[
                ["1", "Describe", "Type the idea or pick a template."],
                ["2", "Review & sign", "Read every rule; sign the hash."],
                ["3", "Launch", "Vault + identity go live on Injective."],
              ].map(([n, t, d]) => (
                <li key={n} className="border-t border-border-strong pt-3">
                  <p className="label">step {n}</p>
                  <p className="mt-1 font-medium">{t}</p>
                  <p className="mt-1 text-muted">{d}</p>
                </li>
              ))}
            </ol>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link href="/terminal" className="inline-flex h-12 items-center gap-2 rounded-full bg-foreground px-6 font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
                Launch an agent <ArrowRight aria-hidden className="size-4" />
              </Link>
              <Link href="/agents" className="text-sm text-muted hover:text-foreground">Browse live agents</Link>
            </div>
          </div>
          <div className="relative grid place-items-center">
            <motion.div
              initial={reduced ? false : { scale: 1.6, rotate: -14, opacity: 0 }}
              animate={inView || reduced ? { scale: 1, rotate: -6, opacity: 1 } : {}}
              transition={{ type: "spring", stiffness: 260, damping: 14, mass: 0.9, delay: 0.15 }}
            >
              <SealMark size={220} rough ink="var(--seal)" paper="var(--surface)" />
            </motion.div>
            <p className="label mt-6">approved · 0xd3cde509…83081f</p>
          </div>
        </div>
      </div>
    </section>
  );
}
