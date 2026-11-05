// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IAeroSwapRouterV2 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        int24 tickSpacing;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
    function factory() external view returns (address);
    function WETH9() external view returns (address);
}

/** @notice Aero adapter V2 with precise refund accounting for partial fills. */
contract AeroAdapterV2 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IAeroSwapRouterV2 public immutable swapRouter;
    address public immutable factoryAddress;
    address public immutable wrappedNativeToken;

    receive() external payable {}

    constructor(address _swapRouter, address initialOwner) {
        require(_swapRouter != address(0) && _swapRouter.code.length > 0, "Invalid Aero router");
        require(initialOwner != address(0), "Invalid owner");
        swapRouter = IAeroSwapRouterV2(_swapRouter);
        factoryAddress = swapRouter.factory();
        wrappedNativeToken = swapRouter.WETH9();
        _transferOwnership(initialOwner);
    }

    function swapExactInputSingle(
        address tokenIn, address tokenOut, int24 tickSpacing, uint256 amountIn,
        uint256 minAmountOut, address recipient, uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        require(tokenIn != address(0) && tokenOut != address(0), "Invalid token");
        require(tokenIn != tokenOut, "Same token pair");
        require(amountIn > 0 && recipient != address(0) && tickSpacing > 0, "Invalid parameters");
        uint256 inputBalanceBefore = IERC20(tokenIn).balanceOf(address(this));
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(swapRouter), amountIn);
        amountOut = swapRouter.exactInputSingle(IAeroSwapRouterV2.ExactInputSingleParams({
            tokenIn: tokenIn, tokenOut: tokenOut, tickSpacing: tickSpacing, recipient: recipient,
            deadline: deadline, amountIn: amountIn, amountOutMinimum: minAmountOut, sqrtPriceLimitX96: 0
        }));
        IERC20(tokenIn).forceApprove(address(swapRouter), 0);
        _refundInputDelta(tokenIn, inputBalanceBefore, msg.sender);
        require(amountOut >= minAmountOut, "Insufficient output amount");
    }

    function swapExactInput(
        address tokenIn, bytes calldata path, uint256 amountIn, uint256 minAmountOut,
        address recipient, uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        require(tokenIn != address(0) && amountIn > 0 && recipient != address(0), "Invalid parameters");
        require(path.length >= 43 && _pathTokenIn(path) == tokenIn, "Invalid path");
        uint256 inputBalanceBefore = IERC20(tokenIn).balanceOf(address(this));
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(swapRouter), amountIn);
        amountOut = swapRouter.exactInput(IAeroSwapRouterV2.ExactInputParams({
            path: path, recipient: recipient, deadline: deadline, amountIn: amountIn, amountOutMinimum: minAmountOut
        }));
        IERC20(tokenIn).forceApprove(address(swapRouter), 0);
        _refundInputDelta(tokenIn, inputBalanceBefore, msg.sender);
        require(amountOut >= minAmountOut, "Insufficient output amount");
    }

    function factory() external view returns (address) { return factoryAddress; }
    function WETH() external view returns (address) { return wrappedNativeToken; }
    function recoverToken(address token, address recipient, uint256 amount) external onlyOwner {
        require(recipient != address(0), "Invalid recipient");
        IERC20(token).safeTransfer(recipient, amount);
    }
    function recoverNative(address payable recipient, uint256 amount) external onlyOwner {
        require(recipient != address(0), "Invalid recipient");
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "Native recovery failed");
    }
    function renounceOwnership() public view override onlyOwner { revert("Renounce ownership disabled"); }

    function _refundInputDelta(address token, uint256 beforeBalance, address recipient) private {
        uint256 afterBalance = IERC20(token).balanceOf(address(this));
        if (afterBalance > beforeBalance) IERC20(token).safeTransfer(recipient, afterBalance - beforeBalance);
    }
    function _pathTokenIn(bytes calldata path) private pure returns (address tokenIn) {
        assembly { tokenIn := shr(96, calldataload(path.offset)) }
    }
}
