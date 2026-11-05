// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./HardenedAggregatorAdapterV2.sol";

/**
 * @title UniswapAdapterV2
 * @notice Hardened V2 adapter for the Uniswap Universal Router.
 */
contract UniswapAdapterV2 is HardenedAggregatorAdapterV2 {
    constructor(address universalRouter, address permit2, address initialOwner)
        HardenedAggregatorAdapterV2(universalRouter, address(0), permit2, initialOwner)
    {}
}
