import { defineChain } from "viem";
import { deployment } from "./generated";

export const RPC = process.env.NEXT_PUBLIC_INJ_RPC ?? "https://k8s.testnet.json-rpc.injective.network";
export const LCD = process.env.INJ_LCD ?? "https://testnet.sentry.lcd.injective.network";
export const EXPLORER = "https://testnet.blockscout.injective.network";
export const EXPLORER_API = `${EXPLORER}/api/v2`;
export const FAUCET = "https://testnet.faucet.injective.network";

export const injectiveTestnet = defineChain({
  id: 1439,
  name: "Injective EVM Testnet",
  nativeCurrency: { name: "Injective", symbol: "INJ", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

type Hex = `0x${string}`;
const env = (k: string | undefined) => (k && /^0x[0-9a-fA-F]{40}$/.test(k) ? (k as Hex) : undefined);

/** ERC-8004 registries live on Injective testnet (erc-8004/erc-8004-contracts README). */
export const IDENTITY_REGISTRY: Hex = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
export const REPUTATION_REGISTRY: Hex = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
export const USDC: Hex = "0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d";
export const USDC_DECIMALS = 6;

export const ADDR = {
  factory: env(process.env.NEXT_PUBLIC_ZHI_FACTORY) ?? deployment?.factory,
  attestor: env(process.env.NEXT_PUBLIC_ZHI_ATTESTOR) ?? deployment?.attestor,
  creditPool: env(process.env.NEXT_PUBLIC_ZHI_CREDIT_POOL) ?? deployment?.creditPool,
};

/** Default harness operated by Zhi (hosted tier). Operators can paste their own. */
export const DEFAULT_HARNESS = env(process.env.NEXT_PUBLIC_ZHI_HARNESS);

export const SKIP_REASONS = [
  "FROZEN", "BAD_RULETREE", "EXPIRED", "MARKET_NOT_ALLOWED", "COOLDOWN", "NOTIONAL", "LEVERAGE", "ORACLE_STALE",
  "PRICE_DEVIATION", "DRAWDOWN", "OFF_TICK", "EQUITY_UNREADABLE", "ORDER_FAILED", "SYNTH_DIRECTION", "SYNTH_REGIME", "SYNTH_UNAVAILABLE",
] as const;

export const INVARIANT_SKIPS = new Set(["NOTIONAL", "LEVERAGE", "MARKET_NOT_ALLOWED", "PRICE_DEVIATION", "BAD_RULETREE", "OFF_TICK"]);

export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;
export const tokenUrl = (registry: string, id: string | bigint) => `${EXPLORER}/token/${registry}/instance/${id}`;
