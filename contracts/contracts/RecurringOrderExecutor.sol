// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title RecurringOrderExecutor
 * @notice INACTIVE: recurring orders are disabled in the application and
 * should not be deployed or configured pending a replacement audit.
 * @dev Pulls pre-approved ERC20 tokens from users and executes bounded recurring
 * swaps through owner-approved route targets selected off-chain. Scheduling and
 * route optimization remain off-chain; this contract enforces the user's
 * on-chain authorization limits.
 */
// contract RecurringOrderExecutor is Ownable, Pausable, ReentrancyGuard {
//     using SafeERC20 for IERC20;

//     uint256 public constant MIN_INTERVAL = 15 minutes;

//     mapping(address => bool) public relayers;
//     mapping(address => bool) public routeTargets;
//     mapping(address => bool) public approvalSpenders;
//     mapping(bytes32 => OrderAuthorization) public orderAuthorizations;

//     struct OrderAuthorization {
//         address user;
//         address tokenIn;
//         address tokenOut;
//         uint256 maxAmountIn;
//         uint256 minInterval;
//         uint256 validAfter;
//         uint256 validUntil;
//         uint256 lastExecutedAt;
//         bool active;
//     }

//     event RelayerUpdated(address indexed relayer, bool isAllowed);
//     event RouteTargetUpdated(address indexed target, bool isAllowed);
//     event ApprovalSpenderUpdated(address indexed spender, bool isAllowed);
//     event OrderAuthorized(
//         bytes32 indexed orderId,
//         address indexed user,
//         address indexed tokenIn,
//         address tokenOut,
//         uint256 maxAmountIn,
//         uint256 minInterval,
//         uint256 validAfter,
//         uint256 validUntil
//     );
//     event OrderCancelled(bytes32 indexed orderId, address indexed user);
//     event OrderExecuted(
//         bytes32 indexed orderId,
//         address indexed user,
//         address indexed relayer,
//         address tokenIn,
//         address tokenOut,
//         uint256 amountIn,
//         uint256 amountOut
//     );

//     modifier onlyRelayer() {
//         require(relayers[msg.sender], "Caller is not a relayer");
//         _; 
//     }

//     constructor(address _owner) {
//         require(_owner != address(0), "Invalid owner");
//         transferOwnership(_owner);
//     }

//     function setRelayer(address relayer, bool isAllowed) external onlyOwner {
//         require(relayer != address(0), "Invalid relayer");
//         relayers[relayer] = isAllowed;
//         emit RelayerUpdated(relayer, isAllowed);
//     }

//     function setRouteTarget(address target, bool isAllowed) external onlyOwner {
//         require(target != address(0), "Invalid target");
//         routeTargets[target] = isAllowed;
//         emit RouteTargetUpdated(target, isAllowed);
//     }

//     function setApprovalSpender(address spender, bool isAllowed) external onlyOwner {
//         require(spender != address(0), "Invalid spender");
//         approvalSpenders[spender] = isAllowed;
//         emit ApprovalSpenderUpdated(spender, isAllowed);
//     }

//     function authorizeOrder(
//         bytes32 orderId,
//         address tokenIn,
//         address tokenOut,
//         uint256 maxAmountIn,
//         uint256 minInterval,
//         uint256 validAfter,
//         uint256 validUntil
//     ) external whenNotPaused {
//         require(orderId != bytes32(0), "Invalid orderId");
//         require(tokenIn != address(0), "Invalid tokenIn");
//         require(tokenOut != address(0), "Invalid tokenOut");
//         require(tokenIn != tokenOut, "Same token pair");
//         require(maxAmountIn > 0, "Invalid max amount");
//         require(minInterval >= MIN_INTERVAL, "Interval too short");
//         require(validUntil == 0 || validUntil > validAfter, "Invalid validity");

//         orderAuthorizations[orderId] = OrderAuthorization({
//             user: msg.sender,
//             tokenIn: tokenIn,
//             tokenOut: tokenOut,
//             maxAmountIn: maxAmountIn,
//             minInterval: minInterval,
//             validAfter: validAfter,
//             validUntil: validUntil,
//             lastExecutedAt: 0,
//             active: true
//         });

