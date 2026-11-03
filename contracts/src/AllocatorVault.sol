// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {GuardrailVault} from "./GuardrailVault.sol";
import {ZhiAttestor} from "./ZhiAttestor.sol";

/// @title AllocatorVault (P1)
/// @notice One ERC-4626 vault per agent, denominated in native USDC, that deposits into the agent's
///         Guardrail Vault. Allocators get exactly the same on-chain limits as the operator.
///         Performance fee: 20% of net profit above a high-water mark, settled each epoch;
///         15 points to the operator, 5 to the protocol. No management fee.
///         The deposit cap scales with the agent's finalized Zhi Score; deposits close while frozen.
contract AllocatorVault is ERC4626 {
    using SafeERC20 for IERC20;
    using Math for uint256;

    uint256 public constant EPOCH = 1 days;
    uint16 public constant PERF_FEE_BPS = 2000;
    uint16 public constant OPERATOR_FEE_BPS = 1500; // of profit; protocol gets the remaining 500

    GuardrailVault public immutable guardrail;
    ZhiAttestor public immutable attestor;
    address public immutable treasury;

    uint256 public highWaterMark; // assets per 1e18 shares
    uint64 public lastSettle;

    event EpochSettled(uint256 pricePerShare, uint256 highWaterMark, uint256 operatorShares, uint256 protocolShares);

    constructor(GuardrailVault guardrail_, ZhiAttestor attestor_, address treasury_, string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
        ERC4626(IERC20(address(guardrail_.asset())))
    {
        guardrail = guardrail_;
        attestor = attestor_;
        treasury = treasury_;
        highWaterMark = _pps();
        lastSettle = uint64(block.timestamp);
    }

    function operator() public view returns (address) {
        return guardrail.owner();
    }

    /// Deposit cap by finalized Zhi Score (asset units, 6 dp USDC): launch limits.
    function depositCap() public view returns (uint256) {
        if (address(attestor) == address(0)) return 10_000e6;
        (uint16 score,,) = attestor.scoreOf(guardrail.agentId());
        if (score >= 780) return 1_000_000e6;
        if (score >= 700) return 250_000e6;
        if (score >= 600) return 50_000e6;
        return 10_000e6;
    }

    function totalAssets() public view override returns (uint256) {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 held = guardrail.sharesToAssets(guardrail.shares(address(this)));
        return idle + held;
    }

    function maxDeposit(address) public view override returns (uint256) {
        if (guardrail.frozen() || guardrail.creditReduceOnly()) return 0;
        uint256 cap = depositCap();
        uint256 ta = totalAssets();
        return ta >= cap ? 0 : cap - ta;
    }

    function maxMint(address r) public view override returns (uint256) {
        return convertToShares(maxDeposit(r));
    }

    /// Withdrawals pull from the Guardrail Vault, which only releases capital when flat and debt-free.
    function maxWithdraw(address owner_) public view override returns (uint256) {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 own = convertToAssets(balanceOf(owner_));
        if (guardrail.debt() != 0 || !guardrail.isFlat()) return Math.min(own, idle);
        return own;
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        return Math.min(balanceOf(owner_), convertToShares(maxWithdraw(owner_)));
    }

    /// @notice Settle the performance fee once per epoch against the high-water mark.
    function settleEpoch() public returns (uint256 operatorShares, uint256 protocolShares) {
        require(block.timestamp >= uint256(lastSettle) + EPOCH, "epoch");
        lastSettle = uint64(block.timestamp);
        uint256 supply = totalSupply();
        uint256 pps = _pps();
        if (supply == 0 || pps <= highWaterMark) {
            if (supply == 0) highWaterMark = pps;
            emit EpochSettled(pps, highWaterMark, 0, 0);
            return (0, 0);
        }
        uint256 ta = totalAssets();
        uint256 profit = (pps - highWaterMark) * supply / 1e18; // assets
        uint256 fee = profit * PERF_FEE_BPS / 1e4;
        // mint shares worth `fee` at post-mint price: s = fee * supply / (ta - fee)
        uint256 feeShares = fee * supply / (ta - fee);
        operatorShares = feeShares * OPERATOR_FEE_BPS / PERF_FEE_BPS;
        protocolShares = feeShares - operatorShares;
        if (operatorShares > 0) _mint(operator(), operatorShares);
        if (protocolShares > 0) _mint(treasury, protocolShares);
        highWaterMark = _pps();
        emit EpochSettled(pps, highWaterMark, operatorShares, protocolShares);
    }

    function pricePerShare() external view returns (uint256) {
        return _pps();
    }

    function _pps() internal view returns (uint256) {
        return convertToAssets(1e18);
    }

    /// Virtual-share offset blunts the ERC-4626 donation/inflation attack.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares_) internal override {
        super._deposit(caller, receiver, assets, shares_);
        IERC20(asset()).forceApprove(address(guardrail), assets);
        guardrail.deposit(assets, address(this));
    }

    function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares_)
        internal
        override
    {
        IERC20 a = IERC20(asset());
        uint256 idle = a.balanceOf(address(this));
        if (idle < assets) {
            uint256 need = assets - idle;
            uint256 held = guardrail.shares(address(this));
            uint256 heldAssets = guardrail.sharesToAssets(held);
            uint256 gShares = heldAssets == 0 ? held : Math.min(held, need.mulDiv(held, heldAssets, Math.Rounding.Ceil) + 1);
            guardrail.withdraw(gShares, address(this));
        }
        super._withdraw(caller, receiver, owner_, assets, shares_);
    }
}
