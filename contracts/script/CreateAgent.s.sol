// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ZhiFactory} from "../src/ZhiFactory.sol";
import {GuardrailVault} from "../src/GuardrailVault.sol";
import {ZhiTypes} from "../src/ZhiTypes.sol";

/// Creates a demo BTC/USDC PERP agent on Injective testnet, signs + registers its rule tree,
/// and optionally funds it.
///   forge script script/CreateAgent.s.sol --rpc-url injective_testnet --broadcast --legacy
/// Env: PRIVATE_KEY (operator), HARNESS_ADDRESS, RULETREE_HASH (bytes32, from `zhi hash`),
///      AGENT_URI (optional), DEPOSIT_USDC (optional, 6dp units)
contract CreateAgent is Script {
    // Injective testnet BTC/USDC PERP (ChainlinkDataStreams oracle, type 13)
    bytes32 constant BTC_PERP = 0xfd704649cf3a516c0c145ab0111717c44640d8dbe52a462ae35cadf2f6df1515;
    string constant BTC_FEED = "0x00037da06d56d083fe599397a4769a042d63aa73dc4ef57709d31e9971a5b439";
    string constant USDC_FEED = "0x0003dc85e8b01946bf9dfd8b0db860129181eb6105a8c8981d9f28e00b6f60d9";

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address harness = vm.envAddress("HARNESS_ADDRESS");
        bytes32 ruleTreeHash = vm.envBytes32("RULETREE_HASH");
        string memory agentURI = vm.envOr("AGENT_URI", string("https://zhi.trade/agents/btc-momentum.json"));
        uint256 depositAmt = vm.envOr("DEPOSIT_USDC", uint256(0));

        string memory dep = vm.readFile("./deployments/injective-testnet.json");
        ZhiFactory factory = ZhiFactory(vm.parseJsonAddress(dep, ".factory"));

        ZhiFactory.CreateParams memory p;
        p.harness = harness;
        p.agentURI = agentURI;
        p.bounds = ZhiTypes.Bounds({
            maxNotional: 2_500e18, //   matches the PRD example tree's maxNotionalUsd
            maxLeverageX100: 300, //    3x
            maxDailyDdBps: 400, //      4%
            maxDeviationBps: 50, //     0.5% vs oracle
            cooldownSec: 180,
            maxOracleAgeSec: 120
        });
        p.markets = new ZhiTypes.MarketInput[](1);
        p.markets[0] = ZhiTypes.MarketInput({
            marketId: BTC_PERP,
            isBinary: false,
            oracleType: 13,
            oracleBase: BTC_FEED,
            oracleQuote: USDC_FEED,
            minPriceTick: 1e18, // chain tick 1000000 / 10^6 quote decimals = 1.0 USDC
            minQtyTick: 1e14 //   0.0001 BTC
        });

        vm.startBroadcast(pk);
        (address vaultAddr, uint256 agentId) = factory.createAgent(p);
        GuardrailVault vault = GuardrailVault(vaultAddr);

        uint256 deadline = block.timestamp + 1 days;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, vault.ruleTreeDigest(ruleTreeHash, deadline));
        vault.registerRuleTree(ruleTreeHash, deadline, abi.encodePacked(r, s, v));

        if (depositAmt > 0) {
            IERC20(factory.asset()).approve(vaultAddr, depositAmt);
            vault.deposit(depositAmt, vm.addr(pk));
        }
        vm.stopBroadcast();

        console2.log("vault        ", vaultAddr);
        console2.log("agentId      ", agentId);
        console2.log("subaccount   ", vault.subaccountId());
        console2.log("feeRecipient ", vault.feeRecipient());
    }
}
