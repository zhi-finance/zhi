// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IExchangeModule} from "./injective/Exchange.sol";
import {ExchangeTypes} from "./injective/ExchangeTypes.sol";
import {IOracleModule} from "./injective/Oracle.sol";
import {VaultOps} from "./libraries/VaultOps.sol";
import {ZhiTypes} from "./ZhiTypes.sol";

/// @title GuardrailVault
/// @notice Owns one Zhi agent's funds and exchange subaccount on Injective EVM and is the only thing
///         that can place that agent's orders. Every intent from the harness passes the on-chain
///         checks below. A failing check emits `TradeSkipped` and returns false; it never reverts,
///         so the evidence (and the consumed nonce) persists. A daily-drawdown breach freezes the
///         vault, and anyone can enforce that with `poke()`.
/// @dev Deployed as an EIP-1167 clone by ZhiFactory. Trades through the exchange precompile at
///      0x65 on its own subaccount (no authz grant needed) and reads reference prices from the
///      oracle precompile at 0x67.
contract GuardrailVault is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants

    IExchangeModule public constant EXCHANGE = IExchangeModule(0x0000000000000000000000000000000000000065);
    IOracleModule public constant ORACLE = IOracleModule(0x0000000000000000000000000000000000000067);

    uint256 public constant TIMELOCK = 24 hours;
    uint256 public constant EPOCH = 1 days;

    /// Hard protocol ceilings: no owner action can configure bounds above these.
    uint32 public constant HARD_MAX_LEVERAGE_X100 = 2000; // 20x
    uint16 public constant HARD_MAX_DD_BPS = 5000; //        50%
    uint16 public constant HARD_MAX_DEVIATION_BPS = 1000; // 10%
    uint32 public constant HARD_MAX_ORACLE_AGE = 1 hours;
    uint16 public constant MAX_PROTOCOL_FEE_SHARE_BPS = 5000;

    /// Subaccount nonce used for trading (matches InjectiveLabs exchange-direct demo).
    string public constant SUBACCOUNT_NONCE = "000000000000000000000001";

    bytes32 public constant RULETREE_TYPEHASH = keccak256("RuleTreeApproval(bytes32 ruleTreeHash,uint256 deadline)");

    // ---------------------------------------------------------------- types

    struct InitParams {
        address owner;
        address harness;
        address asset; //          ERC-20 view of the quote denom (native USDC on Injective)
        string denom; //           bank denom of `asset`, e.g. "erc20:0x0C38..."
        address treasury; //       receives the protocol's share of fee-recipient income
        uint16 protocolFeeShareBps; // PRD section 18: 2500 = Zhi keeps 25% of the 40% share
        ZhiTypes.Bounds bounds;
        ZhiTypes.MarketInput[] markets;
    }

    // ---------------------------------------------------------------- config

    address public factory;
    address public owner;
    address public harness;
    IERC20 public asset;
    string public denom;
    uint256 public assetScale; // 10^(18 - asset decimals)
    string public subaccountId;
    string public feeRecipient; // this vault's own inj1... address
    address public treasury;
    uint16 public protocolFeeShareBps;
    uint256 public agentId;
    bool public agentIdSet;
    bool private _initialized;

    ZhiTypes.Bounds public bounds;
    ZhiTypes.Bounds public pendingBounds;
    uint64 public pendingBoundsEta;

    mapping(bytes32 => ZhiTypes.Market) internal _markets;
    bytes32[] public marketList;
    mapping(bytes32 => bytes32) public marketByHexHash; // keccak(lowercase hex id) => marketId
    mapping(bytes32 => ZhiTypes.MarketInput) internal _pendingMarkets;
    mapping(bytes32 => uint64) public pendingMarketEta;

    mapping(bytes32 => bool) public ruleTree;

    // ---------------------------------------------------------------- risk state

    bool public frozen;
    uint64 public unfreezeEta;
    bool public creditReduceOnly;
    uint64 public nextNonce;
    uint64 public lastEntryAt;
    uint64 public epochStart;
    uint256 public epochStartEquity; // 18 dp

    // ---------------------------------------------------------------- capital

    mapping(address => uint256) public shares;
    uint256 public totalShares;
    mapping(address => bool) public depositor; // e.g. the agent's AllocatorVault
    address public creditPool;
    uint256 public debt; // asset units

    // ---------------------------------------------------------------- stats (for the scorer)

    uint64 public intentsSubmitted;
    uint64 public executions;
    uint64 public adherenceSkips;

    // ---------------------------------------------------------------- events

    event Initialized(address indexed owner, address indexed harness, string subaccountId, string feeRecipient);
    event AgentIdSet(uint256 indexed agentId);
    event RuleTreeRegistered(bytes32 indexed ruleTreeHash, address indexed signer);
    event RuleTreeRevoked(bytes32 indexed ruleTreeHash);
    event ExecutionLogged(
        bytes32 indexed ruleTreeHash,
        bytes32 indexed marketId,
        uint64 indexed nonce,
        bool isBuy,
        bool reduceOnly,
        uint256 quantity,
        uint256 worstPrice,
        uint256 notional,
        uint256 leverageX100,
        bytes32 synthHash,
        bytes32 intentHash,
        string orderHash
    );
    event TradeSkipped(
        bytes32 indexed ruleTreeHash,
        bytes32 indexed marketId,
        uint64 indexed nonce,
        ZhiTypes.Skip reason,
        bytes32 synthHash,
        bytes32 intentHash
    );
    event ExitOrder(uint64 indexed nonce, bool isTakeProfit, uint256 triggerPrice, bool placed);
    event Frozen(uint256 equity, uint256 epochStartEquity);
    event UnfreezeRequested(uint64 eta);
    event Unfrozen(uint256 equity);
    event EpochRolled(uint64 epochStart, uint256 epochStartEquity);
    event BoundsTightened(ZhiTypes.Bounds bounds);
    event BoundsProposed(ZhiTypes.Bounds bounds, uint64 eta);
    event BoundsApplied(ZhiTypes.Bounds bounds);
    event MarketProposed(bytes32 indexed marketId, uint64 eta);
    event MarketAllowed(bytes32 indexed marketId, string marketIdHex);
    event MarketRemoved(bytes32 indexed marketId);
    event HarnessSet(address indexed harness);
    event DepositorSet(address indexed depositor, bool allowed);
    event Deposited(address indexed from, address indexed receiver, uint256 amount, uint256 shares);
    event Withdrawn(address indexed from, address indexed receiver, uint256 amount, uint256 shares);
    event FeesHarvested(uint256 total, uint256 protocolCut);
    event CreditPoolSet(address indexed pool);
    event CreditDrawn(uint256 amount, uint256 debt);
    event CreditRepaid(uint256 amount, uint256 principal, uint256 debt);
    event CreditReduceOnly(bool on);

    // ---------------------------------------------------------------- errors

    error NotOwner();
    error NotHarness();
    error NotFactory();
    error NotCreditPool();
    error NotDepositor();
    error AlreadyInitialized();
    error BadNonce(uint64 expected, uint64 got);
    error InvalidBounds();
    error NotTighter();
    error TimelockActive(uint64 eta);
    error NothingPending();
    error InvalidSignature();
    error SignatureExpired();
    error VaultFrozen();
    error EquityUnreadable();
    error NotFlat();
    error OutstandingDebt();
    error InsufficientShares();
    error ExchangeCallFailed();
    error InvalidMarket();
    error InvalidAmount();
    error InvalidGateReason();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyCreditPool() {
        if (msg.sender != creditPool || creditPool == address(0)) revert NotCreditPool();
        _;
    }

    constructor() EIP712("ZhiGuardrailVault", "1") {
        _initialized = true; // lock the implementation; clones start uninitialized
    }

    // ================================================================ init

    function initialize(InitParams calldata p) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        _validateBounds(p.bounds);
        if (p.protocolFeeShareBps > MAX_PROTOCOL_FEE_SHARE_BPS) revert InvalidBounds();

        factory = msg.sender;
        owner = p.owner;
        harness = p.harness;
        asset = IERC20(p.asset);
        denom = p.denom;
        uint8 dec = IERC20Metadata(p.asset).decimals();
        assetScale = 10 ** (18 - dec);
        treasury = p.treasury;
        protocolFeeShareBps = p.protocolFeeShareBps;
        bounds = p.bounds;

        subaccountId = VaultOps.subaccountOf(address(this), SUBACCOUNT_NONCE);
        feeRecipient = VaultOps.injAddress(address(this));

        for (uint256 i = 0; i < p.markets.length; i++) {
            _allowMarket(p.markets[i]);
        }

        epochStart = uint64(block.timestamp);
        emit Initialized(p.owner, p.harness, subaccountId, feeRecipient);
    }

    function setAgentId(uint256 id) external {
        if (msg.sender != factory) revert NotFactory();
        require(!agentIdSet, "agentId set");
        agentId = id;
        agentIdSet = true;
        emit AgentIdSet(id);
    }

    // ================================================================ rule trees (EIP-712 sign-off)

    /// @notice Register a rule tree hash signed by the owner (EOA or ERC-1271 multisig).
    ///         Anyone may relay the signature.
    function registerRuleTree(bytes32 hash, uint256 deadline, bytes calldata signature) external {
        if (block.timestamp > deadline) revert SignatureExpired();
        bytes32 digest = ruleTreeDigest(hash, deadline);
        if (!SignatureChecker.isValidSignatureNow(owner, digest, signature)) revert InvalidSignature();
        ruleTree[hash] = true;
        emit RuleTreeRegistered(hash, owner);
    }

    function ruleTreeDigest(bytes32 hash, uint256 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(RULETREE_TYPEHASH, hash, deadline)));
    }

    /// Revoking only ever tightens, so it is instant.
    function revokeRuleTree(bytes32 hash) external onlyOwner {
        ruleTree[hash] = false;
        emit RuleTreeRevoked(hash);
    }

    // ================================================================ the core path

    /// @notice Submit a harness intent. Returns true if an order was placed, false if skipped.
    function executeIntent(ZhiTypes.Intent calldata it) external nonReentrant returns (bool) {
        if (msg.sender != harness) revert NotHarness();
        if (it.nonce != nextNonce) revert BadNonce(nextNonce, it.nonce);
        nextNonce++;
        intentsSubmitted++;

        (uint256 eq, bool eqOk) = _equity();
        if (eqOk) {
            if (_drawdownBreached(eq)) {
                bool wasFrozen = frozen;
                _freeze(eq);
                if (!wasFrozen && !it.reduceOnly) return _skip(it, ZhiTypes.Skip.DRAWDOWN);
            }
            _rollEpoch(eq);
        }

        if ((frozen || creditReduceOnly) && !it.reduceOnly) return _skip(it, ZhiTypes.Skip.FROZEN);
        if (!ruleTree[it.ruleTreeHash]) return _skip(it, ZhiTypes.Skip.BAD_RULETREE);
        if (block.timestamp > it.deadline) return _skip(it, ZhiTypes.Skip.EXPIRED);

        ZhiTypes.Market storage m = _markets[it.marketId];
        if (!m.allowed) return _skip(it, ZhiTypes.Skip.MARKET_NOT_ALLOWED);
        if (!it.reduceOnly && !eqOk) return _skip(it, ZhiTypes.Skip.EQUITY_UNREADABLE);
        if (!it.reduceOnly && lastEntryAt != 0 && block.timestamp < uint256(lastEntryAt) + bounds.cooldownSec) {
            return _skip(it, ZhiTypes.Skip.COOLDOWN);
        }
        if (
            it.quantity == 0 || it.worstPrice == 0 || it.quantity % m.minQtyTick != 0
                || it.worstPrice % m.minPriceTick != 0
        ) return _skip(it, ZhiTypes.Skip.OFF_TICK);

        uint256 notional = it.quantity * it.worstPrice / 1e18;
        if (!it.reduceOnly) {
            if (notional > bounds.maxNotional) return _skip(it, ZhiTypes.Skip.NOTIONAL);
            if (!m.isBinary) {
                if (it.margin == 0 || notional * 100 / it.margin > bounds.maxLeverageX100) {
                    return _skip(it, ZhiTypes.Skip.LEVERAGE);
                }
            }
        }

        (uint256 refPx, bool fresh) = _oracleRef(m);
        if (fresh) {
            uint256 dev = it.worstPrice > refPx ? it.worstPrice - refPx : refPx - it.worstPrice;
            if (dev * 1e4 / refPx > bounds.maxDeviationBps) return _skip(it, ZhiTypes.Skip.PRICE_DEVIATION);
        } else if (!it.reduceOnly) {
            // Entries need a live oracle (this is also the iAsset off-hours rule). Exits are always
            // allowed: the worst price on the market order still caps their slippage.
            return _skip(it, ZhiTypes.Skip.ORACLE_STALE);
        }

        (bool placed, string memory orderHash) = VaultOps.placeMarketOrder(m.marketIdHex, subaccountId, feeRecipient, it);
        if (!placed) return _skip(it, ZhiTypes.Skip.ORDER_FAILED);

        if (!it.reduceOnly) {
            lastEntryAt = uint64(block.timestamp);
            if (it.tpPrice != 0) _placeExit(m, it, true);
            if (it.slPrice != 0) _placeExit(m, it, false);
        }
        executions++;

        emit ExecutionLogged(
            it.ruleTreeHash,
            it.marketId,
            it.nonce,
            it.isBuy,
            it.reduceOnly,
            it.quantity,
            it.worstPrice,
            notional,
            it.margin == 0 ? 0 : notional * 100 / it.margin,
            it.synthHash,
            keccak256(abi.encode(it)),
            orderHash
        );
        return true;
    }

    /// @notice Record an off-chain verifier (Synth SN50) skip on-chain, so the skip and the forecast
    ///         hash that caused it become public evidence. Consumes the nonce like any intent.
    function logGateSkip(ZhiTypes.Intent calldata it, ZhiTypes.Skip reason) external {
        if (msg.sender != harness) revert NotHarness();
        if (
            reason != ZhiTypes.Skip.SYNTH_DIRECTION && reason != ZhiTypes.Skip.SYNTH_REGIME
                && reason != ZhiTypes.Skip.SYNTH_UNAVAILABLE
        ) revert InvalidGateReason();
        if (it.nonce != nextNonce) revert BadNonce(nextNonce, it.nonce);
        nextNonce++;
        intentsSubmitted++;
        _skip(it, reason);
    }

    /// @notice Permissionless circuit breaker: anyone can enforce the drawdown limit, so a stalled
    ///         or malicious harness cannot keep a breached vault alive.
    function poke() external returns (bool isFrozen) {
        (uint256 eq, bool ok) = _equity();
        if (ok) {
            if (_drawdownBreached(eq)) _freeze(eq);
            _rollEpoch(eq);
        }
        return frozen;
    }

    // ================================================================ bounds (tighten now, loosen after 24h)

    function tightenBounds(ZhiTypes.Bounds calldata b) external onlyOwner {
        _validateBounds(b);
        ZhiTypes.Bounds memory c = bounds;
        if (
            b.maxNotional > c.maxNotional || b.maxLeverageX100 > c.maxLeverageX100
                || b.maxDailyDdBps > c.maxDailyDdBps || b.maxDeviationBps > c.maxDeviationBps
                || b.cooldownSec < c.cooldownSec || b.maxOracleAgeSec > c.maxOracleAgeSec
        ) revert NotTighter();
        bounds = b;
        emit BoundsTightened(b);
    }

    function proposeBounds(ZhiTypes.Bounds calldata b) external onlyOwner {
        _validateBounds(b);
        pendingBounds = b;
        pendingBoundsEta = uint64(block.timestamp + TIMELOCK);
        emit BoundsProposed(b, pendingBoundsEta);
    }

    function applyBounds() external onlyOwner {
        uint64 eta = pendingBoundsEta;
        if (eta == 0) revert NothingPending();
        if (block.timestamp < eta) revert TimelockActive(eta);
        // Credit invariant: while borrowed capital is outstanding, the freeze level cannot widen.
        if (debt > 0 && pendingBounds.maxDailyDdBps > bounds.maxDailyDdBps) revert OutstandingDebt();
        bounds = pendingBounds;
        pendingBoundsEta = 0;
        emit BoundsApplied(bounds);
    }

    function cancelPendingBounds() external onlyOwner {
        pendingBoundsEta = 0;
    }

    // ================================================================ markets (add after 24h, remove now)

    function proposeMarket(ZhiTypes.MarketInput calldata mi) external onlyOwner {
        if (mi.marketId == bytes32(0) || mi.minPriceTick == 0 || mi.minQtyTick == 0) revert InvalidMarket();
        _pendingMarkets[mi.marketId] = mi;
        pendingMarketEta[mi.marketId] = uint64(block.timestamp + TIMELOCK);
        emit MarketProposed(mi.marketId, pendingMarketEta[mi.marketId]);
    }

    function applyMarket(bytes32 marketId) external onlyOwner {
        uint64 eta = pendingMarketEta[marketId];
        if (eta == 0) revert NothingPending();
        if (block.timestamp < eta) revert TimelockActive(eta);
        _allowMarket(_pendingMarkets[marketId]);
        delete pendingMarketEta[marketId];
        delete _pendingMarkets[marketId];
    }

    function removeMarket(bytes32 marketId) external onlyOwner {
        _markets[marketId].allowed = false; // oracle config kept so open positions still mark
        emit MarketRemoved(marketId);
    }

    // ================================================================ freeze lifecycle

    function requestUnfreeze() external onlyOwner {
        if (!frozen) revert NothingPending();
        unfreezeEta = uint64(block.timestamp + TIMELOCK);
        emit UnfreezeRequested(unfreezeEta);
    }

    function unfreeze() external onlyOwner {
        if (!frozen || unfreezeEta == 0) revert NothingPending();
        if (block.timestamp < unfreezeEta) revert TimelockActive(unfreezeEta);
        (uint256 eq, bool ok) = _equity();
        if (!ok) revert EquityUnreadable();
        frozen = false;
        unfreezeEta = 0;
        epochStart = uint64(block.timestamp);
        epochStartEquity = eq;
        emit Unfrozen(eq);
    }

    // ================================================================ roles

    /// Rotating the harness key is key management, not a limit change, so it is instant.
    function setHarness(address h) external onlyOwner {
        harness = h;
        emit HarnessSet(h);
    }

    function setDepositor(address d, bool allowed) external onlyOwner {
        depositor[d] = allowed;
        emit DepositorSet(d, allowed);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero");
        owner = newOwner;
    }

    // ================================================================ capital

    /// @notice Deposit quote asset; mints vault shares at current net asset value.
    function deposit(uint256 amount, address receiver) external nonReentrant returns (uint256 minted) {
        if (msg.sender != owner && !depositor[msg.sender]) revert NotDepositor();
        if (frozen || creditReduceOnly) revert VaultFrozen();
        if (amount == 0) revert InvalidAmount();
        (uint256 eq, bool ok) = _equity();
        if (!ok) revert EquityUnreadable();
        uint256 debt18 = debt * assetScale;
        uint256 navBefore = eq > debt18 ? eq - debt18 : 0;

        asset.safeTransferFrom(msg.sender, address(this), amount);
        _toSubaccount(amount);

        uint256 value = amount * assetScale;
        if (totalShares == 0) {
            minted = value;
        } else {
            require(navBefore > 0, "insolvent");
            minted = value * totalShares / navBefore;
        }
        shares[receiver] += minted;
        totalShares += minted;
        epochStartEquity += value;
        emit Deposited(msg.sender, receiver, amount, minted);
    }

    /// @notice Burn shares for quote asset. Only when the vault is flat and debt-free (PRD section 10).
    function withdraw(uint256 shareAmount, address receiver) external nonReentrant returns (uint256 amount) {
        if (shareAmount == 0 || shares[msg.sender] < shareAmount) revert InsufficientShares();
        if (debt != 0) revert OutstandingDebt();
        if (!isFlat()) revert NotFlat();
        (uint256 eq, bool ok) = _equity();
        if (!ok) revert EquityUnreadable();

        amount = shareAmount * eq / totalShares / assetScale;
        shares[msg.sender] -= shareAmount;
        totalShares -= shareAmount;

        _fromSubaccount(amount);
        asset.safeTransfer(receiver, amount);
        uint256 v = amount * assetScale;
        epochStartEquity = epochStartEquity > v ? epochStartEquity - v : 0;
        emit Withdrawn(msg.sender, receiver, amount, shareAmount);
    }

    /// @notice Split fee-recipient income (Injective pays 40% of trading fees on orders this vault
    ///         sources to its bank balance). Protocol share to treasury, the rest compounds.
    function harvestFees() external nonReentrant returns (uint256 total) {
        total = asset.balanceOf(address(this));
        if (total == 0) return 0;
        uint256 cut = total * protocolFeeShareBps / 1e4;
        if (cut > 0) asset.safeTransfer(treasury, cut);
        if (total > cut) _toSubaccount(total - cut);
        uint256 v = cut * assetScale;
        epochStartEquity = epochStartEquity > v ? epochStartEquity - v : 0;
        emit FeesHarvested(total, cut);
    }

    // ================================================================ credit (P2)

    function setCreditPool(address pool) external onlyOwner {
        if (debt != 0) revert OutstandingDebt();
        creditPool = pool;
        emit CreditPoolSet(pool);
    }

    /// Custody rule: borrowed USDC only moves between the credit pool and this vault's subaccount.
    function onCreditDraw(uint256 amount) external onlyCreditPool nonReentrant {
        if (frozen || creditReduceOnly) revert VaultFrozen();
        asset.safeTransferFrom(creditPool, address(this), amount);
        _toSubaccount(amount);
        debt += amount;
        epochStartEquity += amount * assetScale;
        emit CreditDrawn(amount, debt);
    }

    function repayCredit(uint256 amount, uint256 principal) external onlyCreditPool nonReentrant {
        require(principal <= amount && principal <= debt, "bad repay");
        _fromSubaccount(amount);
        asset.safeTransfer(creditPool, amount);
        debt -= principal;
        uint256 v = amount * assetScale;
        epochStartEquity = epochStartEquity > v ? epochStartEquity - v : 0;
        emit CreditRepaid(amount, principal, debt);
    }

    /// Book entry only: principal was repaid to the pool from outside the vault, or written off.
    function reduceDebt(uint256 principal) external onlyCreditPool {
        require(principal <= debt, "bad repay");
        debt -= principal;
        emit CreditRepaid(0, principal, debt);
    }

    function setCreditReduceOnly(bool on) external onlyCreditPool {
        creditReduceOnly = on;
        emit CreditReduceOnly(on);
    }

    // ================================================================ views

    function equity() external view returns (uint256 eq, bool ok) {
        return _equity();
    }

    /// Net asset value attributable to share holders (equity minus debt), 18 dp.
    function nav() public view returns (uint256) {
        (uint256 eq, bool ok) = _equity();
        if (!ok) return 0;
        uint256 d = debt * assetScale;
        return eq > d ? eq - d : 0;
    }

    /// Operator first-loss capital F, 18 dp.
    function ownerCapital() external view returns (uint256) {
        if (totalShares == 0) return 0;
        return shares[owner] * nav() / totalShares;
    }

    function sharesToAssets(uint256 s) external view returns (uint256) {
        if (totalShares == 0) return 0;
        return s * nav() / totalShares / assetScale;
    }

    function isFlat() public view returns (bool) {
        try EXCHANGE.subaccountPositions(subaccountId) returns (IExchangeModule.DerivativePosition[] memory ps) {
            return ps.length == 0;
        } catch {
            return false;
        }
    }

    function getMarket(bytes32 id) external view returns (ZhiTypes.Market memory) {
        return _markets[id];
    }

    function oracleRef(bytes32 id) external view returns (uint256 price, bool fresh) {
        return _oracleRef(_markets[id]);
    }

    // ================================================================ internals

    function _skip(ZhiTypes.Intent calldata it, ZhiTypes.Skip r) internal returns (bool) {
        if (ZhiTypes.isInvariantSkip(r)) adherenceSkips++;
        emit TradeSkipped(it.ruleTreeHash, it.marketId, it.nonce, r, it.synthHash, keccak256(abi.encode(it)));
        return false; // success return: the event and the consumed nonce persist
    }

    function _drawdownBreached(uint256 eq) internal view returns (bool) {
        uint256 start = epochStartEquity;
        return start != 0 && eq < start && (start - eq) * 1e4 / start >= bounds.maxDailyDdBps;
    }

    function _freeze(uint256 eq) internal {
        if (frozen) return;
        frozen = true;
        unfreezeEta = 0;
        // Entries are market orders and never rest on the book, so there are no resting entries to
        // cancel. On-book exits (reduce-only TP/SL) intentionally stay so open risk keeps its stops.
        emit Frozen(eq, epochStartEquity);
    }

    /// Breach is checked against the old baseline before rolling, so a loss that spans an epoch
    /// boundary cannot be forgiven by the roll itself.
    function _rollEpoch(uint256 eq) internal {
        if (block.timestamp >= uint256(epochStart) + EPOCH) {
            epochStart = uint64(block.timestamp);
            epochStartEquity = eq;
            emit EpochRolled(epochStart, eq);
        }
    }

    /// Equity = idle quote balance + subaccount deposits + sum(position margin + unrealized PnL at
    /// the oracle reference). Any unreadable component makes the whole read fail (fail closed).
    function _equity() internal view returns (uint256 eq, bool ok) {
        try asset.balanceOf(address(this)) returns (uint256 idle) {
            eq = idle * assetScale; // MTS tokens read the bank precompile; treat failure as unreadable
        } catch {
            return (0, false);
        }
        try EXCHANGE.subaccountDeposit(subaccountId, denom) returns (uint256, uint256 total) {
            eq += total * assetScale;
        } catch {
            return (0, false);
        }
        try EXCHANGE.subaccountPositions(subaccountId) returns (IExchangeModule.DerivativePosition[] memory ps) {
            for (uint256 i = 0; i < ps.length; i++) {
                bytes32 id = marketByHexHash[keccak256(bytes(VaultOps.lower(ps[i].marketID)))];
                if (id == bytes32(0)) return (0, false);
                (uint256 px,) = _oracleRef(_markets[id]);
                if (px == 0) return (0, false);
                uint256 q = ExchangeTypes.UFixed256x18.unwrap(ps[i].quantity);
                uint256 entry = ExchangeTypes.UFixed256x18.unwrap(ps[i].entryPrice);
                uint256 margin = ExchangeTypes.UFixed256x18.unwrap(ps[i].margin);
                bool up = px >= entry;
                uint256 move = (up ? px - entry : entry - px) * q / 1e18;
                bool gain = ps[i].isLong ? up : !up;
                if (gain) eq += margin + move;
                else if (move < margin) eq += margin - move;
                // else: position value floored at zero (would be liquidated)
            }
        } catch {
            return (0, false);
        }
        return (eq, true);
    }

    function _oracleRef(ZhiTypes.Market storage m) internal view returns (uint256, bool) {
        return VaultOps.oracleRef(m.oracleType, m.oracleBase, m.oracleQuote, bounds.maxOracleAgeSec);
    }

    function _placeExit(ZhiTypes.Market storage m, ZhiTypes.Intent calldata it, bool takeProfit) internal {
        bool placed = VaultOps.placeExit(m.marketIdHex, subaccountId, feeRecipient, it, takeProfit);
        emit ExitOrder(it.nonce, takeProfit, takeProfit ? it.tpPrice : it.slPrice, placed);
    }

    function _toSubaccount(uint256 amount) internal {
        if (amount == 0) return;
        bool ok;
        try EXCHANGE.deposit(address(this), subaccountId, denom, amount) returns (bool s) {
            ok = s;
        } catch {}
        if (!ok) revert ExchangeCallFailed();
    }

    function _fromSubaccount(uint256 amount) internal {
        uint256 idle = asset.balanceOf(address(this));
        if (idle >= amount) return;
        uint256 need = amount - idle;
        bool ok;
        try EXCHANGE.withdraw(address(this), subaccountId, denom, need) returns (bool s) {
            ok = s;
        } catch {}
        if (!ok) revert ExchangeCallFailed();
    }

    function _allowMarket(ZhiTypes.MarketInput memory mi) internal {
        if (mi.marketId == bytes32(0) || mi.minPriceTick == 0 || mi.minQtyTick == 0) revert InvalidMarket();
        ZhiTypes.Market storage m = _markets[mi.marketId];
        if (bytes(m.marketIdHex).length == 0) {
            m.marketIdHex = VaultOps.hexId(mi.marketId);
            marketByHexHash[keccak256(bytes(m.marketIdHex))] = mi.marketId;
            marketList.push(mi.marketId);
        }
        m.allowed = true;
        m.isBinary = mi.isBinary;
        m.oracleType = mi.oracleType;
        m.oracleBase = mi.oracleBase;
        m.oracleQuote = mi.oracleQuote;
        m.minPriceTick = mi.minPriceTick;
        m.minQtyTick = mi.minQtyTick;
        emit MarketAllowed(mi.marketId, m.marketIdHex);
    }

    function _validateBounds(ZhiTypes.Bounds memory b) internal pure {
        if (
            b.maxNotional == 0 || b.maxLeverageX100 < 100 || b.maxLeverageX100 > HARD_MAX_LEVERAGE_X100
                || b.maxDailyDdBps == 0 || b.maxDailyDdBps > HARD_MAX_DD_BPS || b.maxDeviationBps == 0
                || b.maxDeviationBps > HARD_MAX_DEVIATION_BPS || b.maxOracleAgeSec == 0
                || b.maxOracleAgeSec > HARD_MAX_ORACLE_AGE
        ) revert InvalidBounds();
    }
}
