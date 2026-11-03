// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IExchangeModule} from "../injective/Exchange.sol";
import {ExchangeTypes} from "../injective/ExchangeTypes.sol";
import {Bech32} from "./Bech32.sol";
import {ZhiTypes} from "../ZhiTypes.sol";
import {IOracleModule} from "../injective/Oracle.sol";

/// @title VaultOps
/// @notice Externally linked library holding the Guardrail Vault's order-construction code, so the
///         vault stays under the EIP-170 size limit. Called via DELEGATECALL: `address(this)` is the
///         vault, so the exchange precompile sees the vault as the trader of its own subaccount.
library VaultOps {
    IExchangeModule internal constant EXCHANGE = IExchangeModule(0x0000000000000000000000000000000000000065);

    function injAddress(address a) public pure returns (string memory) {
        return Bech32.encodeAddress("inj", a);
    }

    function placeMarketOrder(
        string memory marketIdHex,
        string memory subaccountId,
        string memory feeRecipient,
        ZhiTypes.Intent memory it
    ) public returns (bool, string memory) {
        IExchangeModule.DerivativeOrder memory o = IExchangeModule.DerivativeOrder({
            marketID: marketIdHex,
            subaccountID: subaccountId,
            feeRecipient: feeRecipient,
            price: ExchangeTypes.UFixed256x18.wrap(it.worstPrice),
            quantity: ExchangeTypes.UFixed256x18.wrap(it.quantity),
            cid: Strings.toString(it.nonce),
            orderType: it.isBuy ? "buy" : "sell",
            margin: ExchangeTypes.UFixed256x18.wrap(it.reduceOnly ? 0 : it.margin), // margin 0 = reduce-only
            triggerPrice: ExchangeTypes.UFixed256x18.wrap(0)
        });
        try EXCHANGE.createDerivativeMarketOrder(address(this), o) returns (
            IExchangeModule.CreateDerivativeMarketOrderResponse memory r
        ) {
            return (true, r.orderHash);
        } catch {
            return (false, "");
        }
    }

    /// Best-effort on-book exit (reduce-only conditional order). Returns whether it was accepted.
    function placeExit(
        string memory marketIdHex,
        string memory subaccountId,
        string memory feeRecipient,
        ZhiTypes.Intent memory it,
        bool takeProfit
    ) public returns (bool placed) {
        uint256 trigger = takeProfit ? it.tpPrice : it.slPrice;
        // A long exits with a sell; a short exits with a buy.
        string memory ot = it.isBuy ? (takeProfit ? "takeSell" : "stopSell") : (takeProfit ? "takeBuy" : "stopBuy");
        IExchangeModule.DerivativeOrder memory o = IExchangeModule.DerivativeOrder({
            marketID: marketIdHex,
            subaccountID: subaccountId,
            feeRecipient: feeRecipient,
            price: ExchangeTypes.UFixed256x18.wrap(trigger),
            quantity: ExchangeTypes.UFixed256x18.wrap(it.quantity),
            cid: string.concat(Strings.toString(it.nonce), takeProfit ? "-tp" : "-sl"),
            orderType: ot,
            margin: ExchangeTypes.UFixed256x18.wrap(0),
            triggerPrice: ExchangeTypes.UFixed256x18.wrap(trigger)
        });
        try EXCHANGE.createDerivativeLimitOrder(address(this), o) returns (
            IExchangeModule.CreateDerivativeLimitOrderResponse memory
        ) {
            placed = true;
        } catch {}
    }

    /// Oracle reference price (1e18) and whether it is fresh within `maxAge` seconds.
    function oracleRef(uint8 oracleType, string memory base, string memory quote, uint256 maxAge)
        public
        view
        returns (uint256 price, bool fresh)
    {
        if (bytes(base).length == 0) return (0, false);
        try IOracleModule(0x0000000000000000000000000000000000000067).oraclePricePairState(oracleType, base, quote) returns (
            IOracleModule.PricePairState memory s
        ) {
            price = s.pairPrice;
            uint256 ts = s.baseTimestamp < s.quoteTimestamp ? s.baseTimestamp : s.quoteTimestamp;
            if (ts == 0) ts = s.baseTimestamp;
            fresh = price > 0 && ts <= block.timestamp && block.timestamp - ts <= maxAge;
        } catch {
            return (0, false);
        }
    }

    function subaccountOf(address a, string memory nonce) public pure returns (string memory) {
        return string.concat(Strings.toHexString(a), nonce);
    }

    function hexId(bytes32 id) public pure returns (string memory) {
        return Strings.toHexString(uint256(id), 32);
    }

    function lower(string memory s) public pure returns (string memory) {
        bytes memory b = bytes(s);
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] >= 0x41 && b[i] <= 0x5A) b[i] = bytes1(uint8(b[i]) + 32);
        }
        return string(b);
    }
}
