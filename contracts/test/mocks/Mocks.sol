// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IExchangeModule} from "../../src/injective/Exchange.sol";
import {ExchangeTypes} from "../../src/injective/ExchangeTypes.sol";
import {IOracleModule} from "../../src/injective/Oracle.sol";

/// 6-decimals USDC stand-in. The mock exchange (at 0x65) may move balances, mirroring how the real
/// precompile moves bank balances.
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function exchangeBurn(address from, uint256 amt) external {
        require(msg.sender == address(0x65), "only exchange");
        _burn(from, amt);
    }

    function exchangeMint(address to, uint256 amt) external {
        require(msg.sender == address(0x65), "only exchange");
        _mint(to, amt);
    }
}

/// Stateful stand-in for the Injective exchange precompile. Etched at 0x65 in tests.
/// Fills market orders at a settable mark, tracks one position per (subaccount, market).
contract MockExchange {
    struct Pos {
        bool exists;
        bool isLong;
        uint256 qty;
        uint256 entry;
        uint256 margin;
    }

    MockUSDC public usdc;
    uint256 public scale; // 1e12 for 6dp
    mapping(string => uint256) public depositOf; // subaccount => total (chain format)
    mapping(string => mapping(string => Pos)) public pos; // subaccount => market => position
    mapping(string => string[]) internal _marketsOf;
    mapping(string => uint256) public mark; // market => 18dp
    bool public rejectOrders;
    bool public rejectConditional;
    bool public revertQueries;
    uint256 public marketOrders;
    uint256 public conditionalOrders;

    // record of every accepted market order, for invariant checks
    struct Fill {
        bool isBuy;
        uint256 qty;
        uint256 price;
        uint256 margin;
    }

    Fill[] public fills;

    function init(MockUSDC u) external {
        usdc = u;
        scale = 1e12;
    }

    function setMark(string calldata m, uint256 px) external {
        mark[m] = px;
    }

    function setReject(bool orders, bool conditional) external {
        rejectOrders = orders;
        rejectConditional = conditional;
    }

    function setRevertQueries(bool r) external {
        revertQueries = r;
    }

    /// test helper: simulate PnL / fee flows directly on the deposit
    function setDeposit(string calldata sub, uint256 amt) external {
        depositOf[sub] = amt;
    }

    function fillCount() external view returns (uint256) {
        return fills.length;
    }

    // ------------------------------------------------------------ precompile surface

    function subaccountDeposit(string calldata sub, string calldata)
        external
        view
        returns (uint256 availableBalance, uint256 totalBalance)
    {
        require(!revertQueries, "query fail");
        return (depositOf[sub], depositOf[sub]);
    }

    function subaccountPositions(string calldata sub)
        external
        view
        returns (IExchangeModule.DerivativePosition[] memory out)
    {
        require(!revertQueries, "query fail");
        string[] storage ms = _marketsOf[sub];
        uint256 n;
        for (uint256 i = 0; i < ms.length; i++) if (pos[sub][ms[i]].exists) n++;
        out = new IExchangeModule.DerivativePosition[](n);
        uint256 k;
        for (uint256 i = 0; i < ms.length; i++) {
            Pos storage p = pos[sub][ms[i]];
            if (!p.exists) continue;
            out[k++] = IExchangeModule.DerivativePosition({
                subaccountID: sub,
                marketID: _upper(ms[i]), // real chain may return any case; vault must normalize
                isLong: p.isLong,
                quantity: ExchangeTypes.UFixed256x18.wrap(p.qty),
                entryPrice: ExchangeTypes.UFixed256x18.wrap(p.entry),
                margin: ExchangeTypes.UFixed256x18.wrap(p.margin),
                cumulativeFundingEntry: 0
            });
        }
    }

    function deposit(address sender, string calldata sub, string calldata, uint256 amount) external returns (bool) {
        usdc.exchangeBurn(sender, amount);
        depositOf[sub] += amount;
        return true;
    }

    function withdraw(address sender, string calldata sub, string calldata, uint256 amount) external returns (bool) {
        require(depositOf[sub] >= amount, "insufficient");
        depositOf[sub] -= amount;
        usdc.exchangeMint(sender, amount);
        return true;
    }

    function createDerivativeMarketOrder(address, IExchangeModule.DerivativeOrder calldata o)
        external
        returns (IExchangeModule.CreateDerivativeMarketOrderResponse memory r)
    {
        require(!rejectOrders, "order rejected");
        bool isBuy = keccak256(bytes(o.orderType)) == keccak256("buy");
        uint256 px = mark[o.marketID];
        require(px > 0, "no mark");
        uint256 worst = ExchangeTypes.UFixed256x18.unwrap(o.price);
        if (isBuy) require(px <= worst, "worst price");
        else require(px >= worst, "worst price");
        uint256 q = ExchangeTypes.UFixed256x18.unwrap(o.quantity);
        uint256 margin18 = ExchangeTypes.UFixed256x18.unwrap(o.margin);

        Pos storage p = pos[o.subaccountID][o.marketID];
        if (margin18 == 0) {
            // reduce-only
            require(p.exists && p.isLong != isBuy, "nothing to reduce");
            uint256 cq = q > p.qty ? p.qty : q;
            uint256 marginPart = p.margin * cq / p.qty;
            int256 pnl = p.isLong ? int256(px) - int256(p.entry) : int256(p.entry) - int256(px);
            int256 back = int256(marginPart) + pnl * int256(cq) / 1e18;
            if (back > 0) depositOf[o.subaccountID] += uint256(back) / scale;
            p.qty -= cq;
            p.margin -= marginPart;
            if (p.qty == 0) delete pos[o.subaccountID][o.marketID];
        } else {
            uint256 m6 = margin18 / scale;
            require(depositOf[o.subaccountID] >= m6, "margin");
            depositOf[o.subaccountID] -= m6;
            if (!p.exists) {
                pos[o.subaccountID][o.marketID] = Pos(true, isBuy, q, px, margin18);
                _marketsOf[o.subaccountID].push(o.marketID);
            } else {
                require(p.isLong == isBuy, "flip unsupported in mock");
                p.entry = (p.entry * p.qty + px * q) / (p.qty + q);
                p.qty += q;
                p.margin += margin18;
            }
        }
        fills.push(Fill(isBuy, q, px, margin18));
        marketOrders++;
        r.orderHash = "0xmockorder";
        r.cid = o.cid;
        r.price = ExchangeTypes.UFixed256x18.wrap(px);
        r.quantity = o.quantity;
    }

    function createDerivativeLimitOrder(address, IExchangeModule.DerivativeOrder calldata o)
        external
        returns (IExchangeModule.CreateDerivativeLimitOrderResponse memory r)
    {
        require(!rejectConditional, "conditional rejected");
        conditionalOrders++;
        r.orderHash = "0xmockexit";
        r.cid = o.cid;
    }

    function _upper(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        for (uint256 i = 2; i < b.length; i++) {
            if (b[i] >= 0x61 && b[i] <= 0x66) b[i] = bytes1(uint8(b[i]) - 32);
        }
        return string(b);
    }
}

