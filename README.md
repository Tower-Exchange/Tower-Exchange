# Tower Exchange (Tower Finance)

> **The Native Stablecoin DEX Aggregator & Cross-Chain Hub on Arc Network**

[![Next.js](https://img.shields.io/badge/Next.js-16.1.1-black?style=flat&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2.3-blue?style=flat&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8?style=flat&logo=tailwind-css)](https://tailwindcss.com/)
[![Network](https://img.shields.io/badge/Network-Arc_Mainnet_%26_Testnet-0052FF?style=flat)](https://arc.network)
[![License](https://img.shields.io/badge/License-Proprietary-gray?style=flat)]()

**Tower Exchange** is a non-custodial decentralized exchange (DEX) aggregator and liquidity protocol operating natively on the **Arc blockchain** (Chain ID: `5042` on mainnet). Tower unifies fragmented liquidity across Arc-native DEXs and routing engines to deliver deep liquidity, optimal execution prices, minimal slippage, and low transaction costs for stablecoins (USDC, EURC, USDT, cNGN, QCAD) and digital assets (cirBTC).

The platform also integrates cross-chain bridging via Circle CCTP, an intelligent AI trading agent (Atlas), native AMM liquidity pools, automated recurring orders (DCA), and a public developer API tailored for self-custody wallets and institutional integrations.

---

## Key Features

- **Multi-Route DEX Aggregation**  
  Aggregates and compares real-time liquidity across top DEXs and routing engines on Arc:
  - **Uniswap V4** (via Universal Router & `UniswapV4Adapter`)
  - **KyberSwap** (MetaAggregationRouterV2 via `KyberSwapAdapter`)
  - **DZap Aggregator** (via `DZapAdapter`)
  - **LI.FI / XyloNet** (Diamond routing via `LiFiAdapter`)
  - **Aero Slipstream** (via `AeroAdapter`)
  - **De1 Exchange** (V4 routing via `De1Adapter`)
  - **UnitFlow** (via `UnitFlowAdapter`)
  - **Synthra DEX**
  - **Tower AMM** (Native Uniswap V2-style liquidity pools)

- **Cross-Chain Stablecoin Bridge**  
  Zero-slippage cross-chain USDC transfers powered by **Circle Cross-Chain Transfer Protocol (CCTP)** via Arc AppKit and Circle Bridge Kit, connecting Arc with EVM chains and Solana.

- **Atlas AI Trading Agent**  
  An interactive conversational DeFi assistant built directly into the exchange interface. Atlas provides market insights, swap preparation, portfolio analytics, and automated DeFi actions, secured by Arc USDC micro-authentication.

- **Tower AMM V1 (Native Liquidity Pools)**  
  A Uniswap V2-style native AMM protocol on Arc featuring custom asset allowlists, pair control, LP token staking, and fee collection for core pairs (`USDC`, `EURC`, `USDT`, `cirBTC`, `cNGN`, `QCAD`).

- **Automated Recurring Orders (Dollar-Cost Averaging)**  
  On-chain recurring swap executor (`RecurringOrderExecutor.sol`) allowing users to automate recurring buy and sell schedules without giving up asset custody.

- **Developer & Self-Custody Wallet APIs**  
  High-throughput, clean REST API endpoints (`/api/public/swap/quote`, `/api/public/swap/build-tx`, `/api/public/tokens`) designed for wallets, institutional frontends, and bot integrators, complete with OpenAPI 1.1 specifications.

- **Multi-Wallet & Multi-Ecosystem Connectivity**  
  Unified wallet connection supporting Ethereum/EVM providers (RainbowKit, Wagmi, Dynamic Labs) and Solana wallets (`@solana/wallet-adapter`).

---

## Tech Stack & Architecture

### Frontend & Core
- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, Server & Client Components)
- **UI Library**: [React 19](https://react.dev/)
- **Language**: [TypeScript 5](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) with PostCSS
- **Animations & Icons**: [Framer Motion](https://www.framer.com/motion/), [Lucide React](https://lucide.dev/), [React Icons](https://react-icons.github.io/react-icons/)
- **Charts**: [Recharts](https://recharts.org/)

### Web3 & Blockchain
- **EVM Libraries**: [Viem 2](https://viem.sh/), [Wagmi 2](https://wagmi.sh/)
- **Wallet Kits**: [RainbowKit](https://www.rainbowkit.com/), [Dynamic Labs SDK](https://www.dynamic.xyz/)
- **Cross-Chain / Solana**: [@solana/web3.js](https://solana.com/), [@solana/kit](https://github.com/solana-labs/solana-web3.js), [@circle-fin/bridge-kit](https://www.circle.com/)
- **Smart Contracts**: [Solidity 0.8.x](https://soliditylang.org/), [Hardhat](https://hardhat.org/)

### Backend, Database & Infrastructure
- **Server Runtime**: Next.js Serverless Edge & Node.js API Routes
- **Database / Auth**: [Supabase](https://supabase.com/) (PostgreSQL & Edge Functions)
- **Partner Verifications**: Legion / Republic quest verification engine

---

## Repository Structure

```text
Tower-Frontend/
├── app/                      # Next.js App Router (pages and API routes)
│   ├── ai-agent/             # Tower AI (Atlas) chat and trading assistant
│   ├── api/                  # Backend endpoints
│   │   ├── ai/               # Atlas AI backend proxy & session authentication
│   │   ├── bridge/           # CCTP bridge quotes and status tracking
│   │   ├── public/           # Public swap API for external wallets & devs
│   │   ├── rpc/              # Arc RPC proxies and transaction broadcasting
│   │   └── swap/             # DEX quote aggregation & execution routes
│   ├── bridge/               # Circle CCTP Cross-chain bridge interface
│   ├── developers/           # Developer hub and API documentation
│   ├── faucet/               # Testnet asset faucet interface
│   ├── pool/                 # Liquidity pool management (Tower AMM)
│   ├── profile/              # User wallet profile & transaction history
│   └── recurring-orders/     # Dollar-Cost Averaging order automation
├── components/               # Reusable React components & providers
│   ├── providers/            # RainbowKit, Solana, and Theme providers
│   ├── AIChat.tsx            # Atlas conversational UI
│   ├── BridgeCardContent.tsx # Cross-chain transfer module
│   ├── Header.tsx            # Navigation, network switcher, wallet avatar
│   └── SwapCard.tsx          # Main DEX aggregation swap interface
├── contracts/                # Hardhat workspace: Router, Executor & Adapters
│   ├── contracts/
│   │   ├── adapters/         # Protocol adapters (Aero, DZap, De1, Kyber, LiFi, Uniswap V4, etc.)
│   │   ├── RecurringOrderExecutor.sol
│   │   ├── TowerRouter.sol
│   │   └── TowerSwapExecutor.sol
│   └── scripts/              # Contract deployment & verification scripts
├── Tower-AMM/                # Hardhat workspace: Native Uniswap V2-style AMM
│   ├── contracts/            # Factory, Pair, LP Token, Math libraries
│   └── scripts/              # AMM deployment and pool seeding scripts
├── docs/                     # Architecture, OpenAPI, and integration specs
├── lib/                      # Business logic, DEX clients, math, & utilities
│   ├── dexAggregatorSDK.ts   # Core routing and quote comparison engine
│   ├── *Dex.ts               # Individual DEX quote & transaction builders
│   ├── bridgeService.ts      # Circle CCTP bridging handler
│   └── wagmi-config.ts       # EVM chain definitions and wallet connectors
└── scripts/                  # Operations, fee distribution, invite scripts
```

---

## Getting Started

### Prerequisites

- **Node.js**: `v24.x` (Recommended: `24.13.0` as specified in `package.json`)
- **Package Manager**: `npm 11+`

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Tower-Exchange/Tower-Frontend.git
   cd Tower-Frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.local.example .env.local
   ```
   Open `.env.local` and configure your credentials:
   - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
   - `ARC_MAINNET_RPC_URL` / `ARC_TESTNET_RPC_URL`
   - Deployed contract addresses (`NEXT_PUBLIC_TOWER_SWAP_EXECUTOR_ADDRESS`, `NEXT_PUBLIC_TOWER_DEX_ROUTER_ADDRESS`, etc.)
   - Optional API keys for aggregators (`DZAP_API_KEY`, `KYBERSWAP_API_KEY`, `LIFI_API_KEY`)
   - AI Agent configuration (`TOWER_AI_API`, `TOWER_AI_API_KEY`)

### Running the Development Server

Start the local Next.js development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Building for Production

Compile and optimize the application for production:

```bash
npm run build
npm run start
```

---

## Smart Contracts & Maintenance

The repository contains two Hardhat environments:

### 1. Tower Router & Aggregator Adapters (`contracts/`)
Manages `TowerSwapExecutor`, protocol adapters (Uniswap V4, KyberSwap, DZap, LiFi, De1, Aero, UnitFlow), and `RecurringOrderExecutor`:

```bash
# Compile contracts
npm run compile --prefix contracts

# Run test suite
npm run test --prefix contracts

# Deploy adapters / executor
npm run deploy:arc-mainnet --prefix contracts
```

### 2. Native Tower AMM (`Tower-AMM/`)
Manages the factory, pairs, and native liquidity pool contracts:

```bash
# Compile AMM contracts
npm run compile --prefix Tower-AMM

# Run AMM unit tests
npm run test --prefix Tower-AMM

# Seed pools and deploy
npm run deploy:arc-mainnet --prefix Tower-AMM
```

### 3. Utility Scripts
- **Verify contracts on Arcscan**:
  ```bash
  npm run verify:arc-mainnet
  ```
- **Generate private invite access codes**:
  ```bash
  npm run generate:invite-codes
  ```
- **Withdraw collected fees to treasury**:
  ```bash
  npm run withdraw:fees
  ```

---

## Official Links & Resources

- **Website**: [tower.exchange](https://tower.exchange)
- **Web Application**: [app.tower.exchange](https://app.tower.exchange)
- **Documentation**: [docs.tower.exchange](https://docs.tower.exchange)
- **Analytics**: [analytics.tower.exchange](https://analytics.tower.exchange)
- **X (Twitter)**: [@TowerExchange](https://x.com/TowerExchange)
- **Telegram**: [t.me/TowerExchangeCommunity](https://t.me/TowerExchangeCommunity)
- **Discord**: [Join Community](https://discord.gg/ftXUD6qa4J)

---

## License

Copyright © 2026 Towerdex Inc. All rights reserved.
