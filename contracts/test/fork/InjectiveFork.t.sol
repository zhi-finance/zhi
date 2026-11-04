// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ZhiFactory} from "../../src/ZhiFactory.sol";
import {GuardrailVault} from "../../src/GuardrailVault.sol";
import {ZhiTypes} from "../../src/ZhiTypes.sol";
import {IIdentityRegistry} from "../../src/interfaces/IERC8004.sol";

/// Integration against live Injective EVM testnet state (real ERC-8004 registry, real oracle
/// precompile). Opt-in: FORK=1 forge test --match-path test/fork/*
/// Note: Foundry's EVM does not implement Injective precompiles, so reads of 0x65/0x67 inside a
/// local fork fail; this suite therefore checks the parts that are plain EVM (factory, identity,
/// EIP-712) and asserts the vault fails CLOSED when precompiles are unreachable.
contract InjectiveForkTest is Test {
    address constant USDC = 0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d;
    address constant IDENTITY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    bytes32 constant BTC_PERP = 0xfd704649cf3a516c0c145ab0111717c44640d8dbe52a462ae35cadf2f6df1515;

    function setUp() public {
        if (!vm.envOr("FORK", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork("injective_testnet");
    }

    function test_fork_createAgent_registersERC8004() public {
        uint256 pk = 0xA11CE;
        address operator = vm.addr(pk);
        ZhiFactory f = new ZhiFactory(address(this), IDENTITY, USDC, "erc20:0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d", address(this), 2500);

        ZhiFactory.CreateParams memory p;
        p.harness = makeAddr("harness");
        p.agentURI = "https://zhi.trade/agents/fork.json";
        p.bounds = ZhiTypes.Bounds(2_500e18, 300, 400, 50, 180, 120);
        p.markets = new ZhiTypes.MarketInput[](1);
        p.markets[0] = ZhiTypes.MarketInput(
            BTC_PERP,
            false,
            13,
            "0x00037da06d56d083fe599397a4769a042d63aa73dc4ef57709d31e9971a5b439",
            "0x0003dc85e8b01946bf9dfd8b0db860129181eb6105a8c8981d9f28e00b6f60d9",
            1e18,
            1e14
        );

        vm.prank(operator);
        (address v, uint256 agentId) = f.createAgent(p);
        GuardrailVault vault = GuardrailVault(v);

        IIdentityRegistry id = IIdentityRegistry(IDENTITY);
        assertEq(id.ownerOf(agentId), operator, "operator owns the ERC-8004 identity");
        assertEq(string(id.getMetadata(agentId, "feeRecipient")), vault.feeRecipient());
        assertEq(id.tokenURI(agentId), p.agentURI);
        assertEq(vault.agentId(), agentId);

        // EIP-712 sign-off works against the live chain id
        bytes32 h = keccak256("tree");
        uint256 dl = block.timestamp + 100;
        (uint8 sv, bytes32 r, bytes32 s) = vm.sign(pk, vault.ruleTreeDigest(h, dl));
        vault.registerRuleTree(h, dl, abi.encodePacked(r, s, sv));
        assertTrue(vault.ruleTree(h));

        // Fail closed when the precompiles are unreachable (local EVM): no entry can be placed.
        (, bool ok) = vault.equity();
        assertFalse(ok);
    }
}
