// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ZhiFactory} from "../src/ZhiFactory.sol";
import {ZhiAttestor} from "../src/ZhiAttestor.sol";
import {CreditPool} from "../src/CreditPool.sol";

/// Deploys the protocol singletons to Injective EVM.
///   forge script script/Deploy.s.sol --rpc-url injective_testnet --broadcast --legacy
/// Env: PRIVATE_KEY (deployer), ATTESTER_ADDRESS (optional; defaults to deployer)
contract Deploy is Script {
    // Injective EVM testnet (chain id 1439)
    address constant USDC = 0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d;
    string constant USDC_DENOM = "erc20:0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d";
    address constant IDENTITY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address constant REPUTATION = 0x8004B663056A597Dffe9eCcC1965A193B7388713;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address attester = vm.envOr("ATTESTER_ADDRESS", deployer);
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);

        vm.startBroadcast(pk);
        ZhiFactory factory = new ZhiFactory(deployer, IDENTITY, USDC, USDC_DENOM, treasury, 2500);
        ZhiAttestor attestor = new ZhiAttestor(deployer, REPUTATION);
        attestor.setAttester(attester, true);
        CreditPool pool = new CreditPool(IERC20(USDC), factory, attestor, deployer);
        vm.stopBroadcast();

        string memory o = "deploy";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "factory", address(factory));
        vm.serializeAddress(o, "vaultImplementation", factory.vaultImplementation());
        vm.serializeAddress(o, "attestor", address(attestor));
        vm.serializeAddress(o, "creditPool", address(pool));
        vm.serializeAddress(o, "usdc", USDC);
        vm.serializeString(o, "usdcDenom", USDC_DENOM);
        vm.serializeAddress(o, "identityRegistry", IDENTITY);
        vm.serializeAddress(o, "reputationRegistry", REPUTATION);
        vm.serializeUint(o, "deployedAt", block.timestamp);
        string memory json = vm.serializeAddress(o, "deployer", deployer);
        vm.writeJson(json, "./deployments/injective-testnet.json");

        console2.log("ZhiFactory      ", address(factory));
        console2.log("ZhiAttestor     ", address(attestor));
        console2.log("CreditPool      ", address(pool));
    }
}
