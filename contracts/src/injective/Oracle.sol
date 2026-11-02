// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Injective Oracle precompile
/// @notice Read-only access to the on-chain oracle reference prices.
/// @dev Deployed at 0x0000000000000000000000000000000000000067
interface IOracleModule {
    /// @notice Full price-pair state returned by oraclePricePairState and
    ///         oraclePricePairStateScaled.
    ///
    /// @dev All price and cumulative-price fields are 1e18-scaled unsigned
    ///      integers (raw LegacyDec mantissas).  Divide by 1e18 to obtain the
    ///      human-readable decimal value.
    ///
    ///      When `quote == "USD"` (single-leg oracle path):
    ///        - quotePrice            == 0
    ///        - quoteCumulativePrice  == 0
    ///        - quoteTimestamp        == baseTimestamp
    ///
    ///      This matches the on-chain PricePairStateForUSD semantics.
    struct PricePairState {
        /// @notice base/quote ratio, 1e18 scaled.
        uint256 pairPrice;
        /// @notice Raw base-leg spot price, 1e18 scaled.
        uint256 basePrice;
        /// @notice Raw quote-leg spot price, 1e18 scaled.  Zero when quote == "USD".
        uint256 quotePrice;
        /// @notice Cumulative base price used for TWAP computation, 1e18 scaled.
        uint256 baseCumulativePrice;
        /// @notice Cumulative quote price used for TWAP computation, 1e18 scaled.
        ///         Zero when quote == "USD".
        uint256 quoteCumulativePrice;
        /// @notice Unix seconds of the most recent base-leg price update.
        uint64 baseTimestamp;
        /// @notice Unix seconds of the most recent quote-leg price update.
        ///         Equal to baseTimestamp when quote == "USD".
        uint64 quoteTimestamp;
    }

    /// @notice Returns the reference price for a (oracleType, base, quote) triple.
    ///
    /// @dev All prices are returned as unsigned integers scaled by 1e18 (i.e. the raw
    /// mantissa of the underlying `LegacyDec` value). Divide by 1e18 to obtain the
    /// human-readable decimal price.
    ///
    /// Supported oracleType values:
    ///   2  = PriceFeed
    ///   3  = Coinbase
    ///   9  = Pyth
    ///   11 = Provider
    ///   12 = Stork
    ///   13 = ChainlinkDataStreams
    ///
    /// Deprecated / unsupported types (1=Band, 4=Chainlink, 10=BandIBC) will
    /// cause a revert with an OraclePriceNotFound error.
    ///
    /// Key conventions per oracle type:
    ///   PriceFeed / Coinbase / Stork / ChainlinkDataStreams:
    ///     base  = asset symbol (e.g. "BTC")
    ///     quote = quote symbol or "USD"
    ///   Pyth:
    ///     base  = 0x-prefixed 32-byte price-id hex string
    ///     quote = "USD" (Pyth always quotes in USD)
    ///   Provider:
    ///     base  = asset symbol (or compound key from JoinProviderCompoundKey)
    ///     quote = provider name (e.g. "prov1")
    ///
    /// @param oracleType Numeric oracle-type enum value (see above).
    /// @param base       Base asset identifier (oracle-type–dependent, see above).
    /// @param quote      Quote asset identifier (oracle-type–dependent, see above).
    /// @return price     Reference price scaled by 1e18.  Reverts if no price is available.
    function oraclePrice(
        uint8 oracleType,
        string calldata base,
        string calldata quote
    ) external view returns (uint256 price);

    /// @notice Returns the full price-pair state for a (oracleType, base, quote) triple.
    ///
    /// @dev The returned struct includes pair price, individual leg prices, cumulative
    ///      prices for TWAP computation, and per-leg timestamps.  All price values are
    ///      1e18-scaled unsigned integers.
    ///
    ///      Recommended for Chainlink AggregatorV3Interface and Pyth PythAggregatorV3
    ///      wrapper contracts, where latestRoundData() requires both the price and a
    ///      timestamp (updatedAt).
    ///
    ///      Oracle type conventions are the same as oraclePrice().
    ///
    ///      When quote == "USD" the quotePrice, quoteCumulativePrice are returned as 0
    ///      and quoteTimestamp equals baseTimestamp (single-leg path, no quote-side data).
    ///
    /// @param oracleType Numeric oracle-type enum value.
    /// @param base       Base asset identifier.
    /// @param quote      Quote asset identifier.
    /// @return state     Full price-pair state.  Reverts if no price is available.
    function oraclePricePairState(
        uint8 oracleType,
        string calldata base,
        string calldata quote
    ) external view returns (PricePairState memory state);

    /// @notice Returns the full price-pair state with explicit decimal scaling.
    ///
    /// @dev Equivalent to oraclePricePairState() but applies decimal scaling to the
    ///      pair price:
    ///
    ///        pairPrice = baseRate * 10^quoteDecimals / (quoteRate * 10^baseDecimals)
    ///
    ///      This matches the ScalingOptions behaviour of the on-chain oracle module.
    ///
    ///      Scaling is only valid when:
    ///        - oracleType != PriceFeed (2)
    ///        - quote != "USD"
    ///      Any other combination reverts with OraclePriceNotFound.
    ///
    ///      The basePrice, quotePrice, cumulative, and timestamp fields are not
    ///      affected by scaling; only pairPrice is rescaled.
    ///
    /// @param oracleType   Numeric oracle-type enum value.
    /// @param base         Base asset identifier.
    /// @param quote        Quote asset identifier (must not be "USD").
    /// @param baseDecimals Decimal precision of the base asset.
    /// @param quoteDecimals Decimal precision of the quote asset.
    /// @return state       Full price-pair state with scaled pairPrice.  Reverts if
    ///                     no price is available or the combination is not allowed.
    function oraclePricePairStateScaled(
        uint8 oracleType,
        string calldata base,
        string calldata quote,
        uint32 baseDecimals,
        uint32 quoteDecimals
    ) external view returns (PricePairState memory state);
}
