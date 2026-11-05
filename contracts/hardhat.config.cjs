require("@nomicfoundation/hardhat-toolbox");
require("dotenv/config");
const { HttpProvider } = require("hardhat/internal/core/providers/http");
require("./scripts/lib/patchArcscanRpc.cjs").patchArcscanRpcProvider(HttpProvider);

const config = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    // Arc Testnet
    "arc-testnet": {
      url: process.env.ARC_TESTNET_RPC_URL || 'https://rpc.testnet.arc.network',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 5042002,
      timeout: 60000,
    },
    // Arc Mainnet. Official public RPC: https://rpc.mainnet.arc.io
    // (https://docs.arc.io/arc/references/connect-to-arc#rpc-endpoints).
    // Prefer a keyed Alchemy/QuickNode/dRPC URL via ARC_MAINNET_RPC_URL.
    "arc-mainnet": {
      url: process.env.ARC_MAINNET_RPC_URL || "https://rpc.mainnet.arc.io",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 5042,
      timeout: 180000,
    },
    // Base Sepolia
    "base-sepolia": {
      url: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 84532,
      timeout: 60000,
    },
    // Optimism Sepolia
    "optimism-sepolia": {
      url: process.env.OPTIMISM_SEPOLIA_RPC_URL || 'https://sepolia.optimism.io',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 11155420,
      timeout: 60000,
    },
    // Avalanche Fuji
    "avalanche-fuji": {
      url: process.env.AVALANCHE_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 43113,
      timeout: 60000,
    },
    // Arbitrum Sepolia
    "arbitrum-sepolia": {
      url: process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 421614,
      timeout: 60000,
    },
    // Ethereum Sepolia
    "ethereum-sepolia": {
      url: process.env.ETHEREUM_SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 11155111,
      timeout: 60000,
    },
    // Linea Sepolia
    "linea-sepolia": {
      url: process.env.LINEA_SEPOLIA_RPC_URL || 'https://rpc.sepolia.linea.build',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 59141,
      timeout: 60000,
    },
    // Polygon Amoy
    "polygon-amoy": {
      url: process.env.POLYGON_AMOY_RPC_URL || 'https://rpc-amoy.polygon.technology',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 80002,
      timeout: 60000,
    },
    // Sonic Testnet
    "sonic-testnet": {
      url: process.env.SONIC_TESTNET_RPC_URL || 'https://rpc.testnet.sonic.fantom.network',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 14601,
      timeout: 60000,
    },
    // Unichain Sepolia
    "unichain-sepolia": {
      url: process.env.UNICHAIN_SEPOLIA_RPC_URL || 'https://sepolia.unichain.org',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 1301,
      timeout: 60000,
    },
    hardhat: {
      forking: {
        enabled: process.env.FORKING === "true",
        url: process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network",
      },
    },
  },
  etherscan: {
    // A single Etherscan key activates Hardhat Verify's Etherscan V2 API.
    // The plugin adds chainid=5042 for Arc mainnet automatically.
    apiKey: process.env.ETHERSCAN_API_KEY || "",
    customChains: [
      {
        network: "arc-testnet",
        chainId: 5042002,
        urls: {
          apiURL: "https://explorer.testnet.arc.io/api",
          browserURL: "https://explorer.testnet.arc.io"
        }
      },
      {
        network: "arc-mainnet",
        chainId: 5042,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://arc.etherscan.io"
        }
      },
      {
        network: "base-sepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org"
        }
      },
      {
        network: "optimism-sepolia",
        chainId: 11155420,
        urls: {
          apiURL: "https://api-sepolia-optimistic.etherscan.io/api",
          browserURL: "https://sepolia-optimism.etherscan.io"
        }
      },
      {
        network: "avalanche-fuji",
        chainId: 43113,
        urls: {
          apiURL: "https://api-testnet.snowtrace.io/api",
          browserURL: "https://testnet.snowtrace.io"
        }
      },
      {
        network: "arbitrum-sepolia",
        chainId: 421614,
        urls: {
          apiURL: "https://api-sepolia.arbiscan.io/api",
          browserURL: "https://sepolia.arbiscan.io"
        }
      },
      {
        network: "linea-sepolia",
        chainId: 59141,
        urls: {
          apiURL: "https://api-sepolia.lineascan.build/api",
          browserURL: "https://sepolia.lineascan.build"
        }
      },
      {
        network: "polygon-amoy",
        chainId: 80002,
        urls: {
          apiURL: "https://www.oklink.com/api/v5/explorer/contract/verify-source-code",
          browserURL: "https://www.oklink.com/amoy"
        }
      },
      {
        network: "sonic-testnet",
        chainId: 14601,
        urls: {
          apiURL: "https://api.testnet.sonic.fantom.network/api",
          browserURL: "https://testnet.sonicscan.app"
        }
      },
      {
        network: "unichain-sepolia",
        chainId: 1301,
        urls: {
          apiURL: "https://api-sepolia.unichain.org/api",
          browserURL: "https://sepolia.uniscan.xyz"
        }
      }
    ]
  },
  sourcify: {
    enabled: false,
  },
  mocha: {
    timeout: 120000,
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

module.exports = config;
