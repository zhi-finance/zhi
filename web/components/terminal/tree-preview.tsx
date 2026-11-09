"use client";

import { AlertTriangle, CheckCircle2, CircleDot, ShieldAlert } from "lucide-react";
import type { Flag } from "@/lib/ruletree/compile";
import type { Condition, Issue, RuleTree } from "@/lib/ruletree/types";
import { Badge, cx } from "../ui";

const OP: Record<string, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", between: "in", crosses_above: "crosses above", crosses_below: "crosses below" };

export function describeCondition(c: Condition): string {
  const lhs = c.period ? `${c.ind}(${c.period})` : c.ind;
  const rhs = c.ref ? (c.ref.period ? `${c.ref.ind}(${c.ref.period})` : c.ref.ind) : Array.isArray(c.value) ? `[${c.value[0]}, ${c.value[1]}]` : String(c.value);
  return `${lhs} ${OP[c.op] ?? c.op} ${rhs}`;
}

function flagStyle(f?: Flag) {
  if (!f) return { cls: "border-l-border", icon: <CircleDot aria-hidden className="size-3.5 text-muted" />, label: "fixed" };
  if (f.kind === "grounded") return { cls: "border-l-ok", icon: <CheckCircle2 aria-hidden className="size-3.5 text-ok" />, label: "from text" };
  if (f.kind === "default") return { cls: "border-l-warn bg-warn-soft/30", icon: <AlertTriangle aria-hidden className="size-3.5 text-warn" />, label: "default" };
  return { cls: "border-l-seal bg-seal-soft/40", icon: <ShieldAlert aria-hidden className="size-3.5 text-seal" />, label: "clamped" };
}

function Row({ path, label, value, flag }: { path: string; label: string; value: string; flag?: Flag }) {
  const s = flagStyle(flag);
  return (
    <li className={cx("grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 border-l-2 px-3 py-2 sm:grid-cols-[12rem_1fr]", s.cls)}>
      <div className="flex min-w-0 items-center gap-1.5">
        {s.icon}
        <span className="truncate text-xs text-muted" title={path}>{label}</span>
      </div>
      <div className="min-w-0">
        <span className="font-mono text-sm tabular break-words">{value}</span>
        {flag && (
          <p className={cx("mt-0.5 text-xs", flag.kind === "grounded" ? "text-muted" : flag.kind === "default" ? "text-warn" : "text-seal")}>
            <span className="sr-only">{s.label}: </span>
            {flag.note}
          </p>
        )}
      </div>
    </li>
  );
}

export function TreePreview({ tree, flags, issues }: { tree: RuleTree; flags: Record<string, Flag>; issues: Issue[] }) {
  const rows: { path: string; label: string; value: string }[] = [
    { path: "market.ticker", label: "Market", value: `${tree.market.ticker} · ${tree.market.type}${tree.market.class ? ` · ${tree.market.class}` : ""}` },
    { path: "entry.side", label: "Side", value: tree.entry.side },
    { path: "timeframe", label: "Timeframe", value: tree.timeframe },
    ...tree.entry.all.map((c, i) => ({ path: `entry.all[${i}]`, label: i === 0 ? "Entry (all of)" : "", value: describeCondition(c) })),
    tree.synthGate
      ? { path: "synthGate.minDirectionProb", label: "Synth P(direction) ≥", value: `${tree.synthGate.minDirectionProb} · ${tree.synthGate.asset} ${tree.synthGate.horizon}` }
      : { path: "synthGate", label: "Synth gate", value: "off (unverified agent)" },
    ...(tree.synthGate ? [{ path: "synthGate.maxBand90Bps", label: "Synth 5–95% band ≤", value: `${tree.synthGate.maxBand90Bps} bps` }] : []),
    tree.sizing.model === "pct_equity"
      ? { path: "sizing.pct", label: "Margin per entry", value: `${tree.sizing.pct}% of equity` }
      : { path: "sizing.usd", label: "Notional per entry", value: `$${tree.sizing.usd}` },
    { path: "sizing.leverage", label: "Leverage", value: `${tree.sizing.leverage}×` },
    { path: "sizing.maxNotionalUsd", label: "Max notional", value: `$${tree.sizing.maxNotionalUsd.toLocaleString()}` },
    { path: "exit.takeProfitPct", label: "Take profit", value: `${tree.exit.takeProfitPct}% · ${tree.exit.orderTypes.tp}` },
    { path: "exit.stopLossPct", label: "Stop loss", value: `${tree.exit.stopLossPct}% · ${tree.exit.orderTypes.sl}` },
    { path: "exit.maxHoldSec", label: "Max hold", value: `${(tree.exit.maxHoldSec / 3600).toFixed(1)} h` },
    { path: "risk.maxDailyDrawdownPct", label: "Daily drawdown freeze", value: `${tree.risk.maxDailyDrawdownPct}%` },
    { path: "risk.maxSlippageBps", label: "Max slippage", value: `${tree.risk.maxSlippageBps} bps` },
    { path: "risk.cooldownSec", label: "Cooldown", value: `${tree.risk.cooldownSec} s` },
  ];
  const dropped = Object.entries(flags).filter(([k]) => k.startsWith("dropped"));
  const counts = { grounded: 0, default: 0, clamped: 0 };
  for (const f of Object.values(flags)) counts[f.kind]++;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-3 pb-3 text-xs">
        <Badge tone="accent">{counts.grounded} from text</Badge>
        <Badge tone="warn">{counts.default} defaults</Badge>
        <Badge tone="danger">{counts.clamped} clamped</Badge>
      </div>
      <ul className="divide-y divide-border border-y border-border">
        {rows.map((r) => (
          <Row key={r.path} {...r} flag={flags[r.path]} />
        ))}
      </ul>
      {dropped.length > 0 && (
        <ul className="mt-3 space-y-1 px-3 text-xs text-seal">
          {dropped.map(([k, f]) => (
            <li key={k}>{f.note}</li>
          ))}
        </ul>
      )}
      {issues.length > 0 && (
        <div role="alert" className="mx-3 mt-3 rounded-md border border-danger/40 bg-danger-soft p-3 text-sm text-seal">
          <p className="font-medium">Rejected by the validator</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 font-mono text-xs">
            {issues.map((i) => (
              <li key={i.path + i.message}>
                {i.path}: {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
