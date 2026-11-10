# Zhi — one entry point for build, test, deploy and run. Reads secrets from ./.env (git-ignored).
SHELL := /bin/bash
-include .env
export

RPC        ?= https://k8s.testnet.json-rpc.injective.network
TREE       ?= fixtures/ruletree.example.json
ZHI        := harness/target/release/zhi
DEP        := contracts/deployments/injective-testnet.json
VAULT      ?= $(shell cat .vault 2>/dev/null)
VAULT_LC    = $(shell echo $(VAULT) | tr A-F a-f)

.PHONY: all build test test-contracts test-harness test-web test-fork deploy agent fund harness harness-dry replay attest status poke web balances

all: build test

build:
	cd contracts && forge build
	cd harness && cargo build --release
	cd web && pnpm install && node scripts/sync-abi.mjs

test: test-contracts test-harness test-web

test-contracts:
	cd contracts && forge test

test-fork:
	cd contracts && FORK=1 forge test --match-path "test/fork/*" -vv

test-harness:
	cd harness && cargo test

test-web:
	cd web && npx vitest run && npx tsc --noEmit

balances:
	@echo "deployer $(DEPLOYER_ADDRESS): $$(cast balance $(DEPLOYER_ADDRESS) -r $(RPC) --ether) INJ, $$(cast call 0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d 'balanceOf(address)(uint256)' $(DEPLOYER_ADDRESS) -r $(RPC)) USDC (6dp)"
	@echo "harness  $(HARNESS_ADDRESS): $$(cast balance $(HARNESS_ADDRESS) -r $(RPC) --ether) INJ"

## Deploy protocol singletons (factory, attestor, credit pool) and point the web app at them
deploy:
	cd contracts && forge script script/Deploy.s.sol --rpc-url injective_testnet --broadcast --legacy --slow
	cd web && node scripts/sync-abi.mjs

## Demo BTC agent from $(TREE): vault + ERC-8004 identity + signed rule tree (+ DEPOSIT_USDC)
agent:
	cd contracts && RULETREE_HASH=$$(../$(ZHI) hash ../$(TREE)) forge script script/CreateAgent.s.sol --rpc-url injective_testnet --broadcast --legacy --slow | tee ../.agent.log
	grep -Eo "vault +0x[0-9a-fA-F]{40}" .agent.log | awk '{print $$2}' > .vault
	@echo "vault -> $$(cat .vault)"

## Send the harness key INJ for gas
fund:
	cast send $(HARNESS_ADDRESS) --value 0.5ether --private-key $(PRIVATE_KEY) -r $(RPC) --legacy

harness:
	$(ZHI) run --tree $(TREE) --vault $(VAULT)

harness-dry:
	$(ZHI) run --tree $(TREE) --vault $(VAULT) --dry-run --once

replay:
	$(ZHI) replay logs/$(VAULT_LC).jsonl

attest:
	$(ZHI) attest --vault $(VAULT) --attestor $$(jq -r .attestor $(DEP)) --harness-log logs/$(VAULT_LC).jsonl --post

status:
	$(ZHI) status --vault $(VAULT)

poke:
	$(ZHI) poke --vault $(VAULT) --key $(PRIVATE_KEY)

web:
	cd web && pnpm dev
