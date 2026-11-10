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
  Lock,
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
  Sparkles,
  Compass,
  KeyRound,
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

  // Keyboard navigation
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
    <div className="relative min-h-screen bg-[#08090b] text-[#ededea] font-sans overflow-x-hidden flex flex-col justify-between select-none">
      {/* Background ambient lighting effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[20%] -left-[10%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-br from-[#e2492f]/10 to-transparent blur-[140px]" />
        <div className="absolute -bottom-[20%] -right-[10%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-tl from-[#d9b46a]/10 to-transparent blur-[140px]" />
        <div className="absolute top-[40%] left-[30%] w-[40vw] h-[40vw] rounded-full bg-gradient-to-r from-[#7fcf9e]/5 to-transparent blur-[160px]" />
        <div className="absolute inset-0 bg-[radial-gradient(#232323_1px,transparent_1px)] [background-size:24px_24px] opacity-40" />
      </div>

      {/* Top Deck Navigation Header */}
      <header className="relative z-30 flex items-center justify-between px-6 py-4 border-b border-[#1c1d22] bg-[#0b0c0f]/80 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-2.5 transition-transform hover:scale-105 focus-visible:outline-none"
          >
            <SealMark size={28} />
            <span className="text-lg font-bold tracking-tight text-white">Zhi</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#1e2029] border border-[#2c2f3b] text-[#d9b46a] font-mono tracking-wider font-semibold">
              PITCH DECK
            </span>
          </Link>
          <div className="hidden sm:flex items-center gap-2 text-xs text-[#8f8f8a] border-l border-[#232323] pl-4">
            <span className="w-2 h-2 rounded-full bg-[#7fcf9e] animate-pulse" />
            <span>Injective EVM Testnet</span>
          </div>
        </div>

        {/* Slide Counter & Jump Pills */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-[#8f8f8a] hidden md:inline-block">
            SLIDE <span className="text-white font-bold">{String(slide + 1).padStart(2, "0")}</span> / {String(TOTAL_SLIDES).padStart(2, "0")}
          </span>
          <div className="h-4 w-px bg-[#232323] mx-1 hidden md:block" />
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg border border-[#232323] bg-[#121318] text-[#8f8f8a] hover:text-white hover:bg-[#1a1b22] transition-colors"
            title="Toggle Fullscreen"
          >
            {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
          <Link
            href="/terminal"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-black font-semibold text-xs transition-opacity hover:opacity-90"
          >
            Launch Terminal <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      </header>

      {/* Slide Main Viewport */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-6 md:p-12 lg:p-16">
        <div className="w-full max-w-6xl mx-auto min-h-[640px] flex flex-col justify-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={slide}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.35, ease: "easeInOut" }}
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

      {/* Bottom Floating Presentation Controller */}
      <footer className="relative z-30 flex items-center justify-between px-6 py-4 border-t border-[#1c1d22] bg-[#0b0c0f]/90 backdrop-blur-xl">
        <div className="text-xs text-[#5c5c58] hidden sm:flex items-center gap-2">
          <span>Navigate with</span>
          <kbd className="px-1.5 py-0.5 rounded bg-[#16171d] border border-[#232323] text-[#8f8f8a] font-mono text-[10px]">←</kbd>
          <kbd className="px-1.5 py-0.5 rounded bg-[#16171d] border border-[#232323] text-[#8f8f8a] font-mono text-[10px]">→</kbd>
          <span>or Space</span>
        </div>

        {/* Clickable Progress Dots */}
        <div className="flex items-center gap-1.5 mx-auto sm:mx-0">
          {Array.from({ length: TOTAL_SLIDES }).map((_, idx) => (
            <button
              key={idx}
              onClick={() => setSlide(idx)}
              className={`h-2 transition-all rounded-full ${
                slide === idx
                  ? "w-8 bg-[#e2492f]"
                  : "w-2 bg-[#232323] hover:bg-[#3c3e4a]"
              }`}
              title={`Go to slide ${idx + 1}`}
            />
          ))}
        </div>

        {/* Prev / Next Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={prevSlide}
            disabled={slide === 0}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
              slide === 0
                ? "border-[#1c1d22] text-[#3e404b] cursor-not-allowed"
                : "border-[#2c2f3b] bg-[#121318] text-[#ededea] hover:bg-[#1c1e27] hover:border-[#414558]"
            }`}
          >
            <ArrowLeft className="size-3.5" /> Prev
          </button>
          <button
            onClick={nextSlide}
            disabled={slide === TOTAL_SLIDES - 1}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
              slide === TOTAL_SLIDES - 1
                ? "border-[#1c1d22] text-[#3e404b] cursor-not-allowed"
                : "border-[#e2492f] bg-[#e2492f] text-white hover:bg-[#d03d24]"
            }`}
          >
            Next <ArrowRight className="size-3.5" />
          </button>
        </div>
      </footer>
    </div>
  );
}

// ==========================================
// SLIDE 1: COVER & HIGH-LEVEL VISION
// ==========================================
function Slide1Cover() {
  return (
    <div className="flex flex-col items-center text-center max-w-4xl mx-auto space-y-8">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#181212] border border-[#e2492f]/30 text-[#e2492f] text-xs font-mono tracking-wide">
        <Sparkles className="size-3.5" />
        THE SAFE EXECUTION LAYER FOR AUTONOMOUS DEFI
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-center gap-4">
          <SealMark size={64} />
          <h1 className="text-6xl md:text-8xl font-black tracking-tight text-white font-serif italic">
            Zhi <span className="font-sans font-normal text-3xl md:text-4xl text-[#8f8f8a] not-italic">智</span>
          </h1>
        </div>
        <p className="text-2xl md:text-3xl font-medium text-[#ededea] max-w-2xl mx-auto leading-snug">
          Trading Agents Bound by the Chain.
        </p>
        <p className="text-base text-[#8f8f8a] max-w-xl mx-auto">
          The model plans once. The subnet verifies. <span className="text-white font-semibold">The chain enforces.</span> Turn natural language into deterministic smart contracts on Injective EVM.
        </p>
      </div>

      {/* 4 Architecture Badges */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full pt-4">
        <div className="p-4 rounded-xl border border-[#232323] bg-[#0f1015]/80 backdrop-blur-md flex flex-col items-center gap-2">
          <Shield className="size-5 text-[#e2492f]" />
          <span className="font-semibold text-sm text-white">Guardrail Vaults</span>
          <span className="text-[11px] text-[#8f8f8a]">ERC-4626 In-Contract Brakes</span>
        </div>
        <div className="p-4 rounded-xl border border-[#232323] bg-[#0f1015]/80 backdrop-blur-md flex flex-col items-center gap-2">
          <KeyRound className="size-5 text-[#7fcf9e]" />
          <span className="font-semibold text-sm text-white">ERC-8004 Identity</span>
          <span className="text-[11px] text-[#8f8f8a]">On-Chain Agent Reputation</span>
        </div>
        <div className="p-4 rounded-xl border border-[#232323] bg-[#0f1015]/80 backdrop-blur-md flex flex-col items-center gap-2">
          <Cpu className="size-5 text-[#d9b46a]" />
          <span className="font-semibold text-sm text-white">Bittensor SN50</span>
          <span className="text-[11px] text-[#8f8f8a]">Real-Time Synth Gating</span>
        </div>
        <div className="p-4 rounded-xl border border-[#232323] bg-[#0f1015]/80 backdrop-blur-md flex flex-col items-center gap-2">
          <Zap className="size-5 text-blue-400" />
          <span className="font-semibold text-sm text-white">Injective EVM</span>
          <span className="text-[11px] text-[#8f8f8a]">Native CLOB Precompiles</span>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SLIDE 2: THE PROBLEM (AGENT TRILEMMA)
// ==========================================
function Slide2Problem() {
  return (
    <div className="space-y-8">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-[#e2492f] uppercase tracking-wider mb-2 font-bold">
          <AlertTriangle className="size-3.5" /> The Broken Paradigm
        </div>
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white">
          Autonomous AI Agents Are One Bad Prompt Away From Liquidating Your Capital
        </h2>
        <p className="text-sm md:text-base text-[#8f8f8a] mt-2 max-w-3xl">
          Today&apos;s Web3 trading agents rely on fragile off-chain loops with unrestricted hot wallet keys. When models hallucinate or adversarial prompts inject, catastrophic loss is guaranteed.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-5">
        <div className="p-6 rounded-2xl border border-[#2e1515] bg-[#140b0b] flex flex-col justify-between">
          <div>
            <div className="size-10 rounded-xl bg-[#2e1515] text-[#e2492f] grid place-items-center mb-4">
              <Bot className="size-5" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Prompt Injections</h3>
            <p className="text-xs text-[#a8a8a2] leading-relaxed">
              Adversaries inject malicious payload instructions in public orderbooks or tweets, causing the LLM to take 20x leverage or dump into predatory liquidity pools.
            </p>
          </div>
          <div className="mt-6 pt-4 border-t border-[#2e1515] text-xs font-mono text-[#e2492f]">
            ⚡ 100% vulnerability in unconstrained prompts
          </div>
        </div>

        <div className="p-6 rounded-2xl border border-[#2e1515] bg-[#140b0b] flex flex-col justify-between">
          <div>
            <div className="size-10 rounded-xl bg-[#2e1515] text-[#e2492f] grid place-items-center mb-4">
              <TrendingUp className="size-5" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Stochastic Drift</h3>
            <p className="text-xs text-[#a8a8a2] leading-relaxed">
              Probabilistic models hallucinate prices, calculate bad slippage tolerances, and experience rapid compounding drawdown during volatile liquidation wicks.
            </p>
          </div>
          <div className="mt-6 pt-4 border-t border-[#2e1515] text-xs font-mono text-[#e2492f]">
            📉 $1.2B+ lost in DeFi liquidation cascades
          </div>
        </div>

        <div className="p-6 rounded-2xl border border-[#2e1515] bg-[#140b0b] flex flex-col justify-between">
          <div>
            <div className="size-10 rounded-xl bg-[#2e1515] text-[#e2492f] grid place-items-center mb-4">
              <Lock className="size-5" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Zero On-Chain Brakes</h3>
            <p className="text-xs text-[#a8a8a2] leading-relaxed">
              Standard bots hold unrestricted signing keys. The blockchain sees every signature as valid. There are no native mathematical brakes at the smart contract level.
            </p>
          </div>
          <div className="mt-6 pt-4 border-t border-[#2e1515] text-xs font-mono text-[#e2492f]">
            🛑 Zero enforceable circuit breakers
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SLIDE 3: THE SOLUTION (3-TIER ZERO-TRUST)
// ==========================================
function Slide3Solution() {
  return (
    <div className="space-y-8">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-[#7fcf9e] uppercase tracking-wider mb-2 font-bold">
          <Layers className="size-3.5" /> 3-Tier Zero-Trust Architecture
        </div>
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white">
          Three Layers. Each Layer Trusts Nothing Above It.
        </h2>
        <p className="text-sm md:text-base text-[#8f8f8a] mt-2 max-w-3xl">
          We separate strategic planning from physical on-chain execution. The AI never touches the private keys; it only proposes a signed, verified boolean AST.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6 relative">
        {/* Layer 1 */}
        <div className="p-6 rounded-2xl border border-[#232323] bg-[#0e1015] relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 px-3 py-1 bg-[#1a1b22] text-[#8f8f8a] text-[10px] font-mono rounded-bl-xl font-bold">
            TIER 1 · OFF-CHAIN
          </div>
          <div>
            <div className="size-10 rounded-xl bg-[#1d1f2b] text-blue-400 grid place-items-center mb-4">
              <Bot className="size-5" />
            </div>
            <span className="text-xs font-mono text-blue-400 font-bold uppercase tracking-wider">The Model Plans</span>
            <h3 className="text-xl font-bold text-white mt-1 mb-2">Natural Language AST</h3>
            <p className="text-xs text-[#8f8f8a] leading-relaxed">
              Translates plain English strategies into a deterministic boolean Rule Tree. Executed <strong>once</strong>, outputting a canonical EIP-712 hash signed by the vault creator.
            </p>
          </div>
          <div className="mt-6 p-2.5 rounded-lg bg-[#14161f] border border-[#212433] text-[11px] font-mono text-blue-300">
            &gt; compile(prompt) → RuleTreeHash
          </div>
        </div>

        {/* Layer 2 */}
        <div className="p-6 rounded-2xl border border-[#232323] bg-[#0e1015] relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 px-3 py-1 bg-[#1a1b22] text-[#8f8f8a] text-[10px] font-mono rounded-bl-xl font-bold">
            TIER 2 · ORACLE GATE
          </div>
          <div>
            <div className="size-10 rounded-xl bg-[#262014] text-[#d9b46a] grid place-items-center mb-4">
              <Cpu className="size-5" />
            </div>
            <span className="text-xs font-mono text-[#d9b46a] font-bold uppercase tracking-wider">The Subnet Verifies</span>
            <h3 className="text-xl font-bold text-white mt-1 mb-2">Bittensor SN50 Synth</h3>
            <p className="text-xs text-[#8f8f8a] leading-relaxed">
              Before an order is submitted, Bittensor&apos;s decentralized Synth subnet validates directional forecast confidence. Trades with low confidence scores are filtered out off-chain.
            </p>
          </div>
          <div className="mt-6 p-2.5 rounded-lg bg-[#1a1711] border border-[#2d2516] text-[11px] font-mono text-[#d9b46a]">
            &gt; if sn50.confidence &lt; 0.65 → drop
          </div>
        </div>

        {/* Layer 3 */}
        <div className="p-6 rounded-2xl border border-[#2e1515] bg-[#140b0b] relative overflow-hidden flex flex-col justify-between ring-1 ring-[#e2492f]/40">
          <div className="absolute top-0 right-0 px-3 py-1 bg-[#2a1310] text-[#e2492f] text-[10px] font-mono rounded-bl-xl font-bold">
            TIER 3 · ON-CHAIN
          </div>
          <div>
            <div className="size-10 rounded-xl bg-[#2a1310] text-[#e2492f] grid place-items-center mb-4">
              <Shield className="size-5" />
            </div>
            <span className="text-xs font-mono text-[#e2492f] font-bold uppercase tracking-wider">The Chain Enforces</span>
            <h3 className="text-xl font-bold text-white mt-1 mb-2">Guardrail Vault</h3>
            <p className="text-xs text-[#8f8f8a] leading-relaxed">
              Injective EVM smart contract validates the rule tree hash, daily drawdown, leverage cap, and oracle bounds in bytecode. Direct precompile interaction with Injective CLOB.
            </p>
          </div>
          <div className="mt-6 p-2.5 rounded-lg bg-[#22100d] border border-[#3e1a14] text-[11px] font-mono text-[#e2492f]">
            &gt; require(drawdown &lt; 500 bps, &quot;FREEZE&quot;)
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SLIDE 4: CORE TECHNOLOGY & HARD BRAKES
// ==========================================
function Slide4Technology() {
  return (
    <div className="space-y-8">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-[#d9b46a] uppercase tracking-wider mb-2 font-bold">
          <Shield className="size-3.5" /> In-Contract Guardrails
        </div>
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white">
          Mathematical Brakes Baked Directly into EVM Bytecode
        </h2>
        <p className="text-sm md:text-base text-[#8f8f8a] mt-2 max-w-3xl">
          Zhi Guardrail Vaults are ERC-4626 capital vaults that enforce immutable risk bounds at consensus. Even if an LLM is 100% hijacked, the bytecode will reject any breach.
        </p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl border border-[#232323] bg-[#0e1015]">
          <div className="text-2xl font-bold text-[#e2492f] font-mono mb-1">5.0%</div>
          <h4 className="text-sm font-semibold text-white mb-1.5">Daily Drawdown Stop</h4>
          <p className="text-xs text-[#8f8f8a] leading-relaxed">
            If portfolio value drops 500 bps in a 24-hour epoch, the vault freezes automatically. Any network observer can permissionlessly poke the brake.
          </p>
        </div>

        <div className="p-5 rounded-xl border border-[#232323] bg-[#0e1015]">
          <div className="text-2xl font-bold text-[#7fcf9e] font-mono mb-1">3x - 5x</div>
          <h4 className="text-sm font-semibold text-white mb-1.5">Hard Leverage Ceiling</h4>
          <p className="text-xs text-[#8f8f8a] leading-relaxed">
            Position sizing caps are locked in contract storage. Malicious prompt requests for 20x leverage throw an immediate EVM revert.
          </p>
        </div>

        <div className="p-5 rounded-xl border border-[#232323] bg-[#0e1015]">
          <div className="text-2xl font-bold text-[#d9b46a] font-mono mb-1">&lt; 150 bps</div>
          <h4 className="text-sm font-semibold text-white mb-1.5">Oracle Deviation &amp; Age</h4>
          <p className="text-xs text-[#8f8f8a] leading-relaxed">
            Trades are rejected if execution price diverges &gt; 1.5% from Pyth/Injective oracle feeds or if oracle updates are older than 60 seconds.
          </p>
        </div>

        <div className="p-5 rounded-xl border border-[#232323] bg-[#0e1015]">
          <div className="text-2xl font-bold text-blue-400 font-mono mb-1">ERC-8004</div>
          <h4 className="text-sm font-semibold text-white mb-1.5">Sovereign Agent ID</h4>
          <p className="text-xs text-[#8f8f8a] leading-relaxed">
            Every agent receives an on-chain identity NFT accumulating adherence proofs, Sharpe ratios, and an immutable reputation score (Zhi Score).
          </p>
        </div>
      </div>

      <div className="p-4 rounded-xl border border-[#1e2029] bg-[#11131a] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="size-5 text-[#7fcf9e] shrink-0" />
          <span>
            <strong>Deterministic Rust Harness:</strong> Fixed-point math (dec18), indicator pipelines (EMA, RSI, ATR), and canonical Keccak-256 AST validation.
          </span>
        </div>
        <span className="font-mono text-[#d9b46a] shrink-0">100% PARITY BETWEEN RUST &amp; SOLIDITY</span>
      </div>
    </div>
  );
}

// ==========================================
// SLIDE 5: MARKET OPPORTUNITY & INJECTIVE
// ==========================================
function Slide5Market() {
  return (
    <div className="space-y-8">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-blue-400 uppercase tracking-wider mb-2 font-bold">
          <TrendingUp className="size-3.5" /> Market Opportunity
        </div>
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white">
          The Explosive Intersection of Autonomous AI and On-Chain Liquidity
        </h2>
        <p className="text-sm md:text-base text-[#8f8f8a] mt-2 max-w-3xl">
          Autonomous agents require millisecond execution without gas wars. Injective is the only Layer-1 with native central limit order book precompiles built into its EVM.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="p-6 rounded-2xl border border-[#232323] bg-[#0e1015] text-center">
          <div className="text-5xl font-black text-white font-mono mb-2">$45B+</div>
          <h4 className="text-base font-bold text-[#ededea] mb-2">Projected AI Agent AUM (2028)</h4>
          <p className="text-xs text-[#8f8f8a] leading-relaxed">
            Autonomous algorithmic agents are projected to manage over $45 Billion in decentralized assets as hedge funds and DAOs delegate execution to AI.
          </p>
        </div>

        <div className="p-6 rounded-2xl border border-[#232323] bg-[#0e1015] text-center">
          <div className="text-5xl font-black text-[#7fcf9e] font-mono mb-2">$3.5B+</div>
          <h4 className="text-base font-bold text-[#ededea] mb-2">Injective Ecosystem Liquidity</h4>
          <p className="text-xs text-[#8f8f8a] leading-relaxed">
            Injective processes billions in institutional trading volume across 350+ perpetuals and spot markets with 0.65-second block times and sub-cent fees.
          </p>
        </div>

        <div className="p-6 rounded-2xl border border-[#232323] bg-[#0e1015] text-center">
          <div className="text-5xl font-black text-[#d9b46a] font-mono mb-2">0 MEV</div>
          <h4 className="text-base font-bold text-[#ededea] mb-2">Frequent Batch Auction Protection</h4>
          <p className="text-xs text-[#8f8f8a] leading-relaxed">
            Injective&apos;s FBA exchange architecture completely eliminates predatory sandwich attacks and front-running on autonomous agent trades.
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
    <div className="space-y-8">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-[#7fcf9e] uppercase tracking-wider mb-2 font-bold">
          <Coins className="size-3.5" /> Sustainable Economics
        </div>
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white">
          A Multi-Pillar Protocol Revenue Flywheel
        </h2>
        <p className="text-sm md:text-base text-[#8f8f8a] mt-2 max-w-3xl">
          Zhi does not depend on inflationary token incentives. The protocol captures pure yield from trading performance, margin credit spreads, and enterprise attestation fees.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="p-6 rounded-2xl border border-[#232323] bg-[#0e1015] flex flex-col justify-between">
          <div>
            <div className="size-10 rounded-xl bg-[#142017] text-[#7fcf9e] grid place-items-center mb-4">
              <BarChart3 className="size-5" />
            </div>
            <span className="text-xs font-mono text-[#7fcf9e] font-bold uppercase tracking-wider">Stream 1</span>
            <h3 className="text-lg font-bold text-white mt-1 mb-2">Vault Performance Take Rate</h3>
            <p className="text-xs text-[#8f8f8a] leading-relaxed">
              Protocol automatically captures a <strong>10% to 20%</strong> performance fee on vault profits above the high-water mark, directly split between the protocol treasury and Zhi stakers.
            </p>
          </div>
          <div className="mt-6 pt-4 border-t border-[#1c1d24] text-xs font-mono text-white">
            Target: $2.4M ARR per $50M active AUM
          </div>
        </div>

        <div className="p-6 rounded-2xl border border-[#232323] bg-[#0e1015] flex flex-col justify-between">
          <div>
            <div className="size-10 rounded-xl bg-[#262014] text-[#d9b46a] grid place-items-center mb-4">
              <Coins className="size-5" />
            </div>
            <span className="text-xs font-mono text-[#d9b46a] font-bold uppercase tracking-wider">Stream 2</span>
            <h3 className="text-lg font-bold text-white mt-1 mb-2">Credit Pool Margin Spread</h3>
            <p className="text-xs text-[#8f8f8a] leading-relaxed">
              LPs deposit idle USDC into the CreditPool. High-reputation agents (Zhi Score &gt; 80) borrow margin facility capital; protocol captures a <strong>3% - 6% net interest spread</strong>.
            </p>
          </div>
          <div className="mt-6 pt-4 border-t border-[#1c1d24] text-xs font-mono text-white">
            Yield-bearing delta-neutral facility
          </div>
        </div>

        <div className="p-6 rounded-2xl border border-[#232323] bg-[#0e1015] flex flex-col justify-between">
          <div>
            <div className="size-10 rounded-xl bg-[#1d1f2b] text-blue-400 grid place-items-center mb-4">
              <FileCode className="size-5" />
            </div>
            <span className="text-xs font-mono text-blue-400 font-bold uppercase tracking-wider">Stream 3</span>
            <h3 className="text-lg font-bold text-white mt-1 mb-2">Enterprise API &amp; Compiler</h3>
            <p className="text-xs text-[#8f8f8a] leading-relaxed">
              Institutional hedge funds, DAOs, and external agent platforms pay monthly API subscriptions and micro-fees for custom LLM strategy compilation and verified EIP-712 attestation proofs.
            </p>
          </div>
          <div className="mt-6 pt-4 border-t border-[#1c1d24] text-xs font-mono text-white">
            B2B institutional SaaS tier
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
    <div className="space-y-8">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-[#7fcf9e] uppercase tracking-wider mb-2 font-bold">
          <CheckCircle2 className="size-3.5" /> Traction &amp; Proof
        </div>
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white">
          Not An Idea — 100% Deployed &amp; Verified Today
        </h2>
        <p className="text-sm md:text-base text-[#8f8f8a] mt-2 max-w-3xl">
          Zhi is live on Injective EVM Testnet with deployed smart contracts, a deterministic Rust execution daemon, and a Next.js 16 trading terminal.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="p-5 rounded-xl border border-[#232323] bg-[#0e1015] flex items-start gap-4">
          <div className="size-9 rounded-lg bg-[#142017] text-[#7fcf9e] grid place-items-center shrink-0">
            <CheckCircle2 className="size-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white mb-1">Live Injective EVM Smart Contracts</h4>
            <p className="text-xs text-[#8f8f8a]">
              Deployed GuardrailVault implementation, ZhiFactory clone factory, CreditPool, and ZhiAttestor at Chain ID 1439 with full Injective precompile integration.
            </p>
          </div>
        </div>

        <div className="p-5 rounded-xl border border-[#232323] bg-[#0e1015] flex items-start gap-4">
          <div className="size-9 rounded-lg bg-[#142017] text-[#7fcf9e] grid place-items-center shrink-0">
            <CheckCircle2 className="size-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white mb-1">Deterministic Rust Execution Harness</h4>
            <p className="text-xs text-[#8f8f8a]">
              High-performance CLI daemon with 18-decimal fixed-point math, EMA/RSI/ATR indicators, Bittensor SN50 Synth confidence gating, and tick backtester.
            </p>
          </div>
        </div>

        <div className="p-5 rounded-xl border border-[#232323] bg-[#0e1015] flex items-start gap-4">
          <div className="size-9 rounded-lg bg-[#142017] text-[#7fcf9e] grid place-items-center shrink-0">
            <CheckCircle2 className="size-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white mb-1">Next.js 16 Web Strategy Terminal</h4>
            <p className="text-xs text-[#8f8f8a]">
              Live terminal connected to 350+ Injective spot and derivative order books, lightweight candlestick charts, interactive 3D Seal visualization, and EIP-712 signer.
            </p>
          </div>
        </div>

        <div className="p-5 rounded-xl border border-[#232323] bg-[#0e1015] flex items-start gap-4">
          <div className="size-9 rounded-lg bg-[#142017] text-[#7fcf9e] grid place-items-center shrink-0">
            <CheckCircle2 className="size-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white mb-1">81+ Production Git Commits</h4>
            <p className="text-xs text-[#8f8f8a]">
              Exhaustive invariant testing suite, Vitest cross-language verification, clean open-source codebase, and zero third-party contributor dependencies.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SLIDE 8: THE TEAM (RYTHME & SWARNA)
// ==========================================
function Slide8Team() {
  return (
    <div className="space-y-8">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-[#d9b46a] uppercase tracking-wider mb-2 font-bold">
          <Users className="size-3.5" /> Founding Team
        </div>
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white">
          Builders at the Intersection of AI, Quant Finance &amp; Web3
        </h2>
        <p className="text-sm md:text-base text-[#8f8f8a] mt-2 max-w-3xl">
          Deep crypto-native experience spanning EVM security, high-frequency blockchain architecture, and quantitative product design.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        {/* Rythme Card */}
        <div className="p-6 rounded-2xl border border-[#232323] bg-[#0e1015] flex flex-col sm:flex-row items-center gap-6 group hover:border-[#e2492f]/50 transition-colors">
          <div className="relative size-36 sm:size-40 rounded-2xl overflow-hidden shrink-0 border-2 border-[#2c2f3b] shadow-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/team/rythme.jpg"
              alt="Rythme Nagrani"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          </div>
          <div className="space-y-2 text-center sm:text-left">
            <div>
              <h3 className="text-2xl font-bold text-white">Rythme Nagrani</h3>
              <p className="text-xs font-mono text-[#e2492f] font-semibold tracking-wide">
                FOUNDER · PROTOCOL ARCHITECT
              </p>
            </div>
            <p className="text-xs text-[#8f8f8a] leading-relaxed">
              Systems engineer specializing in Injective EVM precompiles, smart contract security, deterministic Rust runtimes, and low-latency trading infrastructure.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-2 justify-center sm:justify-start">
              <span className="px-2 py-0.5 rounded bg-[#1c1e27] text-[10px] font-mono text-[#ededea] border border-[#2a2d3d]">
                Smart Contracts
              </span>
              <span className="px-2 py-0.5 rounded bg-[#1c1e27] text-[10px] font-mono text-[#ededea] border border-[#2a2d3d]">
                Rust Daemon
              </span>
              <span className="px-2 py-0.5 rounded bg-[#1c1e27] text-[10px] font-mono text-[#ededea] border border-[#2a2d3d]">
                Injective EVM
              </span>
            </div>
          </div>
        </div>

        {/* Swarna Card */}
        <div className="p-6 rounded-2xl border border-[#232323] bg-[#0e1015] flex flex-col sm:flex-row items-center gap-6 group hover:border-[#d9b46a]/50 transition-colors">
          <div className="relative size-36 sm:size-40 rounded-2xl overflow-hidden shrink-0 border-2 border-[#2c2f3b] shadow-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/team/swarna.jpg"
              alt="Swarna"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          </div>
          <div className="space-y-2 text-center sm:text-left">
            <div>
              <h3 className="text-2xl font-bold text-white">Swarna</h3>
              <p className="text-xs font-mono text-[#d9b46a] font-semibold tracking-wide">
                CO-FOUNDER · PRODUCT &amp; GROWTH
              </p>
            </div>
            <p className="text-xs text-[#8f8f8a] leading-relaxed">
              Product strategist and quantitative researcher leading risk modeling, ecosystem growth, institutional partnerships, and user experience.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-2 justify-center sm:justify-start">
              <span className="px-2 py-0.5 rounded bg-[#1c1e27] text-[10px] font-mono text-[#ededea] border border-[#2a2d3d]">
                Product Strategy
              </span>
              <span className="px-2 py-0.5 rounded bg-[#1c1e27] text-[10px] font-mono text-[#ededea] border border-[#2a2d3d]">
                Quant Risk
              </span>
              <span className="px-2 py-0.5 rounded bg-[#1c1e27] text-[10px] font-mono text-[#ededea] border border-[#2a2d3d]">
                Operations &amp; GTM
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SLIDE 9: ROADMAP & STRATEGIC MILESTONES
// ==========================================
function Slide9Roadmap() {
  return (
    <div className="space-y-8">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-blue-400 uppercase tracking-wider mb-2 font-bold">
          <Compass className="size-3.5" /> Execution Plan
        </div>
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white">
          The Path to Mainnet &amp; Ecosystem Scale
        </h2>
        <p className="text-sm md:text-base text-[#8f8f8a] mt-2 max-w-3xl">
          Phased execution beginning with Injective EVM mainnet deployment and scaling to institutional treasury delegation and cross-chain execution.
        </p>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl border border-[#232323] bg-[#0e1015] relative">
          <span className="px-2 py-0.5 rounded-full bg-[#142017] text-[#7fcf9e] text-[10px] font-mono font-bold">
            Q4 2026 · SHIPPED
          </span>
          <h4 className="text-base font-bold text-white mt-3 mb-2">Testnet Launch</h4>
          <ul className="text-xs text-[#8f8f8a] space-y-1.5 list-disc list-inside">
            <li>Injective EVM testnet deployment</li>
            <li>ERC-8004 agent identity integration</li>
            <li>Bittensor SN50 confidence gating</li>
            <li>Interactive strategy terminal</li>
          </ul>
        </div>

        <div className="p-5 rounded-xl border border-[#2c2f3b] bg-[#12141c] relative ring-1 ring-[#e2492f]/40">
          <span className="px-2 py-0.5 rounded-full bg-[#2a1310] text-[#e2492f] text-[10px] font-mono font-bold">
            Q1 2027 · CURRENT
          </span>
          <h4 className="text-base font-bold text-white mt-3 mb-2">Mainnet Launch</h4>
          <ul className="text-xs text-[#8f8f8a] space-y-1.5 list-disc list-inside">
            <li>Full smart contract security audit</li>
            <li>Injective mainnet vault deployment</li>
            <li>Public LP credit facility bootstrap</li>
            <li>First 50 vetted autonomous vaults</li>
          </ul>
        </div>

        <div className="p-5 rounded-xl border border-[#232323] bg-[#0e1015] relative">
          <span className="px-2 py-0.5 rounded-full bg-[#1c1e27] text-[#8f8f8a] text-[10px] font-mono font-bold">
            Q2 2027
          </span>
          <h4 className="text-base font-bold text-white mt-3 mb-2">Decentralized Attestors</h4>
          <ul className="text-xs text-[#8f8f8a] space-y-1.5 list-disc list-inside">
            <li>Distributed attestor staking network</li>
            <li>Cross-chain Cosmos IBC liquidity</li>
            <li>Multi-asset collateral vaults</li>
            <li>Subnet performance benchmarks</li>
          </ul>
        </div>

        <div className="p-5 rounded-xl border border-[#232323] bg-[#0e1015] relative">
          <span className="px-2 py-0.5 rounded-full bg-[#1c1e27] text-[#8f8f8a] text-[10px] font-mono font-bold">
            Q3 2027
          </span>
          <h4 className="text-base font-bold text-white mt-3 mb-2">Institutional Suite</h4>
          <ul className="text-xs text-[#8f8f8a] space-y-1.5 list-disc list-inside">
            <li>DAO treasury delegation module</li>
            <li>B2B Enterprise strategy compiler SDK</li>
            <li>Multi-agent cooperative hedging</li>
            <li>Institutional compliance reporting</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SLIDE 10: THE ASK & CLOSING CALL TO ACTION
// ==========================================
function Slide10Closing() {
  return (
    <div className="flex flex-col items-center text-center max-w-3xl mx-auto space-y-8">
      <SealMark size={56} />

      <div className="space-y-3">
        <h2 className="text-4xl md:text-6xl font-black tracking-tight text-white font-serif italic">
          Bound by the Chain.
        </h2>
        <p className="text-base md:text-lg text-[#8f8f8a] max-w-xl mx-auto">
          We are seeking early ecosystem partners, seed liquidity providers, and forward-thinking quant developers to define the standard for autonomous DeFi execution.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
        <Link
          href="/terminal"
          className="flex items-center justify-center gap-2 p-3.5 rounded-xl bg-white text-black font-bold text-sm hover:opacity-90 transition-opacity"
        >
          Launch Strategy Terminal <ArrowUpRight className="size-4" />
        </Link>
        <a
          href="https://github.com/zhi-finance/zhi"
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-2 p-3.5 rounded-xl bg-[#14151c] border border-[#2c2f3b] text-white font-bold text-sm hover:bg-[#1c1e27] transition-colors"
        >
          View GitHub Codebase <ExternalLink className="size-4" />
        </a>
        <a
          href="https://www.youtube.com/watch?v=g-tKH7sddR4"
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-2 p-3.5 rounded-xl bg-[#14151c] border border-[#2c2f3b] text-white font-bold text-sm hover:bg-[#1c1e27] transition-colors"
        >
          Watch 2-Min Demo Video <ExternalLink className="size-4" />
        </a>
        <Link
          href="/docs"
          className="flex items-center justify-center gap-2 p-3.5 rounded-xl bg-[#14151c] border border-[#2c2f3b] text-white font-bold text-sm hover:bg-[#1c1e27] transition-colors"
        >
          Read Protocol Specs <FileCode className="size-4" />
        </Link>
      </div>

      <div className="text-xs font-mono text-[#5c5c58] pt-2">
        zhifi.vercel.app · Injective EVM Testnet (Chain ID: 1439) · contact@zhi.finance
      </div>
    </div>
  );
}
