# Tower Exchange

Tower Exchange is a self-custody DEX aggregator and cross-chain stablecoin interface for Arc. It provides swap routing through third-party venues, Circle CCTP bridging, Circle StableFX flows, portfolio information, and partner-facing APIs.

## Active scope

- Swap venues: Aero, DZap, KyberSwap, Uniswap, UnitFlow, and Synthra.
- Cross-chain bridging: Circle CCTP through Arc AppKit.
- StableFX: Circle StableFX order, webhook, settlement, and activity flows.
- The product does **not** operate Tower AMM pools.
- Recurring orders are intentionally unavailable pending a new audited design.

See [the November 2026 remediation note](docs/audit-remediation-2026-11.md) for the retired scope, V2 deployment sequence, and operational controls.

## Development

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

The app uses Node 24 and npm 11. Populate only the service and wallet credentials needed for your environment. Never commit `.env.local` or private keys.

## Contracts

`contracts/` is the Hardhat workspace for the active swap executor and aggregator adapters.

```bash
npm run compile --prefix contracts
npm run test --prefix contracts
```

`TowerSwapExecutorV2.sol` is a separate contract from the live V1 executor. Do not set `NEXT_PUBLIC_TOWER_SWAP_EXECUTOR_V2_ADDRESS` until its V2 adapters have been deployed, allowlisted, and smoke-tested. The deployer can initially be an EOA; V2 uses two-step ownership, so later handoff is `transferOwnership(multisig)` followed by `acceptOwnership()` from the multisig.

The repository never deploys contracts or changes on-chain configuration automatically.

## Useful commands

```bash
# StableFX Permit2 token approval helper
npm run approve:stablefx

# Verify the legacy executor on Arcscan
npm run verify:arc-mainnet

# Generate invite codes
npm run generate:invite-codes
```

## Security

Report security issues privately to the Tower team. Do not publish secrets, private keys, webhook signing keys, or exploit details in public issues.
