// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ZhiBase} from "./Base.t.sol";
import {GuardrailVault} from "../src/GuardrailVault.sol";
import {ZhiTypes} from "../src/ZhiTypes.sol";
import {VaultOps} from "../src/libraries/VaultOps.sol";

contract GuardrailVaultTest is ZhiBase {
    event TradeSkipped(
        bytes32 indexed ruleTreeHash,
        bytes32 indexed marketId,
        uint64 indexed nonce,
        ZhiTypes.Skip reason,
        bytes32 synthHash,
        bytes32 intentHash
    );
    event Frozen(uint256 equity, uint256 epochStartEquity);

    function expectSkip(ZhiTypes.Intent memory it, ZhiTypes.Skip r) internal {
        vm.expectEmit(true, true, true, true, address(vault));
        emit TradeSkipped(it.ruleTreeHash, it.marketId, it.nonce, r, it.synthHash, keccak256(abi.encode(it)));
        assertFalse(exec(it), "should skip");
        assertEq(vault.nextNonce(), it.nonce + 1, "nonce consumed on skip");
    }

    // ------------------------------------------------------------ setup / identity

    function test_init_subaccountAndFeeRecipient() public view {
        string memory expectSub = string.concat(vm.toLowercase(vm.toString(address(vault))), "000000000000000000000001");
        assertEq(vault.subaccountId(), expectSub);
        assertEq(vault.feeRecipient(), VaultOps.injAddress(address(vault)));
        assertEq(vault.owner(), owner);
        assertEq(vault.harness(), harness);
        assertTrue(vault.agentIdSet());
        assertEq(idr.ownerOf(agentId), owner, "identity NFT handed to operator");
        assertEq(string(idr.getMetadata(agentId, "feeRecipient")), vault.feeRecipient());
    }

    /// Known pair from Injective docs: 0xaf79...4902 <-> inj14au322k9munkmx5wrchz9q30juf5wjgz2cfqku
    function test_bech32_knownVector() public pure {
        assertEq(
            VaultOps.injAddress(0xAF79152AC5dF276D9A8e1E2E22822f9713474902),
            "inj14au322k9munkmx5wrchz9q30juf5wjgz2cfqku"
        );
    }

    function test_cannotReinitialize() public {
        GuardrailVault.InitParams memory p;
        vm.expectRevert(GuardrailVault.AlreadyInitialized.selector);
        vault.initialize(p);
    }

    // ------------------------------------------------------------ happy path

    function test_execute_placesOrderWithFeeRecipient() public {
        ZhiTypes.Intent memory it = longIntent();
        assertTrue(exec(it));
        assertEq(ex.marketOrders(), 1);
        assertEq(ex.conditionalOrders(), 2, "tp and sl on book");
        assertEq(vault.executions(), 1);
        assertEq(vault.lastEntryAt(), vm.getBlockTimestamp());
        assertFalse(vault.isFlat());
        (uint256 eq, bool ok) = vault.equity();
        assertTrue(ok);
        assertEq(eq, 10_000e18, "no pnl at entry price");
    }

    function test_execute_survivesRejectedExitOrders() public {
        ex.setReject(false, true);
        assertTrue(exec(longIntent()));
        assertEq(ex.conditionalOrders(), 0);
    }

    function test_reduceOnlyClose_realizesPnl() public {
        exec(longIntent());
        setPrice(76_000e18);
        assertTrue(exec(closeIntent(1e17, 75_900e18)));
        assertTrue(vault.isFlat());
        (uint256 eq,) = vault.equity();
        assertEq(eq, 10_100e18, "+0.1 * 1000");
    }

    // ------------------------------------------------------------ every skip reason

    function test_skip_FROZEN() public {
        _freezeViaLoss();
        vm.warp(vm.getBlockTimestamp() + 1000);
        setPrice(70_000e18);
        expectSkip(longIntent(), ZhiTypes.Skip.FROZEN);
    }

    function test_skip_BAD_RULETREE() public {
        ZhiTypes.Intent memory it = longIntent();
        it.ruleTreeHash = keccak256("unsigned tree");
        expectSkip(it, ZhiTypes.Skip.BAD_RULETREE);
        assertEq(vault.adherenceSkips(), 1);
    }

    function test_skip_BAD_RULETREE_afterRevoke() public {
        vm.prank(owner);
        vault.revokeRuleTree(RT);
        expectSkip(longIntent(), ZhiTypes.Skip.BAD_RULETREE);
    }

    function test_skip_EXPIRED() public {
        ZhiTypes.Intent memory it = longIntent();
        it.deadline = uint64(vm.getBlockTimestamp() - 1);
        expectSkip(it, ZhiTypes.Skip.EXPIRED);
    }

    function test_skip_MARKET_NOT_ALLOWED() public {
        ZhiTypes.Intent memory it = longIntent();
        it.marketId = ETH;
        expectSkip(it, ZhiTypes.Skip.MARKET_NOT_ALLOWED);
    }

    function test_skip_COOLDOWN() public {
        exec(longIntent());
        vm.warp(vm.getBlockTimestamp() + 100);
        setPrice(PX);
        expectSkip(longIntent(), ZhiTypes.Skip.COOLDOWN);
        vm.warp(vm.getBlockTimestamp() + 80);
        setPrice(PX);
        assertTrue(exec(longIntent()), "cooldown elapsed");
    }

    function test_skip_NOTIONAL() public {
        ZhiTypes.Intent memory it = longIntent();
        it.quantity = 4e17; // 30,040 > 25,000
        it.margin = 9_000e18;
        expectSkip(it, ZhiTypes.Skip.NOTIONAL);
    }

    function test_skip_LEVERAGE() public {
        ZhiTypes.Intent memory it = longIntent();
        it.margin = 375e18; // 20x
        expectSkip(it, ZhiTypes.Skip.LEVERAGE);
    }

    function test_skip_LEVERAGE_zeroMargin() public {
        ZhiTypes.Intent memory it = longIntent();
        it.margin = 0;
        expectSkip(it, ZhiTypes.Skip.LEVERAGE);
    }

    function test_skip_ORACLE_STALE() public {
        vm.warp(vm.getBlockTimestamp() + 61);
        expectSkip(longIntent(), ZhiTypes.Skip.ORACLE_STALE);
    }

    function test_skip_ORACLE_STALE_butExitAllowed() public {
        exec(longIntent());
        vm.warp(vm.getBlockTimestamp() + 3600); // iAsset off-hours: feed stops updating
        ex.setMark(BTC_HEX, PX);
        assertTrue(exec(closeIntent(1e17, 74_900e18)), "exits always allowed");
    }

    function test_skip_PRICE_DEVIATION() public {
        ZhiTypes.Intent memory it = longIntent();
        it.worstPrice = 76_000e18; // 133 bps > 100
        expectSkip(it, ZhiTypes.Skip.PRICE_DEVIATION);
    }

    function test_skip_DRAWDOWN_freezes() public {
        exec(longIntent());
        vm.warp(vm.getBlockTimestamp() + 200);
        setPrice(70_000e18); // -500 on 10,000 = 5% > 4%
        ZhiTypes.Intent memory it = longIntent();
        it.worstPrice = 70_100e18;
        expectSkip(it, ZhiTypes.Skip.DRAWDOWN);
        assertTrue(vault.frozen());
    }

    function test_skip_OFF_TICK() public {
        ZhiTypes.Intent memory it = longIntent();
        it.quantity = 1e17 + 1;
        expectSkip(it, ZhiTypes.Skip.OFF_TICK);
        it = longIntent();
        it.worstPrice = 75_100.5e18;
        expectSkip(it, ZhiTypes.Skip.OFF_TICK);
    }

    function test_skip_EQUITY_UNREADABLE_failsClosed() public {
        ex.setRevertQueries(true);
        expectSkip(longIntent(), ZhiTypes.Skip.EQUITY_UNREADABLE);
    }

    function test_skip_ORDER_FAILED_noRevert() public {
        ex.setReject(true, false);
        expectSkip(longIntent(), ZhiTypes.Skip.ORDER_FAILED);
        assertEq(vault.lastEntryAt(), 0);
    }

    function test_gateSkips_recordedOnChain() public {
        ZhiTypes.Intent memory it = longIntent();
        vm.expectEmit(true, true, true, true, address(vault));
        emit TradeSkipped(it.ruleTreeHash, it.marketId, it.nonce, ZhiTypes.Skip.SYNTH_DIRECTION, it.synthHash, keccak256(abi.encode(it)));
        vm.prank(harness);
        vault.logGateSkip(it, ZhiTypes.Skip.SYNTH_DIRECTION);
        assertEq(vault.nextNonce(), 1);
        assertEq(vault.adherenceSkips(), 0, "gate skips are the system working");

        it = longIntent();
        vm.prank(harness);
        vm.expectRevert(GuardrailVault.InvalidGateReason.selector);
        vault.logGateSkip(it, ZhiTypes.Skip.NOTIONAL);
    }

    // ------------------------------------------------------------ access / replay

    function test_onlyHarness() public {
        ZhiTypes.Intent memory it = longIntent();
        vm.prank(owner);
        vm.expectRevert(GuardrailVault.NotHarness.selector);
        vault.executeIntent(it);
    }

    function test_nonceReplayReverts() public {
        ZhiTypes.Intent memory it = longIntent();
        exec(it);
        vm.prank(harness);
        vm.expectRevert(abi.encodeWithSelector(GuardrailVault.BadNonce.selector, uint64(1), uint64(0)));
        vault.executeIntent(it);
    }

    function test_ruleTree_badSignatureRejected() public {
        uint256 deadline = vm.getBlockTimestamp() + 100;
        bytes32 digest = vault.ruleTreeDigest(keccak256("x"), deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBEEF, digest);
        vm.expectRevert(GuardrailVault.InvalidSignature.selector);
        vault.registerRuleTree(keccak256("x"), deadline, abi.encodePacked(r, s, v));
    }

    function test_harnessCannotWithdrawOrLoosen() public {
        vm.startPrank(harness);
        vm.expectRevert(GuardrailVault.InsufficientShares.selector);
        vault.withdraw(1, harness);
        vm.expectRevert(GuardrailVault.NotOwner.selector);
        vault.proposeBounds(_bounds());
        vm.expectRevert(GuardrailVault.NotOwner.selector);
        vault.unfreeze();
        vm.stopPrank();
    }

    // ------------------------------------------------------------ poke: permissionless circuit breaker

    function test_poke_strangerFreezesWithHarnessOffline() public {
        exec(longIntent());
        // harness goes offline; market gaps down
        vm.warp(vm.getBlockTimestamp() + 600);
        setPrice(70_000e18);
        assertTrue(breached());
        assertFalse(vault.frozen());
        vm.prank(stranger);
        assertTrue(vault.poke());
        assertTrue(vault.frozen());
    }

    function test_poke_noBreach_noFreeze() public {
        exec(longIntent());
        setPrice(74_900e18);
        vm.prank(stranger);
        assertFalse(vault.poke());
    }

    function test_frozen_reduceOnlyStillAllowed() public {
        _freezeViaLoss();
        assertTrue(exec(closeIntent(1e17, 69_900e18)));
        assertTrue(vault.isFlat());
    }

    function test_epochRoll_doesNotForgiveBreach() public {
        exec(longIntent());
        vm.warp(vm.getBlockTimestamp() + 1 days + 1);
        setPrice(70_000e18);
        vm.prank(stranger);
        vault.poke();
        assertTrue(vault.frozen(), "breach checked before roll");
    }

    // ------------------------------------------------------------ timelocks

    function test_tightenIsInstant_loosenNeedsTimelock() public {
        ZhiTypes.Bounds memory b = _bounds();
        b.maxLeverageX100 = 300;
        vm.prank(owner);
        vault.tightenBounds(b);
        (, uint32 lev,,,,) = vault.bounds();
        assertEq(lev, 300);

        b.maxLeverageX100 = 800;
        vm.prank(owner);
        vm.expectRevert(GuardrailVault.NotTighter.selector);
        vault.tightenBounds(b);

        vm.prank(owner);
        vault.proposeBounds(b);
        vm.prank(owner);
        vm.expectRevert();
        vault.applyBounds();
        vm.warp(vm.getBlockTimestamp() + 24 hours);
        vm.prank(owner);
        vault.applyBounds();
        (, lev,,,,) = vault.bounds();
        assertEq(lev, 800);
    }

    function test_hardCaps() public {
        ZhiTypes.Bounds memory b = _bounds();
        b.maxLeverageX100 = 5000; // 50x > 20x hard cap
        vm.prank(owner);
        vm.expectRevert(GuardrailVault.InvalidBounds.selector);
        vault.proposeBounds(b);
    }

    function test_unfreezeTimelock() public {
        _freezeViaLoss();
        vm.prank(owner);
        vm.expectRevert(GuardrailVault.NothingPending.selector);
        vault.unfreeze();
        vm.prank(owner);
        vault.requestUnfreeze();
        vm.warp(vm.getBlockTimestamp() + 23 hours);
        vm.prank(owner);
        vm.expectRevert();
        vault.unfreeze();
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        setPrice(70_000e18);
        vm.prank(owner);
        vault.unfreeze();
        assertFalse(vault.frozen());
    }

    function test_marketAddNeedsTimelock_removeInstant() public {
        ZhiTypes.MarketInput memory m = _btcMarket();
        m.marketId = ETH;
        vm.prank(owner);
        vault.proposeMarket(m);
        vm.prank(owner);
        vm.expectRevert();
        vault.applyMarket(ETH);
        vm.warp(vm.getBlockTimestamp() + 24 hours);
        vm.prank(owner);
        vault.applyMarket(ETH);
        assertTrue(vault.getMarket(ETH).allowed);
        vm.prank(owner);
        vault.removeMarket(ETH);
        assertFalse(vault.getMarket(ETH).allowed);
    }

    // ------------------------------------------------------------ capital

    function test_withdraw_onlyWhenFlat() public {
        exec(longIntent());
        uint256 s = vault.shares(owner);
        vm.prank(owner);
        vm.expectRevert(GuardrailVault.NotFlat.selector);
        vault.withdraw(s, owner);

        exec(closeIntent(1e17, 74_900e18));
        uint256 before = usdc.balanceOf(owner);
        vm.prank(owner);
        vault.withdraw(s, owner);
        assertEq(usdc.balanceOf(owner) - before, 10_000e6);
    }

    function test_deposit_closedWhileFrozen() public {
        _freezeViaLoss();
        vm.prank(owner);
        vm.expectRevert(GuardrailVault.VaultFrozen.selector);
        vault.deposit(1e6, owner);
    }

    function test_deposit_onlyOwnerOrDepositor() public {
        usdc.mint(stranger, 1e6);
        vm.startPrank(stranger);
        usdc.approve(address(vault), 1e6);
        vm.expectRevert(GuardrailVault.NotDepositor.selector);
        vault.deposit(1e6, stranger);
        vm.stopPrank();
    }

    function test_harvestFees_split75_25() public {
        usdc.mint(address(vault), 400e6); // fee-recipient income lands in the vault's bank balance
        vault.harvestFees();
        assertEq(usdc.balanceOf(treasury), 100e6);
        (uint256 eq,) = vault.equity();
        assertEq(eq, 10_300e18);
    }

    // ------------------------------------------------------------ fuzz: no out-of-bounds order is ever placed

    function testFuzz_neverPlacesOutOfBounds(uint256 qty, uint256 worst, uint256 margin, bool isBuy) public {
        qty = bound(qty, 1, 1e18) / 1e14 * 1e14;
        worst = bound(worst, 60_000e18, 90_000e18) / 1e18 * 1e18;
        margin = bound(margin, 0, 20_000e18);
        ZhiTypes.Intent memory it = longIntent();
        it.quantity = qty;
        it.worstPrice = worst;
        it.margin = margin;
        it.isBuy = isBuy;
        bool placed = exec(it);
        if (placed) {
            uint256 notional = qty * worst / 1e18;
            assertLe(notional, 25_000e18, "notional");
            assertGt(margin, 0);
            assertLe(notional * 100 / margin, 500, "leverage");
            uint256 dev = worst > PX ? worst - PX : PX - worst;
            assertLe(dev * 1e4 / PX, 100, "deviation");
        }
    }

    // ------------------------------------------------------------ helpers

    function _freezeViaLoss() internal {
        exec(longIntent());
        vm.warp(vm.getBlockTimestamp() + 200);
        setPrice(70_000e18);
        vm.prank(stranger);
        vault.poke();
        assertTrue(vault.frozen());
    }
}
