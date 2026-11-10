"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Shield,
  Bot,
  Zap,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Coins,
  Cpu,
  Layers,
  BarChart3,
  ExternalLink,
  Maximize2,
  Minimize2,
  FileCode,
  Users,
  KeyRound,
  Compass,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { SealMark } from "@/components/fx/seal-mark";

const TOTAL_SLIDES = 10;

export default function PitchDeck() {
  const [slide, setSlide] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const nextSlide = useCallback(() => {
    setSlide((prev) => Math.min(prev + 1, TOTAL_SLIDES - 1));
  }, []);

  const prevSlide = useCallback(() => {
    setSlide((prev) => Math.max(prev - 1, 0));
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        nextSlide();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        prevSlide();
      } else if (e.key === "Home") {
        e.preventDefault();
        setSlide(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setSlide(TOTAL_SLIDES - 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nextSlide, prevSlide]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      setIsFullscreen(false);
    }
  };

  return (
    <div className="relative h-screen max-h-screen overflow-hidden bg-[#090a0d] text-[#ededea] font-sans flex flex-col justify-between select-none">
      {/* Background glow - strict 2-color ambient lighting */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[25%] -left-[10%] w-[45vw] h-[45vw] rounded-full bg-[#e2492f]/10 blur-[130px]" />
        <div className="absolute -bottom-[25%] -right-[10%] w-[45vw] h-[45vw] rounded-full bg-[#d9b46a]/10 blur-[130px]" />
        <div className="absolute inset-0 bg-[radial-gradient(#1f2128_1px,transparent_1px)] [background-size:24px_24px] opacity-40" />
      </div>

      {/* Header Bar - Fixed 56px */}
      <header className="relative z-30 h-14 shrink-0 flex items-center justify-between px-6 border-b border-[#1c1e24] bg-[#0b0c10]/90 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5 transition-transform hover:scale-105">
            <SealMark size={24} />
            <span className="text-base font-bold tracking-tight text-white">Zhi</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#181920] border border-[#282a35] text-[#d9b46a] font-mono tracking-wider font-semibold">
              DECK
            </span>
          </Link>
          <div className="hidden sm:flex items-center gap-2 text-xs text-[#8a8f98] border-l border-[#1f2128] pl-3">
            <span className="w-1.5 h-1.5 rounded-full bg-[#d9b46a] animate-pulse" />
            <span>Injective EVM Testnet</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-[#8a8f98]">
            <span className="text-white font-bold">{String(slide + 1).padStart(2, "0")}</span> / {String(TOTAL_SLIDES).padStart(2, "0")}
          </span>
          <div className="h-3.5 w-px bg-[#20222a] mx-1 hidden sm:block" />
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg border border-[#20222a] bg-[#121318] text-[#8a8f98] hover:text-white transition-colors"
            title="Toggle Fullscreen"
          >
            {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
          <Link
            href="/terminal"
            className="hidden sm:inline-flex items-center gap-1 px-3 py-1 rounded-md bg-[#e2492f] text-white font-semibold text-xs transition-opacity hover:opacity-90"
          >
            Terminal <ArrowUpRight className="size-3" />
          </Link>
        </div>
      </header>

      {/* Main Slide Body - Fitted Screen */}
      <main className="relative z-10 flex-1 overflow-y-auto md:overflow-hidden flex items-center justify-center px-4 py-3 md:px-8 md:py-4">
        <div className="w-full max-w-5xl mx-auto flex flex-col justify-center my-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={slide}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="w-full"
            >
              {slide === 0 && <Slide1Cover />}
              {slide === 1 && <Slide2Problem />}
              {slide === 2 && <Slide3Solution />}
              {slide === 3 && <Slide4Technology />}
              {slide === 4 && <Slide5Market />}
              {slide === 5 && <Slide6BusinessModel />}
              {slide === 6 && <Slide7Traction />}
              {slide === 7 && <Slide8Team />}
              {slide === 8 && <Slide9Roadmap />}
              {slide === 9 && <Slide10Closing />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Footer Bar - Fixed 56px */}
      <footer className="relative z-30 h-14 shrink-0 flex items-center justify-between px-6 border-t border-[#1c1e24] bg-[#0b0c10]/95 backdrop-blur-xl">
        <div className="text-[11px] text-[#555a64] hidden sm:flex items-center gap-2">
          <span>Keys:</span>
          <kbd className="px-1.5 py-0.5 rounded bg-[#16171d] border border-[#20222a] text-[#8a8f98] font-mono text-[10px]">←</kbd>
          <kbd className="px-1.5 py-0.5 rounded bg-[#16171d] border border-[#20222a] text-[#8a8f98] font-mono text-[10px]">→</kbd>
        </div>

        {/* Progress Dots */}
        <div className="flex items-center gap-1.5 mx-auto sm:mx-0">
          {Array.from({ length: TOTAL_SLIDES }).map((_, idx) => (
            <button
              key={idx}
              onClick={() => setSlide(idx)}
              className={`h-1.5 transition-all rounded-full ${
                slide === idx ? "w-7 bg-[#e2492f]" : "w-2 bg-[#20222a] hover:bg-[#353844]"
              }`}
            />
          ))}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={prevSlide}
            disabled={slide === 0}
            className={`inline-flex items-center gap-1 px-3 py-1 rounded-md border text-xs font-semibold transition-all ${
              slide === 0
                ? "border-[#1a1c22] text-[#333742] cursor-not-allowed"
                : "border-[#222530] bg-[#121318] text-[#ededea] hover:bg-[#1b1c24]"
            }`}
          >
            <ArrowLeft className="size-3" /> Prev
          </button>
          <button
            onClick={nextSlide}
            disabled={slide === TOTAL_SLIDES - 1}
            className={`inline-flex items-center gap-1 px-3 py-1 rounded-md border text-xs font-semibold transition-all ${
              slide === TOTAL_SLIDES - 1
                ? "border-[#1a1c22] text-[#333742] cursor-not-allowed"
                : "border-[#e2492f] bg-[#e2492f] text-white hover:bg-[#cf3e26]"
            }`}
          >
            Next <ArrowRight className="size-3" />
          </button>
        </div>
      </footer>
    </div>
  );
}

// ==========================================
// SLIDE 1: COVER
// ==========================================
function Slide1Cover() {
  return (
    <div className="flex flex-col items-center text-center max-w-3xl mx-auto space-y-6">
      <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-[#181110] border border-[#e2492f]/40 text-[#e2492f] text-xs font-mono font-semibold">
        AUTONOMOUS AI EXECUTION LAYER
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-center gap-3">
          <SealMark size={52} />
          <h1 className="text-5xl md:text-7xl font-black tracking-tight text-white font-serif italic">
            Zhi <span className="font-sans font-normal text-2xl md:text-3xl text-[#8a8f98] not-italic">智</span>
          </h1>
        </div>
        <p className="text-xl md:text-2xl font-semibold text-white leading-tight">
          Trading Agents Bound by the Chain.
        </p>
        <p className="text-sm text-[#8a8f98] max-w-lg mx-auto">
          The model plans once. The subnet verifies. <span className="text-white font-semibold">The chain enforces.</span> Turn plain text into bounded smart contracts on Injective EVM.
        </p>
      </div>

      {/* 4 Minimalist Pillars */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full pt-2">
        <div className="p-3.5 rounded-xl border border-[#1e2028] bg-[#101116] flex flex-col items-center">
          <Shield className="size-4 text-[#e2492f] mb-1.5" />
          <span className="font-bold text-xs text-white">Guardrail Vaults</span>
          <span className="text-[10px] text-[#8a8f98]">ERC-4626 Brakes</span>
        </div>
        <div className="p-3.5 rounded-xl border border-[#1e2028] bg-[#101116] flex flex-col items-center">
          <KeyRound className="size-4 text-[#d9b46a] mb-1.5" />
          <span className="font-bold text-xs text-white">ERC-8004 Identity</span>
          <span className="text-[10px] text-[#8a8f98]">On-Chain Reputation</span>
        </div>
        <div className="p-3.5 rounded-xl border border-[#1e2028] bg-[#101116] flex flex-col items-center">
          <Cpu className="size-4 text-[#d9b46a] mb-1.5" />
          <span className="font-bold text-xs text-white">Bittensor SN50</span>
          <span className="text-[10px] text-[#8a8f98]">Synth Gating</span>
        </div>
        <div className="p-3.5 rounded-xl border border-[#1e2028] bg-[#101116] flex flex-col items-center">
          <Zap className="size-4 text-[#e2492f] mb-1.5" />
          <span className="font-bold text-xs text-white">Injective EVM</span>
          <span className="text-[10px] text-[#8a8f98]">CLOB Precompiles</span>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SLIDE 2: THE PROBLEM
// ==========================================
function Slide2Problem() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-[#e2492f] font-bold uppercase tracking-wider mb-1">
          <AlertTriangle className="size-3.5" /> The Broken Paradigm
        </div>
        <h2 className="text-2xl md:text-4xl font-bold tracking-tight text-white">
          Autonomous Agents Are One Prompt Away From Ruin
        </h2>
        <p className="text-xs md:text-sm text-[#8a8f98] mt-1">
          Existing Web3 trading bots rely on unconstrained LLM loops and unrestricted private keys.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="p-5 rounded-xl border border-[#261514] bg-[#120a0a] flex flex-col justify-between">
          <div>
            <div className="size-8 rounded-lg bg-[#201010] text-[#e2492f] grid place-items-center mb-3">
              <Bot className="size-4" />
            </div>
            <h3 className="text-sm font-bold text-white mb-1.5">Prompt Injections</h3>
            <p className="text-xs text-[#8a8f98] leading-relaxed">
              Adversarial inputs in orderbooks trick models into opening 20x leverage or dumping into predatory pools.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-[#201010] text-[11px] font-mono text-[#e2492f]">
            100% vulnerability in raw LLMs
          </div>
        </div>

        <div className="p-5 rounded-xl border border-[#261514] bg-[#120a0a] flex flex-col justify-between">
          <div>
            <div className="size-8 rounded-lg bg-[#201010] text-[#e2492f] grid place-items-center mb-3">
              <TrendingUp className="size-4" />
            </div>
            <h3 className="text-sm font-bold text-white mb-1.5">Stochastic Drift</h3>
            <p className="text-xs text-[#8a8f98] leading-relaxed">
              Models hallucinate prices, miscalculate slippage, and compound liquidations during high-volatility wicks.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-[#201010] text-[11px] font-mono text-[#e2492f]">
            $1.2B+ lost in DeFi liquidations
          </div>
        </div>

        <div className="p-5 rounded-xl border border-[#261514] bg-[#120a0a] flex flex-col justify-between">
          <div>
            <div className="size-8 rounded-lg bg-[#201010] text-[#e2492f] grid place-items-center mb-3">
              <Zap className="size-4" />
            </div>
            <h3 className="text-sm font-bold text-white mb-1.5">Zero On-Chain Brakes</h3>
            <p className="text-xs text-[#8a8f98] leading-relaxed">
              Bots sign arbitrary transactions. If the agent acts maliciously, the smart contract blindly executes it.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-[#201010] text-[11px] font-mono text-[#e2492f]">
            Zero bytecode-level circuit breakers
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SLIDE 3: THE 3-TIER SOLUTION
// ==========================================
function Slide3Solution() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-[#d9b46a] font-bold uppercase tracking-wider mb-1">
          <Layers className="size-3.5" /> 3-Tier Architecture
        </div>
        <h2 className="text-2xl md:text-4xl font-bold tracking-tight text-white">
          Three Layers. Zero Blind Trust.
        </h2>
        <p className="text-xs md:text-sm text-[#8a8f98] mt-1">
          Strategy planning is separated from consensus execution. The model never holds the private key.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {/* Tier 1 */}
        <div className="p-5 rounded-xl border border-[#1e2028] bg-[#101116] flex flex-col justify-between">
          <div>
            <span className="text-[10px] font-mono text-[#d9b46a] font-bold uppercase">Tier 1 · Off-Chain</span>
            <h3 className="text-base font-bold text-white mt-1 mb-1.5">The Model Plans</h3>
            <p className="text-xs text-[#8a8f98] leading-relaxed">
              Compiles plain English into a deterministic boolean RuleTree once, producing an EIP-712 signable hash.
            </p>
          </div>
          <div className="mt-4 p-2 rounded bg-[#161720] border border-[#222430] text-[10px] font-mono text-[#d9b46a]">
            &gt; compile(prompt) → TreeHash
          </div>
        </div>

        {/* Tier 2 */}
        <div className="p-5 rounded-xl border border-[#1e2028] bg-[#101116] flex flex-col justify-between">
          <div>
            <span className="text-[10px] font-mono text-[#d9b46a] font-bold uppercase">Tier 2 · Oracle Gate</span>
            <h3 className="text-base font-bold text-white mt-1 mb-1.5">The Subnet Verifies</h3>
            <p className="text-xs text-[#8a8f98] leading-relaxed">
              Bittensor SN50 Synth validates directional prediction confidence. Unconfident orders are rejected before submission.
            </p>
          </div>
          <div className="mt-4 p-2 rounded bg-[#161720] border border-[#222430] text-[10px] font-mono text-[#d9b46a]">
            &gt; if sn50.confidence &lt; 0.65 → drop
          </div>
        </div>

        {/* Tier 3 */}
        <div className="p-5 rounded-xl border border-[#e2492f]/40 bg-[#160d0c] flex flex-col justify-between">
          <div>
            <span className="text-[10px] font-mono text-[#e2492f] font-bold uppercase">Tier 3 · On-Chain</span>
            <h3 className="text-base font-bold text-white mt-1 mb-1.5">The Chain Enforces</h3>
            <p className="text-xs text-[#8a8f98] leading-relaxed">
              Injective EVM GuardrailVault enforces hard limits on leverage, drawdown, and oracle age directly in bytecode.
            </p>
          </div>
          <div className="mt-4 p-2 rounded bg-[#20100e] border border-[#381612] text-[10px] font-mono text-[#e2492f]">
            &gt; require(drawdown &lt; 500 bps)
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SLIDE 4: IN-CONTRACT GUARDRAILS
// ==========================================
function Slide4Technology() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-[#e2492f] font-bold uppercase tracking-wider mb-1">
          <Shield className="size-3.5" /> Bytecode Brakes
        </div>
        <h2 className="text-2xl md:text-4xl font-bold tracking-tight text-white">
          Mathematical Brakes in EVM Bytecode
        </h2>
        <p className="text-xs md:text-sm text-[#8a8f98] mt-1">
          Even if the AI model is 100% hijacked, the smart contract rejects any parameter violation.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl border border-[#1e2028] bg-[#101116]">
          <div className="text-2xl font-bold text-[#e2492f] font-mono mb-1">5.0%</div>
          <h4 className="text-xs font-bold text-white mb-1">Daily Drawdown Stop</h4>
          <p className="text-[11px] text-[#8a8f98] leading-relaxed">
            Vault auto-freezes if equity drops 500 bps in 24h. Anyone can permissionlessly poke the brake.
          </p>
        </div>

        <div className="p-4 rounded-xl border border-[#1e2028] bg-[#101116]">
          <div className="text-2xl font-bold text-white font-mono mb-1">3x - 5x</div>
          <h4 className="text-xs font-bold text-white mb-1">Leverage Ceiling</h4>
          <p className="text-[11px] text-[#8a8f98] leading-relaxed">
            Hardcoded in contract storage. Malicious prompts asking for 20x leverage immediately revert.
          </p>
        </div>

        <div className="p-4 rounded-xl border border-[#1e2028] bg-[#101116]">
          <div className="text-2xl font-bold text-[#d9b46a] font-mono mb-1">&lt; 150 bps</div>
          <h4 className="text-xs font-bold text-white mb-1">Oracle Deviation</h4>
          <p className="text-[11px] text-[#8a8f98] leading-relaxed">
            Trades are rejected if execution price diverges &gt; 1.5% from Pyth or oracle age &gt; 60 seconds.
          </p>
        </div>

        <div className="p-4 rounded-xl border border-[#1e2028] bg-[#101116]">
          <div className="text-2xl font-bold text-white font-mono mb-1">ERC-8004</div>
          <h4 className="text-xs font-bold text-white mb-1">Sovereign Agent ID</h4>
          <p className="text-[11px] text-[#8a8f98] leading-relaxed">
            Permanent on-chain identity accumulating adherence proofs and an immutable Zhi Score.
          </p>
        </div>
      </div>

      <div className="p-3 rounded-lg border border-[#1e2028] bg-[#12141a] flex items-center justify-between text-xs text-[#8a8f98]">
        <span>Deterministic Rust Harness (Q64.64 / dec18 fixed math + EMA, RSI, ATR)</span>
        <span className="font-mono text-[#d9b46a] font-semibold">100% SOLIDITY &amp; RUST PARITY</span>
      </div>
    </div>
  );
}

// ==========================================
// SLIDE 5: MARKET OPPORTUNITY
// ==========================================
function Slide5Market() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-[#d9b46a] font-bold uppercase tracking-wider mb-1">
          <TrendingUp className="size-3.5" /> Market Opportunity
        </div>
        <h2 className="text-2xl md:text-4xl font-bold tracking-tight text-white">
          Autonomous AI Meets High-Frequency DeFi
        </h2>
        <p className="text-xs md:text-sm text-[#8a8f98] mt-1">
          Injective is the only Layer-1 with native central limit order book precompiles built into its EVM.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4 text-center">
        <div className="p-6 rounded-xl border border-[#1e2028] bg-[#101116]">
          <div className="text-4xl font-black text-white font-mono mb-1">$45B+</div>
          <h4 className="text-xs font-bold text-white mb-1.5">Projected AI Agent AUM (2028)</h4>
          <p className="text-[11px] text-[#8a8f98] leading-relaxed">
            Algorithmic capital transitioning to verifiable, autonomous on-chain agents at 42% CAGR.
          </p>
        </div>

        <div className="p-6 rounded-xl border border-[#1e2028] bg-[#101116]">
          <div className="text-4xl font-black text-[#d9b46a] font-mono mb-1">$3.5B+</div>
          <h4 className="text-xs font-bold text-white mb-1.5">Injective Ecosystem Liquidity</h4>
          <p className="text-[11px] text-[#8a8f98] leading-relaxed">
            Deep orderbook volume across 350+ markets with 0.65-second finality and sub-cent fees.
          </p>
        </div>

        <div className="p-6 rounded-xl border border-[#1e2028] bg-[#101116]">
          <div className="text-4xl font-black text-[#e2492f] font-mono mb-1">0 MEV</div>
          <h4 className="text-xs font-bold text-white mb-1.5">Frequent Batch Auctions</h4>
          <p className="text-[11px] text-[#8a8f98] leading-relaxed">
            Injective’s FBA exchange engine eliminates front-running and sandwich attacks on agent orders.
          </p>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SLIDE 6: BUSINESS & REVENUE MODEL
// ==========================================
function Slide6BusinessModel() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-[#d9b46a] font-bold uppercase tracking-wider mb-1">
          <Coins className="size-3.5" /> Sustainable Economics
        </div>
        <h2 className="text-2xl md:text-4xl font-bold tracking-tight text-white">
          Triple Protocol Revenue Flywheel
        </h2>
        <p className="text-xs md:text-sm text-[#8a8f98] mt-1">
          Zero token inflation dependency. Zhi captures pure organic yield from performance, margin spreads, and APIs.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="p-5 rounded-xl border border-[#1e2028] bg-[#101116] flex flex-col justify-between">
          <div>
            <div className="size-8 rounded-lg bg-[#181922] text-[#d9b46a] grid place-items-center mb-3">
              <BarChart3 className="size-4" />
            </div>
            <span className="text-[10px] font-mono text-[#d9b46a] font-bold uppercase">Stream 1</span>
            <h3 className="text-sm font-bold text-white mt-0.5 mb-1">Vault Performance Take Rate</h3>
            <p className="text-xs text-[#8a8f98] leading-relaxed">
              <strong>10% to 20%</strong> take rate on vault profits above high-water mark, split with protocol treasury.
            </p>
          </div>
          <div className="mt-4 pt-2.5 border-t border-[#1c1e26] text-[11px] font-mono text-white">
            Yield-aligned incentive
          </div>
        </div>

        <div className="p-5 rounded-xl border border-[#1e2028] bg-[#101116] flex flex-col justify-between">
          <div>
            <div className="size-8 rounded-lg bg-[#181922] text-[#d9b46a] grid place-items-center mb-3">
              <Coins className="size-4" />
            </div>
            <span className="text-[10px] font-mono text-[#d9b46a] font-bold uppercase">Stream 2</span>
            <h3 className="text-sm font-bold text-white mt-0.5 mb-1">Credit Pool Margin Spread</h3>
            <p className="text-xs text-[#8a8f98] leading-relaxed">
              LPs deposit idle USDC; high-reputation agents borrow margin at competitive rates. Protocol takes a <strong>3% - 6% spread</strong>.
            </p>
          </div>
          <div className="mt-4 pt-2.5 border-t border-[#1c1e26] text-[11px] font-mono text-white">
            Underwritten credit facility
          </div>
        </div>

        <div className="p-5 rounded-xl border border-[#1e2028] bg-[#101116] flex flex-col justify-between">
          <div>
            <div className="size-8 rounded-lg bg-[#181922] text-[#d9b46a] grid place-items-center mb-3">
              <FileCode className="size-4" />
            </div>
            <span className="text-[10px] font-mono text-[#d9b46a] font-bold uppercase">Stream 3</span>
            <h3 className="text-sm font-bold text-white mt-0.5 mb-1">Enterprise Strategy API</h3>
            <p className="text-xs text-[#8a8f98] leading-relaxed">
              B2B subscriptions and per-attestation micro-fees for quantitative funds, DAOs, and external agent builders.
            </p>
          </div>
          <div className="mt-4 pt-2.5 border-t border-[#1c1e26] text-[11px] font-mono text-white">
            Institutional SaaS tier
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SLIDE 7: TRACTION & WHAT WE SHIPPED
// ==========================================
function Slide7Traction() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-[#d9b46a] font-bold uppercase tracking-wider mb-1">
          <CheckCircle2 className="size-3.5" /> Proven Traction
        </div>
        <h2 className="text-2xl md:text-4xl font-bold tracking-tight text-white">
          Not An Idea — 100% Deployed on Testnet
        </h2>
        <p className="text-xs md:text-sm text-[#8a8f98] mt-1">
          Fully functioning contracts, deterministic execution daemon, and trading terminal.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="p-4 rounded-xl border border-[#1e2028] bg-[#101116] flex items-start gap-3">
          <CheckCircle2 className="size-4 text-[#d9b46a] shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold text-white mb-0.5">Live Injective EVM Contracts</h4>
            <p className="text-[11px] text-[#8a8f98]">
              Deployed GuardrailVault, ZhiFactory, CreditPool, and ZhiAttestor on testnet (Chain ID 1439).
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-[#1e2028] bg-[#101116] flex items-start gap-3">
          <CheckCircle2 className="size-4 text-[#d9b46a] shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold text-white mb-0.5">Deterministic Rust Harness</h4>
            <p className="text-[11px] text-[#8a8f98]">
              Dec18 fixed-point math, indicators, Bittensor SN50 Synth gate, and tick backtest engine.
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-[#1e2028] bg-[#101116] flex items-start gap-3">
          <CheckCircle2 className="size-4 text-[#d9b46a] shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold text-white mb-0.5">Next.js 16 Web Terminal</h4>
            <p className="text-[11px] text-[#8a8f98]">
              Orderbook integration with 350+ Injective markets, candlestick charts, and prompt compiler.
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-[#1e2028] bg-[#101116] flex items-start gap-3">
          <CheckCircle2 className="size-4 text-[#d9b46a] shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold text-white mb-0.5">82+ Production Commits</h4>
            <p className="text-[11px] text-[#8a8f98]">
              Comprehensive invariant testing, Vitest parity suites, and clean open-source architecture.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SLIDE 8: THE TEAM
// ==========================================
function Slide8Team() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-[#d9b46a] font-bold uppercase tracking-wider mb-1">
          <Users className="size-3.5" /> Core Team
        </div>
        <h2 className="text-2xl md:text-4xl font-bold tracking-tight text-white">
          Builders at the Intersection of AI &amp; Web3
        </h2>
        <p className="text-xs md:text-sm text-[#8a8f98] mt-1">
          Deep experience in smart contract security, Injective precompiles, and quant product execution.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Rythme Card */}
        <div className="p-4 rounded-xl border border-[#1e2028] bg-[#101116] flex items-center gap-4">
          <div className="size-24 rounded-xl overflow-hidden shrink-0 border border-[#282a36]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/team/rythme.jpg" alt="Rythme Nagrani" className="w-full h-full object-cover" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-white">Rythme Nagrani</h3>
            <p className="text-[11px] font-mono text-[#e2492f] font-semibold">
              FOUNDER · PROTOCOL ARCHITECT
            </p>
            <p className="text-[11px] text-[#8a8f98] leading-tight">
              Injective EVM precompiles, smart contract security, deterministic Rust engine. Prev: Bittensor Hacker House, built official Lium client (<span className="text-white">gpu402</span>).
            </p>
          </div>
        </div>

        {/* Swarna Card */}
        <div className="p-4 rounded-xl border border-[#1e2028] bg-[#101116] flex items-center gap-4">
          <div className="size-24 rounded-xl overflow-hidden shrink-0 border border-[#282a36]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/team/swarna.jpg" alt="Swarna" className="w-full h-full object-cover" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-white">Swarna</h3>
            <p className="text-[11px] font-mono text-[#d9b46a] font-semibold">
              CO-FOUNDER · PRODUCT &amp; GROWTH
            </p>
            <p className="text-[11px] text-[#8a8f98] leading-tight">
              Product strategy, quant risk framework modeling, institutional partner relations, and go-to-market operations.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SLIDE 9: ROADMAP (FAST-TRACKED TO THIS QUARTER)
// ==========================================
function Slide9Roadmap() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-[#e2492f] font-bold uppercase tracking-wider mb-1">
          <Compass className="size-3.5" /> High-Velocity Execution
        </div>
        <h2 className="text-2xl md:text-4xl font-bold tracking-tight text-white">
          Mainnet Launch This Quarter (Nov - Dec 2026)
        </h2>
        <p className="text-xs md:text-sm text-[#8a8f98] mt-1">
          We move fast. The foundation is already shipped — mainnet goes live before the year ends.
        </p>
      </div>

      <div className="grid md:grid-cols-4 gap-3">
        {/* Q4 2026 */}
        <div className="p-4 rounded-xl border border-[#e2492f]/50 bg-[#160d0c] relative">
          <span className="px-2 py-0.5 rounded-full bg-[#24110e] text-[#e2492f] text-[9px] font-mono font-bold">
            THIS QUARTER · NOV-DEC 2026
          </span>
          <h4 className="text-sm font-bold text-white mt-2 mb-1">Mainnet Launch</h4>
          <p className="text-[11px] text-[#8a8f98] leading-tight">
            Security audit completion, Injective Mainnet vault deployment, and first 20 audited live agent vaults.
          </p>
        </div>

        {/* Q1 2027 */}
        <div className="p-4 rounded-xl border border-[#1e2028] bg-[#101116]">
          <span className="px-2 py-0.5 rounded-full bg-[#181a22] text-[#8a8f98] text-[9px] font-mono font-bold">
            Q1 2027
          </span>
          <h4 className="text-sm font-bold text-white mt-2 mb-1">LP Credit Pool</h4>
          <p className="text-[11px] text-[#8a8f98] leading-tight">
            Public USDC margin facility bootstrap, ERC-8004 reputation ranking, and institutional pilot vaults ($10M AUM).
          </p>
        </div>

        {/* Q2 2027 */}
        <div className="p-4 rounded-xl border border-[#1e2028] bg-[#101116]">
          <span className="px-2 py-0.5 rounded-full bg-[#181a22] text-[#8a8f98] text-[9px] font-mono font-bold">
            Q2 2027
          </span>
          <h4 className="text-sm font-bold text-white mt-2 mb-1">Decentralized Attestors</h4>
          <p className="text-[11px] text-[#8a8f98] leading-tight">
            Decentralized validator staking for off-chain proofs and cross-chain Cosmos IBC liquidity routing.
          </p>
        </div>

        {/* Q3 2027 */}
        <div className="p-4 rounded-xl border border-[#1e2028] bg-[#101116]">
          <span className="px-2 py-0.5 rounded-full bg-[#181a22] text-[#8a8f98] text-[9px] font-mono font-bold">
            Q3 2027
          </span>
          <h4 className="text-sm font-bold text-white mt-2 mb-1">Enterprise Suite</h4>
          <p className="text-[11px] text-[#8a8f98] leading-tight">
            B2B institutional strategy compiler SDK and multi-agent cooperative hedging swarms for DAOs.
          </p>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SLIDE 10: THE ASK & CLOSING
// ==========================================
function Slide10Closing() {
  return (
    <div className="flex flex-col items-center text-center max-w-2xl mx-auto space-y-6">
      <SealMark size={48} />

      <div className="space-y-2">
        <h2 className="text-4xl md:text-5xl font-black tracking-tight text-white font-serif italic">
          Bound by the Chain.
        </h2>
        <p className="text-xs md:text-sm text-[#8a8f98] max-w-md mx-auto">
          Raising pre-seed capital &amp; partnering with Injective ecosystem validators, LPs, and quantitative funds.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 w-full max-w-md">
        <Link
          href="/terminal"
          className="flex items-center justify-center gap-1.5 p-2.5 rounded-lg bg-[#e2492f] text-white font-bold text-xs hover:bg-[#cf3e26] transition-colors"
        >
          Launch Terminal <ArrowUpRight className="size-3.5" />
        </Link>
        <a
          href="https://github.com/zhi-finance/zhi"
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-1.5 p-2.5 rounded-lg bg-[#14161f] border border-[#222532] text-white font-bold text-xs hover:bg-[#1a1c27] transition-colors"
        >
          GitHub Codebase <ExternalLink className="size-3.5" />
        </a>
        <a
          href="https://www.youtube.com/watch?v=g-tKH7sddR4"
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-1.5 p-2.5 rounded-lg bg-[#14161f] border border-[#222532] text-white font-bold text-xs hover:bg-[#1a1c27] transition-colors"
        >
          Watch Demo <ExternalLink className="size-3.5" />
        </a>
        <Link
          href="/docs"
          className="flex items-center justify-center gap-1.5 p-2.5 rounded-lg bg-[#14161f] border border-[#222532] text-white font-bold text-xs hover:bg-[#1a1c27] transition-colors"
        >
          Documentation <FileCode className="size-3.5" />
        </Link>
      </div>

      <div className="text-[11px] font-mono text-[#555a64]">
        zhifi.vercel.app · Injective EVM (Chain ID 1439) · contact@zhi.finance
      </div>
    </div>
  );
}
