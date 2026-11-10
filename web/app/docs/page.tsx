import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { ADDR, IDENTITY_REGISTRY, REPUTATION_REGISTRY, USDC, addrUrl } from "@/lib/chain";

export const metadata: Metadata = { title: "How it works" };

const skips = [
  ["0", "FROZEN", "Frozen (or credit reduce-only) vaults accept reduce-only exits only"],
  ["1", "BAD_RULETREE", "Intent cites a rule tree hash the owner never signed (or revoked)"],
  ["2", "EXPIRED", "block.timestamp > intent.deadline"],
  ["3", "MARKET_NOT_ALLOWED", "Market not on the vault allowlist"],
  ["4", "COOLDOWN", "Too soon after the previous entry"],
  ["5", "NOTIONAL", "quantity × worstPrice > maxNotional"],
  ["6", "LEVERAGE", "margin = 0 or notional ÷ margin > maxLeverage"],
  ["7", "ORACLE_STALE", "Injective oracle reference missing or older than maxOracleAgeSec (entries only)"],
  ["8", "PRICE_DEVIATION", "worstPrice further than maxDeviationBps from the oracle reference"],
  ["9", "DRAWDOWN", "This intent found the daily drawdown breached and froze the vault"],
  ["10", "OFF_TICK", "Quantity or price not on the market's tick sizes"],
  ["11", "EQUITY_UNREADABLE", "Fail closed: equity could not be read for an entry"],
  ["12", "ORDER_FAILED", "Exchange precompile rejected the order (no revert, evidence kept)"],
  ["13–15", "SYNTH_*", "Off-chain gate verdict recorded on-chain with the forecast hash"],
];

const resolved = [
  ["Oracle precompile address", "0x…0067, interface IOracleModule (InjectiveLabs/solidity-contracts src/Oracle.sol). Verified live: oraclePricePairState(13, BTC feed, USDC feed) returns a 2-second-old price on testnet."],
  ["ERC-8004 registries on Injective", `Identity ${IDENTITY_REGISTRY}, Reputation ${REPUTATION_REGISTRY} on testnet; reference giveFeedback signature and self-feedback rule confirmed in source and exercised in a fork test.`],
  ["ExchangeTypes fields", "DerivativeOrder {marketID, subaccountID, feeRecipient, price, quantity, cid, orderType, margin, triggerPrice}; reduce-only = margin 0."],
  ["Synth API", "GET /insights/prediction-percentiles?asset&horizon(&start_time) with Authorization: Apikey; 9 levels 0.005–0.995 per step. Equities use SP500/NVDA/TSLA/AAPL/GOOGL symbols."],
];

export default function Docs() {
  return (
    <article className="mx-auto max-w-4xl space-y-12 px-4 py-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">How Zhi works</h1>
        <p className="mt-3 text-muted">
          Three trust boundaries separate the parts: the LLM can only propose a rule tree, the harness can only propose an intent, and only the Guardrail Vault can
          place an order. Each layer distrusts the one above it.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">1. Compile once, sign the hash</h2>
        <p className="text-muted">
          The compiler sends your text to Claude as quoted data with a JSON-schema-constrained output. Deterministic code then decides what is accepted: values not
          grounded in the text become operator defaults (yellow), values above your presets are clamped (red), unknown keys fail. The canonical JSON (sorted keys,
          minimal numbers) is hashed with keccak256; you sign that hash with EIP-712 and the vault stores it. TypeScript, Rust and an independent Python
          implementation produce the same hash for the shared fixture.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">2. The deterministic harness</h2>
        <p className="text-muted">
          A Rust service (<code className="font-mono">zhi run</code>) samples the Injective oracle precompile, builds candles locally, evaluates the frozen tree in
          18-decimal fixed point, asks Synth before entries, and submits intents. Every tick is logged with its inputs and the raw Synth body;{" "}
          <code className="font-mono">zhi replay</code> re-runs the log and must reproduce every intent hash bit-for-bit.
        </p>
        <pre className="overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-xs leading-relaxed">{`# hash + validate a rule tree
zhi hash ruletree.json
zhi validate ruletree.json --vault 0xVAULT

# run the harness (testnet)
HARNESS_PRIVATE_KEY=0x… SYNTH_API_KEY=… zhi run --tree ruletree.json --vault 0xVAULT

# prove determinism
zhi replay logs/0xvault.jsonl

# with vs without the Synth gate, on Injective candle history
zhi backtest --tree ruletree.json --days 30

# daily evidence -> Zhi Score -> ERC-8004 feedback
zhi attest --vault 0xVAULT --attestor 0xATTESTOR --post

# anyone: enforce the drawdown freeze
zhi poke --vault 0xVAULT`}</pre>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">3. Synth SN50 gate</h2>
        <p className="text-muted">
          On the last time step of the horizon the harness interpolates the forecast CDF F at the current oracle price P₀. A long needs P(up) = 1 − F(P₀) ≥ the
          tree&apos;s threshold (shorts mirror it), and the 5–95% band (p95 − p05) / P₀ × 10⁴ must be under the tree&apos;s ceiling. Failing either check, or Synth
          being unreachable, skips the trade and records <code className="font-mono">TradeSkipped(SYNTH_*)</code> on-chain with keccak256 of the raw response.
          The gate is a filter that reduces bad entries; the backtester reports the same tree with and without it.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">4. Guardrail Vault checks</h2>
        <p className="text-muted">Each failure emits TradeSkipped(reason) and returns false. Nothing reverts, so the evidence and the consumed nonce persist.</p>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Code</th>
                <th scope="col" className="px-4 py-2 font-medium">Reason</th>
                <th scope="col" className="px-4 py-2 font-medium">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {skips.map(([c, r, m]) => (
                <tr key={r} className="border-t border-border">
                  <td className="px-4 py-2 font-mono text-muted">{c}</td>
                  <td className="px-4 py-2 font-mono text-accent">{r}</td>
                  <td className="px-4 py-2">{m}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Contracts (Injective EVM testnet, chain 1439)</h2>
        <ul className="space-y-1 font-mono text-sm">
          {[
            ["ZhiFactory", ADDR.factory],
            ["ZhiAttestor", ADDR.attestor],
            ["CreditPool", ADDR.creditPool],
            ["ERC-8004 Identity", IDENTITY_REGISTRY],
            ["ERC-8004 Reputation", REPUTATION_REGISTRY],
            ["USDC", USDC],
          ].map(([k, a]) => (
            <li key={k} className="flex flex-wrap gap-x-3">
              <span className="w-44 text-muted">{k}</span>
              {a ? <a className="break-all hover:underline" href={addrUrl(a)} target="_blank" rel="noreferrer">{a}</a> : <span className="text-muted">not deployed yet</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">PRD open questions closed during the build</h2>
        <ul className="space-y-3">
          {resolved.map(([q, a]) => (
            <li key={q}>
              <p className="font-medium">{q}</p>
              <p className="text-sm text-muted break-words">{a}</p>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
