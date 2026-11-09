"use client";

import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

const STEPS = [
  {
    n: "01",
    who: "The model",
    verb: "plans",
    tag: "compile · once",
    body: "You describe a strategy the way you'd text a friend. An AI compiles it once into a strict rule tree: fixed indicators, bounded numbers, no free text. You read it and sign its hash. Then the AI leaves. It never holds a key.",
    can: ["turn your words into rules", "flag what it had to guess"],
    cant: ["place a trade", "touch funds", "change a limit later"],
  },
  {
    n: "02",
    who: "The subnet",
    verb: "verifies",
    tag: "Bittensor SN50 · every entry",
    body: "Before any entry, Synth (Bittensor subnet 50) is asked whether its forecast distribution agrees with the trade and whether volatility is calm. If it disagrees, or doesn't answer, the trade is skipped and the forecast's hash is written on-chain.",
    can: ["veto an entry", "leave public evidence of why"],
    cant: ["force a trade", "bypass the vault"],
  },
  {
    n: "03",
    who: "The chain",
    verb: "enforces",
    tag: "Injective EVM · every order",
    body: "Funds sit in a Guardrail Vault on Injective. It re-checks every order: size, leverage, price against the oracle, cooldown, daily loss. Then it trades Injective's native orderbook. A bad day freezes it, and anyone can pull that brake.",
    can: ["trade inside your limits", "freeze itself on a bad day"],
    cant: ["exceed a bound", "be loosened without a 24h wait"],
  },
] as const;

function Typing({ lines, on, speed = 360 }: { lines: { t: string; c?: string }[]; on: boolean; speed?: number }) {
  const [n, setN] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!on) return;
    let i = reduced ? lines.length : 0;
    const tick = () => setN(i);
    tick();
    if (reduced) return;
    const id = setInterval(() => {
      i = i >= lines.length + 4 ? 0 : i + 1;
      tick();
    }, speed);
    return () => clearInterval(id);
  }, [on, reduced, lines.length, speed]);
  return (
    <div className="space-y-1">
      {lines.map((l, i) => (
        <p key={i} className={`transition-opacity duration-200 ${i < n ? "opacity-100" : "opacity-0"} ${l.c ?? "text-muted"}`}>
          {l.t}
        </p>
      ))}
    </div>
  );
}

const PANELS = [
  {
    title: "zhi / compile",
    lines: [
      { t: "› long BTC when the 20 EMA is above the 50, 3x, cut losses at 1.5%", c: "text-foreground" },
      { t: "" },
      { t: '  "entry":  EMA(20) > EMA(50)' },
      { t: '  "sizing": 10% equity · 3× · max $2,500' },
      { t: '  "exit":   TP 3% · SL 1.5% · max 24h' },
      { t: '  "risk":   freeze at −4%/day · slippage 35bps' },
      { t: "" },
      { t: "  keccak256  0xd3cde509…7bc783081f", c: "text-foreground" },
      { t: "  ✓ signed (EIP-712) by 0x0dA2…A8b9", c: "text-ok" },
    ],
  },
  {
    title: "zhi / synth-gate",
    lines: [
      { t: "› GET synthdata.co/insights/prediction-percentiles?asset=BTC&horizon=1h", c: "text-foreground" },
      { t: "" },
      { t: "  P0 (Injective oracle)   74,159.28" },
      { t: "  F(P0) on last step      0.34" },
      { t: "  P(up) = 1 − F(P0)       0.66   ≥ 0.60   ✓", c: "text-ok" },
      { t: "  band 5–95%              160bps ≤ 180    ✓", c: "text-ok" },
      { t: "" },
      { t: "  synthHash  0x8f1c…e2a0 → attached to intent", c: "text-foreground" },
    ],
  },
  {
    title: "injective / guardrail-vault",
    lines: [
      { t: "› executeIntent(nonce 14)", c: "text-foreground" },
      { t: "" },
      { t: "  rule tree signed ............... ok" },
      { t: "  market allowlisted ............. ok" },
      { t: "  notional $2,498 ≤ $2,500 ....... ok" },
      { t: "  leverage 2.99× ≤ 3× ............ ok" },
      { t: "  worst price within 0.5% ........ ok" },
      { t: "  drawdown −0.6% > −4% ........... ok" },
      { t: "" },
      { t: "  → createDerivativeMarketOrder via 0x65", c: "text-foreground" },
      { t: "  ExecutionLogged(…, synthHash)", c: "text-ok" },
    ],
  },
];

