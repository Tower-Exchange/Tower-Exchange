// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IPermit2AllowanceTransferV2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/**
 * @notice Shared base implementation for named V2 aggregator adapters.
 * @dev DZapAdapterV2, KyberSwapAdapterV2, and UniswapAdapterV2 inherit this
 * implementation. It is deliberately abstract so no generic, ambiguously
 * configured adapter is deployed in production.
 * @dev Permit2 is used only as an approval layer. It is never a callable
 * route target, preventing arbitrary Permit2 approvals from being planted.
 */
abstract contract HardenedAggregatorAdapterV2 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint160 private constant PERMIT2_MAX_AMOUNT = type(uint160).max;
    uint48 private constant PERMIT2_MAX_EXPIRATION = type(uint48).max;

    address public immutable primaryRouteTarget;
    address public immutable secondaryRouteTarget;
    address public immutable permit2;

    receive() external payable {}

    constructor(address _primaryRouteTarget, address _secondaryRouteTarget, address _permit2, address initialOwner) {
        require(_primaryRouteTarget != address(0) && _primaryRouteTarget.code.length > 0, "Invalid route target");
        require(initialOwner != address(0), "Invalid owner");
        if (_secondaryRouteTarget != address(0)) {
            require(_secondaryRouteTarget.code.length > 0, "Invalid secondary target");
        }
        if (_permit2 != address(0)) require(_permit2.code.length > 0, "Permit2 is not a contract");

        primaryRouteTarget = _primaryRouteTarget;
        secondaryRouteTarget = _secondaryRouteTarget;
        permit2 = _permit2;
        _transferOwnership(initialOwner);
    }

    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        address routeTarget,
        bytes calldata routeCalldata
    ) external nonReentrant returns (uint256 amountOut) {
        require(tokenIn != address(0) && tokenOut != address(0), "Invalid token");
        require(tokenIn != tokenOut, "Same token pair");
        require(amountIn > 0, "Invalid amountIn");
        require(recipient != address(0), "Invalid recipient");
        require(routeCalldata.length > 0, "Invalid route calldata");
        require(_isAllowedRouteTarget(routeTarget), "Invalid route target");

        uint256 inputBalanceBefore = IERC20(tokenIn).balanceOf(address(this));
        uint256 recipientOutBefore = IERC20(tokenOut).balanceOf(recipient);
        uint256 adapterOutBefore = IERC20(tokenOut).balanceOf(address(this));

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        _approveSpenders(tokenIn, amountIn);
        (bool success, bytes memory returnData) = routeTarget.call(routeCalldata);
        _clearSpenders(tokenIn);
        require(success, _getRevertMsg(returnData));

        uint256 adapterOutAfter = IERC20(tokenOut).balanceOf(address(this));
        if (recipient != address(this) && adapterOutAfter > adapterOutBefore) {
            IERC20(tokenOut).safeTransfer(recipient, adapterOutAfter - adapterOutBefore);
        }

        uint256 inputBalanceAfter = IERC20(tokenIn).balanceOf(address(this));
        if (inputBalanceAfter > inputBalanceBefore) {
            IERC20(tokenIn).safeTransfer(msg.sender, inputBalanceAfter - inputBalanceBefore);
        }

        amountOut = IERC20(tokenOut).balanceOf(recipient) - recipientOutBefore;
        require(amountOut >= minAmountOut, "Insufficient output amount");
    }

    function recoverToken(address token, address recipient, uint256 amount) external onlyOwner {
        require(recipient != address(0), "Invalid recipient");
        IERC20(token).safeTransfer(recipient, amount);
    }

    function recoverNative(address payable recipient, uint256 amount) external onlyOwner {
        require(recipient != address(0), "Invalid recipient");
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "Native recovery failed");
    }

    function renounceOwnership() public view override onlyOwner {
        revert("Renounce ownership disabled");
    }

    function _isAllowedRouteTarget(address routeTarget) private view returns (bool) {
        return
            routeTarget == primaryRouteTarget ||
            (secondaryRouteTarget != address(0) && routeTarget == secondaryRouteTarget);
    }

    function _approveSpenders(address token, uint256 amount) private {
        IERC20(token).forceApprove(primaryRouteTarget, amount);
        if (permit2 == address(0) || amount > PERMIT2_MAX_AMOUNT) return;

        IERC20(token).forceApprove(permit2, amount);
        IPermit2AllowanceTransferV2(permit2).approve(
            token,
            primaryRouteTarget,
            uint160(amount),
            PERMIT2_MAX_EXPIRATION
        );
    }

    function _clearSpenders(address token) private {
        IERC20(token).forceApprove(primaryRouteTarget, 0);
        if (permit2 == address(0)) return;

        IERC20(token).forceApprove(permit2, 0);
        IPermit2AllowanceTransferV2(permit2).approve(token, primaryRouteTarget, 0, 0);
    }

    function _getRevertMsg(bytes memory returnData) private pure returns (string memory) {
        if (returnData.length < 4) return "Route execution failed";
        bytes4 selector;
        assembly { selector := mload(add(returnData, 0x20)) }
        if (selector == 0x08c379a0 && returnData.length >= 68) {
            assembly { returnData := add(returnData, 0x04) }
            return abi.decode(returnData, (string));
        }
        if (selector == 0x4e487b71) return "Route execution panicked";
        return "Route execution failed";
    }
}
