// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {GuardrailVault} from "./GuardrailVault.sol";
import {ZhiAttestor} from "./ZhiAttestor.sol";
import {ZhiFactory} from "./ZhiFactory.sol";

/// @title CreditPool (P2)
/// @notice LP pool that lends native USDC to Guardrail Vaults, always behind operator first-loss
///         capital F. Credit C = k * F. Because the vault freezes at drawdown d of total equity,
///         the most it can lose before freezing is d(1+k)F, which F absorbs first. Every tier keeps
///         d(1+k) <= 0.5, leaving a 2x buffer for price gaps. Nothing is ever lent unsecured.
contract CreditPool is ERC4626, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Tier {
        uint16 minScore;
        uint32 minDays;
        uint32 minTrades;
        uint8 k; //          credit multiple
        uint256 maxCredit; // asset units
        uint16 aprBps;
    }

    struct Loan {
        uint256 principal;
        uint256 interestDue;
        uint256 lastNav; //   asset units, for profit detection between settlements
        uint64 lastAccrual;
        uint64 lastSettle;
        uint16 aprBps;
        uint8 k;
    }

    uint256 public constant EPOCH = 1 days;
    uint16 public constant RESERVE_CUT_BPS = 1000; // 10% of interest to the protocol reserve
    uint16 public constant MAX_GAP_BPS = 5000; //     d(1+k) <= 0.5

    ZhiFactory public immutable factory;
    ZhiAttestor public immutable attestor;
    Tier[4] public tiers; // tiers[0] = no credit
    mapping(address => Loan) public loans;
    uint256 public totalPrincipal;
    uint256 public reserve;

    event Borrowed(address indexed vault, uint256 amount, uint256 principal, uint8 tier);
    event Settled(address indexed vault, uint256 profit, uint256 interestPaid, uint256 principalPaid, bool reduceOnly);
    event Repaid(address indexed vault, uint256 interestPaid, uint256 principalPaid);
    event WrittenOff(address indexed vault, uint256 recovered, uint256 coveredByReserve, uint256 lpLoss);

    constructor(IERC20 asset_, ZhiFactory factory_, ZhiAttestor attestor_, address owner_)
        ERC20("Zhi Credit LP", "zCLP")
        ERC4626(asset_)
        Ownable(owner_)
    {
        factory = factory_;
        attestor = attestor_;
        // PRD v2 section 13 launch table (USDC, 6 dp)
        tiers[1] = Tier(600, 30, 100, 1, 10_000e6, 1200);
        tiers[2] = Tier(700, 60, 200, 2, 50_000e6, 1000);
        tiers[3] = Tier(780, 90, 300, 3, 250_000e6, 800);
    }

    // ---------------------------------------------------------------- LP accounting

    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) - reserve + totalPrincipal;
    }

    function maxWithdraw(address o) public view override returns (uint256) {
        uint256 liquid = IERC20(asset()).balanceOf(address(this)) - reserve;
        uint256 own = convertToAssets(balanceOf(o));
        return own < liquid ? own : liquid;
    }

    function maxRedeem(address o) public view override returns (uint256) {
        return convertToShares(maxWithdraw(o));
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    // ---------------------------------------------------------------- underwriting

    function tierOf(address vault) public view returns (uint8 t) {
        GuardrailVault v = GuardrailVault(vault);
        if (!v.agentIdSet()) return 0;
        (uint16 score, uint32 daysLive, uint32 trades) = attestor.scoreOf(v.agentId());
        for (uint8 i = 3; i >= 1; i--) {
            Tier memory tr = tiers[i];
            if (score >= tr.minScore && daysLive >= tr.minDays && trades >= tr.minTrades) return i;
        }
        return 0;
    }

    function operatorCapital(address vault) public view returns (uint256) {
        GuardrailVault v = GuardrailVault(vault);
        return v.ownerCapital() / v.assetScale();
    }

    function creditLimit(address vault) public view returns (uint256) {
        uint8 t = tierOf(vault);
        if (t == 0) return 0;
        Tier memory tr = tiers[t];
        GuardrailVault v = GuardrailVault(vault);
        (, , uint16 dd,,,) = v.bounds();
        if (uint256(dd) * (1 + tr.k) > MAX_GAP_BPS) return 0;
        uint256 byF = operatorCapital(vault) * tr.k;
        return byF < tr.maxCredit ? byF : tr.maxCredit;
    }

    function borrow(address vault, uint256 amount) external nonReentrant {
        require(factory.isVault(vault), "not a zhi vault");
        GuardrailVault v = GuardrailVault(vault);
        require(msg.sender == v.owner(), "operator only");
        require(v.creditPool() == address(this), "pool not set");
        // clean first-loss: the operator must be the vault's only equity holder while borrowing
        require(v.shares(v.owner()) == v.totalShares(), "allocators present");

        Loan storage l = loans[vault];
        _accrue(l);
        uint8 t = tierOf(vault);
        require(t > 0, "no tier");
        require(l.principal + amount <= creditLimit(vault), "over limit");
        require(amount <= IERC20(asset()).balanceOf(address(this)) - reserve, "liquidity");

        Tier memory tr = tiers[t];
        if (l.principal == 0) {
            l.lastSettle = uint64(block.timestamp);
            l.aprBps = tr.aprBps;
            l.k = tr.k;
        }
        l.principal += amount;
        totalPrincipal += amount;

        IERC20(asset()).forceApprove(vault, amount);
        v.onCreditDraw(amount);
        l.lastNav = v.nav() / v.assetScale();
        emit Borrowed(vault, amount, l.principal, t);
    }

    /// @notice Settlement waterfall, callable by anyone once per epoch.
    ///  Profits: (1) interest due to the pool (90% LPs / 10% reserve), (2) half of what remains repays
    ///  principal, (3) the rest stays as operator equity. If F < C/k, the vault goes reduce-only.
    function settle(address vault) external nonReentrant {
        Loan storage l = loans[vault];
        require(l.principal > 0, "no loan");
        require(block.timestamp >= uint256(l.lastSettle) + EPOCH, "epoch");
        l.lastSettle = uint64(block.timestamp);
        _accrue(l);

        GuardrailVault v = GuardrailVault(vault);
        uint256 navNow = v.nav() / v.assetScale();
        uint256 profit = navNow > l.lastNav ? navNow - l.lastNav : 0;

        uint256 interestPaid = profit < l.interestDue ? profit : l.interestDue;
        uint256 rest = profit - interestPaid;
        uint256 principalPaid = rest / 2 < l.principal ? rest / 2 : l.principal;
        uint256 total = interestPaid + principalPaid;

        if (total > 0) {
            try v.repayCredit(total, principalPaid) {
                l.interestDue -= interestPaid;
                l.principal -= principalPaid;
                totalPrincipal -= principalPaid;
                reserve += interestPaid * RESERVE_CUT_BPS / 1e4;
            } catch {
                interestPaid = 0;
                principalPaid = 0; // margin locked: retry next epoch
            }
        }
        l.lastNav = v.nav() / v.assetScale();

        bool ro = l.principal > 0 && operatorCapital(vault) * l.k < l.principal;
        if (v.creditReduceOnly() != ro) v.setCreditReduceOnly(ro);
        emit Settled(vault, profit, interestPaid, principalPaid, ro);
    }

    /// @notice Voluntary repayment by anyone (usually the operator): interest first, then principal.
    function repay(address vault, uint256 amount) external nonReentrant {
        Loan storage l = loans[vault];
        _accrue(l);
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), amount);
        uint256 i = amount < l.interestDue ? amount : l.interestDue;
        uint256 p = amount - i;
        require(p <= l.principal, "overpay");
        l.interestDue -= i;
        l.principal -= p;
        totalPrincipal -= p;
        reserve += i * RESERVE_CUT_BPS / 1e4;
        GuardrailVault v = GuardrailVault(vault);
        // Repaid from outside the vault: mirror the principal reduction on the vault's books.
        if (p > 0) v.reduceDebt(p);
        bool ro = l.principal > 0 && operatorCapital(vault) * l.k < l.principal;
        if (v.creditReduceOnly() != ro) v.setCreditReduceOnly(ro);
        emit Repaid(vault, i, p);
    }

    /// @notice Close out an insolvent loan on a frozen, flat vault: recover what the vault has,
    ///  cover the shortfall from the reserve, and only then socialize the remainder to LPs.
    function writeOff(address vault) external nonReentrant {
        Loan storage l = loans[vault];
        GuardrailVault v = GuardrailVault(vault);
        require(l.principal > 0, "no loan");
        require(v.frozen() && v.isFlat(), "not closable");
        (uint256 eq18, bool ok) = v.equity();
        require(ok, "equity");
        uint256 eq = eq18 / v.assetScale();
        require(eq < l.principal + l.interestDue, "solvent: use settle");

        uint256 recovered = eq;
        uint256 principalPart = recovered < l.principal ? recovered : l.principal;
        if (recovered > 0) v.repayCredit(recovered, principalPart);
        uint256 shortfall = l.principal - principalPart;
        // after recovery the vault's books still show `shortfall` of debt; clear it
        if (shortfall > 0) v.reduceDebt(shortfall);
        uint256 fromReserve = shortfall < reserve ? shortfall : reserve;
        reserve -= fromReserve;
        uint256 lpLoss = shortfall - fromReserve;

        totalPrincipal -= l.principal;
        // reserve dollars that covered the shortfall become LP assets again
        delete loans[vault];
        emit WrittenOff(vault, recovered, fromReserve, lpLoss);
    }

    function _accrue(Loan storage l) internal {
        if (l.lastAccrual != 0 && l.principal > 0) {
            uint256 dt = block.timestamp - l.lastAccrual;
            l.interestDue += l.principal * l.aprBps * dt / (365 days * 1e4);
        }
        l.lastAccrual = uint64(block.timestamp);
    }

    function setTier(uint8 i, Tier calldata t) external onlyOwner {
        require(i >= 1 && i <= 3, "tier");
        tiers[i] = t;
    }
}
