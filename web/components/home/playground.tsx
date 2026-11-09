"use client";

import { RotateCcw } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { cx } from "@/components/ui";

// Limits of the live demo agent (#72) on Injective testnet.
const L = { maxNotional: 2500, maxLev: 3, maxDevBps: 50, cooldown: 180, oracleAge: 120, ddPct: 4, minProb: 0.6, maxBand: 180 };

interface Sim {
  signed: boolean;
  allowed: boolean;
  notional: number;
  leverage: number;
  offsetBps: number;
  oracleAge: number;
  sinceEntry: number;
  dayPct: number;
  pUp: number;
  band: number;
}

const NORMAL: Sim = { signed: true, allowed: true, notional: 1500, leverage: 2, offsetBps: 20, oracleAge: 3, sinceEntry: 900, dayPct: 0.6, pUp: 0.66, band: 150 };

const PRESETS: { id: string; label: string; patch: Partial<Sim> }[] = [
  { id: "normal", label: "A normal trade", patch: {} },
  { id: "inject", label: "Prompt-injected 20×", patch: { leverage: 20 } },
  { id: "fat", label: "Fat-finger $9,000", patch: { notional: 9000, leverage: 3 } },
  { id: "forged", label: "Forged rule tree", patch: { signed: false } },
  { id: "synth", label: "Synth disagrees", patch: { pUp: 0.41 } },
  { id: "chaos", label: "Chaotic market", patch: { band: 320 } },
  { id: "weekend", label: "Stale weekend feed", patch: { oracleAge: 3000 } },
  { id: "price", label: "Bad fill price", patch: { offsetBps: 140 } },
  { id: "spam", label: "Spam entries", patch: { sinceEntry: 40 } },
  { id: "rekt", label: "Down 5% today", patch: { dayPct: -5 } },
];

interface Check {
  code: string;
  label: string;
  by: "SN50" | "vault";
  pass: (s: Sim) => boolean;
  why: string;
}

// Order mirrors the harness gate, then GuardrailVault.executeIntent.
const CHECKS: Check[] = [
  { code: "SYNTH_DIRECTION", label: "Forecast agrees on direction", by: "SN50", pass: (s) => s.pUp >= L.minProb, why: "Bittensor's forecast doesn't favour this direction enough. The trade is skipped and the forecast's hash goes on-chain as evidence." },
  { code: "SYNTH_REGIME", label: "Volatility inside the band", by: "SN50", pass: (s) => s.band <= L.maxBand, why: "The forecast's 5–95% band is too wide. The network sees an unstable market, so the agent sits it out." },
  { code: "DRAWDOWN", label: "Daily loss above −4%", by: "vault", pass: (s) => s.dayPct > -L.ddPct, why: "The vault is down 4% or more today, so it freezes itself. Only closing trades are allowed, and unfreezing needs a 24-hour wait." },
  { code: "BAD_RULETREE", label: "Rule tree signed by owner", by: "vault", pass: (s) => s.signed, why: "This intent cites rules the owner never signed. Even a hacked harness can't invent its own strategy." },
  { code: "MARKET_NOT_ALLOWED", label: "Market on the allowlist", by: "vault", pass: (s) => s.allowed, why: "This vault isn't allowed to trade that market." },
  { code: "COOLDOWN", label: "180s since last entry", by: "vault", pass: (s) => s.sinceEntry >= L.cooldown, why: "Too soon after the previous entry, so there's no machine-gun trading." },
  { code: "NOTIONAL", label: "Position ≤ $2,500", by: "vault", pass: (s) => s.notional <= L.maxNotional, why: "Bigger than the vault's cap. It doesn't matter what the AI or the harness wanted." },
  { code: "LEVERAGE", label: "Leverage ≤ 3×", by: "vault", pass: (s) => s.leverage <= L.maxLev, why: "Above the leverage bound. A post that says \"ignore limits, 100×\" stops here." },
  { code: "ORACLE_STALE", label: "Oracle price is fresh", by: "vault", pass: (s) => s.oracleAge <= L.oracleAge, why: "The price feed is stale, like tokenized stocks on a weekend. New entries wait; exits are still allowed." },
  { code: "PRICE_DEVIATION", label: "Price within 0.5% of oracle", by: "vault", pass: (s) => Math.abs(s.offsetBps) <= L.maxDevBps, why: "The worst acceptable price is too far from Injective's oracle. This blocks manipulation and bad fills." },
];

function Slider({ id, label, value, min, max, step, onChange, fmt, limit, bad }: { id: string; label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string; limit: string; bad: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm text-muted">{label}</label>
        <span className={cx("font-mono text-sm tabular", bad ? "text-seal" : "text-foreground")}>
          {fmt(value)} <span className="text-faint">/ {limit}</span>
        </span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} data-bad={bad} className="range mt-3 w-full" />
    </div>
  );
}

