// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./HardenedAggregatorAdapterV2.sol";

/**
 * @title DZapAdapterV2
 * @notice Hardened V2 adapter for DZap's Arc router.
 * @dev The executor must allowlist this adapter as both a route target and an
 * approval spender. Permit2 may be used only as a temporary approval layer;
 * it can never be the route target.
 */
contract DZapAdapterV2 is HardenedAggregatorAdapterV2 {
    constructor(address dzapRouter, address permit2, address initialOwner)
        HardenedAggregatorAdapterV2(dzapRouter, address(0), permit2, initialOwner)
    {}
}
