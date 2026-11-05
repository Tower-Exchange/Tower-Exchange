// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./HardenedAggregatorAdapterV2.sol";

/**
 * @title KyberSwapAdapterV2
 * @notice Hardened V2 adapter for KyberSwap's router and aggregation executor.
 */
contract KyberSwapAdapterV2 is HardenedAggregatorAdapterV2 {
    constructor(
        address kyberRouter,
        address aggregationExecutor,
        address permit2,
        address initialOwner
    )
        HardenedAggregatorAdapterV2(
            kyberRouter,
            aggregationExecutor,
            permit2,
            initialOwner
        )
    {}
}