/// Stand-in for the oracle precompile at 0x67.
contract MockOracle {
    mapping(bytes32 => uint256) public price;
    mapping(bytes32 => uint64) public ts;

    function set(string calldata base, string calldata quote, uint256 px, uint64 t) external {
        bytes32 k = keccak256(abi.encode(base, quote));
        price[k] = px;
        ts[k] = t;
    }

    function oraclePricePairState(uint8, string calldata base, string calldata quote)
        external
        view
        returns (IOracleModule.PricePairState memory s)
    {
        bytes32 k = keccak256(abi.encode(base, quote));
        require(price[k] > 0, "OraclePriceNotFound");
        s.pairPrice = price[k];
        s.basePrice = price[k];
        s.baseTimestamp = ts[k];
        s.quoteTimestamp = ts[k];
    }
}

/// Minimal ERC-8004 identity registry with the reference semantics Zhi relies on.
contract MockIdentityRegistry is ERC721 {
    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

    uint256 public lastId;
    mapping(uint256 => mapping(string => bytes)) public meta;
    mapping(uint256 => string) public uris;

    constructor() ERC721("AgentIdentity", "AGENT") {}

    function register(string memory agentURI, MetadataEntry[] memory md) external returns (uint256 id) {
        id = lastId++;
        _safeMint(msg.sender, id);
        uris[id] = agentURI;
        for (uint256 i = 0; i < md.length; i++) meta[id][md[i].metadataKey] = md[i].metadataValue;
    }

    function getMetadata(uint256 id, string memory key) external view returns (bytes memory) {
        return meta[id][key];
    }

    function setMetadata(uint256 id, string memory key, bytes memory value) external {
        require(_isAuthorized(ownerOf(id), msg.sender, id), "Not authorized");
        meta[id][key] = value;
    }

    function isAuthorizedOrOwner(address spender, uint256 id) external view returns (bool) {
        return _isAuthorized(ownerOf(id), spender, id);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        return uris[id];
    }
}

contract MockReputationRegistry {
    MockIdentityRegistry public identity;

    struct Fb {
        uint256 agentId;
        address client;
        int128 value;
        uint8 decimals;
        string tag1;
        string tag2;
        bytes32 hash;
    }

    Fb[] public feedback;

    event NewFeedback(uint256 indexed agentId, address indexed client, int128 value, string tag1, string tag2);

    constructor(MockIdentityRegistry i) {
        identity = i;
    }

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata,
        string calldata,
        bytes32 feedbackHash
    ) external {
        require(!identity.isAuthorizedOrOwner(msg.sender, agentId), "Self-feedback not allowed");
        feedback.push(Fb(agentId, msg.sender, value, valueDecimals, tag1, tag2, feedbackHash));
        emit NewFeedback(agentId, msg.sender, value, tag1, tag2);
    }

    function count() external view returns (uint256) {
        return feedback.length;
    }
}
