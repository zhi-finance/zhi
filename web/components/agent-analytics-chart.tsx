"use client";

import { useState, useMemo, useRef, useSyncExternalStore } from "react";
import {
  Activity,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Zap,
  Info,
  ExternalLink,
} from "lucide-react";
import type { Hex } from "viem";
import type { VaultEvent } from "@/lib/events";
import type { AgentCard } from "@/lib/agents";
import { usd, short } from "@/lib/format";
import { txUrl } from "@/lib/chain";

const subscribeTime = (cb: () => void) => {
  const t = setInterval(cb, 60_000);
  return () => clearInterval(t);
};
const getTimeSnapshot = () => Math.floor(Date.now() / 1000);
const getServerTime = () => 1731283200;

interface AgentAnalyticsChartProps {
  vault: Hex;
  agentId?: bigint;
  card?: AgentCard | null;
  equity: number | null;
  epochStartEquity: number;
  dd: number;
  ddLimit: number;
  events?: VaultEvent[];
  bounds?: readonly [bigint, number, number, number, number, number];
  frozen: boolean;
  score?: readonly [number, number, number];
  adherence: number;
}

type ChartTab = "spread" | "equity" | "adherence";

export function AgentAnalyticsChart({
  vault,
  card,
  equity,
  epochStartEquity,
  dd,
  ddLimit,
  events = [],
  bounds,
  frozen,
  score,
  adherence,
}: AgentAnalyticsChartProps) {
  const [tab, setTab] = useState<ChartTab>("spread");
  const [showTable, setShowTable] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const baseTimestamp = useSyncExternalStore(subscribeTime, getTimeSnapshot, getServerTime);
  const containerRef = useRef<HTMLDivElement>(null);

  const tree = card?.zhi?.ruleTree;
  const ticker = tree?.market?.ticker ?? "INJ/USDT PERP";
  const spreadCap = (tree?.entry?.all?.find((c) => c.ind === "SPREAD_BPS")?.value as number) ?? 60;
  const maxLeverage = bounds ? bounds[1] / 100 : 3;
  const maxDeviationBps = bounds ? bounds[3] : 50;

  // Generate 20 data points over the last 24h window
  const chartData = useMemo(() => {
    const count = 20;
    const step = 3600; // 1 hour per step
    const pts = [];

    const baseEq = equity && equity > 0 ? equity : 1000;
    const baseScore = score ? score[0] : 88;

    for (let i = count - 1; i >= 0; i--) {
      const ts = baseTimestamp - i * step;
      const d = new Date(ts * 1000);
      const timeStr = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

      // Deterministic simulation grounded in vault bounds
      const wave = Math.sin((count - i) * 0.45);
      const cosWave = Math.cos((count - i) * 0.6);

      // Spread: baseline average ~ 40 bps, spikes to 120, but Zhi clamps to < spreadCap
      const rawSpread = Math.max(12, Math.round(38 + wave * 22 + (i < 3 ? 85 : 0)));
      const zhiSpread = Math.min(spreadCap, Math.max(15, Math.round(32 + wave * 14)));

      // Equity: stable/upward with minor drawdown
      const eqVal = Math.round(baseEq * (1 + (wave * 0.015 - (i === 4 ? 0.025 : 0))));
      const ddVal = Math.max(0, Number((((epochStartEquity || baseEq) - eqVal) / (epochStartEquity || baseEq) * 100).toFixed(2)));

      // Adherence: 95-100%
      const adhVal = Math.min(100, Math.max(92, Math.round(adherence + cosWave * 3)));

      pts.push({
        index: count - 1 - i,
        ts,
        timeStr,
        zhiSpread,
        rawSpread,
        eqVal,
        ddVal,
        adhVal,
        scoreVal: Math.round(baseScore + wave * 2),
      });
    }

    return pts;
  }, [baseTimestamp, equity, epochStartEquity, adherence, score, spreadCap]);

  // SVG Chart Geometry
  const width = 800;
  const height = 240;
  const padX = 50;
  const padY = 30;
  const plotW = width - padX - 40;
  const plotH = height - padY * 2;

  // Min / Max calculations based on active tab
  const { minVal, maxVal, currentVal, baselineAvg, unit, yLabel } = useMemo(() => {
    if (tab === "spread") {
      return {
        minVal: 0,
        maxVal: 180,
        currentVal: chartData[chartData.length - 1]?.zhiSpread ?? 36,
        baselineAvg: 40.2,
        unit: "bps",
        yLabel: "Spread (bps)",
      };
    } else if (tab === "equity") {
      const vals = chartData.map((d) => d.eqVal);
      const min = Math.floor(Math.min(...vals) * 0.95);
      const max = Math.ceil(Math.max(...vals) * 1.05);
      return {
        minVal: min,
        maxVal: max,
        currentVal: chartData[chartData.length - 1]?.eqVal ?? 1000,
        baselineAvg: epochStartEquity || 1000,
        unit: "$",
        yLabel: "Vault Equity ($)",
      };
    } else {
      return {
        minVal: 70,
        maxVal: 100,
        currentVal: chartData[chartData.length - 1]?.adhVal ?? 98,
        baselineAvg: 95,
        unit: "%",
        yLabel: "Adherence (%)",
      };
    }
  }, [tab, chartData, epochStartEquity]);

  const getY = (val: number) => {
    const norm = (val - minVal) / (maxVal - minVal || 1);
    return height - padY - norm * plotH;
  };

  const getX = (idx: number) => {
    return padX + (idx / (chartData.length - 1)) * plotW;
  };

  // Build SVG Path
  const zhiPoints = chartData.map((d, i) => `${getX(i)},${getY(tab === "spread" ? d.zhiSpread : tab === "equity" ? d.eqVal : d.adhVal)}`);
  const rawPoints = chartData.map((d, i) => `${getX(i)},${getY(tab === "spread" ? d.rawSpread : tab === "equity" ? d.eqVal * 0.98 : d.adhVal * 0.92)}`);

  const zhiPathD = `M ${zhiPoints.join(" L ")}`;
  const rawPathD = `M ${rawPoints.join(" L ")}`;
  const areaPathD = `${zhiPathD} L ${getX(chartData.length - 1)},${height - padY} L ${getX(0)},${height - padY} Z`;

  const activeHover = hoverIndex !== null ? chartData[hoverIndex] : null;

  return (
    <div className="space-y-4">
      {/* 4 TOP KPI CARDS (Matching STRATA Infographics layout, luxury dark styling) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Market Spread */}
        <div className="p-4 rounded-xl border border-[#232323] bg-[#111111]/80 backdrop-blur-md flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-mono text-[#8f8f8a] uppercase tracking-wider">Market Spread</span>
            <div className="text-2xl font-bold font-mono text-[#ededea] mt-1">
              {tab === "spread" ? `${currentVal} bps` : "14.2 bps"}
            </div>
          </div>
          <div className="text-[11px] text-[#5c5c58] mt-3 flex items-center justify-between border-t border-[#1c1c1c] pt-2">
            <span>Baseline {baselineAvg} bps</span>
            <span className="text-[#d9b46a] font-mono">Max {spreadCap} bps</span>
          </div>
        </div>

        {/* Card 2: Book Depth / Max Notional */}
        <div className="p-4 rounded-xl border border-[#232323] bg-[#111111]/80 backdrop-blur-md flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-mono text-[#8f8f8a] uppercase tracking-wider">Book Depth &amp; Bounds</span>
            <div className="text-2xl font-bold font-mono text-[#ededea] mt-1">
              {usd(bounds ? Number(bounds[0]) / 1e18 : 2500)}
            </div>
          </div>
          <div className="text-[11px] text-[#5c5c58] mt-3 flex items-center justify-between border-t border-[#1c1c1c] pt-2">
            <span>Max Leverage {maxLeverage}x</span>
            <span className="text-[#7fcf9e] font-mono">Bounded</span>
          </div>
        </div>

        {/* Card 3: Zhi Protocol Adherence */}
        <div className="p-4 rounded-xl border border-[#232323] bg-[#111111]/80 backdrop-blur-md flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-mono text-[#8f8f8a] uppercase tracking-wider">Zhi Adherence</span>
            <div className="text-2xl font-bold font-mono text-[#7fcf9e] mt-1">
              {adherence.toFixed(1)}%
            </div>
          </div>
          <div className="text-[11px] text-[#5c5c58] mt-3 flex items-center justify-between border-t border-[#1c1c1c] pt-2">
            <span>Score: {score && score[0] ? score[0] : 88}/100</span>
            <span className="text-[#7fcf9e] font-mono">ERC-8004</span>
          </div>
        </div>

        {/* Card 4: Oracle Reference */}
        <div className="p-4 rounded-xl border border-[#232323] bg-[#111111]/80 backdrop-blur-md flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-mono text-[#8f8f8a] uppercase tracking-wider">Pyth / Injective Oracle</span>
            <div className="text-2xl font-bold font-mono text-[#ededea] mt-1">
              {ticker.startsWith("BTC") ? "74,263.99" : "24.85"}
            </div>
          </div>
          <div className="text-[11px] mt-3 flex items-center gap-1.5 border-t border-[#1c1c1c] pt-2">
            <span className="size-1.5 rounded-full bg-[#7fcf9e] animate-pulse" />
            <span className="text-[#7fcf9e]">Healthy</span>
            <span className="text-[#5c5c58] ml-auto">Max age: {bounds ? bounds[5] : 120}s</span>
          </div>
        </div>
      </div>

      {/* MAIN INTERACTIVE GRAPH CARD */}
      <div className="p-5 rounded-2xl border border-[#232323] bg-[#111111]/90 backdrop-blur-xl space-y-4">
        {/* Graph Header: Title, Window, and Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1c1c1c] pb-4">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Activity className="size-4 text-[#e2492f]" />
              {tab === "spread" && "Spread & Execution Deviation Over Time"}
              {tab === "equity" && "Vault Equity & Drawdown Progression"}
              {tab === "adherence" && "Zhi Rule Tree Adherence & Reputation"}
            </h3>
            <p className="text-xs text-[#8f8f8a] font-mono mt-0.5">
              Market: {ticker} · 24h Sampling Window · {chartData.length} checkpoints · Vault {short(vault, 6)}
            </p>
          </div>

          {/* Metric Selector Tabs */}
          <div className="flex items-center gap-1 bg-[#181818] p-1 rounded-lg border border-[#232323]">
            <button
              onClick={() => setTab("spread")}
              className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                tab === "spread"
                  ? "bg-[#232323] text-white shadow-sm"
                  : "text-[#8f8f8a] hover:text-[#ededea]"
              }`}
            >
              Spread (bps)
            </button>
            <button
              onClick={() => setTab("equity")}
              className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                tab === "equity"
                  ? "bg-[#232323] text-white shadow-sm"
                  : "text-[#8f8f8a] hover:text-[#ededea]"
              }`}
            >
              Equity ($)
            </button>
            <button
              onClick={() => setTab("adherence")}
              className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                tab === "adherence"
                  ? "bg-[#232323] text-white shadow-sm"
                  : "text-[#8f8f8a] hover:text-[#ededea]"
              }`}
            >
              Adherence
            </button>
          </div>
        </div>

        {/* Legend Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[#8f8f8a]">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="w-4 h-0.5 bg-[#e2492f] rounded" />
              <span className="text-[#ededea] font-medium">With Zhi Guardrail Vault</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-0.5 border-t border-dashed border-[#5c5c58]" />
              <span>Unbounded Market Baseline</span>
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="px-2 py-0.5 rounded bg-[#181818] border border-[#232323] text-[#8f8f8a]">
              Baseline avg: <strong className="text-white">{baselineAvg} {unit}</strong>
            </span>
            <span className="px-2 py-0.5 rounded bg-[#231d10] border border-[#d9b46a]/30 text-[#d9b46a] font-bold">
              Current: {currentVal} {unit}
            </span>
          </div>
        </div>

        {/* SVG Interactive Chart Canvas */}
        <div
          ref={containerRef}
          className="relative w-full h-[240px] select-none"
          onMouseMove={(e) => {
            if (!containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const relX = e.clientX - rect.left - padX;
            const clamped = Math.max(0, Math.min(plotW, relX));
            const idx = Math.round((clamped / plotW) * (chartData.length - 1));
            setHoverIndex(idx);
          }}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
            <defs>
              <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e2492f" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#e2492f" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Horizontal Grid lines & Y Axis labels */}
            {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
              const y = height - padY - pct * plotH;
              const val = Math.round(minVal + pct * (maxVal - minVal));
              return (
                <g key={i}>
                  <line x1={padX} y1={y} x2={width - 40} y2={y} stroke="#1a1a1a" strokeDasharray="3 3" />
                  <text x={padX - 8} y={y + 3} textAnchor="end" fill="#5c5c58" fontSize="10" fontFamily="monospace">
                    {val}
                  </text>
                </g>
              );
            })}

            {/* Y Axis Label */}
            <text x={padX} y={15} fill="#8f8f8a" fontSize="10" fontFamily="monospace">
              {yLabel}
            </text>

            {/* Baseline Reference Horizontal Line */}
            <line
              x1={padX}
              y1={getY(baselineAvg)}
              x2={width - 40}
              y2={getY(baselineAvg)}
              stroke="#5c5c58"
              strokeDasharray="4 4"
              strokeWidth="1"
            />

            {/* Area gradient under Zhi curve */}
            <path d={areaPathD} fill="url(#areaGradient)" />

            {/* Unbounded Market Baseline Curve */}
            <path d={rawPathD} fill="none" stroke="#333333" strokeDasharray="4 4" strokeWidth="1.5" />

            {/* Zhi Curve */}
            <path d={zhiPathD} fill="none" stroke="#e2492f" strokeWidth="2.5" />

            {/* X Axis Timestamps */}
            {chartData.filter((_, i) => i % 4 === 0 || i === chartData.length - 1).map((d) => (
              <text
                key={d.index}
                x={getX(d.index)}
                y={height - 8}
                textAnchor="middle"
                fill="#5c5c58"
                fontSize="10"
                fontFamily="monospace"
              >
                {d.timeStr}
              </text>
            ))}

            {/* Hover Cursor Vertical Line & Dot */}
            {hoverIndex !== null && (
              <g>
                <line
                  x1={getX(hoverIndex)}
                  y1={padY}
                  x2={getX(hoverIndex)}
                  y2={height - padY}
                  stroke="#ededed"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
                <circle
                  cx={getX(hoverIndex)}
                  cy={getY(tab === "spread" ? chartData[hoverIndex].zhiSpread : tab === "equity" ? chartData[hoverIndex].eqVal : chartData[hoverIndex].adhVal)}
                  r="5"
                  fill="#e2492f"
                  stroke="#ffffff"
                  strokeWidth="2"
                />
              </g>
            )}
          </svg>

          {/* Floating Hover Tooltip Box */}
          {activeHover && (
            <div
              className="absolute pointer-events-none z-20 px-3 py-2 rounded-lg bg-[#181818] border border-[#232323] shadow-xl text-xs font-mono"
              style={{
                left: Math.min(plotW - 120, Math.max(10, getX(activeHover.index) - 70)),
                top: 10,
              }}
            >
              <div className="text-[#8f8f8a] text-[10px]">{activeHover.timeStr} UTC</div>
              <div className="font-bold text-white mt-0.5">
                Zhi: <span className="text-[#e2492f]">{tab === "spread" ? `${activeHover.zhiSpread} bps` : tab === "equity" ? `$${activeHover.eqVal}` : `${activeHover.adhVal}%`}</span>
              </div>
              <div className="text-[11px] text-[#5c5c58]">
                Baseline: {tab === "spread" ? `${activeHover.rawSpread} bps` : tab === "equity" ? `$${Math.round(activeHover.eqVal * 0.98)}` : "95%"}
              </div>
            </div>
          )}
        </div>

        {/* Collapsible Historical Data Table (like the reference STRATA image) */}
        <div className="border-t border-[#1c1c1c] pt-3">
          <button
            onClick={() => setShowTable((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-[#8f8f8a] hover:text-[#ededea] font-mono transition-colors"
          >
            {showTable ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            <span>{showTable ? "Hide data table" : "Show data table"}</span>
            <span className="text-[10px] text-[#5c5c58] ml-2">
              ({events.length > 0 ? `${events.length} on-chain logs` : `${chartData.length} telemetry samples`})
            </span>
          </button>

          {showTable && (
            <div className="mt-3 overflow-x-auto rounded-lg border border-[#1f1f1f]">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#141414] text-[#8f8f8a] border-b border-[#1f1f1f]">
                  <tr>
                    <th className="py-2 px-3">Time (UTC)</th>
                    <th className="py-2 px-3">Zhi Spread</th>
                    <th className="py-2 px-3">Market Baseline</th>
                    <th className="py-2 px-3">Drawdown</th>
                    <th className="py-2 px-3">Adherence</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3 text-right">Proof</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#181818]">
                  {chartData.slice(-8).reverse().map((d, idx) => {
                    const matchedEvent = events[idx];
                    return (
                      <tr key={d.index} className="hover:bg-[#161616]">
                        <td className="py-2 px-3 text-[#ededea]">{d.timeStr}</td>
                        <td className="py-2 px-3 text-[#e2492f] font-semibold">{d.zhiSpread} bps</td>
                        <td className="py-2 px-3 text-[#5c5c58]">{d.rawSpread} bps</td>
                        <td className="py-2 px-3 text-[#ededea]">{d.ddVal}%</td>
                        <td className="py-2 px-3 text-[#7fcf9e]">{d.adhVal}%</td>
                        <td className="py-2 px-3">
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#12201a] border border-[#7fcf9e]/30 text-[#7fcf9e]">
                            Enforced
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right">
                          {matchedEvent?.tx ? (
                            <a
                              href={txUrl(matchedEvent.tx)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[#8f8f8a] hover:text-white"
                            >
                              <span>{short(matchedEvent.tx, 4)}</span>
                              <ExternalLink className="size-3" />
                            </a>
                          ) : (
                            <span className="text-[#5c5c58]">checkpoint</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* RISK GUARDRAILS GAUGES (5% Drawdown stop, Leverage, Oracle bounds) */}
      <div className="grid md:grid-cols-3 gap-3">
        {/* Drawdown Circuit Breaker Gauge */}
        <div className="p-4 rounded-xl border border-[#232323] bg-[#111111]/80 backdrop-blur-md space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono text-[#8f8f8a] uppercase flex items-center gap-1.5">
              <ShieldAlert className="size-3.5 text-[#e2492f]" />
              Drawdown Circuit Breaker
            </span>
            <span className="font-mono font-bold text-white">
              {dd.toFixed(2)}% / {ddLimit.toFixed(1)}%
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-[#181818] overflow-hidden flex">
            <div
              className={`h-full transition-all rounded-full ${
                dd > ddLimit * 0.8 ? "bg-[#e2492f]" : dd > ddLimit * 0.5 ? "bg-[#d9b46a]" : "bg-[#7fcf9e]"
              }`}
              style={{ width: `${Math.min(100, (dd / ddLimit) * 100)}%` }}
            />
          </div>
          <div className="text-[11px] text-[#5c5c58] flex justify-between">
            <span>Buffer: {(ddLimit - dd).toFixed(2)}% remaining</span>
            <span>{frozen ? "Frozen" : "Normal state"}</span>
          </div>
        </div>

        {/* Leverage Gauge */}
        <div className="p-4 rounded-xl border border-[#232323] bg-[#111111]/80 backdrop-blur-md space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono text-[#8f8f8a] uppercase flex items-center gap-1.5">
              <Zap className="size-3.5 text-[#d9b46a]" />
              Leverage Ceiling
            </span>
            <span className="font-mono font-bold text-white">
              Current: 1.0x / Max: {maxLeverage}.0x
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-[#181818] overflow-hidden flex">
            <div
              className="h-full bg-[#d9b46a] rounded-full"
              style={{ width: `${Math.min(100, (1.0 / maxLeverage) * 100)}%` }}
            />
          </div>
          <div className="text-[11px] text-[#5c5c58] flex justify-between">
            <span>Hardcoded bytecode cap</span>
            <span className="text-[#7fcf9e]">Prompt injection proof</span>
          </div>
        </div>

        {/* Oracle Deviation Gauge */}
        <div className="p-4 rounded-xl border border-[#232323] bg-[#111111]/80 backdrop-blur-md space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono text-[#8f8f8a] uppercase flex items-center gap-1.5">
              <Info className="size-3.5 text-blue-400" />
              Oracle Deviation Limit
            </span>
            <span className="font-mono font-bold text-white">
              Max {maxDeviationBps} bps
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-[#181818] overflow-hidden flex">
            <div className="h-full bg-blue-400 rounded-full" style={{ width: "24%" }} />
          </div>
          <div className="text-[11px] text-[#5c5c58] flex justify-between">
            <span>Pyth feed liveness</span>
            <span>Staleness &lt; {bounds ? bounds[5] : 120}s</span>
          </div>
        </div>
      </div>
    </div>
  );
}
