// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ZhiBase} from "./Base.t.sol";
import {GuardrailVault} from "../src/GuardrailVault.sol";
import {ZhiAttestor} from "../src/ZhiAttestor.sol";
import {AllocatorVault} from "../src/AllocatorVault.sol";
import {CreditPool} from "../src/CreditPool.sol";
import {ZhiTypes} from "../src/ZhiTypes.sol";

contract AttestorTest is ZhiBase {
    function _report(uint16 score) internal pure returns (ZhiAttestor.EpochReport memory r) {
        r.pnlBps = 120;
        r.maxDdBps = 80;
        r.adherenceX1e4 = 10_000;
        r.score = score;
        r.daysLive = 45;
        r.closedTrades = 150;
        r.reportHash = keccak256("report");
    }

    function test_postEpoch_writesFourFeedbacks() public {
        vm.prank(attesterKey);
        attestor.postEpoch(agentId, 1, _report(640), "ipfs://report-1");
        assertEq(rep.count(), 4);
        (uint256 id, address client,,, string memory t1, string memory t2,) = rep.feedback(3);
        assertEq(id, agentId);
        assertEq(client, address(attestor));
        assertEq(t1, "zhi.score");
        assertEq(t2, "v1");
    }

    function test_operatorCannotSelfFeedback() public {
        vm.prank(owner);
        vm.expectRevert("Self-feedback not allowed");
        rep.giveFeedback(agentId, 1, 0, "x", "y", "", "", bytes32(0));
    }

    function test_challengeWindow() public {
        vm.prank(attesterKey);
        attestor.postEpoch(agentId, 1, _report(640), "ipfs://r1");
        (uint16 s,,) = attestor.scoreOf(agentId);
        assertEq(s, 0, "not final inside window");

        vm.warp(vm.getBlockTimestamp() + 72 hours);
        (s,,) = attestor.scoreOf(agentId);
        assertEq(s, 640);
    }

    function test_challengeUpheld() public {
        vm.prank(attesterKey);
        attestor.postEpoch(agentId, 1, _report(720), "ipfs://r1");
        vm.prank(stranger);
        attestor.challenge(agentId, 610, "ipfs://recompute");
        vm.warp(vm.getBlockTimestamp() + 80 hours);
        (uint16 s,,) = attestor.scoreOf(agentId);
        assertEq(s, 0, "challenged score never auto-finalizes");
        attestor.resolveChallenge(agentId, true, 610);
        (s,,) = attestor.scoreOf(agentId);
        assertEq(s, 610);
    }

    function test_dailyPostsDoNotStarveFinalization() public {
        for (uint64 e = 1; e <= 6; e++) {
            vm.prank(attesterKey);
            attestor.postEpoch(agentId, e, _report(uint16(600 + e)), "ipfs://r");
            vm.warp(vm.getBlockTimestamp() + 1 days);
        }
        (uint16 s,,) = attestor.scoreOf(agentId);
        assertGt(s, 0, "some score finalized despite daily posts");
    }
}

