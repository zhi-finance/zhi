"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { fetchAgents, type AgentRow } from "@/lib/agents";
import { ADDR } from "@/lib/chain";
import { ago, short, usd } from "@/lib/format";
import { SealMark } from "./fx/seal-mark";
import { cx } from "./ui";

type Sort = "score" | "equity" | "today" | "executed";

const today = (a: AgentRow) => (a.equity !== null && a.epochStartEquity > 0 ? ((a.equity - a.epochStartEquity) / a.epochStartEquity) * 100 : null);
const adherence = (a: AgentRow) => (a.intents ? (1 - a.adherenceSkips / a.intents) * 100 : 100);

function Status({ a }: { a: AgentRow }) {
  if (a.frozen) return <span className="inline-flex items-center gap-1.5 rounded-full border border-seal/40 px-2.5 py-0.5 text-xs text-seal"><span className="size-1.5 rounded-full bg-seal" />Frozen</span>;
  if (!a.equity) return <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted">Unfunded</span>;
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/40 px-2.5 py-0.5 text-xs text-ok"><span className="pulse-dot size-1.5 rounded-full bg-ok" />Live</span>;
}

function Avatar({ id }: { id: bigint }) {
  return (
    <span className="relative grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-surface-2">
      <SealMark size={22} />
      <span className="absolute -bottom-1.5 -right-1.5 rounded bg-background px-1 font-mono text-[10px] text-muted">#{id.toString()}</span>
    </span>
  );
}

export function Leaderboard({ operator }: { operator?: string }) {
  const q = useQuery({ queryKey: ["agents"], queryFn: fetchAgents, refetchInterval: 20_000 });
  const [sort, setSort] = useState<Sort>("score");

  if (!ADDR.factory) return <p className="text-muted">Protocol not deployed on this network.</p>;
  if (q.error) return <p role="alert" className="text-seal">Couldn&apos;t read agents from Injective testnet. {(q.error as Error).message}</p>;

  const rows = (q.data ?? [])
    .filter((a) => !operator || a.operator.toLowerCase() === operator.toLowerCase())
    .sort((a, b) => {
      if (sort === "equity") return (b.equity ?? 0) - (a.equity ?? 0);
      if (sort === "today") return (today(b) ?? -1e9) - (today(a) ?? -1e9);
      if (sort === "executed") return b.executions - a.executions;
      return b.score - a.score || (b.equity ?? 0) - (a.equity ?? 0) || b.executions - a.executions;
    });
  const podium = rows.slice(0, 3);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm text-muted">
          <span aria-hidden className="pulse-dot size-1.5 rounded-full bg-ok" /> Live, read from vault events on Injective
        </span>
        <div className="ml-auto flex gap-1 rounded-lg border border-border p-1" role="radiogroup" aria-label="Sort by">
          {(
            [
              ["score", "Zhi Score"],
              ["equity", "Equity"],
              ["today", "Today"],
              ["executed", "Trades"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={sort === k} onClick={() => setSort(k)} className={cx("rounded-md px-3 py-1.5 text-sm", sort === k ? "bg-surface-2" : "text-muted hover:text-foreground")}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-56 animate-pulse rounded-2xl border border-border bg-surface motion-reduce:animate-none" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-border px-6 py-16 text-center">
          <p className="font-medium">{operator ? "You haven't launched an agent yet." : "No agents yet."}</p>
          <p className="mt-1 text-sm text-muted">Describe an idea, sign the rules, and your vault goes live on Injective testnet.</p>
          <Link href="/terminal" className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background">
            Launch an agent <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>
      ) : (
        <>
          <ol className="grid gap-4 md:grid-cols-3">
            {podium.map((a, i) => {
              const t = today(a);
              return (
                <li key={a.vault} className="flex flex-col rounded-2xl border border-border bg-surface p-6">
                  <div className="flex items-start gap-3">
                    <Avatar id={a.agentId} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">Agent #{a.agentId.toString()}</p>
                      <p className="truncate font-mono text-xs text-muted">{short(a.operator)} · {ago(a.createdAt)}</p>
                    </div>
                    <span className="label ml-auto">#{i + 1}</span>
                  </div>
                  <p className={cx("mt-6 font-mono text-4xl tracking-tight tabular", t === null ? "text-muted" : t >= 0 ? "text-ok" : "text-seal")}>
                    {t === null ? "—" : `${t >= 0 ? "+" : ""}${t.toFixed(2)}%`}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    today · equity {a.equity === null ? "unreadable" : usd(a.equity)} · score {a.score || "pending"}
                  </p>
                  <div className="mt-5 flex items-center gap-3">
                    <Status a={a} />
                    <span className="text-xs text-muted">{a.executions} trades · {adherence(a).toFixed(0)}% adherence</span>
                  </div>
                  <Link href={`/agents/${a.vault}`} className="mt-6 inline-flex h-9 w-fit items-center rounded-full border border-border-strong px-4 text-sm hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    View
                  </Link>
                </li>
              );
            })}
          </ol>

          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[860px] text-sm">
              <caption className="sr-only">All agents</caption>
              <thead>
                <tr className="border-b border-border">
                  {["#", "Agent", "Equity", "Today", "Intents · executed", "Adherence", "Zhi Score", "Status", ""].map((h) => (
                    <th key={h} scope="col" className="label px-5 py-3.5 text-left font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((a, i) => {
                  const t = today(a);
                  return (
                    <tr key={a.vault} className="border-b border-border last:border-0 hover:bg-surface">
                      <td className="px-5 py-4 font-mono text-muted">{i + 1}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <Avatar id={a.agentId} />
                          <div>
                            <p className="font-medium">Agent #{a.agentId.toString()}</p>
                            <p className="font-mono text-xs text-muted">{short(a.vault)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 font-mono tabular">{a.equity === null ? "—" : usd(a.equity)}</td>
                      <td className={cx("px-5 py-4 font-mono tabular", t === null ? "text-muted" : t >= 0 ? "text-ok" : "text-seal")}>{t === null ? "—" : `${t >= 0 ? "+" : ""}${t.toFixed(2)}%`}</td>
                      <td className="px-5 py-4 font-mono tabular">{a.intents} · {a.executions}</td>
                      <td className="px-5 py-4 font-mono tabular">{adherence(a).toFixed(1)}%</td>
                      <td className="px-5 py-4 font-mono tabular">{a.score || <span className="text-muted">pending</span>}</td>
                      <td className="px-5 py-4"><Status a={a} /></td>
                      <td className="px-5 py-4 text-right">
                        <Link href={`/agents/${a.vault}`} className="inline-flex h-8 items-center rounded-full border border-border-strong px-3 text-xs hover:bg-surface-2">View</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
