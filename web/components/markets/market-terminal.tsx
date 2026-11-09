"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Search, ShieldCheck, Star } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMainnetMarkets } from "@/components/app-shell";
import { cx } from "@/components/ui";
import { fetchCandles, fetchTestnetBook, fetchTestnetTrades, fmtCompact, fmtPrice, type MainnetMarket } from "@/lib/injective-data";
import { fetchMarkets, type MarketInfo } from "@/lib/markets";
import { PriceChart } from "./price-chart";

const RES = [
  { l: "5m", m: 5 },
  { l: "15m", m: 15 },
  { l: "1h", m: 60 },
  { l: "4h", m: 240 },
  { l: "1d", m: 1440 },
];

const base = (t: string) => t.split(/[/ -]/)[0].toUpperCase();

function useFavourites() {
  const [fav, setFav] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("zhi:fav") ?? "[]");
    } catch {
      return [];
    }
  });
  const toggle = (b: string) =>
    setFav((f) => {
      const n = f.includes(b) ? f.filter((x) => x !== b) : [...f, b];
      try {
        localStorage.setItem("zhi:fav", JSON.stringify(n));
      } catch {}
      return n;
    });
  return { fav, toggle };
}

function SymbolSearch({ markets, deployable, current, onPick }: { markets: MainnetMarket[]; deployable: Set<string>; current: string; onPick: (b: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "crypto" | "stocks" | "deploy" | "fav">("all");
  const { fav, toggle } = useFavourites();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onDoc = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const list = markets.filter((m) => {
    if (q && !m.ticker.toLowerCase().includes(q.toLowerCase())) return false;
    if (tab === "crypto") return m.kind === "crypto";
    if (tab === "stocks") return m.kind === "stocks";
    if (tab === "deploy") return deployable.has(m.base);
    if (tab === "fav") return fav.includes(m.base);
    return true;
  });
  const pick = (b: string) => {
    onPick(b);
    setOpen(false);
    setQ("");
  };

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex h-11 items-center gap-2 rounded-lg px-2 text-xl font-semibold tracking-tight hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {current}-USD
        {deployable.has(current) && <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] font-normal text-ok">deployable</span>}
        <ChevronDown aria-hidden className="size-4 text-muted" />
      </button>
      {open && (
        <div className="absolute left-0 top-12 z-50 w-[min(640px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border-strong bg-surface shadow-2xl shadow-black/60">
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search aria-hidden className="size-4 text-muted" />
            <label htmlFor="mkt-q" className="sr-only">Search markets</label>
            <input
              id="mkt-q"
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && list[0] && pick(list[0].base)}
              placeholder="Search BTC, TSLA, gold, NVDA…"
              autoComplete="off"
              className="h-12 flex-1 bg-transparent text-[15px] placeholder:text-faint focus:outline-none"
            />
          </div>
          <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2" role="tablist">
            {(
              [
                ["all", "All"],
                ["crypto", "Crypto"],
                ["stocks", "Stocks & more"],
                ["deploy", "Deployable now"],
                ["fav", "Favourites"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx("whitespace-nowrap rounded-md px-3 py-1.5 text-sm", tab === k ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground")}>
                {l}
              </button>
            ))}
          </div>
          <ul className="max-h-[420px] overflow-y-auto" role="listbox" aria-label="Markets">
            {list.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted">{tab === "fav" ? "Star markets to keep them here." : "No markets match."}</li>}
            {list.slice(0, 200).map((m) => (
              <li key={m.marketId} role="option" aria-selected={m.base === current} className="grid grid-cols-[2rem_1fr_auto_5rem_5.5rem] items-center gap-2 px-2 text-sm hover:bg-surface-2">
                <button onClick={() => toggle(m.base)} aria-label={fav.includes(m.base) ? `Unstar ${m.base}` : `Star ${m.base}`} className="grid size-8 place-items-center text-muted hover:text-foreground">
                  <Star aria-hidden className={cx("size-4", fav.includes(m.base) && "fill-current text-warn")} />
                </button>
                <button onClick={() => pick(m.base)} className="flex h-11 items-center gap-2 text-left">
                  <span className="font-medium">{m.base}</span>
                  {deployable.has(m.base) && <ShieldCheck aria-label="deployable on testnet" className="size-3.5 text-ok" />}
                </button>
                <button onClick={() => pick(m.base)} className="text-right font-mono tabular">{fmtPrice(m.price)}</button>
                <span className={cx("text-right font-mono tabular", (m.change ?? 0) >= 0 ? "text-ok" : "text-seal")}>
                  {(m.change ?? 0) >= 0 ? "+" : ""}
                  {(m.change ?? 0).toFixed(2)}%
                </span>
                <span className="pr-2 text-right font-mono text-muted tabular">{fmtCompact(m.volume)}</span>
              </li>
            ))}
          </ul>
          <p className="label border-t border-border px-4 py-2">prices: Injective mainnet · ✓ deployable on testnet today</p>
        </div>
      )}
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: "ok" | "seal" }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{k}</p>
      <p className={cx("mt-0.5 font-mono text-[15px] tabular", tone === "ok" && "text-ok", tone === "seal" && "text-seal")}>{v}</p>
    </div>
  );
}

function BookTrades({ testnet }: { testnet: MarketInfo | undefined }) {
  const [tab, setTab] = useState<"book" | "trades">("book");
  const book = useQuery({ queryKey: ["book", testnet?.marketId], queryFn: () => fetchTestnetBook(testnet!.marketId), enabled: !!testnet, refetchInterval: 5_000 });
  const trades = useQuery({ queryKey: ["trades", testnet?.marketId], queryFn: () => fetchTestnetTrades(testnet!.marketId), enabled: !!testnet && tab === "trades", refetchInterval: 10_000 });
  const asks = (book.data?.asks ?? []).slice(0, 8).reverse();
  const bids = (book.data?.bids ?? []).slice(0, 8);
  const maxSize = Math.max(1e-9, ...asks.map((a) => a.size), ...bids.map((b) => b.size));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-border px-3 py-2" role="tablist">
        {(["book", "trades"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx("rounded-md px-3 py-1.5 text-sm", tab === t ? "bg-surface-2" : "text-muted hover:text-foreground")}>
            {t === "book" ? "Order book" : "Trades"}
          </button>
        ))}
        <span className="label ml-auto">testnet</span>
      </div>
      {!testnet ? (
        <p className="m-auto max-w-xs p-6 text-center text-sm text-muted">This market isn&apos;t listed on Injective testnet with USDC yet, so there&apos;s no testnet book to show. Pick a ✓ deployable market.</p>
      ) : tab === "book" ? (
        <div className="flex-1 font-mono text-[12.5px]">
          <div className="grid grid-cols-3 px-4 py-2 text-[11px] text-muted">
            <span>Price</span>
            <span className="text-right">Size</span>
            <span className="text-right">Total</span>
          </div>
          {book.isLoading && <p className="px-4 py-6 text-muted">Loading book…</p>}
          {book.data && asks.length + bids.length === 0 && <p className="px-4 py-6 text-muted">The testnet book is empty right now.</p>}
          {asks.map((a, i) => (
            <div key={`a${i}`} className="relative grid grid-cols-3 px-4 py-[3px] tabular">
              <span aria-hidden className="absolute inset-y-0 right-0 bg-seal/10" style={{ width: `${(a.size / maxSize) * 100}%` }} />
              <span className="relative text-seal">{fmtPrice(a.price)}</span>
              <span className="relative text-right">{a.size}</span>
              <span className="relative text-right text-muted">{fmtCompact(a.price * a.size)}</span>
            </div>
          ))}
          {asks.length > 0 && bids.length > 0 && (
            <div className="border-y border-border px-4 py-1.5 text-[11px] text-muted">
              spread {fmtPrice(asks.at(-1)!.price - bids[0].price)} · {(((asks.at(-1)!.price - bids[0].price) / bids[0].price) * 1e4).toFixed(0)} bps
            </div>
          )}
          {bids.map((b, i) => (
            <div key={`b${i}`} className="relative grid grid-cols-3 px-4 py-[3px] tabular">
              <span aria-hidden className="absolute inset-y-0 right-0 bg-ok/10" style={{ width: `${(b.size / maxSize) * 100}%` }} />
              <span className="relative text-ok">{fmtPrice(b.price)}</span>
              <span className="relative text-right">{b.size}</span>
              <span className="relative text-right text-muted">{fmtCompact(b.price * b.size)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto font-mono text-[12.5px]">
          <div className="grid grid-cols-3 px-4 py-2 text-[11px] text-muted">
            <span>Price</span>
            <span className="text-right">Size</span>
            <span className="text-right">Time</span>
          </div>
          {trades.data?.length === 0 && <p className="px-4 py-6 text-muted">No testnet trades yet.</p>}
          {trades.data?.map((t, i) => (
            <div key={i} className="grid grid-cols-3 px-4 py-[3px] tabular">
              <span className={t.side === "buy" ? "text-ok" : "text-seal"}>{fmtPrice(t.price)}</span>
              <span className="text-right">{t.size}</span>
              <span className="text-right text-muted">{new Date(t.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentPanel({ testnet, current, price }: { testnet: MarketInfo | undefined; current: string; price: number | null }) {
  const router = useRouter();
  const [side, setSide] = useState<"long" | "short">("long");
  const [lev, setLev] = useState(3);
  const [pct, setPct] = useState(10);
  const [tp, setTp] = useState(3);
  const [sl, setSl] = useState(1.5);
  const ok = !!testnet?.supported;
  const synth = !!testnet?.synthAsset;

  const build = () => {
    if (!testnet) return;
    const p = new URLSearchParams({ market: testnet.marketId, side, lev: String(lev), pct: String(pct), tp: String(tp), sl: String(sl) });
    router.push(`/terminal?${p.toString()}`);
  };

  const row = (label: string, value: string, input: React.ReactNode) => (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="font-mono tabular">{value}</span>
      </div>
      <div className="mt-2.5">{input}</div>
    </div>
  );

  return (
    <div className="flex h-full flex-col gap-5 p-4">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1" role="radiogroup" aria-label="Direction">
        {(["long", "short"] as const).map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={side === s}
            onClick={() => setSide(s)}
            className={cx("h-10 rounded-md text-sm font-medium capitalize transition-colors", side === s ? (s === "long" ? "bg-ok text-background" : "bg-seal text-white") : "text-muted hover:text-foreground")}
          >
            {s}
          </button>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted">
        Zhi doesn&apos;t place one-off orders. You set the rules once; your agent trades {current} inside them, and the vault enforces every limit.
      </p>
      {row("Leverage", `${lev}×`, <input type="range" className="range w-full" min={1} max={5} step={0.5} value={lev} onChange={(e) => setLev(Number(e.target.value))} aria-label="Leverage" />)}
      {row("Margin per entry", `${pct}% of vault`, <input type="range" className="range w-full" min={1} max={25} step={1} value={pct} onChange={(e) => setPct(Number(e.target.value))} aria-label="Margin per entry" />)}
      <div className="grid grid-cols-2 gap-4">
        {row("Take profit", `${tp}%`, <input type="range" className="range w-full" min={0.5} max={15} step={0.5} value={tp} onChange={(e) => setTp(Number(e.target.value))} aria-label="Take profit" />)}
        {row("Stop loss", `${sl}%`, <input type="range" className="range w-full" min={0.5} max={10} step={0.5} value={sl} onChange={(e) => setSl(Number(e.target.value))} aria-label="Stop loss" />)}
      </div>
      <dl className="space-y-1.5 rounded-lg border border-border p-3 text-sm">
        <div className="flex justify-between"><dt className="text-muted">Entry filter</dt><dd>EMA(20) {side === "long" ? ">" : "<"} EMA(50)</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Synth SN50 gate</dt><dd className={synth ? "text-ok" : "text-muted"}>{synth ? "on · P ≥ 60%" : "not covered"}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Daily freeze</dt><dd>−4%</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Stop at</dt><dd className="font-mono tabular">{price ? fmtPrice(side === "long" ? price * (1 - sl / 100) : price * (1 + sl / 100)) : "—"}</dd></div>
      </dl>
      <button
        onClick={build}
        disabled={!ok}
        className="mt-auto h-11 rounded-lg bg-foreground text-sm font-medium text-background transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {ok ? `Build ${side} agent on ${current}` : `${current} isn't deployable on testnet yet`}
      </button>
    </div>
  );
}

export function MarketTerminal() {
  const params = useSearchParams();
  const router = useRouter();
  const current = (params.get("m") ?? "BTC").toUpperCase();
  const [res, setRes] = useState(60);
  const mainnet = useMainnetMarkets();
  const testnet = useQuery({ queryKey: ["markets"], queryFn: fetchMarkets, staleTime: 60_000 });

  const m = mainnet.data?.find((x) => x.base === current);
  const tn = testnet.data?.find((x) => x.supported && base(x.ticker) === current) ?? testnet.data?.find((x) => base(x.ticker) === current);
  const deployable = useMemo(() => new Set((testnet.data ?? []).filter((x) => x.supported).map((x) => base(x.ticker))), [testnet.data]);
  const candles = useQuery({ queryKey: ["candles", m?.marketId, res], queryFn: () => fetchCandles(m!.marketId, res), enabled: !!m, refetchInterval: 30_000 });

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-border px-4 py-3">
        <SymbolSearch markets={mainnet.data ?? []} deployable={deployable} current={current} onPick={(b) => router.replace(`/markets?m=${encodeURIComponent(b)}`)} />
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <Stat k="Price" v={fmtPrice(m?.price)} />
          <Stat k="24h change" v={m?.change !== undefined && m?.change !== null ? `${m.change >= 0 ? "+" : ""}${m.change.toFixed(2)}%` : "—"} tone={(m?.change ?? 0) >= 0 ? "ok" : "seal"} />
          <Stat k="24h high / low" v={m ? `${fmtPrice(m.high)} / ${fmtPrice(m.low)}` : "—"} />
          <Stat k="24h volume" v={fmtCompact(m?.volume)} />
          <Stat k="Testnet mark" v={fmtPrice(tn?.markPrice ?? null)} />
        </div>
      </div>

      <div className="grid min-h-[calc(100svh-6.5rem-4.25rem)] lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col border-border lg:border-r">
          <div className="flex items-center gap-1 border-b border-border px-3 py-2">
            {RES.map((r) => (
              <button key={r.l} onClick={() => setRes(r.m)} aria-pressed={res === r.m} className={cx("rounded-md px-2.5 py-1 text-sm", res === r.m ? "bg-surface-2" : "text-muted hover:text-foreground")}>
                {r.l}
              </button>
            ))}
            <span className="label ml-auto">price history · Injective mainnet</span>
          </div>
          <div className="relative min-h-[380px] flex-1">
            {candles.error ? (
              <p className="absolute inset-0 grid place-items-center text-sm text-muted">Couldn&apos;t load candles from Injective. Retrying…</p>
            ) : !m && mainnet.data ? (
              <p className="absolute inset-0 grid place-items-center text-sm text-muted">No mainnet market for {current}.</p>
            ) : (
              <PriceChart candles={candles.data ?? []} />
            )}
          </div>
          <div className="h-[340px] border-t border-border">
            <BookTrades testnet={tn?.supported ? tn : undefined} />
          </div>
        </div>
        <aside aria-label="Build an agent" className="border-t border-border lg:border-t-0">
          <AgentPanel testnet={tn} current={current} price={m?.price ?? null} />
        </aside>
      </div>
    </div>
  );
}
