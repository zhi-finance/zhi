"use client";

import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import type { Candle } from "@/lib/injective-data";
import { fmtPrice } from "@/lib/injective-data";

const UP = "#7fcf9e";
const DOWN = "#e2492f";

export function PriceChart({ candles, refLine }: { candles: Candle[]; refLine?: { price: number; label: string } | null }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<{ c: ISeriesApi<"Candlestick">; v: ISeriesApi<"Histogram"> } | null>(null);
  const [hover, setHover] = useState<Candle | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8f8f8a", fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: "#161616" }, horzLines: { color: "#161616" } },
      rightPriceScale: { borderColor: "#232323" },
      timeScale: { borderColor: "#232323", timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#5c5c58", labelBackgroundColor: "#232323" }, horzLine: { color: "#5c5c58", labelBackgroundColor: "#232323" } },
    });
    const cs = c.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, priceLineColor: "#ededea" });
    const vs = c.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    cs.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    c.subscribeCrosshairMove((p) => {
      const d = p.seriesData.get(cs) as { open: number; high: number; low: number; close: number; time: number } | undefined;
      setHover(d ? { time: d.time, open: d.open, high: d.high, low: d.low, close: d.close, volume: 0 } : null);
    });
    chart.current = c;
    series.current = { c: cs, v: vs };
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, []);

  useEffect(() => {
    const s = series.current;
    if (!s) return;
    s.c.setData(candles.map((k) => ({ time: k.time as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close })));
    s.v.setData(candles.map((k) => ({ time: k.time as UTCTimestamp, value: k.volume, color: k.close >= k.open ? "rgba(127,207,158,.35)" : "rgba(226,73,47,.35)" })));
    chart.current?.timeScale().fitContent();
  }, [candles]);

  useEffect(() => {
    const s = series.current;
    if (!s || !refLine) return;
    const line = s.c.createPriceLine({ price: refLine.price, color: "#ededea", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: refLine.label });
    return () => s.c.removePriceLine(line);
  }, [refLine]);

  const last = hover ?? candles.at(-1) ?? null;
  return (
    <div className="relative h-full min-h-[360px]">
      {last && (
        <p className="pointer-events-none absolute left-3 top-2 z-10 flex flex-wrap gap-x-4 font-mono text-[11px] text-muted">
          <span>O <span className="text-foreground">{fmtPrice(last.open)}</span></span>
          <span>H <span className="text-foreground">{fmtPrice(last.high)}</span></span>
          <span>L <span className="text-foreground">{fmtPrice(last.low)}</span></span>
          <span>C <span className={last.close >= last.open ? "text-ok" : "text-seal"}>{fmtPrice(last.close)}</span></span>
        </p>
      )}
      <div ref={el} className="absolute inset-0" role="img" aria-label="Price chart" />
    </div>
  );
}