function Step({ s, i, onActive }: { s: (typeof STEPS)[number]; i: number; onActive: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-45% 0px -45% 0px" });
  useEffect(() => {
    if (inView) onActive(i);
  }, [inView, i, onActive]);
  return (
    <div ref={ref} className="border-t border-border py-12 first:border-t-0 lg:min-h-[62vh] lg:py-20">
      <p className="label">{s.n} — {s.tag}</p>
      <h3 className="mt-4 text-4xl font-medium tracking-[-0.03em] sm:text-5xl">
        {s.who} <span className="serif">{s.verb}.</span>
      </h3>
      <p className="mt-5 max-w-md leading-relaxed text-muted">{s.body}</p>
      <dl className="mt-8 grid max-w-md grid-cols-2 gap-6 text-sm">
        <div>
          <dt className="label">Can</dt>
          {s.can.map((c) => (
            <dd key={c} className="mt-2">{c}</dd>
          ))}
        </div>
        <div>
          <dt className="label">Can&apos;t</dt>
          {s.cant.map((c) => (
            <dd key={c} className="mt-2 text-muted line-through decoration-seal/70">{c}</dd>
          ))}
        </div>
      </dl>
      {/* panel inline on small screens */}
      <div className="mt-8 lg:hidden">
        <Panel i={i} on />
      </div>
    </div>
  );
}

function Panel({ i, on }: { i: number; on: boolean }) {
  const p = PANELS[i];
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span aria-hidden className="flex gap-1.5">
          <i className="size-2.5 rounded-full bg-border-strong" />
          <i className="size-2.5 rounded-full bg-border-strong" />
          <i className="size-2.5 rounded-full bg-border-strong" />
        </span>
        <span className="font-mono text-xs text-muted">{p.title}</span>
        <span className="label ml-auto">example run · {i + 1}/3</span>
      </div>
      <div className="min-h-[300px] overflow-x-auto p-5 font-mono text-[12.5px] leading-6 whitespace-pre">
        <Typing key={i} lines={p.lines} on={on} />
      </div>
    </div>
  );
}

export function Verbs() {
  const [active, setActive] = useState(0);
  return (
    <section id="how" className="mx-auto max-w-7xl scroll-mt-20 px-5 pt-28">
      <p className="label">01 — How it works</p>
      <h2 className="mt-4 max-w-3xl text-[clamp(2.2rem,4.6vw,3.8rem)] font-medium leading-[1.02] tracking-[-0.035em]">
        Three layers. <span className="text-muted">Each one distrusts the layer above it.</span>
      </h2>
      <div className="mt-6 grid gap-12 lg:grid-cols-2">
        <div>
          {STEPS.map((s, i) => (
            <Step key={s.n} s={s} i={i} onActive={setActive} />
          ))}
        </div>
        <div className="hidden lg:block">
          <div className="sticky top-28 pt-20">
            <AnimatePresence mode="wait">
              <motion.div key={active} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
                <Panel i={active} on />
              </motion.div>
            </AnimatePresence>
            <ol className="mt-4 flex gap-1.5" aria-label="Step progress">
              {STEPS.map((s, i) => (
                <li key={s.n} className={`h-0.5 flex-1 rounded-full transition-colors duration-500 ${i <= active ? "bg-foreground" : "bg-border-strong"}`} />
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
