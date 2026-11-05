export type BridgeNetworkMode = "testnet" | "mainnet";

export const BRIDGE_NETWORK_STORAGE_KEY = "tower-bridge-network";

export const DEFAULT_BRIDGE_CHAIN: Record<BridgeNetworkMode, string> = {
  testnet: "arc-testnet",
  mainnet: "arc",
};

export const TESTNET_BRIDGE_CHAIN_IDS = [
  "arc-testnet",
  "solana",
  "base-sepolia",
  "optimism-sepolia",
  "avalanche-fuji",
  "arbitrum-sepolia",
  "ethereum-sepolia",
  "linea-sepolia",
  "polygon-amoy",
  "sonic-testnet",
  "unichain-sepolia",
] as const;

export const MAINNET_BRIDGE_CHAIN_IDS = [
  "arc",
  "solana-mainnet",
  "base",
  "optimism",
  "avalanche",
  "arbitrum",
  "ethereum",
  "linea",
  "polygon",
  "sonic",
  "unichain",
] as const;

const TESTNET_CHAIN_SET = new Set<string>(TESTNET_BRIDGE_CHAIN_IDS);
const MAINNET_CHAIN_SET = new Set<string>(MAINNET_BRIDGE_CHAIN_IDS);

export const SOLANA_DEVNET_USDC_MINT =
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const SOLANA_MAINNET_USDC_MINT =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const ARC_NATIVE_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000";

export const BRIDGE_EURC_DECIMALS = 6;
export const CCTP_EXPANDED_EURC_TOKEN_ID =
  "0x6ca9e29fa53becc29becaf4a90b9ca7a995ad4d2234880da13ca38c657fb241c";

export const BRIDGE_USDC_ADDRESSES: Record<string, string> = {
  "arc-testnet": ARC_NATIVE_USDC_ADDRESS,
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "optimism-sepolia": "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
  "avalanche-fuji": "0x5425890298aed601595a70ab815c96711a31bc65",
  "arbitrum-sepolia": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  "ethereum-sepolia": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  "linea-sepolia": "0xfece4462d57bd51a6a552365a011b95f0e16d9b7",
  "polygon-amoy": "0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582",
  "sonic-testnet": "0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51",
  "unichain-sepolia": "0x31d0220469e10c4E71834a79b1f276d740d3768F",
  solana: SOLANA_DEVNET_USDC_MINT,
  arc: ARC_NATIVE_USDC_ADDRESS,
  ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  optimism: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  unichain: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
  polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  sonic: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  avalanche: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  linea: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff",
  "solana-mainnet": SOLANA_MAINNET_USDC_MINT,
};

// Circle CCTP expanded assets (non-USDC). Live Iris EURC deployments plus
// Circle kit locators for the matching testnets. EVM-only; Solana is excluded.
// https://developers.circle.com/cctp/expanded-assets/concepts/supported-chains-and-domains
export const BRIDGE_EURC_ADDRESSES: Record<string, string> = {
  "arc-testnet": "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  "ethereum-sepolia": "0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4",
  "base-sepolia": "0x808456652fdb597867f38412077A9182bf77359F",
  arc: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
  ethereum: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
  base: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
};

export const getBridgeTokenAddress = (
  chainId?: string | null,
  tokenSymbol?: string | null,
) => {
  if (!chainId) {
    return null;
  }

  const symbol = tokenSymbol?.toUpperCase() || "USDC";
  if (symbol === "EURC") {
    return BRIDGE_EURC_ADDRESSES[chainId] ?? null;
  }

  return BRIDGE_USDC_ADDRESSES[chainId] ?? null;
};

export const isBridgeTokenSupportedOnChain = (
  chainId?: string | null,
  tokenSymbol?: string | null,
) => Boolean(getBridgeTokenAddress(chainId, tokenSymbol));

export const BRIDGE_EXPLORER_TX_URLS: Record<string, string> = {
  "arc-testnet": "https://testnet.arcscan.app/tx/",
  arc: "https://arc.etherscan.io/tx/",
  "base-sepolia": "https://sepolia.basescan.org/tx/",
  base: "https://basescan.org/tx/",
  "optimism-sepolia": "https://sepolia-optimism.etherscan.io/tx/",
  optimism: "https://optimistic.etherscan.io/tx/",
  "avalanche-fuji": "https://testnet.snowtrace.io/tx/",
  avalanche: "https://snowtrace.io/tx/",
  "arbitrum-sepolia": "https://sepolia.arbiscan.io/tx/",
  arbitrum: "https://arbiscan.io/tx/",
  "ethereum-sepolia": "https://sepolia.etherscan.io/tx/",
  ethereum: "https://etherscan.io/tx/",
  "linea-sepolia": "https://sepolia.lineascan.build/tx/",
  linea: "https://lineascan.build/tx/",
  "polygon-amoy": "https://amoy.polygonscan.com/tx/",
  polygon: "https://polygonscan.com/tx/",
  "sonic-testnet": "https://testnet.sonicscan.org/tx/",
  sonic: "https://sonicscan.org/tx/",
  "unichain-sepolia": "https://unichain-sepolia.blockscout.com/tx/",
  unichain: "https://uniscan.xyz/tx/",
  solana: "https://explorer.solana.com/tx/",
  "solana-mainnet": "https://explorer.solana.com/tx/",
};