//         emit OrderAuthorized(
//             orderId,
//             msg.sender,
//             tokenIn,
//             tokenOut,
//             maxAmountIn,
//             minInterval,
//             validAfter,
//             validUntil
//         );
//     }

//     function cancelOrder(bytes32 orderId) external {
//         OrderAuthorization storage authorization = orderAuthorizations[orderId];
//         require(authorization.user == msg.sender, "Not order owner");
//         require(authorization.active, "Order inactive");

//         authorization.active = false;
//         emit OrderCancelled(orderId, msg.sender);
//     }

//     function executeOrder(
//         bytes32 orderId,
//         uint256 amountIn,
//         uint256 minAmountOut,
//         address routeTarget,
//         address approvalSpender,
//         bytes calldata routeCalldata
//     ) external onlyRelayer whenNotPaused nonReentrant returns (uint256 amountOut) {
//         OrderAuthorization storage authorization = orderAuthorizations[orderId];

//         require(authorization.active, "Order inactive");
//         require(amountIn > 0, "Invalid amount");
//         require(minAmountOut > 0, "Invalid min output");
//         require(routeTargets[routeTarget], "Route target not allowed");
//         require(approvalSpenders[approvalSpender], "Approval spender not allowed");
//         require(routeCalldata.length > 0, "Invalid route calldata");
//         require(amountIn <= authorization.maxAmountIn, "Amount exceeds authorization");
//         require(block.timestamp >= authorization.validAfter, "Order not valid yet");
//         require(
//             authorization.validUntil == 0 || block.timestamp <= authorization.validUntil,
//             "Order expired"
//         );
//         require(
//             authorization.lastExecutedAt == 0 ||
//                 block.timestamp >= authorization.lastExecutedAt + authorization.minInterval,
//             "Execution too soon"
//         );

//         authorization.lastExecutedAt = block.timestamp;

//         uint256 userOutputBefore = IERC20(authorization.tokenOut).balanceOf(authorization.user);
//         uint256 executorOutputBefore = IERC20(authorization.tokenOut).balanceOf(address(this));

//         IERC20(authorization.tokenIn).safeTransferFrom(
//             authorization.user,
//             address(this),
//             amountIn
//         );
//         IERC20(authorization.tokenIn).safeApprove(approvalSpender, 0);
//         IERC20(authorization.tokenIn).safeApprove(approvalSpender, amountIn);

//         (bool success, bytes memory result) = routeTarget.call(routeCalldata);
//         require(success, _getRevertMsg(result));

//         IERC20(authorization.tokenIn).safeApprove(approvalSpender, 0);

//         uint256 executorOutputAfter = IERC20(authorization.tokenOut).balanceOf(address(this));
//         if (executorOutputAfter > executorOutputBefore) {
//             IERC20(authorization.tokenOut).safeTransfer(
//                 authorization.user,
//                 executorOutputAfter - executorOutputBefore
//             );
//         }

//         uint256 userOutputAfter = IERC20(authorization.tokenOut).balanceOf(authorization.user);
//         amountOut = userOutputAfter - userOutputBefore;
//         require(amountOut >= minAmountOut, "Insufficient output amount");

//         emit OrderExecuted(
//             orderId,
//             authorization.user,
//             msg.sender,
//             authorization.tokenIn,
//             authorization.tokenOut,
//             amountIn,
//             amountOut
//         );
//     }

//     function _getRevertMsg(bytes memory returnData) private pure returns (string memory) {
//         if (returnData.length < 68) {
//             return "Route execution failed";
//         }

//         assembly {
//             returnData := add(returnData, 0x04)
//         }

//         return abi.decode(returnData, (string));
//     }

//     function pause() external onlyOwner {
//         _pause();
//     }

//     function unpause() external onlyOwner {
//         _unpause();
//     }

//     function recoverToken(address token, address recipient, uint256 amount) external onlyOwner {
//         require(recipient != address(0), "Invalid recipient");
//         IERC20(token).safeTransfer(recipient, amount);
//     }
// }
