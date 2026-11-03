// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Shared types for the Zhi protocol. Numeric conventions:
///  - prices, quantities, margins and notionals are Injective "API format": human value * 1e18
///  - basis points are 1e4 = 100%
library ZhiTypes {
    /// @dev Order matters: it is part of the ABI and the off-chain scorer keys on it.
    ///      0-9 match PRD v2 section 10. 10+ are additions documented in docs/ARCHITECTURE.md.
    enum Skip {
        FROZEN, //              0  vault frozen (or credit reduce-only) and intent is not reduce-only
        BAD_RULETREE, //        1  intent cites a rule tree hash that was never signed/registered
        EXPIRED, //             2  block.timestamp > deadline
        MARKET_NOT_ALLOWED, //  3  market not on allowlist
        COOLDOWN, //            4  too soon after the previous entry
        NOTIONAL, //            5  quantity * worstPrice > maxNotional
        LEVERAGE, //            6  margin == 0 or notional / margin > maxLeverage
        ORACLE_STALE, //        7  oracle reference missing or older than maxOracleAgeSec
        PRICE_DEVIATION, //     8  worstPrice too far from oracle reference
        DRAWDOWN, //            9  this intent found the daily drawdown breached and froze the vault
        OFF_TICK, //           10  quantity / price not a multiple of the market tick sizes
        EQUITY_UNREADABLE, //  11  fail closed: equity could not be computed for an entry
        ORDER_FAILED, //       12  exchange precompile rejected the order (no revert, evidence kept)
        SYNTH_DIRECTION, //    13  off-chain gate: Synth direction probability under threshold
        SYNTH_REGIME, //       14  off-chain gate: Synth 90% band wider than ceiling
        SYNTH_UNAVAILABLE //   15  off-chain gate: Synth unreachable / malformed -> fail closed
    }

    struct Bounds {
        uint256 maxNotional; //     quote units, 18 dp
        uint32 maxLeverageX100; //  500 = 5.00x
        uint16 maxDailyDdBps; //    400 = 4%
        uint16 maxDeviationBps; //  worst price vs oracle reference
        uint32 cooldownSec; //      min seconds between entries
        uint32 maxOracleAgeSec; //  oracle freshness window (also the iAsset liveness rule)
    }

    struct Intent {
        bytes32 ruleTreeHash;
        bytes32 marketId;
        bool isBuy;
        bool reduceOnly;
        uint256 quantity; //   18 dp
        uint256 worstPrice; // 18 dp; market orders carry it so the exchange caps slippage
        uint256 margin; //     18 dp; ignored (forced 0) for reduce-only
        uint256 tpPrice; //    optional on-book take-profit trigger (0 = none)
        uint256 slPrice; //    optional on-book stop-loss trigger (0 = none)
        bytes32 synthHash; //  keccak256 of the raw Synth response that justified the entry
        uint64 nonce;
        uint64 deadline;
    }

    struct MarketInput {
        bytes32 marketId;
        bool isBinary; //       binary options: leverage check skipped, notional cap kept
        uint8 oracleType; //    Injective oracle type (13 = ChainlinkDataStreams, 9 = Pyth, ...)
        string oracleBase;
        string oracleQuote;
        uint256 minPriceTick; // 18 dp
        uint256 minQtyTick; //   18 dp
    }

    struct Market {
        bool allowed;
        bool isBinary;
        uint8 oracleType;
        string marketIdHex; // lowercase 0x-prefixed, as the exchange module expects
        string oracleBase;
        string oracleQuote;
        uint256 minPriceTick;
        uint256 minQtyTick;
    }

    function isInvariantSkip(Skip s) internal pure returns (bool) {
        // PRD section 12: these count against contract adherence. Synth / cooldown skips are the
        // system working as designed and do not.
        return s == Skip.NOTIONAL || s == Skip.LEVERAGE || s == Skip.MARKET_NOT_ALLOWED
            || s == Skip.PRICE_DEVIATION || s == Skip.BAD_RULETREE || s == Skip.OFF_TICK;
    }
}
