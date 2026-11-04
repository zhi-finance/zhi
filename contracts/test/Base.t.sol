// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GuardrailVault} from "../src/GuardrailVault.sol";
import {ZhiFactory} from "../src/ZhiFactory.sol";
import {ZhiAttestor} from "../src/ZhiAttestor.sol";
import {ZhiTypes} from "../src/ZhiTypes.sol";
import {MockUSDC, MockExchange, MockOracle, MockIdentityRegistry, MockReputationRegistry} from "./mocks/Mocks.sol";

abstract contract ZhiBase is Test {
    MockUSDC internal usdc;
    MockExchange internal ex;
    MockOracle internal orc;
    MockIdentityRegistry internal idr;
    MockReputationRegistry internal rep;
    ZhiFactory internal factory;
    ZhiAttestor internal attestor;
    GuardrailVault internal vault;
    uint256 internal agentId;

    uint256 internal ownerPk = 0xA11CE;
    address internal owner;
    address internal harness = makeAddr("harness");
    address internal treasury = makeAddr("treasury");
    address internal stranger = makeAddr("stranger");
    address internal attesterKey = makeAddr("attester");

    // Injective testnet BTC/USDC PERP
    bytes32 internal constant BTC = 0xfd704649cf3a516c0c145ab0111717c44640d8dbe52a462ae35cadf2f6df1515;
    string internal constant BTC_HEX = "0xfd704649cf3a516c0c145ab0111717c44640d8dbe52a462ae35cadf2f6df1515";
    bytes32 internal constant ETH = 0x135de28700392fb1c17d40d5170a74f30055a4ad522feddafec42fbbbb780897;
    string internal constant FEED_BASE = "0x00037da06d56d083fe599397a4769a042d63aa73dc4ef57709d31e9971a5b439";
    string internal constant FEED_QUOTE = "0x0003dc85e8b01946bf9dfd8b0db860129181eb6105a8c8981d9f28e00b6f60d9";
    uint256 internal constant PX = 75_000e18;
    bytes32 internal constant RT = keccak256("zhi.ruletree/1.0 example");
    bytes32 internal constant SYNTH = keccak256("synth response");

    uint64 internal nonce;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        owner = vm.addr(ownerPk);
        usdc = new MockUSDC();

        vm.etch(address(0x65), address(new MockExchange()).code);
        ex = MockExchange(address(0x65));
        ex.init(usdc);
        vm.etch(address(0x67), address(new MockOracle()).code);
        orc = MockOracle(address(0x67));
        setPrice(PX);

        idr = new MockIdentityRegistry();
        rep = new MockReputationRegistry(idr);
        attestor = new ZhiAttestor(address(this), address(rep));
        attestor.setAttester(attesterKey, true);
        factory = new ZhiFactory(address(this), address(idr), address(usdc), "erc20:usdc", treasury, 2500);

        vm.prank(owner);
        (address v, uint256 id) = factory.createAgent(_params());
        vault = GuardrailVault(v);
        agentId = id;

        usdc.mint(owner, 1_000_000e6);
        vm.startPrank(owner);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(10_000e6, owner);
        vm.stopPrank();

        registerRuleTree(RT);
    }

    function _bounds() internal pure returns (ZhiTypes.Bounds memory) {
        return ZhiTypes.Bounds({
            maxNotional: 25_000e18,
            maxLeverageX100: 500,
            maxDailyDdBps: 400,
            maxDeviationBps: 100,
            cooldownSec: 180,
            maxOracleAgeSec: 60
        });
    }

    function _btcMarket() internal pure returns (ZhiTypes.MarketInput memory) {
        return ZhiTypes.MarketInput({
            marketId: BTC,
            isBinary: false,
            oracleType: 13,
            oracleBase: FEED_BASE,
            oracleQuote: FEED_QUOTE,
            minPriceTick: 1e18,
            minQtyTick: 1e14
        });
    }

    function _params() internal view returns (ZhiFactory.CreateParams memory p) {
        p.harness = harness;
        p.bounds = _bounds();
        p.markets = new ZhiTypes.MarketInput[](1);
        p.markets[0] = _btcMarket();
        p.agentURI = "ipfs://agent-card";
    }

    function setPrice(uint256 px) internal {
        orc.set(FEED_BASE, FEED_QUOTE, px, uint64(vm.getBlockTimestamp()));
        ex.setMark(BTC_HEX, px);
    }

    function registerRuleTree(bytes32 hash) internal {
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        bytes32 digest = vault.ruleTreeDigest(hash, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, digest);
        vault.registerRuleTree(hash, deadline, abi.encodePacked(r, s, v));
    }

    function longIntent() internal view returns (ZhiTypes.Intent memory it) {
        it = ZhiTypes.Intent({
            ruleTreeHash: RT,
            marketId: BTC,
            isBuy: true,
            reduceOnly: false,
            quantity: 1e17, //            0.1 BTC
            worstPrice: 75_100e18, //     13 bps through the oracle
            margin: 2_000e18, //          notional 7,510 -> 3.75x
            tpPrice: 77_000e18,
            slPrice: 74_000e18,
            synthHash: SYNTH,
            nonce: vault.nextNonce(),
            deadline: uint64(vm.getBlockTimestamp() + 60)
        });
    }

    function closeIntent(uint256 qty, uint256 worst) internal view returns (ZhiTypes.Intent memory it) {
        it = longIntent();
        it.isBuy = false;
        it.reduceOnly = true;
        it.quantity = qty;
        it.worstPrice = worst;
        it.margin = 0;
        it.tpPrice = 0;
        it.slPrice = 0;
    }

    function exec(ZhiTypes.Intent memory it) internal returns (bool) {
        vm.prank(harness);
        return vault.executeIntent(it);
    }

    function breached() internal view returns (bool) {
        (uint256 eq, bool ok) = vault.equity();
        uint256 start = vault.epochStartEquity();
        (,, uint16 dd,,,) = vault.bounds();
        return ok && start != 0 && eq < start && (start - eq) * 1e4 / start >= dd;
    }
}