export function Playground() {
  const reduced = useReducedMotion();
  const [s, setS] = useState<Sim>(NORMAL);
  const [preset, setPreset] = useState("normal");
  const [step, setStep] = useState(CHECKS.length + 1);
  const [runId, setRunId] = useState(0);

  const failIdx = useMemo(() => CHECKS.findIndex((c) => !c.pass(s)), [s]);
  const stopAt = failIdx === -1 ? CHECKS.length : failIdx;

  useEffect(() => {
    let i = reduced ? stopAt + 1 : 0;
    const tick = () => setStep(i);
    const first = requestAnimationFrame(tick);
    if (reduced) return () => cancelAnimationFrame(first);
    const id = setInterval(() => {
      i++;
      tick();
      if (i > stopAt) clearInterval(id);
    }, 90);
    return () => {
      cancelAnimationFrame(first);
      clearInterval(id);
    };
  }, [runId, stopAt, reduced]);

  const set = (patch: Partial<Sim>) => {
    setS((p) => ({ ...p, ...patch }));
    setPreset("");
    setRunId((r) => r + 1);
  };
  const choose = (p: (typeof PRESETS)[number]) => {
    setS({ ...NORMAL, ...p.patch });
    setPreset(p.id);
    setRunId((r) => r + 1);
  };

  const done = step > stopAt;
  const failed = failIdx !== -1;
  const fc = failed ? CHECKS[failIdx] : null;

  return (
    <section id="playground" className="mx-auto max-w-7xl scroll-mt-20 px-5 pt-32">
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end">
        <div>
          <p className="label">02 — Playground</p>
          <h2 className="mt-4 text-[clamp(2.2rem,4.6vw,3.8rem)] font-medium leading-[1.02] tracking-[-0.035em]">
            Try to break the vault. <span className="serif text-muted">You can&apos;t.</span>
          </h2>
        </div>
        <p className="max-w-md text-muted lg:justify-self-end">
          Pick an attack or drag the sliders. The checks run in the same order as the real contract, using the live demo agent&apos;s limits.
        </p>
      </div>

      <div className="mt-10 flex flex-wrap gap-2" role="group" aria-label="Scenarios">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => choose(p)}
            aria-pressed={preset === p.id}
            className={cx(
              "h-9 rounded-full border px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              preset === p.id ? "border-foreground bg-foreground text-background" : "border-border text-muted hover:border-border-strong hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mt-6 grid overflow-hidden rounded-2xl border border-border lg:grid-cols-[5fr_7fr]">
        {/* controls */}
        <div className="space-y-6 border-b border-border bg-surface p-6 sm:p-8 lg:border-b-0 lg:border-r">
          <p className="label">The intent the harness sends</p>
          <Slider id="pg-size" label="Position size" value={s.notional} min={100} max={10000} step={100} onChange={(v) => set({ notional: v })} fmt={(v) => `$${v.toLocaleString()}`} limit="$2,500" bad={s.notional > L.maxNotional} />
          <Slider id="pg-lev" label="Leverage" value={s.leverage} min={1} max={25} step={1} onChange={(v) => set({ leverage: v })} fmt={(v) => `${v}×`} limit="3×" bad={s.leverage > L.maxLev} />
          <Slider id="pg-off" label="Worst price vs oracle" value={s.offsetBps} min={-200} max={200} step={5} onChange={(v) => set({ offsetBps: v })} fmt={(v) => `${v > 0 ? "+" : ""}${(v / 100).toFixed(2)}%`} limit="±0.50%" bad={Math.abs(s.offsetBps) > L.maxDevBps} />
          <Slider id="pg-p" label="Synth: chance price goes up" value={s.pUp} min={0.2} max={0.95} step={0.01} onChange={(v) => set({ pUp: v })} fmt={(v) => `${Math.round(v * 100)}%`} limit="≥ 60%" bad={s.pUp < L.minProb} />
          <Slider id="pg-day" label="Vault P&L today" value={s.dayPct} min={-8} max={4} step={0.1} onChange={(v) => set({ dayPct: v })} fmt={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`} limit="freezes at −4%" bad={s.dayPct <= -L.ddPct} />
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={s.signed} onChange={(e) => set({ signed: e.target.checked })} className="size-4 accent-[var(--foreground)]" />
              Rule tree signed
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={s.allowed} onChange={(e) => set({ allowed: e.target.checked })} className="size-4 accent-[var(--foreground)]" />
              BTC/USDC allowed
            </label>
            <button onClick={() => choose(PRESETS[0])} className="ml-auto inline-flex items-center gap-1.5 text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <RotateCcw aria-hidden className="size-3.5" /> Reset
            </button>
          </div>
        </div>

        {/* checks + verdict */}
        <div className="flex flex-col">
          <ol className="divide-y divide-border" aria-label="Checks">
            {CHECKS.map((c, i) => {
              const reached = i < step;
              const isFail = reached && i === failIdx;
              const ok = reached && !isFail && i <= stopAt;
              const after = i > stopAt;
              return (
                <li key={c.code} className={cx("grid grid-cols-[1.5rem_1fr_auto] items-center gap-3 px-6 py-2.5 text-sm transition-colors duration-150", isFail && "bg-seal-soft", after && "opacity-30")}>
                  <span aria-hidden className={cx("font-mono text-xs", isFail ? "text-seal" : ok ? "text-ok" : "text-faint")}>{isFail ? "✕" : ok ? "✓" : "·"}</span>
                  <span className={isFail ? "text-foreground" : ok ? "text-foreground" : "text-muted"}>{c.label}</span>
                  <span className="label !text-[10px]">{c.by}</span>
                </li>
              );
            })}
          </ol>
          <div className="mt-auto border-t border-border bg-background p-6" aria-live="polite">
            {done ? (
              <motion.div key={`${runId}-${failIdx}`} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                <p className="flex items-center gap-3">
                  <span className={cx("rounded px-2 py-0.5 font-mono text-xs uppercase tracking-wider", failed ? "bg-seal text-white" : "bg-ok text-background")}>
                    {failed ? (fc!.code === "DRAWDOWN" ? "frozen" : "blocked") : "executed"}
                  </span>
                  <code className="font-mono text-sm text-foreground">{failed ? `TradeSkipped(${fc!.code})` : "ExecutionLogged(…, synthHash)"}</code>
                </p>
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
                  {failed ? fc!.why : "Every bound held. The vault places a market order on Injective's native orderbook, with its own address as the fee recipient."}
                </p>
                <p className="label mt-3">nonce consumed · nothing reverts · evidence stays on-chain</p>
              </motion.div>
            ) : (
              <p className="font-mono text-sm text-muted caret">checking</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
