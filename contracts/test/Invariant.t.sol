// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ZhiBase} from "./Base.t.sol";
import {GuardrailVault} from "../src/GuardrailVault.sol";
import {ZhiTypes} from "../src/ZhiTypes.sol";
import {MockExchange, MockOracle} from "./mocks/Mocks.sol";

/// Drives the vault with arbitrary intents, price paths, time jumps and pokes. Every handler action
/// ends with the vault being touched (an intent or a poke), which is the PRD's claim: once anything
/// interacts with a breached vault, it is frozen.
contract VaultHandler is Test {
    GuardrailVault public vault;
    MockExchange public ex;
    MockOracle public orc;
    address public harness;
    bytes32 public rt;
    bytes32 public btc;
    string public btcHex;
    string public feedBase;
    string public feedQuote;
    uint256 public px;

    uint256 public placedOutOfBounds;
    uint256 public calls;

    constructor(GuardrailVault v, address h, bytes32 rt_, bytes32 btc_, string memory hex_, string memory b, string memory q) {
        vault = v;
        ex = MockExchange(address(0x65));
        orc = MockOracle(address(0x67));
        harness = h;
        rt = rt_;
        btc = btc_;
        btcHex = hex_;
        feedBase = b;
        feedQuote = q;
        px = 75_000e18;
    }

    function _move(int256 bps, uint256 dt) internal {
        bps = bound(bps, -1500, 1500);
        dt = bound(dt, 0, 2 days);
        vm.warp(vm.getBlockTimestamp() + dt);
        int256 next = int256(px) + int256(px) * bps / 1e4;
        if (next < 1_000e18) next = 1_000e18;
        px = uint256(next) / 1e18 * 1e18;
        orc.set(feedBase, feedQuote, px, uint64(vm.getBlockTimestamp()));
        ex.setMark(btcHex, px);
    }

    function intent(int256 bps, uint256 dt, uint256 qty, uint256 margin, bool isBuy, bool reduceOnly, int256 slipBps)
        external
    {
        calls++;
        _move(bps, dt);
        qty = bound(qty, 1e14, 5e17) / 1e14 * 1e14;
        margin = bound(margin, 0, 30_000e18);
        slipBps = bound(slipBps, -300, 300);
        uint256 worst = uint256(int256(px) + int256(px) * slipBps / 1e4) / 1e18 * 1e18;
        // a valid reduce-only order must oppose the open position; let the mock decide
        ZhiTypes.Intent memory it = ZhiTypes.Intent({
            ruleTreeHash: rt,
            marketId: btc,
            isBuy: isBuy,
            reduceOnly: reduceOnly,
            quantity: qty,
            worstPrice: worst,
            margin: reduceOnly ? 0 : margin,
            tpPrice: 0,
            slPrice: 0,
            synthHash: bytes32(0),
            nonce: vault.nextNonce(),
            deadline: uint64(vm.getBlockTimestamp() + 30)
        });
        (,, uint16 dd,,,) = vault.bounds();
        dd; // silence
        uint256 fillsBefore = ex.fillCount();
        vm.prank(harness);
        bool placed = vault.executeIntent(it);
        if (placed && !reduceOnly) {
            (uint256 maxN, uint32 maxLev,,,,) = vault.bounds();
            uint256 notional = qty * worst / 1e18;
            if (notional > maxN || margin == 0 || notional * 100 / margin > maxLev) placedOutOfBounds++;
        }
        if (!placed) require(ex.fillCount() == fillsBefore, "skip must not trade");
    }

    function poke(int256 bps, uint256 dt, address who) external {
        calls++;
        _move(bps, dt);
        vm.prank(who);
        vault.poke();
    }
}

contract InvariantTest is ZhiBase {
    VaultHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new VaultHandler(vault, harness, RT, BTC, BTC_HEX, FEED_BASE, FEED_QUOTE);
        targetContract(address(handler));
    }

    /// PRD REQ-05 / metric "breached vaults left unfrozen = 0"
    function invariant_breachedVaultIsFrozen() public view {
        if (breached()) assertTrue(vault.frozen(), "breached vault left unfrozen");
    }

    /// PRD metric "out-of-bounds orders placed = 0"
    function invariant_noOutOfBoundsOrders() public view {
        assertEq(handler.placedOutOfBounds(), 0);
    }

    function invariant_nonceMatchesIntents() public view {
        assertEq(vault.nextNonce(), vault.intentsSubmitted());
    }
}
