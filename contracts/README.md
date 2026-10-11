# Tower Finance Contracts (`@tower-finance/contracts`)

> **Smart Contract Architecture for Swaps, Aggregation, and Automation on the Arc Blockchain**

This workspace contains the core smart contract layer powering **Tower Exchange** on the Arc Network (Mainnet Chain ID: `5042` / Arc Testnet):

1. **`TowerSwapExecutor.sol`**: A stateless, non-custodial execution coordinator that atomically collects platform fees directly to treasury and routes output directly to recipients in a single transaction.
2. **Protocol Adapters (`contracts/adapters/`)**: Standardized execution wrappers connecting liquidity venues to Tower's execution coordinator.
3. **`RecurringOrderExecutor.sol`**: An on-chain Dollar-Cost Averaging (DCA) engine that enforces non-custodial, parameterized recurring trade limits on Arc.
4. **`TowerRouter.sol`**: Multi-pair routing and liquidity periphery.

---

## Verified Deployments on Arc Mainnet (Chain ID: `5042`)

| Contract | Mainnet Address | Arcscan Explorer |
| :--- | :--- | :--- |
| **TowerSwapExecutor** | `0xeB8940752Fa12944d3b2D736d51fA36E4dA32BC8` | [View Contract](https://explorer.arc.io/address/0xeB8940752Fa12944d3b2D736d51fA36E4dA32BC8) |
| **Treasury Wallet** | `0xb3966683724303400B6fECDa1963825d994B546a` | [View Account](https://explorer.arc.io/address/0xb3966683724303400B6fECDa1963825d994B546a) |

*(For native AMM Factory & Router contracts, see [`Tower-AMM/`](../Tower-AMM/)).*

---

## System Architecture & Technical Specifications

### 1. `TowerSwapExecutor.sol` (Stateless Execution Coordinator)

`TowerSwapExecutor` is the central smart contract coordinating swaps across multiple decentralized exchanges on Arc. It is designed around three architectural principles:

- **Stateless & Zero Custody**: The contract does not store or escrow user funds. Swap inputs are pulled, platform fees are routed directly to the treasury, and output tokens are immediately delivered to the recipient in the same atomic transaction.
- **Strict Allowlisting**: Swap calldata can only be dispatched to owner-authorized route targets and approval spenders. This prevents unauthorized arbitrary execution.
- **Slippage & Refund Enforcements**: The executor enforces that received output matches or exceeds `minAmountOut`, and automatically refunds any unconsumed input tokens back to the user.

### 2. Protocol Adapters (`contracts/adapters/`)

Protocol adapters act as standardized execution wrappers between `TowerSwapExecutor` and diverse AMM architectures on Arc:
- Normalize interactions across varying router, pool, and aggregator interfaces into a uniform execution flow.
- Ensure strict recipient delivery and balance safety checks before returning control to the primary executor.
- Are deployed modularly and allowlisted by the executor as authorized route targets and spenders.

### 3. `RecurringOrderExecutor.sol` (Automated DCA)

An on-chain order execution engine enabling automated Dollar-Cost Averaging schedules on Arc:
- Users authorize execution parameters on-chain (`tokenIn`, `tokenOut`, `maxAmountIn`, `minInterval`, `validUntil`).
- Off-chain relayers trigger executions when intervals elapse, provided the execution satisfies the user's on-chain slippage and parameter boundaries.
- Relayers have no custody or withdrawal privileges beyond executing valid parameter-bounded swaps.

---

## Development & Deployment Workflow

### 1. Installation & Compilation

```bash
cd contracts
npm install
npm run compile
```

### 2. Running Tests

```bash
npm run test
```

### 3. Deploying to Arc Mainnet (`5042`)

Configure your environment variables in `.env` (or pass via command-line):

- `ARC_MAINNET_RPC_URL=https://rpc.mainnet.arc.io`
- `PRIVATE_KEY=your_deployer_key`

Run deployment scripts:

```bash
# Deploy TowerSwapExecutor
npm run deploy:tower-swap-executor:mainnet

# Deploy protocol adapters
npm run deploy:<adapter-script>:mainnet
```

### 4. Contract Verification on Arcscan

```bash
npm run verify:arc-mainnet
```

---

## Contract Directory Layout

```text
contracts/
├── contracts/
│   ├── adapters/                     # Protocol execution wrappers
│   ├── interfaces/                   # DEX and router interface specifications
│   ├── RecurringOrderExecutor.sol    # Dollar-cost averaging scheduled automation
│   ├── TowerRouter.sol               # Multi-pool routing contract
│   └── TowerSwapExecutor.sol         # Core stateless atomic fee router
├── deployments/                      # Recorded deployment addresses and metadata
├── scripts/                          # Hardhat deploy, configure, and verify scripts
└── test/                             # Hardhat test suites
```
