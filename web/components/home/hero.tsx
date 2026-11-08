"use client";

import { ArrowRight, ArrowUp } from "lucide-react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SealStage } from "@/components/fx/seal-stage";
import { useAgentCount, useBtcOracle } from "@/lib/live";

const IDEAS = [
  { chip: "BTC trend · 20/50 EMA", text: "Long BTC when the 20 EMA crosses above the 50 EMA on 5m candles, 3x leverage, stop at 1.5%, take profit 3%" },
  { chip: "Fade ETH when RSI > 75", text: "Short ETH when RSI(14) is above 75 and the spread is tight, 2x leverage, stop at 1%" },
  { chip: "Buy BTC dips", text: "Buy BTC dips: price below SMA(50) and RSI(14) under 35, 2x leverage, take profit 3%, stop 1.5%" },
];

const ease = [0.2, 0.8, 0.2, 1] as const;

function useNow() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const t = () => setNow(Math.floor(Date.now() / 1000));
    t();
    const id = setInterval(t, 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function LiveStrip() {
  const o = useBtcOracle();
  const agents = useAgentCount();
  const now = useNow();
  const cells = [
    ["BTC · oracle 0x67", o.data ? `$${o.data.price.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : "—"],
    ["Last oracle update", o.data && now ? `${Math.max(0, now - o.data.ts)}s ago` : "—"],
    ["Injective block", o.data ? `#${o.data.block.toLocaleString()}` : "—"],
    ["Agents deployed", agents.data !== undefined ? String(agents.data) : "—"],
    ["Out-of-bounds orders", "0"],
  ];
  return (
    <dl className="grid grid-cols-2 border-y border-border sm:grid-cols-3 lg:grid-cols-5">
      {cells.map(([k, v], i) => (
        <div key={k} className={`px-5 py-4 ${i > 0 ? "border-l border-border" : ""} ${i === 2 ? "max-sm:border-l-0" : ""}`}>
          <dt className="label">{k}</dt>
          <dd className="mt-1.5 font-mono text-[15px] tabular text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Hero() {
  const router = useRouter();
  const reduced = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const [idea, setIdea] = useState("");
  const [stamp, setStamp] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  useMotionValueEvent(scrollYProgress, "change", (v) => setStamp(Math.min(1, v * 1.6)));

  const go = (text: string) => router.push(`/terminal?q=${encodeURIComponent(text.trim())}`);
  const rise = (d: number) => (reduced ? {} : { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.9, delay: d, ease } });

  return (
    <section ref={ref} className="relative pt-16">
      <div className="mx-auto grid max-w-7xl items-center gap-6 px-5 pb-14 pt-14 lg:grid-cols-[1.08fr_1fr] lg:pt-20">
        <div>
          <motion.p {...rise(0)} className="label flex items-center gap-2">
            <span aria-hidden className="size-1.5 rounded-full bg-ok" /> Built on Injective · verified by Bittensor SN50
          </motion.p>

          <h1 className="mt-7 text-[clamp(2.9rem,6.6vw,6rem)] font-medium leading-[0.95] tracking-[-0.045em]">
            <motion.span {...rise(0.08)} className="block">Trading agents,</motion.span>
            <motion.span {...rise(0.16)} className="block">
              <span className="serif text-[1.08em]">bound</span> <span className="text-muted">by the chain.</span>
            </motion.span>
          </h1>

          <motion.p {...rise(0.26)} className="mt-7 max-w-lg text-[17px] leading-relaxed text-muted">
            Describe a strategy in plain words. An AI writes it into rules once, you sign them, and an Injective contract enforces every limit on every trade. A prompt can&apos;t talk its way past it.
          </motion.p>

          <motion.form
            {...rise(0.36)}
            onSubmit={(e) => {
              e.preventDefault();
              if (idea.trim().length > 3) go(idea);
            }}
            className="mt-9 max-w-xl"
          >
            <label htmlFor="idea" className="sr-only">Describe a trading idea</label>
            <div className="group flex items-end gap-2 rounded-2xl border border-border-strong bg-surface p-2 pl-4 transition-colors focus-within:border-foreground/50">
              <textarea
                id="idea"
                rows={2}
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (idea.trim().length > 3) go(idea);
                  }
                }}
                placeholder="What should your agent trade?"
                className="min-h-12 flex-1 resize-none bg-transparent py-2 text-[15px] placeholder:text-faint focus:outline-none"
              />
              <button
                type="submit"
                aria-label="Compile this idea"
                disabled={idea.trim().length <= 3}
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-foreground text-background transition-opacity disabled:opacity-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <ArrowUp aria-hidden className="size-4" />
              </button>
            </div>
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Example ideas">
              {IDEAS.map((t) => (
                <li key={t.chip}>
                  <button type="button" onClick={() => go(t.text)} title={t.text} className="rounded-full border border-border px-3 py-1.5 text-left text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {t.chip}
                  </button>
                </li>
              ))}
            </ul>
          </motion.form>

          <motion.div {...rise(0.46)} className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            <Link href="/terminal" className="group inline-flex items-center gap-1.5 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Open the app <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a href="#playground" className="text-muted hover:text-foreground">Try to break the vault</a>
            <Link href="/agents/0x9e229Bd01D43b2Ce6774c67c3843B316285E8f26" className="text-muted hover:text-foreground">See a live agent</Link>
          </motion.div>
        </div>

        <motion.div initial={reduced ? false : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.4, ease }} className="relative h-[420px] sm:h-[520px] lg:h-[620px]">
          <div aria-hidden className="dots absolute inset-8 rounded-[2rem] opacity-60 [mask-image:radial-gradient(closest-side,black,transparent)]" />
          <SealStage className="absolute inset-0" progress={stamp} />
          <p className="label absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap">智 · zhì · wisdom — the seal that signs every rule</p>
        </motion.div>
      </div>
      <div className="mx-auto max-w-7xl px-5">
        <LiveStrip />
      </div>
    </section>
  );
}
