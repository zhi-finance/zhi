//! Injective EVM bindings: the Guardrail Vault, the Zhi Attestor, and the exchange / oracle
//! precompiles (read-only eth_calls work against the real chain).

use alloy::primitives::{Address, B256, U256};
use alloy::sol;
use zhi_core::Fx;

sol! {
    #[sol(rpc)]
    contract GuardrailVault {
        struct Bounds { uint256 maxNotional; uint32 maxLeverageX100; uint16 maxDailyDdBps; uint16 maxDeviationBps; uint32 cooldownSec; uint32 maxOracleAgeSec; }
        struct Intent { bytes32 ruleTreeHash; bytes32 marketId; bool isBuy; bool reduceOnly; uint256 quantity; uint256 worstPrice; uint256 margin; uint256 tpPrice; uint256 slPrice; bytes32 synthHash; uint64 nonce; uint64 deadline; }
        struct Market { bool allowed; bool isBinary; uint8 oracleType; string marketIdHex; string oracleBase; string oracleQuote; uint256 minPriceTick; uint256 minQtyTick; }

        event ExecutionLogged(bytes32 indexed ruleTreeHash, bytes32 indexed marketId, uint64 indexed nonce, bool isBuy, bool reduceOnly, uint256 quantity, uint256 worstPrice, uint256 notional, uint256 leverageX100, bytes32 synthHash, bytes32 intentHash, string orderHash);
        event TradeSkipped(bytes32 indexed ruleTreeHash, bytes32 indexed marketId, uint64 indexed nonce, uint8 reason, bytes32 synthHash, bytes32 intentHash);
        event Frozen(uint256 equity, uint256 epochStartEquity);

        function executeIntent(Intent calldata it) external returns (bool);
        function logGateSkip(Intent calldata it, uint8 reason) external;
        function poke() external returns (bool);
        function equity() external view returns (uint256 eq, bool ok);
        function nextNonce() external view returns (uint64);
        function lastEntryAt() external view returns (uint64);
        function frozen() external view returns (bool);
        function creditReduceOnly() external view returns (bool);
        function harness() external view returns (address);
        function owner() external view returns (address);
        function agentId() external view returns (uint256);
        function subaccountId() external view returns (string);
        function ruleTree(bytes32) external view returns (bool);
        function epochStartEquity() external view returns (uint256);
        function intentsSubmitted() external view returns (uint64);
        function executions() external view returns (uint64);
        function adherenceSkips() external view returns (uint64);
        function bounds() external view returns (uint256 maxNotional, uint32 maxLeverageX100, uint16 maxDailyDdBps, uint16 maxDeviationBps, uint32 cooldownSec, uint32 maxOracleAgeSec);
        function getMarket(bytes32 id) external view returns (Market memory);
    }

    #[sol(rpc)]
    contract ZhiAttestor {
        struct EpochReport { int128 pnlBps; uint128 maxDdBps; uint128 adherenceX1e4; uint16 score; uint32 daysLive; uint32 closedTrades; bytes32 reportHash; uint64 postedAt; }
        function postEpoch(uint256 agentId, uint64 epoch, EpochReport calldata r, string calldata reportURI) external;
        function scoreState(uint256) external view returns (uint64 pendingEpoch, uint64 lastEpoch, bool challenged, uint16 finalScore, uint32 finalDaysLive, uint32 finalClosedTrades, uint64 finalEpoch);
    }

    #[sol(rpc)]
    contract ExchangePrecompile {
        struct DerivativePosition { string subaccountID; string marketID; bool isLong; uint256 quantity; uint256 entryPrice; uint256 margin; int256 cumulativeFundingEntry; }
        function subaccountPositions(string calldata subaccountID) external view returns (DerivativePosition[] memory positions);
        function subaccountDeposit(string calldata subaccountID, string calldata denom) external view returns (uint256 availableBalance, uint256 totalBalance);
    }

    #[sol(rpc)]
    contract OraclePrecompile {
        struct PricePairState { uint256 pairPrice; uint256 basePrice; uint256 quotePrice; uint256 baseCumulativePrice; uint256 quoteCumulativePrice; uint64 baseTimestamp; uint64 quoteTimestamp; }
        function oraclePricePairState(uint8 oracleType, string calldata base, string calldata quote) external view returns (PricePairState memory state);
    }
}

pub const EXCHANGE: Address = Address::new([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x65]);
pub const ORACLE: Address = Address::new([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x67]);

pub fn fx_from_u256(v: U256) -> Fx {
    Fx::from_u256_raw(v.to::<u128>())
}

pub fn to_sol_intent(it: &zhi_core::intent::Intent) -> GuardrailVault::Intent {
    let s = it.to_sol();
    GuardrailVault::Intent {
        ruleTreeHash: s.ruleTreeHash,
        marketId: s.marketId,
        isBuy: s.isBuy,
        reduceOnly: s.reduceOnly,
        quantity: s.quantity,
        worstPrice: s.worstPrice,
        margin: s.margin,
        tpPrice: s.tpPrice,
        slPrice: s.slPrice,
        synthHash: s.synthHash,
        nonce: s.nonce,
        deadline: s.deadline,
    }
}

pub fn b256(s: &str) -> anyhow::Result<B256> {
    Ok(s.parse()?)
}

/// Skip reason codes, mirroring ZhiTypes.Skip.
pub const SKIP_NAMES: [&str; 16] = [
    "FROZEN",
    "BAD_RULETREE",
    "EXPIRED",
    "MARKET_NOT_ALLOWED",
    "COOLDOWN",
    "NOTIONAL",
    "LEVERAGE",
    "ORACLE_STALE",
    "PRICE_DEVIATION",
    "DRAWDOWN",
    "OFF_TICK",
    "EQUITY_UNREADABLE",
    "ORDER_FAILED",
    "SYNTH_DIRECTION",
    "SYNTH_REGIME",
    "SYNTH_UNAVAILABLE",
];

pub fn skip_name(code: u8) -> &'static str {
    SKIP_NAMES.get(code as usize).copied().unwrap_or("UNKNOWN")
}
