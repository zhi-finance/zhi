# Zhi web app

Next.js 16 app for Zhi: landing page, markets terminal, agent launcher, leaderboard and agent pages. Reads live data from Injective (mainnet indexer for prices and candles, testnet for the order book, vaults and ERC-8004 identities).

## Run locally

```bash
pnpm install
pnpm dev            # http://localhost:3000
pnpm test           # rule-tree hash + validator parity with the Rust harness
pnpm sync           # refresh ABIs + deployment addresses from ../contracts
```

## Deploy on Vercel

1. Import the repository in Vercel.
2. Set **Root Directory** to `web`. Install and build commands come from `vercel.json`.
3. Optional environment variables (see `.env.example`):
   - `ANTHROPIC_API_KEY`: enables the LLM compiler at `/api/compile`. Without it, "Start from template" and everything else still work.
   - `NEXT_PUBLIC_ZHI_HARNESS`: harness address pre-filled in the deploy panel.

Contract addresses for Injective EVM testnet are committed in `lib/generated.ts`, so no other configuration is needed.