const BRIDGE_CHAIN_COUNTERPARTS: Record<string, string> = {
  "arc-testnet": "arc",
  arc: "arc-testnet",
  solana: "solana-mainnet",
  "solana-mainnet": "solana",
  "base-sepolia": "base",
  base: "base-sepolia",
  "optimism-sepolia": "optimism",
  optimism: "optimism-sepolia",
  "avalanche-fuji": "avalanche",
  avalanche: "avalanche-fuji",
  "arbitrum-sepolia": "arbitrum",
  arbitrum: "arbitrum-sepolia",
  "ethereum-sepolia": "ethereum",
  ethereum: "ethereum-sepolia",
  "linea-sepolia": "linea",
  linea: "linea-sepolia",
  "polygon-amoy": "polygon",
  polygon: "polygon-amoy",
  "sonic-testnet": "sonic",
  sonic: "sonic-testnet",
  "unichain-sepolia": "unichain",
  unichain: "unichain-sepolia",
};

export const isSolanaDevnetChain = (chainId?: string | null) =>
  chainId === "solana";

export const isSolanaMainnetChain = (chainId?: string | null) =>
  chainId === "solana-mainnet";

export const isSolanaBridgeChain = (chainId?: string | null) =>
  isSolanaDevnetChain(chainId) || isSolanaMainnetChain(chainId);

export const isNativeArcUsdcChain = (chainId?: string | null) =>
  chainId === "arc-testnet" || chainId === "arc";

export const getBridgeNetworkMode = (
  chainId?: string | null,
): BridgeNetworkMode | null => {
  if (!chainId) {
    return null;
  }

  if (TESTNET_CHAIN_SET.has(chainId)) {
    return "testnet";
  }

  if (MAINNET_CHAIN_SET.has(chainId)) {
    return "mainnet";
  }

  return null;
};

export const parseBridgeNetworkMode = (
  value?: string | null,
): BridgeNetworkMode | null => {
  if (value === "testnet" || value === "mainnet") {
    return value;
  }

  return null;
};

export const inferBridgeNetworkMode = (
  fromChain?: string | null,
  toChain?: string | null,
): BridgeNetworkMode | null =>
  getBridgeNetworkMode(fromChain) || getBridgeNetworkMode(toChain);

export const getDefaultBridgeNetworkMode = (): BridgeNetworkMode => {
  const envMode = process.env.NEXT_PUBLIC_DEFAULT_NETWORK_MODE;
  if (envMode === "mainnet" || envMode === "testnet") {
    return envMode;
  }
  return "mainnet";
};

export const readStoredBridgeNetworkMode = (): BridgeNetworkMode => {
  if (typeof window === "undefined") {
    return getDefaultBridgeNetworkMode();
  }

  try {
    const stored = window.sessionStorage.getItem(BRIDGE_NETWORK_STORAGE_KEY);
    if (stored === "testnet" || stored === "mainnet") {
      return stored;
    }
  } catch {
    // Ignore private-mode or storage quota failures.
  }

  return getDefaultBridgeNetworkMode();
};

export const TOWER_NETWORK_MODE_EVENT = "tower-network-mode";

export const storeBridgeNetworkMode = (mode: BridgeNetworkMode) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(BRIDGE_NETWORK_STORAGE_KEY, mode);
    window.dispatchEvent(
      new CustomEvent<BridgeNetworkMode>(TOWER_NETWORK_MODE_EVENT, {
        detail: mode,
      }),
    );
  } catch {
    // Ignore private-mode or storage quota failures.
  }
};

export const remapChainForNetwork = (
  chainId: string | null | undefined,
  mode: BridgeNetworkMode,
): string | null => {
  if (!chainId || chainId === "all") {
    return chainId ?? null;
  }

  const currentMode = getBridgeNetworkMode(chainId);
  if (currentMode === mode) {
    return chainId;
  }

  const counterpart = BRIDGE_CHAIN_COUNTERPARTS[chainId];
  if (counterpart && getBridgeNetworkMode(counterpart) === mode) {
    return counterpart;
  }

  return DEFAULT_BRIDGE_CHAIN[mode];
};

export const getSolanaUsdcMint = (chainId?: string | null) =>
  isSolanaMainnetChain(chainId)
    ? SOLANA_MAINNET_USDC_MINT
    : SOLANA_DEVNET_USDC_MINT;

export const getBridgeTransactionUrl = (
  chainId?: string | null,
  transactionHash?: string | null,
) => {
  if (!chainId || !transactionHash) {
    return null;
  }

  const explorerBaseUrl = BRIDGE_EXPLORER_TX_URLS[chainId];
  if (!explorerBaseUrl) {
    return null;
  }

  return isSolanaDevnetChain(chainId)
    ? `${explorerBaseUrl}${transactionHash}?cluster=devnet`
    : `${explorerBaseUrl}${transactionHash}`;
};