contract AllocatorTest is ZhiBase {
    AllocatorVault internal alloc;
    address internal lp = makeAddr("lp");

    function setUp() public override {
        super.setUp();
        alloc = new AllocatorVault(vault, attestor, treasury, "Zhi BTC Agent", "zBTC");
        vm.prank(owner);
        vault.setDepositor(address(alloc), true);
        usdc.mint(lp, 100_000e6);
        vm.prank(lp);
        usdc.approve(address(alloc), type(uint256).max);
    }

    function test_depositFlowsIntoGuardrail() public {
        vm.prank(lp);
        alloc.deposit(5_000e6, lp);
        assertEq(alloc.totalAssets(), 5_000e6);
        (uint256 eq,) = vault.equity();
        assertEq(eq, 15_000e18);
    }

    function test_capByScore() public {
        assertEq(alloc.maxDeposit(lp), 10_000e6);
        vm.prank(lp);
        vm.expectRevert();
        alloc.deposit(10_001e6, lp);
    }

    function test_depositsCloseWhileFrozen() public {
        exec(longIntent());
        vm.warp(vm.getBlockTimestamp() + 200);
        setPrice(70_000e18);
        vault.poke();
        assertEq(alloc.maxDeposit(lp), 0);
    }

    /// REQ-13: HWM performance fee settles correctly across 30 simulated epochs.
    function test_hwmFee_30epochs() public {
        vm.prank(lp);
        alloc.deposit(10_000e6, lp);
        string memory sub = vault.subaccountId();
        uint256 hwm = alloc.highWaterMark();
        // deterministic pseudo-random daily returns between -3% and +4%
        uint256 totalFeeShares;
        for (uint256 e = 0; e < 30; e++) {
            vm.warp(vm.getBlockTimestamp() + 1 days);
            setPrice(PX);
            int256 r = int256(uint256(keccak256(abi.encode(e))) % 701) - 300; // bps
            uint256 dep = ex.depositOf(sub);
            uint256 next = uint256(int256(dep) + int256(dep) * r / 1e4);
            ex.setDeposit(sub, next);

            uint256 ppsBefore = alloc.pricePerShare();
            uint256 supplyBefore = alloc.totalSupply();
            (uint256 opS, uint256 prS) = alloc.settleEpoch();
            totalFeeShares += opS + prS;
            if (ppsBefore <= hwm) {
                assertEq(opS + prS, 0, "no fee below hwm");
                assertEq(alloc.highWaterMark(), hwm, "hwm never decreases");
            } else {
                // fee value == 20% of profit above HWM (within rounding)
                uint256 profit = (ppsBefore - hwm) * supplyBefore / 1e18;
                uint256 feeValue = alloc.convertToAssets(opS + prS);
                assertApproxEqAbs(feeValue, profit * 2000 / 1e4, 3, "fee = 20% of profit");
                assertApproxEqAbs(opS * 5, prS * 15, 15, "15/5 split");
                assertGe(alloc.highWaterMark(), hwm);
                hwm = alloc.highWaterMark();
            }
        }
        assertEq(alloc.balanceOf(owner) + alloc.balanceOf(treasury), totalFeeShares);
    }

    function test_withdrawOnlyWhenFlat() public {
        vm.prank(lp);
        alloc.deposit(5_000e6, lp);
        exec(longIntent());
        assertEq(alloc.maxWithdraw(lp), 0);
        exec(closeIntent(1e17, 74_900e18));
        uint256 w = alloc.maxWithdraw(lp);
        assertApproxEqAbs(w, 5_000e6, 1);
        vm.prank(lp);
        alloc.withdraw(w, lp, lp);
        assertApproxEqAbs(usdc.balanceOf(lp), 100_000e6, 2);
    }
}

