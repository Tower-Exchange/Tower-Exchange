# Tower Exchange contracts

This Hardhat workspace contains the swap executor and protocol adapters used by Tower Exchange on Arc.

## Deployment status

- `TowerSwapExecutor.sol` is the legacy executor currently referenced by the product.
- `TowerSwapExecutorV2.sol` is a **separate deployment**, not a proxy upgrade. It is inactive until `NEXT_PUBLIC_TOWER_SWAP_EXECUTOR_V2_ADDRESS` is configured after adapter deployment and testing.
- `RecurringOrderExecutor.sol` is retained only as inactive, historical source. Do not deploy, configure, or allowlist it pending a new audited recurring-order design.
- The standalone `Tower-AMM/` workspace was removed. Pool UI/support code remains outside this workspace by product decision.

## V2 controls

V2 enforces per-swap expiries, uses two-step ownership, and disallows ownership renunciation. Its V2 adapters restrict target calls and make delta-based refunds, so unrelated pre-existing balances cannot be swept by a partial fill.

Deploy with an EOA if required, then transfer later with `transferOwnership(multisig)` and complete it from the multisig with `acceptOwnership()`.

```bash
npm run compile
npm run test

# Deployment commands require the appropriate RPC and private-key environment.
npm run deploy:tower-swap-executor:v2:mainnet
npm run deploy:aero-adapter:v2:mainnet
npm run deploy:dzap-adapter:v2:mainnet
npm run deploy:kyberswap-adapter:v2:mainnet
npm run deploy:uniswap-adapter:v2:mainnet

# Set ETHERSCAN_API_KEY, then verify the V2 executor on ArcScan/Etherscan.
npm run verify:tower-swap-executor:v2:mainnet
```

Arc mainnet verification uses Etherscan V2 (`chainid=5042`) and opens contract
pages on `https://arc.etherscan.io`. The legacy command
`verify:tower-swap-executor:mainnet` is for `TowerSwapExecutor.sol` only; it
rejects a V2 deployment address to prevent a source/constructor mismatch.

For the complete migration order and audit scope, see [`../docs/audit-remediation-2026-11.md`](../docs/audit-remediation-2026-11.md).

No script in this workspace is run automatically by the application. Contract deployment, allowlisting, pausing, and ownership transfer always require an authorized wallet transaction.
