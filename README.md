# Zhi 智

**The model plans once. The subnet verifies. The chain enforces.**

Zhi is the safe execution layer for AI trading agents on Injective. An LLM compiles a trading thesis once into a signed, schema-bounded rule tree; a deterministic Rust harness evaluates it on Injective market data; Bittensor **Synth (SN50)** must agree before any entry; and an on-chain **Guardrail Vault** on Injective EVM enforces risk limits no prompt can override, trading the native orderbook through the exchange precompile. Every fill and skip becomes ERC-8004 reputation evidence.

Implements the Zhi PRD v2 (10 Nov 2026), P0 end to end plus P1/P2 contracts.

```
thesis ──► compiler (Claude, once) ──► EIP-712 sign-off ──► rule tree hash on vault
                                                                 │
Injective oracle/book ──► Rust harness (fixed-point, replayable) ◄─┤◄── Synth SN50 gate
                                   │ signed intent                 │
                                   ▼                               │
        Guardrail Vault (Injective EVM 1439) ── 0x65 exchange ──► native orderbook
         │ events            ▲ poke() by anyone                     fee recipient = vault
         ▼                   │
   ZhiAttestor ──► ERC-8004 Reputation ──► Zhi Score ──► AllocatorVault (4626) / CreditPool
```

## Live on Injective EVM testnet (chain 1439)