contract CreditTest is ZhiBase {
    CreditPool internal pool;
    address internal lp = makeAddr("lp");

    function setUp() public override {
        super.setUp();
        pool = new CreditPool(usdc, factory, attestor, address(this));
        usdc.mint(lp, 500_000e6);
        vm.startPrank(lp);
        usdc.approve(address(pool), type(uint256).max);
        pool.deposit(200_000e6, lp);
        vm.stopPrank();
        vm.prank(owner);
        vault.setCreditPool(address(pool));
        // credit tiers need d(1+k) <= 0.5: tighten the freeze level to 10% max is fine; 4% already is
    }

    function _qualify(uint16 score, uint32 daysLive, uint32 trades) internal {
        ZhiAttestor.EpochReport memory r;
        r.score = score;
        r.daysLive = daysLive;
        r.closedTrades = trades;
        r.adherenceX1e4 = 10_000;
        r.reportHash = keccak256("r");
        vm.prank(attesterKey);
        attestor.postEpoch(agentId, uint64(vm.getBlockTimestamp() / 1 days), r, "ipfs://r");
        vm.warp(vm.getBlockTimestamp() + 72 hours);
        setPrice(PX);
    }

    function test_noTier_noCredit() public {
        vm.prank(owner);
        vm.expectRevert("no tier");
        pool.borrow(address(vault), 1e6);
    }

    function test_borrow_tier2_limitIsKF() public {
        _qualify(720, 70, 250); // tier 2: k = 2, cap 50k
        assertEq(pool.tierOf(address(vault)), 2);
        assertEq(pool.creditLimit(address(vault)), 20_000e6, "2 x F(10k)");
        vm.prank(owner);
        vm.expectRevert("over limit");
        pool.borrow(address(vault), 20_001e6);
        vm.prank(owner);
        pool.borrow(address(vault), 20_000e6);
        assertEq(vault.debt(), 20_000e6);
        (uint256 eq,) = vault.equity();
        assertEq(eq, 30_000e18);
        // custody rule: operator cannot withdraw while debt is outstanding
        uint256 s = vault.shares(owner);
        vm.prank(owner);
        vm.expectRevert(GuardrailVault.OutstandingDebt.selector);
        vault.withdraw(s, owner);
    }

    function test_settle_waterfall() public {
        _qualify(720, 70, 250);
        vm.prank(owner);
        pool.borrow(address(vault), 20_000e6);
        vm.warp(vm.getBlockTimestamp() + 1 days);
        setPrice(PX);
        // +600 USDC profit
        string memory sub = vault.subaccountId();
        ex.setDeposit(sub, ex.depositOf(sub) + 600e6);
        uint256 poolBefore = usdc.balanceOf(address(pool));
        pool.settle(address(vault));
        (uint256 principal, uint256 interestDue,,,,,) = pool.loans(address(vault));
        uint256 interest = uint256(20_000e6) * 1000 / 365 / 1e4; // ~5.479 USDC/day at 10%
        uint256 paid = usdc.balanceOf(address(pool)) - poolBefore;
        assertApproxEqAbs(paid, interest + (600e6 - interest) / 2, 2, "interest + half of rest");
        assertApproxEqAbs(principal, 20_000e6 - (600e6 - interest) / 2, 2);
        assertEq(interestDue, 0);
        assertApproxEqAbs(pool.reserve(), interest / 10, 1, "10% of interest to reserve");
    }

    function test_reduceOnlyWhenFBelowCoverage() public {
        _qualify(720, 70, 250);
        vm.prank(owner);
        pool.borrow(address(vault), 20_000e6);
        vm.warp(vm.getBlockTimestamp() + 1 days);
        setPrice(PX);
        string memory sub = vault.subaccountId();
        ex.setDeposit(sub, ex.depositOf(sub) - 1_000e6); // F drops to 9k < C/k = 10k
        pool.settle(address(vault));
        assertTrue(vault.creditReduceOnly());
        expectNoEntry();
    }

    function expectNoEntry() internal {
        assertFalse(exec(longIntent()));
    }

    /// REQ-15: no LP loss in any path where the gap loss is below 0.5 F.
    function testFuzz_noLpLossBelowHalfF(uint256 lossBps) public {
        _qualify(720, 70, 250);
        vm.prank(owner);
        pool.borrow(address(vault), 20_000e6);
        uint256 lpValueBefore = pool.convertToAssets(pool.balanceOf(lp));

        // F = 10k, total equity 30k. Any loss < 0.5F = 5k.
        lossBps = bound(lossBps, 0, 4_999);
        uint256 loss = 10_000e6 * lossBps / 1e4;
        string memory sub = vault.subaccountId();
        ex.setDeposit(sub, ex.depositOf(sub) - loss);
        vault.poke();
        vm.warp(vm.getBlockTimestamp() + 1 days);
        setPrice(PX);
        pool.settle(address(vault));
        // close out the vault entirely and repay
        (uint256 principal,,,,,,) = pool.loans(address(vault));
        (uint256 eq18,) = vault.equity();
        assertGe(eq18 / 1e12, principal, "equity still covers principal");
        uint256 lpValueAfter = pool.convertToAssets(pool.balanceOf(lp));
        assertGe(lpValueAfter + 1, lpValueBefore, "LP whole");
    }

    function test_writeOff_reserveFirst() public {
        _qualify(720, 70, 250);
        vm.prank(owner);
        pool.borrow(address(vault), 20_000e6);
        string memory sub = vault.subaccountId();
        // catastrophic gap: equity 30k -> 15k (operator wiped, pool short 5k)
        ex.setDeposit(sub, 15_000e6);
        vault.poke();
        assertTrue(vault.frozen());
        pool.writeOff(address(vault));
        assertEq(vault.debt(), 0);
        assertEq(pool.totalPrincipal(), 0);
    }
}
