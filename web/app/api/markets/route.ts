// GET /api/markets — active Injective testnet derivative markets with Zhi metadata
// (asset class for the iAsset liveness rule, Synth SN50 coverage, tick sizes).
import { LCD, USDC } from "@/lib/chain";
import { synthHorizons } from "@/lib/ruletree/types";

const EQUITIES: Record<string, string> = { TSLA: "TSLA", NVDA: "NVDA", AAPL: "AAPL", GOOGL: "GOOGL", SPY: "SP500", SPX: "SP500" };
const COMMODITIES: Record<string, string> = { XAU: "XAU", GOLD: "XAU", WTI: "WTIOIL", XAG: "" };

/** Oracle types the oracle precompile (0x67) supports: Injective Oracle.sol. */
const ORACLE_TYPES: Record<string, number> = { PriceFeed: 2, Coinbase: 3, Pyth: 9, Provider: 11, Stork: 12, ChainlinkDataStreams: 13 };

function trimDecimal(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Exact base-10 shift of a decimal string (no floats). */
function shiftDecimal(s: string, by: number): string {
  const [i, f = ""] = s.split(".");
  const digits = (i + f).replace(/^0+(?=\d)/, "");
  const point = i.length + by;
  const padded = point <= 0 ? "0".repeat(1 - point) + digits : digits.padEnd(point, "0");
  const p = Math.max(point, 1);
  return trimDecimal(padded.slice(0, p) + "." + padded.slice(p)).replace(/^0+(?=\d)/, "");
}

interface LcdMarket {
  market: {
    ticker: string; market_id: string; quote_denom: string; oracle_type: string; oracle_base: string; oracle_quote: string;
    min_price_tick_size: string; min_quantity_tick_size: string; isPerpetual?: boolean;
  };
  mark_price?: string;
}

export async function GET() {
  try {
    const res = await fetch(`${LCD}/injective/exchange/v1beta1/derivative/markets?status=Active`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`LCD HTTP ${res.status}`);
    const data = (await res.json()) as { markets: LcdMarket[] };
    const markets = data.markets.map(({ market: m, mark_price }) => {
      const base = m.ticker.split(/[/-]/)[0].toUpperCase();
      const cls = base in EQUITIES ? "equity" : base in COMMODITIES ? "commodity" : "crypto";
      const synthAsset = cls === "equity" ? EQUITIES[base] : cls === "commodity" ? COMMODITIES[base] || null : base;
      const quoteDecimals = 6; // USDC / USDT on Injective
      return {
        ticker: m.ticker,
        oracleTypeId: ORACLE_TYPES[m.oracle_type] ?? null,
        oracleBase: m.oracle_base,
        oracleQuote: m.oracle_quote,
        // exact decimal strings for the vault's 18-dp tick checks (chain price tick / 10^quoteDecimals)
        priceTickStr: shiftDecimal(m.min_price_tick_size, -quoteDecimals),
        qtyTickStr: trimDecimal(m.min_quantity_tick_size),
        marketId: m.market_id,
        type: "derivative" as const,
        class: cls,
        synthAsset: synthAsset && synthHorizons(synthAsset).length ? synthAsset : null,
        quoteDenom: m.quote_denom,
        // vaults hold native USDC; the oracle precompile must support the market's oracle type
        supported: m.quote_denom.toLowerCase() === `erc20:${USDC}`.toLowerCase() && m.oracle_type in ORACLE_TYPES,
        oracleType: m.oracle_type,
        priceTick: Number(m.min_price_tick_size) / 10 ** quoteDecimals,
        qtyTick: Number(m.min_quantity_tick_size),
        markPrice: mark_price ? Number(mark_price) / 10 ** quoteDecimals : null,
      };
    });
    markets.sort((a, b) => Number(b.supported) - Number(a.supported) || Number(!!b.synthAsset) - Number(!!a.synthAsset) || a.ticker.localeCompare(b.ticker));
    return Response.json({ markets });
  } catch (e) {
    return Response.json({ error: (e as Error).message, markets: [] }, { status: 502 });
  }
}