| Contract | Address |
|---|---|
| ZhiFactory | [`0xc29CD98f79A6701f74d67FB8C76d244a16453497`](https://testnet.blockscout.injective.network/address/0xc29CD98f79A6701f74d67FB8C76d244a16453497) |
| ZhiAttestor | [`0xCffA9121FcD58041Df9bc7B51db13F9A0Db9aaD7`](https://testnet.blockscout.injective.network/address/0xCffA9121FcD58041Df9bc7B51db13F9A0Db9aaD7) |
| CreditPool | [`0xB61DfbC378321e98f9B4143596860eCFB27ED5E6`](https://testnet.blockscout.injective.network/address/0xB61DfbC378321e98f9B4143596860eCFB27ED5E6) |
| Demo agent #72 vault (BTC/USDC PERP) | [`0x9e229Bd01D43b2Ce6774c67c3843B316285E8f26`](https://testnet.blockscout.injective.network/address/0x9e229Bd01D43b2Ce6774c67c3843B316285E8f26) · fee recipient `inj1nc3fh5qagwevuem5ce7rssanzc59arexqek02u` |

## Deploy the web app (Vercel)

Import this repository in Vercel and set **Root Directory** to `web`. The install and build commands are pinned in `web/vercel.json`. Optionally set `ANTHROPIC_API_KEY` to enable the LLM compiler; every other page works without configuration because the testnet contract addresses are committed in `web/lib/generated.ts`.

## Repository

| Path | What | Stack |
|---|---|---|
| `contracts/` | GuardrailVault, ZhiFactory, ZhiAttestor, AllocatorVault, CreditPool, Bech32/VaultOps libs, vendored Injective precompile interfaces | Solidity 0.8.24, Foundry |
| `harness/crates/zhi-core` | Rule tree DSL + validator, canonical JSON/keccak, 18-dp fixed-point math, indicators, Synth gate, intent sizing + ABI hashing, decision log + replay, Zhi Score | Rust |
| `harness/crates/zhi-cli` | `zhi` binary: `hash`, `validate`, `run`, `replay`, `backtest`, `attest`, `status`, `poke` | Rust, alloy 2 |
| `web/` | Landing, terminal (compile → preview → sign → deploy), leaderboard, agent page, docs; `/api/compile` (Claude), `/api/markets` | Next.js 16, wagmi 3, viem |
| `fixtures/` | Shared rule tree + hashes every language must agree on | |

## Status: what is verified

| Check | Result |
|---|---|
| Contracts: unit tests for every skip reason, timelocks, poke, capital, credit | `forge test`: **59/59 pass** |
| Invariant fuzz: breached vault never left unfrozen; no out-of-bounds order; nonce accounting | 3 invariants × 128 runs × 64 depth (8,192 calls each, 0 reverts) |
| Fuzz: no LP loss when gap loss < 0.5F (REQ-15) | 512 runs pass |
| HWM performance fee over 30 simulated epochs (REQ-13) | pass |
| Live-fork test vs Injective testnet: factory registers a **real ERC-8004 identity**, operator owns it, EIP-712 sign-off verifies | pass (`make test-fork`) |
| Live precompile reads on testnet: oracle `0x67` (BTC/USDC ≈ 74.3k, 2 s old), exchange `0x65` | verified with `cast` |
| Rust core: fixed-point, indicators, Synth gate, sizing, replay detects tampering, score | `cargo test`: **24/24 pass** |
| Rule tree hash: Rust = TypeScript = Python + `cast keccak` | `0xd3cde509…83081f` |
| Intent hash: Rust `abi_encode` = Solidity encoder (`cast abi-encode`) | `0xf7455619…25a190` |
| Web: validator parity with Rust, malicious-post compile stays bounded | `vitest`: **10/10 pass**, `next build` clean, lint clean |
| Backtest on real Injective candles | 7 days, 2,998 mainnet BTC/USDC 5m candles |

**Not yet verified (needs things this machine doesn't have):** live order placement through `0x65` from the vault (needs funded testnet keys + testnet USDC), the LLM compile call (needs `ANTHROPIC_API_KEY`), the Synth-gated live/backtest runs (needs `SYNTH_API_KEY`). Foundry's EVM doesn't implement Injective precompiles, so local tests use stateful mocks etched at `0x65`/`0x67`; the fork test confirms the vault fails closed when they are absent.

## Quick start

```bash
cp web/.env.example web/.env.local   # add ANTHROPIC_API_KEY to enable the LLM compiler
make build && make test              # contracts + harness + web
make web                             # http://localhost:3000
```

### Go live on Injective testnet (chain 1439)

1. Fund the deployer printed by `make balances` with testnet INJ (and testnet USDC for deposits) at https://testnet.faucet.injective.network
2. `make deploy`: factory, attestor, credit pool; writes `contracts/deployments/injective-testnet.json` and syncs the web app
3. `make fund`: gas for the harness key
4. `make agent DEPOSIT_USDC=100000000`: BTC/USDC PERP vault + ERC-8004 identity + signed rule tree (+100 USDC)
5. `make harness-dry`, then `make harness` (add `SYNTH_API_KEY` to `.env` for the gate; without it every entry fails closed as `SYNTH_UNAVAILABLE`, by design)
6. `make replay`, `make attest`, `make status`, `make poke`

Or do steps 4+ from the web terminal with any injected wallet (MetaMask/Rabby on Injective EVM testnet).

## Demo script (PRD §15) → where it lives

| Step | How |
|---|---|
| 1. Paste a real X post → rule tree with yellow defaults → sign | Terminal: Compile → preview (green/yellow/red provenance) → Deploy (EIP-712) |
| 2. Agent in the ERC-8004 registry with the vault as fee recipient | Factory mints the identity with `feeRecipient` metadata = vault's own `inj1…` (derived on-chain via Bech32); NFT transferred to the operator |
| 3. Entry true + Synth agrees → order on the native orderbook, `ExecutionLogged` | `zhi run`; agent page evidence feed links each tx |
| 4. Synth disagrees → `TradeSkipped(SYNTH_DIRECTION)` with forecast hash | Harness calls `logGateSkip`; hash = keccak256(raw Synth body) |
| 5. Malicious post → bounded tree; forged 20× intent skipped as `LEVERAGE` | "prompt-injection sample" in the terminal; `test_skip_LEVERAGE` |
| 6. Force drawdown, kill harness, `poke()` from a stranger → frozen | Agent page `poke()` button or `zhi poke`; `test_poke_strangerFreezesWithHarnessOffline` |
| 7. Daily ERC-8004 feedback and Zhi Score | `zhi attest --post` → 4 `giveFeedback` calls via ZhiAttestor |

## Design decisions beyond the PRD

- **Skip enum** extends the PRD's 10 reasons with `OFF_TICK`, `EQUITY_UNREADABLE`, `ORDER_FAILED`, and `SYNTH_DIRECTION/REGIME/UNAVAILABLE` (recorded on-chain via `logGateSkip`, so gate skips are public evidence too).
- **Drawdown is checked against the old baseline before the epoch rolls**, so a loss spanning midnight can't be forgiven by the roll itself (`test_epochRoll_doesNotForgiveBreach`).
- **Exits never need a live oracle** (iAsset off-hours): reduce-only intents skip the freshness check but keep the worst-price cap.
- **Equity read fails closed** if any component (bank balance, subaccount, positions, oracle) is unreadable; entries skip, exits still allowed.
- **Fee recipient is computed on-chain** (`VaultOps.injAddress`, BIP-173 bech32, tested against Injective's docs vector), so an operator can't route the 40% fee share elsewhere.
- **Vaults are EIP-1167 clones**; order construction lives in an externally linked library to keep the vault under EIP-170 (24,201 / 24,576 bytes).
- **Attestor finalization**: one score waits out its 72h window at a time, so daily posts can't keep restarting it.
- **Credit requires the operator to be the vault's sole equity holder** while borrowing, so first-loss is unambiguous.
- **Market data**: the harness samples the same oracle precompile the vault checks and builds candles locally; warm-up uses Injective mainnet chart candles for the same asset (testnet has none). Chain Stream gRPC is the production transport; the poller implements the same logged-inputs contract.

## Security notes

Testnet software, unaudited. The PRD's threat model applies (§17). The harness key can only call `executeIntent`/`logGateSkip`; loosening bounds, adding markets and unfreezing are 24h-timelocked; tightening is instant. The compiler fetches URLs server-side with DNS-resolved private-address blocking on every redirect hop. Synth responses are trusted-but-auditable (hash on-chain, raw body in the harness log).
