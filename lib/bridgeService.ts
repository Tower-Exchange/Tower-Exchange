"use client";

/**
 * Bridge Service - Arc Network Bridge Integration
 *
 * Handles bridging USDC across different EVM blockchains using Arc's Bridge Kit
 * Reference: https://docs.arc.io/app-kit/bridge
 *
 * This module uses browser APIs (window.ethereum) and must run on the client-side
 */

import {
  PublicClient,
  createPublicClient,
  http,
  Chain as ViemChain,
  type EIP1193Provider,
  formatUnits,
  parseUnits,
} from "viem";
import {
  arbitrum,
  avalanche,
  base,
  baseSepolia,
  linea,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  sonic,
  unichain,
  arbitrumSepolia,
  avalancheFuji,
} from "viem/chains";

// Bridge Kit adapters and chain definitions
import { AppKit, isRetryableError } from "@circle-fin/app-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { createSolanaAdapterFromProvider } from "@circle-fin/adapter-solana";
import { CCTPV2BridgingProvider } from "@circle-fin/provider-cctp-v2";
import { Buffer } from "buffer";
import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";
import {
  ArcTestnet,
  Arbitrum,
  ArbitrumSepolia,
  Avalanche,
  AvalancheFuji,
  Base,
  BaseSepolia,
  Ethereum,
  EthereumSepolia,
  Linea,
  LineaSepolia,
  Optimism,
  OptimismSepolia,
  Polygon,
  PolygonAmoy,
  Solana,
  SolanaDevnet,
  Sonic,
  SonicTestnet,
  Unichain,
  UnichainSepolia,
} from "@circle-fin/bridge-kit/chains";
import {
  getConnectedSolanaAddress,
  getConnectedSolanaProvider,
  type SolanaWalletProvider,
} from "@/lib/solanaWalletStore";
import {
  ARC_ADD_NETWORK_PARAMS,
  ARC_MAINNET_ADD_NETWORK_PARAMS,
  ARC_MAINNET_PUBLIC_RPC_URL,
} from "@/lib/arcNetwork";
import {
  BRIDGE_EURC_ADDRESSES,
  BRIDGE_USDC_ADDRESSES,
  getBridgeNetworkMode,
  isBridgeTokenSupportedOnChain,
  isSolanaBridgeChain,
  isSolanaMainnetChain,
} from "@/lib/bridgeNetworks";
import {
  ARC_MAINNET_VIEM_CHAIN,
  ArcMainnet,
  getCircleBridgeTokenRegistry,
  withCircleChainAwareViemAdapter,
} from "@/lib/circleArcMainnet";
import { isPositiveDecimalAmount } from "@/lib/positiveAmount";

// Chain mapping for viem
const VIEM_CHAIN_MAP: Record<number, ViemChain> = {
  1: mainnet,
  10: optimism,
  130: unichain,
  137: polygon,
  146: sonic,
  8453: base,
  43114: avalanche,
  42161: arbitrum,
  59144: linea,
  5042: ARC_MAINNET_VIEM_CHAIN,
  84532: baseSepolia,
  11155420: optimismSepolia,
  43113: avalancheFuji,
  421614: arbitrumSepolia,
  11155111: {
    id: 11155111,
    name: "Ethereum Sepolia",
    network: "ethereum-sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: ["https://ethereum-sepolia-rpc.publicnode.com"] },
      public: { http: ["https://ethereum-sepolia-rpc.publicnode.com"] },
    },
  } as ViemChain,
  59141: {
    id: 59141,
    name: "Linea Sepolia",
    network: "linea-sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: ["https://rpc.sepolia.linea.build"] },
      public: { http: ["https://rpc.sepolia.linea.build"] },
    },
  } as ViemChain,
  80002: {
    id: 80002,
    name: "Polygon Amoy",
    network: "polygon-amoy",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    rpcUrls: {
      default: { http: ["https://rpc-amoy.polygon.technology"] },
      public: { http: ["https://rpc-amoy.polygon.technology"] },
    },
  } as ViemChain,
  14601: {
    id: 14601,
    name: "Sonic Testnet",
    network: "sonic-testnet",
    nativeCurrency: { name: "Sonic", symbol: "S", decimals: 18 },
    rpcUrls: {
      default: { http: ["https://rpc.testnet.soniclabs.com"] },
      public: { http: ["https://rpc.testnet.soniclabs.com"] },
    },
  } as ViemChain,
  1301: {
    id: 1301,
    name: "Unichain Sepolia",
    network: "unichain-sepolia",
    nativeCurrency: { name: "Uni", symbol: "UNI", decimals: 18 },
    rpcUrls: {
      default: { http: ["https://sepolia.unichain.org"] },
      public: { http: ["https://sepolia.unichain.org"] },
    },
  } as ViemChain,
  5042002: {
    id: 5042002,
    name: "Arc Testnet",
    network: "arc-testnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: ["https://rpc.testnet.arc.network"] },
      public: { http: ["https://rpc.testnet.arc.network"] },
    },
  } as ViemChain,
};

const SOLANA_RPC_PROXY_PATH = "/api/rpc/solana";
const SOLANA_MAINNET_RPC_PROXY_PATH = "/api/rpc/solana-mainnet";

// Chain configurations for supported networks
export const SUPPORTED_CHAINS = {
  "arc-testnet": {
    name: "Arc Testnet",
    chainId: 5042002,
    rpcUrl: "https://rpc.testnet.arc.network",
    nativeTokenSymbol: "USDC",
    circleChain: "Arc_Testnet" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES["arc-testnet"],
  },
  "base-sepolia": {
    name: "Base Sepolia",
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    nativeTokenSymbol: "ETH",
    circleChain: "Base_Sepolia" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES["base-sepolia"],
  },
  "optimism-sepolia": {
    name: "Optimism Sepolia",
    chainId: 11155420,
    rpcUrl: "https://sepolia.optimism.io",
    nativeTokenSymbol: "ETH",
    circleChain: "Optimism_Sepolia" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES["optimism-sepolia"],
  },
  "avalanche-fuji": {
    name: "Avalanche Fuji",
    chainId: 43113,
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    nativeTokenSymbol: "AVAX",
    circleChain: "Avalanche_Fuji" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES["avalanche-fuji"],
  },
  "arbitrum-sepolia": {
    name: "Arbitrum Sepolia",
    chainId: 421614,
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    nativeTokenSymbol: "ETH",
    circleChain: "Arbitrum_Sepolia" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES["arbitrum-sepolia"],
  },
  "ethereum-sepolia": {
    name: "Ethereum Sepolia",
    chainId: 11155111,
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    nativeTokenSymbol: "ETH",
    circleChain: "Ethereum_Sepolia" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES["ethereum-sepolia"],
  },
  "linea-sepolia": {
    name: "Linea Sepolia",
    chainId: 59141,
    rpcUrl: "https://rpc.sepolia.linea.build",
    nativeTokenSymbol: "ETH",
    circleChain: "Linea_Sepolia" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES["linea-sepolia"],
  },
  "polygon-amoy": {
    name: "Polygon Amoy",
    chainId: 80002,
    rpcUrl: "https://rpc-amoy.polygon.technology",
    nativeTokenSymbol: "POL",
    circleChain: "Polygon_Amoy_Testnet" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES["polygon-amoy"],
  },
  "sonic-testnet": {
    name: "Sonic Testnet",
    chainId: 14601,
    rpcUrl: "https://rpc.testnet.soniclabs.com",
    nativeTokenSymbol: "S",
    circleChain: "Sonic_Testnet" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES["sonic-testnet"],
  },
  "unichain-sepolia": {
    name: "Unichain Sepolia",
    chainId: 1301,
    rpcUrl: "https://sepolia.unichain.org",
    nativeTokenSymbol: "UNI",
    circleChain: "Unichain_Sepolia" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES["unichain-sepolia"],
  },
  solana: {
    name: "Solana Devnet",
    chainId: 103,
    rpcUrl: "https://api.devnet.solana.com",
    nativeTokenSymbol: "SOL",
    circleChain: "Solana_Devnet" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES.solana,
  },
  arc: {
    name: "Arc",
    chainId: 5042,
    rpcUrl: ARC_MAINNET_PUBLIC_RPC_URL,
    nativeTokenSymbol: "USDC",
    circleChain: "Arc_Testnet" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES.arc,
  },
  ethereum: {
    name: "Ethereum",
    chainId: 1,
    rpcUrl: "https://ethereum.publicnode.com",
    nativeTokenSymbol: "ETH",
    circleChain: "Ethereum" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES.ethereum,
  },
  optimism: {
    name: "Optimism",
    chainId: 10,
    rpcUrl: "https://mainnet.optimism.io",
    nativeTokenSymbol: "ETH",
    circleChain: "Optimism" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES.optimism,
  },
  unichain: {
    name: "Unichain",
    chainId: 130,
    rpcUrl: "https://mainnet.unichain.org",
    nativeTokenSymbol: "ETH",
    circleChain: "Unichain" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES.unichain,
  },
  polygon: {
    name: "Polygon",
    chainId: 137,
    rpcUrl: "https://polygon-rpc.com",
    nativeTokenSymbol: "POL",
    circleChain: "Polygon" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES.polygon,
  },
  sonic: {
    name: "Sonic",
    chainId: 146,
    rpcUrl: "https://rpc.soniclabs.com",
    nativeTokenSymbol: "S",
    circleChain: "Sonic" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES.sonic,
  },
  base: {
    name: "Base",
    chainId: 8453,
    rpcUrl: "https://mainnet.base.org",
    nativeTokenSymbol: "ETH",
    circleChain: "Base" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES.base,
  },
  avalanche: {
    name: "Avalanche",
    chainId: 43114,
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    nativeTokenSymbol: "AVAX",
    circleChain: "Avalanche" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES.avalanche,
  },
  arbitrum: {
    name: "Arbitrum",
    chainId: 42161,
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    nativeTokenSymbol: "ETH",
    circleChain: "Arbitrum" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES.arbitrum,
  },
  linea: {
    name: "Linea",
    chainId: 59144,
    rpcUrl: "https://rpc.linea.build",
    nativeTokenSymbol: "ETH",
    circleChain: "Linea" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES.linea,
  },
  "solana-mainnet": {
    name: "Solana",
    chainId: 101,
    rpcUrl: "https://api.mainnet-beta.solana.com",
    nativeTokenSymbol: "SOL",
    circleChain: "Solana" as const,
    usdcAddress: BRIDGE_USDC_ADDRESSES["solana-mainnet"],
  },
};

const getSolanaBridgeRpcUrl = (chainKey: string = "solana") => {
  const chainConfig =
    SUPPORTED_CHAINS[chainKey as keyof typeof SUPPORTED_CHAINS];
  const fallbackRpcUrl =
    chainConfig && isSolanaBridgeChain(chainKey)
      ? chainConfig.rpcUrl
      : SUPPORTED_CHAINS.solana.rpcUrl;

  if (typeof window === "undefined") {
    return fallbackRpcUrl;
  }

  const proxyPath = isSolanaMainnetChain(chainKey)
    ? SOLANA_MAINNET_RPC_PROXY_PATH
    : SOLANA_RPC_PROXY_PATH;

  return new URL(proxyPath, window.location.origin).toString();
};

const createSolanaBridgeConnection = (rpcUrl: string) =>
  new Connection(rpcUrl, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 120000,
    disableRetryOnRateLimit: false,
  });

const SUPPORTED_EVM_CIRCLE_CHAINS = [
  ArcTestnet,
  ArcMainnet,
  BaseSepolia,
  OptimismSepolia,
  AvalancheFuji,
  ArbitrumSepolia,
  EthereumSepolia,
  LineaSepolia,
  PolygonAmoy,
  SonicTestnet,
  UnichainSepolia,
  Ethereum,
  Optimism,
  Unichain,
  Polygon,
  Sonic,
  Base,
  Avalanche,
  Arbitrum,
  Linea,
] as const;

type CircleSolanaProvider = SolanaWalletProvider;

type SolanaSignableTransaction = Transaction | VersionedTransaction;

const decodeBase64Value = (value: string) =>
  Uint8Array.from(Buffer.from(value, "base64"));

const encodeBase64Value = (value: Uint8Array) =>
  Buffer.from(value).toString("base64");

const getSolanaProviderAddress = (
  provider: SolanaWalletProvider | null | undefined,
  fallbackAddress?: string,
) =>
  provider?.publicKey?.toString?.() ??
  provider?.address ??
  fallbackAddress ??
  "";

const setSolanaProviderAddress = (
  provider: SolanaWalletProvider | null | undefined,
  address: string,
) => {
  if (!provider) {
    return;
  }

  try {
    provider.address = address;
  } catch {
    // Some injected providers expose a read-only shape; the wrapper getter
    // still resolves from publicKey, so treat address assignment as best-effort.
  }
};

const decodeSolanaWireTransaction = (
  wireTransaction: string,
): SolanaSignableTransaction => {
  const bytes = decodeBase64Value(wireTransaction);

  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return Transaction.from(Buffer.from(bytes));
  }
};

const encodeSignedSolanaTransaction = (signedTransaction: unknown) => {
  if (typeof signedTransaction === "string") {
    return signedTransaction;
  }

  if (signedTransaction instanceof Uint8Array) {
    return encodeBase64Value(signedTransaction);
  }

  if (
    signedTransaction &&
    typeof signedTransaction === "object" &&
    "serialize" in signedTransaction &&
    typeof (signedTransaction as { serialize: () => Uint8Array }).serialize ===
      "function"
  ) {
    return encodeBase64Value(
      (signedTransaction as { serialize: () => Uint8Array }).serialize(),
    );
  }

  throw new Error(
    "Unsupported signed transaction response from Solana wallet provider.",
  );
};

const getSolanaConnectResultAddress = (
  result: unknown,
  provider: SolanaWalletProvider,
  fallbackAddress: string,
) =>
  result && typeof result === "object" && "publicKey" in result
    ? ((
        result as { publicKey?: { toString?: () => string } | null }
      ).publicKey?.toString?.() ??
      getSolanaProviderAddress(provider, fallbackAddress))
    : result && typeof result === "object" && "address" in result
      ? ((result as { address?: string }).address ??
        getSolanaProviderAddress(provider, fallbackAddress))
      : getSolanaProviderAddress(provider, fallbackAddress);

const refreshTrustedPhantomSession = async (
  provider: SolanaWalletProvider,
  fallbackAddress: string,
) => {
  if (!provider.isPhantom) {
    return null;
  }

  try {
    const result = await provider.connect({ onlyIfTrusted: true });
    const address = getSolanaConnectResultAddress(
      result,
      provider,
      fallbackAddress,
    );

    if (!address) {
      return null;
    }

    setSolanaProviderAddress(provider, address);
    return address;
  } catch (error) {
    console.warn(
      "Unable to silently refresh Phantom session before signing:",
      error,
    );
    return null;
  }
};

const ensureConnectedSolanaProvider = async (
  provider: SolanaWalletProvider,
  fallbackAddress: string,
  forceReconnect = false,
) => {
  const existingAddress = getSolanaProviderAddress(provider, fallbackAddress);

  if (!forceReconnect && provider.isConnected && existingAddress) {
    const refreshedPhantomAddress = await refreshTrustedPhantomSession(
      provider,
      existingAddress,
    );

    const addressToUse = refreshedPhantomAddress ?? existingAddress;
    setSolanaProviderAddress(provider, addressToUse);
    return addressToUse;
  }

  const result = await provider.connect();
  const address = getSolanaConnectResultAddress(
    result,
    provider,
    fallbackAddress,
  );

  if (!address) {
    throw new Error("Wallet connection did not return an address");
  }

  setSolanaProviderAddress(provider, address);
  return address;
};

const isSolanaProviderConnectionError = (error: unknown) => {
  const normalizedMessage = getBridgeErrorMessage(error).toLowerCase();

  return (
    normalizedMessage.includes("disconnected port") ||
    normalizedMessage.includes("failed to send message") ||
    normalizedMessage.includes("service worker") ||
    normalizedMessage.includes("wallet disconnected")
  );
};

const withSolanaProviderConnectionRetry = async <T>(
  provider: SolanaWalletProvider,
  fallbackAddress: string,
  operation: () => Promise<T>,
) => {
  await ensureConnectedSolanaProvider(provider, fallbackAddress);

  try {
    return await operation();
  } catch (error) {
    if (!isSolanaProviderConnectionError(error)) {
      throw error;
    }

    console.warn(
      "Solana wallet provider lost connection during signing. Retrying after reconnect.",
      error,
    );

    await ensureConnectedSolanaProvider(provider, fallbackAddress, true);
    return await operation();
  }
};

const createCircleCompatibleSolanaProvider = (
  provider: SolanaWalletProvider,
  fallbackAddress: string,
): CircleSolanaProvider => {
  let knownAddress = fallbackAddress;
  const resolveAddress = () => getSolanaProviderAddress(provider, knownAddress);
  const rememberAddress = (address: string) => {
    knownAddress = address;
    setSolanaProviderAddress(provider, address);
    return address;
  };

  return {
    get address() {
      return resolveAddress();
    },
    get isConnected() {
      return Boolean(provider.isConnected && resolveAddress());
    },
    connect: async () => {
      const address = rememberAddress(
        await ensureConnectedSolanaProvider(provider, knownAddress, true),
      );
      return { address };
    },
    disconnect: async () => {
      knownAddress = "";
      setSolanaProviderAddress(provider, "");
      await provider.disconnect();
    },
    signTransaction: async (wireTransaction: unknown) => {
      if (typeof wireTransaction !== "string") {
        throw new Error(
          "Expected a base64-encoded Solana transaction payload.",
        );
      }

      const decodedTransaction = decodeSolanaWireTransaction(wireTransaction);
      console.log("Solana provider signTransaction requested", {
        wallet: provider.isPhantom
          ? "phantom"
          : provider.isSolflare
            ? "solflare"
            : provider.isBackpack
              ? "backpack"
              : "unknown",
        isConnected: provider.isConnected,
        address: resolveAddress(),
        transactionType:
          decodedTransaction instanceof VersionedTransaction
            ? "versioned"
            : "legacy",
      });
      const signedTransaction = await withSolanaProviderConnectionRetry(
        provider,
        knownAddress,
        async () => provider.signTransaction(decodedTransaction),
      );
      const latestAddress = resolveAddress();
      if (latestAddress) {
        rememberAddress(latestAddress);
      }
      console.log("Solana provider signTransaction completed", {
        address: latestAddress || resolveAddress(),
      });
      return encodeSignedSolanaTransaction(signedTransaction);
    },
    ...(provider.signAllTransactions
      ? {
          signAllTransactions: async (wireTransactions: unknown[]) => {
            const decodedTransactions = wireTransactions.map(
              (wireTransaction) => {
                if (typeof wireTransaction !== "string") {
                  throw new Error(
                    "Expected base64-encoded Solana transaction payloads.",
                  );
                }

                return decodeSolanaWireTransaction(wireTransaction);
              },
            );
            console.log("Solana provider signAllTransactions requested", {
              wallet: provider.isPhantom
                ? "phantom"
                : provider.isSolflare
                  ? "solflare"
                  : provider.isBackpack
                    ? "backpack"
                    : "unknown",
              count: decodedTransactions.length,
              isConnected: provider.isConnected,
              address: resolveAddress(),
            });
            const signedTransactions = await withSolanaProviderConnectionRetry(
              provider,
              knownAddress,
              async () => provider.signAllTransactions!(decodedTransactions),
            );
            const latestAddress = resolveAddress();
            if (latestAddress) {
              rememberAddress(latestAddress);
            }
            console.log("Solana provider signAllTransactions completed", {
              count: signedTransactions.length,
              address: latestAddress || resolveAddress(),
            });
            return signedTransactions.map(encodeSignedSolanaTransaction);
          },
        }
      : {}),
  };
};

const withSolanaMessageSigning = (
  adapter: any,
  provider: SolanaWalletProvider,
  fallbackAddress: string,
) => {
  if (
    !adapter ||
    typeof adapter.getSigner !== "function" ||
    !provider.signMessage
  ) {
    return adapter;
  }

  const originalGetSigner = adapter.getSigner.bind(adapter);

  adapter.getSigner = async (...args: unknown[]) => {
    const signer = await originalGetSigner(...args);

    if (!signer || typeof signer !== "object" || "signMessages" in signer) {
      return signer;
    }

    return {
      ...signer,
      signMessages: async (
        messages: Array<{
          content: Uint8Array;
          signatures?: Record<string, Uint8Array>;
        }>,
      ) => {
        const results = [];

        for (const message of messages) {
          const address = await ensureConnectedSolanaProvider(
            provider,
            fallbackAddress,
          );
          console.log("Solana provider signMessage requested", {
            wallet: provider.isPhantom
              ? "phantom"
              : provider.isSolflare
                ? "solflare"
                : provider.isBackpack
                  ? "backpack"
                  : "unknown",
            isConnected: provider.isConnected,
            address,
            messageBytes: message.content.length,
          });
          const signedMessage = await withSolanaProviderConnectionRetry(
            provider,
            address,
            async () => provider.signMessage!(message.content),
          );
          const signature =
            signedMessage &&
            typeof signedMessage === "object" &&
            "signature" in signedMessage &&
            signedMessage.signature instanceof Uint8Array
              ? signedMessage.signature
              : signedMessage instanceof Uint8Array
                ? signedMessage
                : null;

          if (!signature) {
            throw new Error(
              "Unsupported Solana message signature response from wallet provider.",
            );
          }

          results.push({
            ...(message.signatures ?? {}),
            [address]: signature,
          });
        }

        return results;
      },
    };
  };

  return adapter;
};

const BRIDGE_STEP_RECEIPT_TIMEOUT_MS = 5 * 60 * 1000;
const BRIDGE_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_USE_CIRCLE_FORWARDER = true;
const CIRCLE_IRIS_MAINNET_URL = "https://iris-api.circle.com";
const CIRCLE_IRIS_SANDBOX_URL = "https://iris-api-sandbox.circle.com";
const ACTIONABLE_PENDING_BRIDGE_STEPS = new Set([
  "burn",
  "depositForBurn",
  "fetchAttestation",
  "mint",
]);

function isBridgeSourceTransactionStep(stepName?: string): boolean {
  return stepName === "burn" || stepName === "depositForBurn";
}

async function getCctpFastForwardingFees(
  sourceDomain: number,
  destinationDomain: number,
  isTestnet: boolean,
): Promise<{ forwarderFee: bigint; scaledBurnFeeBps: bigint }> {
  const baseUrl = isTestnet ? CIRCLE_IRIS_SANDBOX_URL : CIRCLE_IRIS_MAINNET_URL;
  const response = await fetch(
    `${baseUrl}/v2/burn/USDC/fees/${sourceDomain}/${destinationDomain}?forward=true`,
  );

  if (!response.ok) {
    throw new Error(
      `Circle fee quote request failed with HTTP ${response.status}.`,
    );
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Circle returned an invalid forwarding fee quote.");
  }

  const fastFeeTier = payload.find(
    (
      tier,
    ): tier is {
      finalityThreshold: number;
      minimumFee: string | number;
      forwardFee: { high: string | number };
    } =>
      typeof tier === "object" &&
      tier !== null &&
      "finalityThreshold" in tier &&
      tier.finalityThreshold === 1000 &&
      "minimumFee" in tier &&
      (typeof tier.minimumFee === "string" ||
        typeof tier.minimumFee === "number") &&
      "forwardFee" in tier &&
      typeof tier.forwardFee === "object" &&
      tier.forwardFee !== null &&
      "high" in tier.forwardFee &&
      (typeof tier.forwardFee.high === "string" ||
        typeof tier.forwardFee.high === "number"),
  );

  if (!fastFeeTier) {
    throw new Error(
      "Circle did not return a high-tier FAST forwarding fee for this route.",
    );
  }

  // Circle's CCTP provider deliberately uses this tier for the forwarder so
  // destination-gas movements cannot leave the depositForBurn maxFee too low.
  // The value must match the tier used by the provider that builds the burn.
  const highFee = fastFeeTier.forwardFee.high;
  if (
    (typeof highFee === "number" && !Number.isSafeInteger(highFee)) ||
    (typeof highFee === "string" && !/^\d+$/.test(highFee))
  ) {
    throw new Error("Circle returned an invalid high-tier forwarding fee.");
  }

  const forwarderFee = BigInt(highFee);
  if (forwarderFee < 0n) {
    throw new Error("Circle returned a negative forwarding fee.");
  }

  const minimumFeeBps = Number.parseFloat(String(fastFeeTier.minimumFee));
  if (!Number.isFinite(minimumFeeBps) || minimumFeeBps < 0) {
    throw new Error("Circle returned an invalid FAST CCTP fee.");
  }

  return {
    forwarderFee,
    scaledBurnFeeBps: BigInt(Math.round(minimumFeeBps * 100)),
  };
}

function calculateFastForwardingMaxFee(
  amountInMinorUnits: bigint,
  fees: { forwarderFee: bigint; scaledBurnFeeBps: bigint },
): bigint {
  const burnFee =
    (fees.scaledBurnFeeBps * amountInMinorUnits + 999_999n) / 1_000_000n;
  const burnFeeWithBuffer = burnFee + burnFee / 10n;

  return burnFeeWithBuffer + fees.forwarderFee;
}

const CHAIN_SWITCH_RESTORE_DELAY_MS = 350;

export type BridgeProgressSnapshot = {
  lastStep?: string;
  lastTxHash?: string;
  lastExplorerUrl?: string;
  events: Array<{
    step: string;
    txHash?: string;
    explorerUrl?: string;
  }>;
};

function getBridgeErrorDiagnostics(error: unknown, depth = 0): unknown {
  if (depth > 3 || error == null) {
    return error;
  }

  if (typeof error !== "object") {
    return error;
  }

  const record = error as Record<string, unknown>;
  const cause =
    "cause" in record
      ? getBridgeErrorDiagnostics(record.cause, depth + 1)
      : undefined;
  const trace =
    record.cause &&
    typeof record.cause === "object" &&
    "trace" in (record.cause as Record<string, unknown>)
      ? (record.cause as Record<string, unknown>).trace
      : undefined;

  return {
    name: typeof record.name === "string" ? record.name : undefined,
    message: typeof record.message === "string" ? record.message : undefined,
    code: record.code,
    type: record.type,
    recoverability: record.recoverability,
    trace,
    cause,
  };
}

function getBridgeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }

  return "Unknown bridge error";
}

function isBridgeTimeoutError(message: string): boolean {
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("timeout") ||
    normalizedMessage.includes("timed out") ||
    normalizedMessage.includes("execution exceeded")
  );
}

function isBridgeNetworkError(message: string): boolean {
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("network") ||
    normalizedMessage.includes("connection") ||
    normalizedMessage.includes("rpc") ||
    normalizedMessage.includes("fetch failed")
  );
}

function hasActionableBridgeProgress(
  progress: BridgeProgressSnapshot,
): boolean {
  return progress.events.some((event) =>
    ACTIONABLE_PENDING_BRIDGE_STEPS.has(event.step),
  );
}

function createPendingBridgeMessage(progress: BridgeProgressSnapshot): string {
  switch (progress.lastStep) {
    case "mint":
      return "Bridge mint transaction was submitted and is still confirming on the destination chain. Check your wallet or the explorer while it finishes.";
    case "fetchAttestation":
      return "Bridge burn transaction succeeded and Circle is still finalizing the attestation. The transfer is still in progress.";
    case "burn":
    case "depositForBurn":
      return "Bridge burn transaction was submitted and is still settling on the source chain. The transfer is still in progress.";
    default:
      return "Bridge transaction was submitted and is still processing on-chain. Check your wallet or the explorer while it finishes.";
  }
}

const BRIDGE_RETRY_ATTEMPTS = 2;
const BRIDGE_RETRY_DELAY_MS = 1500;
const FORWARDED_BRIDGE_COMPLETION_TIMEOUT_MS = 15000;
const FORWARDED_BRIDGE_COMPLETION_RETRIES = 15;
const FORWARDED_BRIDGE_COMPLETION_RETRY_DELAY_MS = 2000;
const CIRCLE_CHAIN_OBJECTS: Record<string, any> = {
  "arc-testnet": ArcTestnet,
  "base-sepolia": BaseSepolia,
  "optimism-sepolia": OptimismSepolia,
  "avalanche-fuji": AvalancheFuji,
  "arbitrum-sepolia": ArbitrumSepolia,
  "ethereum-sepolia": EthereumSepolia,
  "linea-sepolia": LineaSepolia,
  "polygon-amoy": PolygonAmoy,
  "sonic-testnet": SonicTestnet,
  "unichain-sepolia": UnichainSepolia,
  solana: SolanaDevnet,
  arc: ArcMainnet,
  ethereum: Ethereum,
  optimism: Optimism,
  unichain: Unichain,
  polygon: Polygon,
  sonic: Sonic,
  base: Base,
  avalanche: Avalanche,
  arbitrum: Arbitrum,
  linea: Linea,
  "solana-mainnet": Solana,
};
const RELAYER_RETRYABLE_BRIDGE_ERROR_PATTERNS = [
  "circle relayer failed to forward the mint transaction",
  "relayer failed to forward the mint transaction",
  "mint may still have succeeded",
  "retry using the attestation data",
  "rpc error on solana devnet",
  "relayer_forward_failed",
  "onchain_unknown_blockchain_error",
  "unknown blockchain error",
];

function isBridgeRelayerFailureMessage(message: string): boolean {
  const normalizedMessage = message.toLowerCase();
  return RELAYER_RETRYABLE_BRIDGE_ERROR_PATTERNS.some((pattern) =>
    normalizedMessage.includes(pattern),
  );
}

function isBridgeRetryableFailure(error: unknown): boolean {
  if (isRetryableError(error)) {
    return true;
  }

  const diagnostics = getBridgeErrorDiagnostics(error);
  if (
    diagnostics &&
    typeof diagnostics === "object" &&
    "recoverability" in diagnostics
  ) {
    const recoverability = (diagnostics as { recoverability?: unknown })
      .recoverability;
    if (recoverability === "RETRYABLE" || recoverability === "RESUMABLE") {
      return true;
    }
  }

  const message = getBridgeErrorMessage(error);
  return (
    isBridgeRelayerFailureMessage(message) ||
    isBridgeTimeoutError(message) ||
    isBridgeNetworkError(message)
  );
}

function getRetryableFailedBridgeStep(result: unknown): any | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  const steps = (result as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) {
    return null;
  }

  return (
    steps.find((step) => {
      if (
        !step ||
        typeof step !== "object" ||
        (step as any).state !== "error"
      ) {
        return false;
      }

      const stepError = (step as any).error;
      const stepErrorMessage =
        typeof (step as any).errorMessage === "string"
          ? (step as any).errorMessage
          : getBridgeErrorMessage(stepError);

      return (
        isBridgeRetryableFailure(stepError) ||
        isBridgeRelayerFailureMessage(stepErrorMessage)
      );
    }) ?? null
  );
}

function getBridgeRetryContext(
  fromAdapter: any,
  toAdapter: any,
  useForwarder: boolean,
) {
  if (useForwarder) {
    return { from: fromAdapter };
  }

  return {
    from: fromAdapter,
    to: toAdapter,
  };
}

function waitForBridgeRetryDelay(attemptNumber: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, BRIDGE_RETRY_DELAY_MS * attemptNumber);
  });
}

export async function waitForForwardedBridgeCompletion(
  request: Pick<
    BridgeRequest,
    "fromChain" | "sourceAddress" | "publicClient" | "walletClient" | "chain"
  > & {
    burnTxHash: string;
  },
): Promise<BridgeResponse> {
  const fromChainObj = CIRCLE_CHAIN_OBJECTS[request.fromChain];

  if (!fromChainObj) {
    return {
      success: false,
      error: `Chain object not found for ${request.fromChain}`,
    };
  }

  const sourceAdapter = isSolanaBridgeChain(request.fromChain)
    ? await ensureSolanaBridgeAdapter(request.fromChain)
    : await ensureEvmBridgeAdapter(request);

  if (!sourceAdapter) {
    return {
      success: false,
      error: "Bridge source adapter not initialized.",
    };
  }

  const provider = new CCTPV2BridgingProvider();

  try {
    const attestation = await provider.fetchRelayerMint(
      {
        adapter: sourceAdapter,
        chain: fromChainObj,
        ...(request.sourceAddress
          ? {
              address: request.sourceAddress,
            }
          : {}),
      } as any,
      request.burnTxHash,
      {
        timeout: FORWARDED_BRIDGE_COMPLETION_TIMEOUT_MS,
        maxRetries: FORWARDED_BRIDGE_COMPLETION_RETRIES,
        retryDelay: FORWARDED_BRIDGE_COMPLETION_RETRY_DELAY_MS,
      },
    );

    const transactionHash = (attestation as { forwardTxHash?: string })
      .forwardTxHash;

    if (!transactionHash) {
      return {
        success: true,
        status: "pending",
        forwarded: true,
        transactionHash: request.burnTxHash,
        sourceTransactionHash: request.burnTxHash,
        message: createPendingBridgeMessage({
          lastStep: "mint",
          lastTxHash: request.burnTxHash,
          events: [],
        }),
      };
    }

    return {
      success: true,
      status: "completed",
      forwarded: true,
      transactionHash,
      sourceTransactionHash: request.burnTxHash,
      message: "Circle Forwarder confirmed the destination mint.",
    };
  } catch (error) {
    if (isBridgeRetryableFailure(error)) {
      return {
        success: true,
        status: "pending",
        forwarded: true,
        transactionHash: request.burnTxHash,
        sourceTransactionHash: request.burnTxHash,
        message: createPendingBridgeMessage({
          lastStep: "mint",
          lastTxHash: request.burnTxHash,
          events: [],
        }),
      };
    }

    return {
      success: false,
      error: getBridgeErrorMessage(error),
    };
  }
}

function withBridgeTransactionTimeouts<T>(adapter: T): T {
  const candidate = adapter as T & {
    waitForTransaction?: (
      txHash: string,
      config: { confirmations?: number; timeout?: number } | undefined,
      chain: unknown,
    ) => Promise<unknown>;
    __towerBridgeTimeoutPatched?: boolean;
  };

  if (
    !candidate ||
    typeof candidate.waitForTransaction !== "function" ||
    candidate.__towerBridgeTimeoutPatched
  ) {
    return adapter;
  }

  const originalWaitForTransaction =
    candidate.waitForTransaction.bind(candidate);
  candidate.waitForTransaction = (txHash, config, chain) =>
    originalWaitForTransaction(
      txHash,
      {
        ...config,
        timeout: config?.timeout ?? BRIDGE_STEP_RECEIPT_TIMEOUT_MS,
      },
      chain,
    );
  candidate.__towerBridgeTimeoutPatched = true;

  return adapter;
}

const getEvmRequestProvider = (
  walletClient?: {
    request?: EIP1193Provider["request"];
    transport?: { request?: EIP1193Provider["request"] };
    on?: EIP1193Provider["on"];
    removeListener?: EIP1193Provider["removeListener"];
  } | null,
): EIP1193Provider | null => {
  if (walletClient?.request) {
    return {
      request: walletClient.request,
      on: walletClient.on ?? (() => undefined),
      removeListener: walletClient.removeListener ?? (() => undefined),
    } as EIP1193Provider;
  }

  if (walletClient?.transport?.request) {
    return {
      request: walletClient.transport.request,
      on: walletClient.on ?? (() => undefined),
      removeListener: walletClient.removeListener ?? (() => undefined),
    } as EIP1193Provider;
  }

  const provider = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
  if (provider?.request) {
    return provider;
  }

  return null;
};

async function getActiveWalletChainId(
  walletClient?: BridgeRequest["walletClient"],
): Promise<string | null> {
  const provider = getEvmRequestProvider(walletClient);

  if (!provider) {
    return null;
  }

  try {
    const chainId = await provider.request({ method: "eth_chainId" });
    return typeof chainId === "string" ? chainId : null;
  } catch (error) {
    console.warn("Unable to read active wallet chain before bridge:", error);
    return null;
  }
}

async function restoreActiveWalletChain(
  initialChainId: string | null,
  walletClient?: BridgeRequest["walletClient"],
) {
  const provider = getEvmRequestProvider(walletClient);

  if (!provider || !initialChainId) {
    return;
  }

  try {
    const currentChainId = await provider.request({ method: "eth_chainId" });

    if (currentChainId === initialChainId) {
      return;
    }

    window.setTimeout(() => {
      void provider
        .request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: initialChainId }],
        })
        .catch((error) => {
          console.warn("Unable to restore wallet network after bridge:", error);
        });
    }, CHAIN_SWITCH_RESTORE_DELAY_MS);
  } catch (error) {
    console.warn("Unable to check wallet network after bridge:", error);
  }
}

const getWalletErrorCode = (error: unknown) =>
  error && typeof error === "object" && "code" in error
    ? (error as { code?: number }).code
    : undefined;

const toWalletChainHex = (chainId: number) => `0x${chainId.toString(16)}`;

const normalizeWalletChainHex = (chainId: string | number) => {
  if (typeof chainId === "number") {
    return toWalletChainHex(chainId).toLowerCase();
  }

  const trimmed = chainId.trim().toLowerCase();
  const normalized = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  return `0x${BigInt(normalized).toString(16)}`;
};

const getBridgeRpcProxyUrl = (chainId: number) => {
  if (typeof window === "undefined") {
    return null;
  }

  return `${window.location.origin}/api/rpc/${chainId}`;
};

const getWalletAddChainParams = (
  chainKey: string,
  chainConfig: (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS],
) => {
  if (chainKey === "arc-testnet") {
    const proxyRpcUrl = getBridgeRpcProxyUrl(chainConfig.chainId);
    if (proxyRpcUrl) {
      return [
        {
          ...ARC_ADD_NETWORK_PARAMS[0],
          rpcUrls: [proxyRpcUrl, ...ARC_ADD_NETWORK_PARAMS[0].rpcUrls],
        },
      ];
    }

    return ARC_ADD_NETWORK_PARAMS;
  }

  if (chainKey === "arc") {
    const proxyRpcUrl = getBridgeRpcProxyUrl(chainConfig.chainId);
    if (proxyRpcUrl) {
      return [
        {
          ...ARC_MAINNET_ADD_NETWORK_PARAMS[0],
          rpcUrls: [proxyRpcUrl, ...ARC_MAINNET_ADD_NETWORK_PARAMS[0].rpcUrls],
        },
      ];
    }

    return ARC_MAINNET_ADD_NETWORK_PARAMS;
  }

  const viemChain = VIEM_CHAIN_MAP[chainConfig.chainId];
  if (!viemChain) {
    return null;
  }

  const proxyRpcUrl = getBridgeRpcProxyUrl(chainConfig.chainId);
  const rpcUrls = proxyRpcUrl
    ? [proxyRpcUrl]
    : viemChain.rpcUrls.default.http.filter(
        (url): url is string => typeof url === "string" && url.length > 0,
      );
  const blockExplorerUrl = viemChain.blockExplorers?.default?.url;

  return [
    {
      chainId: toWalletChainHex(chainConfig.chainId),
      chainName: chainConfig.name,
      nativeCurrency: viemChain.nativeCurrency,
      rpcUrls,
      ...(blockExplorerUrl ? { blockExplorerUrls: [blockExplorerUrl] } : {}),
    },
  ];
};

export async function ensureWalletOnBridgeChain(
  chainKey: string,
  walletClient?: BridgeRequest["walletClient"],
): Promise<void> {
  if (isSolanaBridgeChain(chainKey)) {
    return;
  }

  const chainConfig =
    SUPPORTED_CHAINS[chainKey as keyof typeof SUPPORTED_CHAINS];
  if (!chainConfig) {
    throw new Error(`Unsupported chain: ${chainKey}`);
  }

  const provider = getEvmRequestProvider(walletClient);
  if (!provider) {
    throw new Error(
      "No wallet provider found. Please connect your wallet and try again.",
    );
  }

  const targetChainHex = toWalletChainHex(chainConfig.chainId);
  const normalizedTargetChainHex = normalizeWalletChainHex(targetChainHex);
  const addChainParams = getWalletAddChainParams(chainKey, chainConfig);

  try {
    const currentChainId = await provider.request({ method: "eth_chainId" });
    if (
      typeof currentChainId === "string" &&
      normalizeWalletChainHex(currentChainId) === normalizedTargetChainHex
    ) {
      return;
    }
  } catch (error) {
    console.warn("Unable to read wallet chain before bridge switch:", error);
  }

  const switchToTargetChain = async () => {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetChainHex }],
    });
  };

  const addOrUpdateTargetChain = async () => {
    if (!addChainParams) {
      return;
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: addChainParams as any,
    });
  };

  try {
    try {
      await addOrUpdateTargetChain();
    } catch (addError) {
      if (getWalletErrorCode(addError) === 4001) {
        throw new Error(
          `Please approve adding ${chainConfig.name} to your wallet to continue bridging.`,
        );
      }

      console.warn(
        `Unable to refresh ${chainConfig.name} network config in wallet:`,
        addError,
      );
    }

    await switchToTargetChain();
  } catch (switchError) {
    if (getWalletErrorCode(switchError) === 4902) {
      try {
        await addOrUpdateTargetChain();
        await switchToTargetChain();
      } catch (retryError) {
        if (getWalletErrorCode(retryError) === 4001) {
          throw new Error(
            `Please approve switching to ${chainConfig.name} in your wallet to continue bridging.`,
          );
        }

        throw retryError;
      }
    } else if (getWalletErrorCode(switchError) === 4001) {
      throw new Error(
        `Please approve switching to ${chainConfig.name} in your wallet to continue bridging.`,
      );
    } else {
      throw switchError;
    }
  }

  const currentChainId = await provider.request({ method: "eth_chainId" });
  if (
    typeof currentChainId !== "string" ||
    normalizeWalletChainHex(currentChainId) !== normalizedTargetChainHex
  ) {
    throw new Error(
      `Please switch to ${chainConfig.name} to continue bridging.`,
    );
  }
}
/**
 * Circle's bridge fee configuration
 * Circle automatically deducts a fee (~0.00013 USDC) from the bridge amount.
 * This is mandatory and cannot be avoided.
 */
export const BRIDGE_FEE_CONFIG: Record<string, string> = {
  // Circle's fee per bridge (varies by chain pair, approximate)
  USDC: "0.00013",
  EURC: "0.00013",
};

const BRIDGE_CUSTOM_FEE_AMOUNT_USDC =
  process.env.NEXT_PUBLIC_BRIDGE_CUSTOM_FEE_USDC?.trim() ?? "0";
const BRIDGE_CUSTOM_FEE_RECIPIENT_EVM =
  process.env.NEXT_PUBLIC_BRIDGE_FEE_RECIPIENT_EVM?.trim() ??
  process.env.NEXT_PUBLIC_BRIDGE_FEE_RECIPIENT?.trim() ??
  "";
const BRIDGE_CUSTOM_FEE_RECIPIENT_SOLANA =
  process.env.NEXT_PUBLIC_BRIDGE_FEE_RECIPIENT_SOLANA?.trim() ?? "";

type BridgeCustomFeeConfig = {
  value: string;
  recipientAddress: string;
};

type BridgeFeeQuote = {
  minimumBridgeAmount: string;
  circleFee: string;
  platformFee: string;
  totalFee: string;
  totalWithFees: string;
  amountReceived: string;
  sourceDebitTotal: string;
  customFeeEnabled: boolean;
};

const formatBridgeFeeAmount = (value: number) => value.toFixed(6);

const formatBridgeCustomFeeValue = (value: number) =>
  value.toFixed(6).replace(/\.?0+$/, "");

const getBridgeProtocolFee = (tokenSymbol: string = "USDC") => {
  const feeKey = tokenSymbol?.toUpperCase?.() ?? "USDC";
  const configuredFee = Number.parseFloat(
    BRIDGE_FEE_CONFIG[feeKey] ?? BRIDGE_FEE_CONFIG.USDC,
  );

  return Number.isFinite(configuredFee) && configuredFee > 0
    ? configuredFee
    : 0;
};

const getConfiguredCustomBridgeFee = (
  sourceChain: string,
): BridgeCustomFeeConfig | null => {
  const customFeeValue = Number.parseFloat(BRIDGE_CUSTOM_FEE_AMOUNT_USDC);

  if (!Number.isFinite(customFeeValue) || customFeeValue <= 0) {
    return null;
  }

  const recipientAddress = isSolanaBridgeChain(sourceChain)
    ? BRIDGE_CUSTOM_FEE_RECIPIENT_SOLANA
    : BRIDGE_CUSTOM_FEE_RECIPIENT_EVM;
  const recipientChainType = isSolanaBridgeChain(sourceChain)
    ? "solana"
    : "evm";

  if (
    !recipientAddress ||
    !isValidAddress(recipientAddress, recipientChainType)
  ) {
    return null;
  }

  return {
    value: formatBridgeCustomFeeValue(customFeeValue),
    recipientAddress,
  };
};

const getBridgeFeeQuote = (
  fromChain: string,
  amount: string,
  tokenSymbol: string = "USDC",
  circleFeeOverride?: number,
): BridgeFeeQuote => {
  const transferAmount = Number.parseFloat(amount);
  const safeTransferAmount =
    Number.isFinite(transferAmount) && transferAmount > 0 ? transferAmount : 0;
  const circleFee =
    circleFeeOverride !== undefined &&
    Number.isFinite(circleFeeOverride) &&
    circleFeeOverride >= 0
      ? circleFeeOverride
      : getBridgeProtocolFee(tokenSymbol);
  const customFee = getConfiguredCustomBridgeFee(fromChain);
  const platformFee = customFee ? Number.parseFloat(customFee.value) : 0;
  const amountReceived = Math.max(safeTransferAmount - circleFee, 0);
  const sourceDebitTotal = safeTransferAmount + platformFee;
  const totalFee = circleFee + platformFee;

  return {
    circleFee: formatBridgeFeeAmount(circleFee),
    platformFee: formatBridgeFeeAmount(platformFee),
    totalFee: formatBridgeFeeAmount(totalFee),
    totalWithFees: formatBridgeFeeAmount(amountReceived),
    amountReceived: formatBridgeFeeAmount(amountReceived),
    sourceDebitTotal: formatBridgeFeeAmount(sourceDebitTotal),
    customFeeEnabled: platformFee > 0,
    minimumBridgeAmount: "1.00",
  };
};

type PreparedSolanaRecipient = {
  ownerAddress: string;
  ataAddress: string;
  created: boolean;
  sponsored: boolean;
  sponsorAddress: string | null;
};

const prepareSolanaBridgeRecipient = async (
  walletAddress: string,
  chainId: string = "solana",
): Promise<PreparedSolanaRecipient> => {
  const response = await fetch("/api/bridge/prepare-solana-recipient", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      walletAddress,
      chainId,
    }),
  });

  const payload = (await response.json().catch(() => null)) as {
    success?: boolean;
    error?: string;
    ownerAddress?: string;
    ataAddress?: string;
    created?: boolean;
    sponsored?: boolean;
    sponsorAddress?: string | null;
  } | null;

  if (
    !response.ok ||
    !payload?.success ||
    !payload.ataAddress ||
    !payload.ownerAddress
  ) {
    throw new Error(
      payload?.error ||
        "Unable to prepare the Solana receiving wallet right now.",
    );
  }

  return {
    ownerAddress: payload.ownerAddress,
    ataAddress: payload.ataAddress,
    created: Boolean(payload.created),
    sponsored: Boolean(payload.sponsored),
    sponsorAddress: payload.sponsorAddress ?? null,
  };
};

// Bridge request parameters
export interface BridgeRequest {
  fromChain: string;
  toChain: string;
  amount: string; // In token units (e.g., "1.00" for USDC)
  token: string; // Token symbol, usually "USDC"
  toAddress?: string; // Destination wallet address (Solana owner wallet when bridging to Solana)
  sourceAddress?: string; // Source wallet address
  // Optional: For RainbowKit/wagmi integration - provide pre-configured viem clients
  publicClient?: any; // PublicClient from usePublicClient();
  walletClient?: any; // WalletClient from useWalletClient();
  chain?: any; // Chain object from useAccount() or useChainId();
  useForwarder?: boolean; // Let Circle submit the destination mint transaction.
  onProgress?: (progress: BridgeProgressSnapshot) => void;
}

// Bridge response
export interface BridgeResponse {
  success: boolean;
  transactionHash?: string;
  sourceTransactionHash?: string;
  status?: string;
  error?: string;
  estimatedTime?: string;
  message?: string; // Additional info message (e.g., pending settlement status)
  forwarded?: boolean;
}

// Token configuration
export interface SupportedToken {
  symbol: string;
  name: string;
  decimals: number;
  chains: string[]; // Which chains support this token
  chainAddresses: Record<string, string>; // Contract address per chain
  logo?: string; // Logo image path
}

/**
 * Create a single Bridge Kit adapter for the bridgeable EVM testnets we support
 */
/**
 * Create a Bridge Kit adapter from the browser wallet provider
 * Uses Circle's createViemAdapterFromProvider factory function for user-controlled transactions
 *
 * Works with RainbowKit/wagmi injected providers
 */
async function createBridgeKitAdapter(): Promise<any> {
  // Get the EIP1193 provider from the browser window
  let provider = (window as Window & { ethereum?: EIP1193Provider }).ethereum;

  // For RainbowKit: Check if provider exists and has the expected methods
  if (provider) {
    console.log("Wallet provider found at window.ethereum", {
      hasRequest: typeof (provider as any).request === "function",
      providerName: (provider as any).name || "unknown",
    });
  } else {
    console.warn(
      "No provider at window.ethereum - checking for RainbowKit/wagmi providers",
    );

    // Try to find wagmi-injected providers
    if ((window as any).ethereum) {
      provider = (window as any).ethereum;
      console.log("Found wagmi provider at window.ethereum");
    } else {
      throw new Error(
        "No wallet provider found. Please ensure RainbowKit/MetaMask is installed and connected. " +
          "If using RainbowKit, verify the wallet connector is properly configured.",
      );
    }
  }

  if (!provider || typeof (provider as any).request !== "function") {
    throw new Error(
      "Provider does not have EIP1193 methods. " +
        "This may indicate RainbowKit is not properly connected. " +
        "Please check your wallet connection in the browser.",
    );
  }

  // Use Circle's factory function with the browser provider directly
  // This automatically handles wallet client creation from the provider
  // Route read-only calls through our API to avoid CORS issues
  // CRITICAL: let viem retry aggressively, but also extend the transaction receipt
  // wait at the adapter layer because AppKit calls waitForTransaction without a timeout.
  try {
    const adapter = await createViemAdapterFromProvider({
      provider,
      getPublicClient: ({ chain }) =>
        createPublicClient({
          chain,
          transport: http(`/api/rpc/${chain.id}`, {
            retryCount: 10, // Retry up to 10 times for slow testnets
            timeout: 180000, // Per-request RPC timeout
          }),
          // Polling settings for transaction receipt - helps with slower block times
          pollingInterval: 2000, // Poll every 2 seconds instead of viem's default
        }),
      capabilities: {
        addressContext: "user-controlled",
        supportedChains: [...SUPPORTED_EVM_CIRCLE_CHAINS],
      },
    });

    console.log(
      "Bridge adapter created successfully with extended receipt timeout",
    );
    return withBridgeTransactionTimeouts(
      withCircleChainAwareViemAdapter(adapter),
    );
  } catch (error) {
    console.error("Failed to create bridge adapter:", error);
    throw new Error(
      `Bridge adapter creation failed: ${error instanceof Error ? error.message : String(error)}. ` +
        `This may indicate the wallet provider is not compatible with Circle's Bridge Kit. ` +
        `If using RainbowKit, ensure your wallet connector supports EIP1193.`,
    );
  }
}

/**
 * Create a Bridge Kit adapter from pre-configured viem clients
 * This is specifically for RainbowKit/wagmi integration
 *
 * Usage (from a React component with wagmi hooks):
 * ```tsx
 * const publicClient = usePublicClient();
 * const { data: walletClient } = useWalletClient();
 * const adapter = await createBridgeKitAdapterFromClients(publicClient, walletClient, chain);
 * ```
 */
export async function createBridgeKitAdapterFromClients(
  publicClient: PublicClient | undefined,
  walletClient: any | undefined,
  chain: any,
): Promise<any> {
  if (!publicClient) {
    throw new Error(
      "Public client not available. RainbowKit may not be connected.",
    );
  }

  if (!walletClient) {
    throw new Error(
      "Wallet client not available. RainbowKit wallet may not be connected.",
    );
  }

  if (!chain) {
    throw new Error("Chain information is required.");
  }

  const provider = getEvmRequestProvider(walletClient);
  if (!provider) {
    throw new Error(
      "Unable to resolve the connected wallet provider from RainbowKit.",
    );
  }

  const adapter = await createViemAdapterFromProvider({
    provider,
    getPublicClient: ({ chain: requestedChain }) => {
      if (!requestedChain || requestedChain.id === publicClient.chain?.id) {
        return publicClient;
      }

      const supportedEntry = Object.entries(SUPPORTED_CHAINS).find(
        ([, config]) => config.chainId === requestedChain.id,
      );

      if (supportedEntry && !isSolanaBridgeChain(supportedEntry[0])) {
        return createEVMPublicClient(
          supportedEntry[1].chainId,
          `/api/rpc/${supportedEntry[1].chainId}`,
        );
      }

      return createPublicClient({
        chain: requestedChain,
        transport: http(`/api/rpc/${requestedChain.id}`, {
          retryCount: 10,
          timeout: 180000,
        }),
        pollingInterval: 2000,
      });
    },
    capabilities: {
      addressContext: "user-controlled",
      supportedChains: [...SUPPORTED_EVM_CIRCLE_CHAINS],
    },
  });

  console.log("Bridge adapter created from RainbowKit/wagmi clients", {
    chainId:
      walletClient.chain?.id ?? publicClient.chain?.id ?? chain?.id ?? chain,
  });
  return withBridgeTransactionTimeouts(
    withCircleChainAwareViemAdapter(adapter),
  );
}

/**
 * Initialize Circle AppKit with the bridge capability
 * AppKit is preferred over BridgeKit for better bridge support
 */
let appKitInstance: AppKit | null = null;
let evmAdapter: any = null;
let solanaAdapter: any = null;
let solanaAdapterProvider: SolanaWalletProvider | null = null;
let solanaAdapterAddress: string | null = null;

/**
 * Helper function to initialize Solana adapter from the shared wallet store
 * Returns null if a supported Solana wallet is not connected
 */
async function initializeSolanaAdapter(
  chainKey: string = "solana",
): Promise<any> {
  try {
    const rawProvider = getConnectedSolanaProvider();
    const connectedAddress = getConnectedSolanaAddress();
    const address = getSolanaProviderAddress(rawProvider, connectedAddress);

    if (!rawProvider || !address) {
      console.warn("No connected Solana wallet found in shared wallet store");
      return null;
    }

    setSolanaProviderAddress(rawProvider, address);
    const solanaRpcUrl = getSolanaBridgeRpcUrl(chainKey);
    const provider = rawProvider as Parameters<
      typeof createSolanaAdapterFromProvider
    >[0]["provider"];
    const adapter = await createSolanaAdapterFromProvider({
      provider,
      connection: createSolanaBridgeConnection(solanaRpcUrl),
      capabilities: {
        addressContext: "user-controlled",
        supportedChains: [
          isSolanaMainnetChain(chainKey) ? Solana : SolanaDevnet,
        ],
      },
    });
    console.log("Solana adapter initialized successfully", {
      address,
      rpcUrl: solanaRpcUrl,
      supportsMessageSigning: Boolean(rawProvider.signMessage),
    });
    return adapter;
  } catch (error) {
    console.warn("Failed to initialize Solana adapter:", error);
    console.warn(
      "Solana adapter initialization diagnostics:",
      getBridgeErrorDiagnostics(error),
    );
    return null;
  }
}

async function ensureEvmBridgeAdapter(
  request?: Pick<BridgeRequest, "publicClient" | "walletClient" | "chain">,
): Promise<any> {
  if (request?.publicClient && request?.walletClient) {
    return createBridgeKitAdapterFromClients(
      request.publicClient,
      request.walletClient,
      request.chain,
    );
  }

  if (evmAdapter) {
    return evmAdapter;
  }

  evmAdapter = await createBridgeKitAdapter();
  return evmAdapter;
}

async function ensureSolanaBridgeAdapter(
  chainKey: string = "solana",
): Promise<any> {
  const provider = getConnectedSolanaProvider();
  const currentAddress = getSolanaProviderAddress(
    provider,
    getConnectedSolanaAddress(),
  );

  if (!provider || !currentAddress) {
    solanaAdapter = null;
    solanaAdapterProvider = null;
    solanaAdapterAddress = null;
    return null;
  }

  solanaAdapter = await initializeSolanaAdapter(chainKey);
  solanaAdapterProvider = solanaAdapter ? provider : null;
  solanaAdapterAddress = solanaAdapter ? currentAddress : null;
  return solanaAdapter;
}

async function initializeCircleSDK(): Promise<any> {
  if (appKitInstance) {
    return appKitInstance;
  }

  try {
    appKitInstance = new AppKit({
      disableErrorReporting: true,
      tokens: getCircleBridgeTokenRegistry(),
    } as ConstructorParameters<typeof AppKit>[0]);

    console.log("Circle AppKit initialized successfully");
    return appKitInstance;
  } catch (error) {
    console.error("Failed to initialize Circle SDK:", error);
    throw new Error("Failed to initialize bridge service");
  }
}

/**
 * Create a Viem public client for EVM chains
 * Returns a configured client that can be used with Bridge Kit adapters
 */
function createEVMPublicClient(chainId: number, rpcUrl: string): PublicClient {
  const chain = VIEM_CHAIN_MAP[chainId] || {
    id: chainId,
    name: `Chain ${chainId}`,
    network: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
  };

  return createPublicClient({
    chain: chain as ViemChain,
    transport: http(rpcUrl, {
      retryCount: 10,
      timeout: 180000,
    }),
  });
}

/**
 * Bridge tokens from one chain to another
 *
 * This function executes cross-chain bridge transactions using the user's browser wallet.
 * The bridge is executed client-side with your wallet's signing capability.
 *
 * Usage:
 * const result = await bridgeTokens({
 *   fromChain: "base-sepolia",
 *   toChain: "arc-testnet",
 *   amount: "100",
 *   token: "USDC",
 *   toAddress: "0x123...",
 * });
 */
export async function bridgeTokens(
  request: BridgeRequest,
): Promise<BridgeResponse> {
  const bridgeProgress: BridgeProgressSnapshot = { events: [] };
  (window as any).__lastBridgeProgress = bridgeProgress;
  const shouldTrackEvmWalletChain = !isSolanaBridgeChain(request.fromChain);
  const initialWalletChainId = shouldTrackEvmWalletChain
    ? await getActiveWalletChainId(request.walletClient)
    : null;
  const isEvmToSolanaRoute =
    !isSolanaBridgeChain(request.fromChain) &&
    isSolanaBridgeChain(request.toChain);
  const resolvedUseForwarder = isEvmToSolanaRoute
    ? true
    : (request.useForwarder ?? DEFAULT_USE_CIRCLE_FORWARDER);

  try {
    if (!isPositiveDecimalAmount(request.amount)) {
      return {
        success: false,
        error: "Amount must be a positive number",
      };
    }

    const fromChainConfig =
      SUPPORTED_CHAINS[request.fromChain as keyof typeof SUPPORTED_CHAINS];
    const toChainConfig =
      SUPPORTED_CHAINS[request.toChain as keyof typeof SUPPORTED_CHAINS];

    if (!fromChainConfig || !toChainConfig) {
      return {
        success: false,
        error: `Unsupported chain. Supported: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`,
      };
    }

    if (!isBridgeRouteSupported(request.fromChain, request.toChain)) {
      return {
        success: false,
        error:
          "This bridge route is not supported. Source and destination must be different chains on the same network.",
      };
    }

    const unavailableRouteError = getUnavailableCircleRouteError(
      request.fromChain,
      request.toChain,
      request.token,
    );
    if (unavailableRouteError) {
      return {
        success: false,
        error: unavailableRouteError,
      };
    }

    const requestedDestinationAddress = request.toAddress
      ? normalizeWalletAddress(request.toAddress)
      : "";

    // Determine if destination is cross-chain type (EVM <-> Solana)
    const isFromEVM = !isSolanaBridgeChain(request.fromChain);
    const isToEVM = !isSolanaBridgeChain(request.toChain);
    const isChainTypeCrossover = isFromEVM !== isToEVM;

    // Validate destination address for cross-chain type transitions
    if (isChainTypeCrossover) {
      if (!requestedDestinationAddress) {
        const chainType = isToEVM ? "EVM" : "Solana";
        return {
          success: false,
          error: `Destination ${chainType} address is required when bridging from ${isFromEVM ? "EVM" : "Solana"} to ${isToEVM ? "EVM" : "Solana"}`,
        };
      }
    }

    if (requestedDestinationAddress) {
      const addressType = isToEVM ? "evm" : "solana";
      if (!isValidAddress(requestedDestinationAddress, addressType)) {
        return {
          success: false,
          error: `Invalid ${addressType.toUpperCase()} destination address`,
        };
      }
    }

    let preparedSolanaSource: PreparedSolanaRecipient | null = null;
    if (
      isSolanaBridgeChain(request.fromChain) &&
      (request.token || "USDC").toUpperCase() === "USDC"
    ) {
      const sourceSolanaAddress = getSolanaProviderAddress(
        getConnectedSolanaProvider(),
        getConnectedSolanaAddress(),
      );

      if (
        !sourceSolanaAddress ||
        !isValidAddress(sourceSolanaAddress, "solana")
      ) {
        return {
          success: false,
          error: `Solana wallet not connected. Please connect a supported Solana wallet to ${fromChainConfig.name}.`,
        };
      }

      try {
        preparedSolanaSource = await prepareSolanaBridgeRecipient(
          sourceSolanaAddress,
          request.fromChain,
        );
      } catch (error) {
        return {
          success: false,
          error: getBridgeErrorMessage(error),
        };
      }
    }

    let resolvedDestinationAddress = requestedDestinationAddress;
    let preparedSolanaRecipient: PreparedSolanaRecipient | null = null;

    if (isSolanaBridgeChain(request.toChain)) {
      if (!requestedDestinationAddress) {
        return {
          success: false,
          error: "Destination Solana address is required.",
        };
      }

      try {
        preparedSolanaRecipient = await prepareSolanaBridgeRecipient(
          requestedDestinationAddress,
          request.toChain,
        );
        // AppKit expects the Solana owner wallet address as recipientAddress;
        // it derives the USDC ATA internally when building the CCTP burn.
        resolvedDestinationAddress = preparedSolanaRecipient.ownerAddress;
      } catch (error) {
        return {
          success: false,
          error: getBridgeErrorMessage(error),
        };
      }
    }

    console.log("Bridge Request:", {
      from: fromChainConfig.name,
      to: toChainConfig.name,
      amount: request.amount,
      token: request.token,
      destination: requestedDestinationAddress,
      resolvedDestination: resolvedDestinationAddress,
      sourceChainId: fromChainConfig.chainId,
      destChainId: toChainConfig.chainId,
      hasCustomClients: !!request.publicClient,
      useForwarder: resolvedUseForwarder,
      solanaSourceAtaPrepared: Boolean(preparedSolanaSource),
      solanaSourceAta: preparedSolanaSource?.ataAddress,
      solanaSourceAtaCreated: preparedSolanaSource?.created,
      solanaSourceAtaSponsored: preparedSolanaSource?.sponsored,
      solanaSourceAtaSponsor: preparedSolanaSource?.sponsorAddress,
      solanaRecipientPrepared: Boolean(preparedSolanaRecipient),
      solanaRecipientAta: preparedSolanaRecipient?.ataAddress,
      solanaRecipientAtaSponsor: preparedSolanaRecipient?.sponsorAddress,
    });

    // Use Circle's recommended client-side bridge with browser wallet
    const kit = await initializeCircleSDK();

    // Get the proper chain objects from Circle's definitions
    const allTokens = getSupportedTokens();
    const tokenDef = allTokens.find(
      (t) => t.symbol.toLowerCase() === (request.token || "USDC").toLowerCase(),
    );

    if (!tokenDef) {
      return {
        success: false,
        error: `Unsupported token: ${request.token}`,
      };
    }
    const fromChainObj = CIRCLE_CHAIN_OBJECTS[request.fromChain];
    const toChainObj = CIRCLE_CHAIN_OBJECTS[request.toChain];

    if (!fromChainObj || !toChainObj) {
      return {
        success: false,
        error: `Chain objects not found for ${request.fromChain} or ${request.toChain}`,
      };
    }

    const useForwarder = resolvedUseForwarder;

    if (!resolvedDestinationAddress) {
      return {
        success: false,
        error: "Destination address is required",
      };
    }

    if (!isSolanaBridgeChain(request.fromChain)) {
      try {
        const provider = getEvmRequestProvider(request.walletClient);
        if (provider) {
          const accounts = (await provider.request({
            method: "eth_requestAccounts",
          })) as string[];
          console.log("Wallet accounts confirmed before bridge:", accounts[0]);
        }
      } catch (error) {
        console.warn("Could not confirm wallet accounts:", error);
      }

      try {
        await ensureWalletOnBridgeChain(
          request.fromChain,
          request.walletClient,
        );
      } catch (error) {
        return {
          success: false,
          error: getBridgeErrorMessage(error),
        };
      }
    }

    let fromAdapter: any = null;
    let toAdapter: any = null;

    if (isSolanaBridgeChain(request.fromChain)) {
      fromAdapter = await ensureSolanaBridgeAdapter(request.fromChain);
      if (!fromAdapter) {
        return {
          success: false,
          error: `Solana wallet not connected. Please connect a supported Solana wallet to ${fromChainConfig.name}.`,
        };
      }
    } else {
      fromAdapter = await ensureEvmBridgeAdapter(request);
      if (!fromAdapter) {
        return {
          success: false,
          error: "Bridge adapter not initialized. Please connect your wallet.",
        };
      }
    }

    const tokenSymbol = (request.token || "USDC").toUpperCase();
    if (tokenSymbol !== "USDC" && tokenSymbol !== "EURC") {
      return {
        success: false,
        error: `${request.token} bridging is not supported. Bridge USDC or EURC.`,
      };
    }

    const amountInMinorUnits = parseUnits(request.amount, 6);
    const customFee = getConfiguredCustomBridgeFee(request.fromChain);
    const useFastForwarding = isEvmToSolanaRoute && useForwarder;
    let fastForwardingMaxFee: bigint | null = null;

    if (useFastForwarding) {
      if (tokenSymbol !== "USDC") {
        return {
          success: false,
          error: "Circle forwarding to Solana currently supports USDC only.",
        };
      }

      if (
        !Number.isInteger(fromChainObj.cctp.domain) ||
        !Number.isInteger(toChainObj.cctp.domain)
      ) {
        throw new Error(
          "Circle chain domain is unavailable for the forwarding fee quote.",
        );
      }

      const fastForwardingFees = await getCctpFastForwardingFees(
        fromChainObj.cctp.domain,
        toChainObj.cctp.domain,
        fromChainObj.isTestnet,
      );
      fastForwardingMaxFee = calculateFastForwardingMaxFee(
        amountInMinorUnits,
        fastForwardingFees,
      );

      if (fastForwardingMaxFee >= amountInMinorUnits) {
        const minimumTransferAmount = fastForwardingMaxFee + 1n;
        return {
          success: false,
          error:
            `Circle's estimated FAST burn and forwarding fees for this route total ${formatUnits(fastForwardingMaxFee, 6)} USDC, which is not less than the transfer amount (${request.amount} USDC). ` +
            `The transfer amount must be at least ${formatUnits(minimumTransferAmount, 6)} USDC at the current quote. This is separate from Tower's platform fee, which is charged on top.`,
        };
      }
    }

    const bridgeConfig = {
      ...(fastForwardingMaxFee !== null
        ? {
            transferSpeed: "FAST" as const,
            maxFee: formatUnits(fastForwardingMaxFee, 6),
          }
        : {}),
      ...(customFee ? { customFee } : {}),
    };

    const requiresDestinationAdapter = !(
      useForwarder && resolvedDestinationAddress
    );
    if (requiresDestinationAdapter) {
      if (isSolanaBridgeChain(request.toChain)) {
        toAdapter ??= await ensureSolanaBridgeAdapter(request.toChain);
        if (!toAdapter) {
          return {
            success: false,
            error: `Solana wallet not connected. Please connect a supported Solana wallet to ${toChainConfig.name}.`,
          };
        }
      } else {
        toAdapter = await ensureEvmBridgeAdapter(request);
        if (!toAdapter) {
          return {
            success: false,
            error:
              "Destination adapter not initialized. Please ensure required wallet is connected.",
          };
        }
      }
    }

    console.log("Executing bridge with adapter:", {
      fromChain: (fromChainObj as any).name,
      toChain: (toChainObj as any).name,
      amount: request.amount,
      token: request.token,
      useForwarder,
    });

    if (!customFee) {
      const configuredCustomFeeAmount = Number.parseFloat(
        BRIDGE_CUSTOM_FEE_AMOUNT_USDC,
      );

      if (
        Number.isFinite(configuredCustomFeeAmount) &&
        configuredCustomFeeAmount > 0
      ) {
        console.warn(
          "Custom bridge fee is configured but disabled for this source chain because the recipient is missing or invalid.",
          { sourceChain: request.fromChain },
        );
      }
    }

    console.log("Starting bridge execution...");
    console.log("Bridge adapter info:", {
      fromChain: (fromChainObj as any).name,
      toChain: (toChainObj as any).name,
      adapterReady: !!fromAdapter,
      walletConnected: !!fromAdapter,
    });

    const startTime = Date.now();
    const bridgeEventHandler = (event: any) => {
      const step = typeof event?.method === "string" ? event.method : "unknown";
      const values =
        event &&
        typeof event === "object" &&
        event.values &&
        typeof event.values === "object"
          ? event.values
          : {};
      const txHash =
        typeof (values as Record<string, unknown>).txHash === "string"
          ? ((values as Record<string, unknown>).txHash as string)
          : undefined;
      const explorerUrl =
        typeof (values as Record<string, unknown>).explorerUrl === "string"
          ? ((values as Record<string, unknown>).explorerUrl as string)
          : undefined;

      bridgeProgress.lastStep = step;
      if (txHash) {
        bridgeProgress.lastTxHash = txHash;
      }
      if (explorerUrl) {
        bridgeProgress.lastExplorerUrl = explorerUrl;
      }
      bridgeProgress.events.push({ step, txHash, explorerUrl });

      (window as any).__lastBridgeProgress = bridgeProgress;
      request.onProgress?.({
        ...bridgeProgress,
        events: [...bridgeProgress.events],
      });
      console.log(`Bridge event [${step}]`, { txHash, explorerUrl, values });
    };

    let result: unknown;

    kit.on("*", bridgeEventHandler);

    try {
      const bridgeDestination: Record<string, unknown> = {
        chain: toChainObj,
      };

      if (resolvedDestinationAddress) {
        bridgeDestination.recipientAddress = resolvedDestinationAddress;
      }

      if (useForwarder && resolvedDestinationAddress) {
        bridgeDestination.useForwarder = true;
      } else {
        bridgeDestination.adapter = toAdapter;
        bridgeDestination.useForwarder = useForwarder;
      }

      const buildBridgeParams = () => ({
        from: { adapter: fromAdapter, chain: fromChainObj },
        to: bridgeDestination as any,
        amount: request.amount,
        token: tokenSymbol,
        invocationMeta: {
          tokens: getCircleBridgeTokenRegistry({
            arcMainnet:
              request.fromChain === "arc" || request.toChain === "arc",
          }),
        },
        ...(Object.keys(bridgeConfig).length > 0
          ? {
              config: bridgeConfig,
            }
          : {}),
      });

      const executeBridgeAttemptWithTimeout = async (
        actionLabel: string,
        operation: () => Promise<unknown>,
      ) => {
        let attemptTimeoutId: number | undefined;

        try {
          return await Promise.race([
            operation(),
            new Promise<never>((_, reject) => {
              attemptTimeoutId = window.setTimeout(() => {
                reject(
                  new Error(
                    `${actionLabel} timeout: Execution exceeded ${
                      BRIDGE_EXECUTION_TIMEOUT_MS / 60000
                    } minutes. The transaction may still be pending on-chain. Check your wallet or the explorer for updates.`,
                  ),
                );
              }, BRIDGE_EXECUTION_TIMEOUT_MS);
            }),
          ]);
        } finally {
          if (attemptTimeoutId) {
            window.clearTimeout(attemptTimeoutId);
          }
        }
      };

      result = await executeBridgeAttemptWithTimeout("Bridge", () =>
        kit.bridge(buildBridgeParams()),
      );

      let retryableFailedStep = getRetryableFailedBridgeStep(result);

      for (
        let retryAttempt = 1;
        retryableFailedStep && retryAttempt <= BRIDGE_RETRY_ATTEMPTS;
        retryAttempt += 1
      ) {
        const retryMessage =
          retryableFailedStep.errorMessage ||
          getBridgeErrorMessage(retryableFailedStep.error);

        console.warn("Retrying bridge after transient bridge-step failure", {
          retryAttempt,
          step: retryableFailedStep.name,
          message: retryMessage,
        });

        await waitForBridgeRetryDelay(retryAttempt);

        result = await executeBridgeAttemptWithTimeout(
          `Bridge retry ${retryAttempt}`,
          () =>
            kit.retryBridge(
              result as any,
              getBridgeRetryContext(fromAdapter, toAdapter, useForwarder),
            ),
        );

        retryableFailedStep = getRetryableFailedBridgeStep(result);
      }
    } finally {
      kit.off("*", bridgeEventHandler);
    }

    const elapsedTime = Date.now() - startTime;
    console.log(`Bridge execution completed in ${elapsedTime}ms`);
    console.log("Bridge transaction result:", result);
    console.log("Result type:", typeof result);
    console.log(
      "Result keys:",
      result && typeof result === "object"
        ? Object.keys(result as object)
        : "null/undefined",
    );
    console.log("Result state:", (result as any)?.state);

    // Don't try to stringify the whole result - it has BigInts
    // Instead log the steps array length and details
    if ((result as any)?.steps && Array.isArray((result as any).steps)) {
      console.log("Result steps count:", (result as any).steps.length);
      (result as any).steps.forEach((step: any, index: number) => {
        const stepDetails: any = {
          name: step.name,
          state: step.state,
        };
        if (step.txHash) stepDetails.txHash = step.txHash;
        if (step.forwarded !== undefined)
          stepDetails.forwarded = step.forwarded;
        if (step.error) stepDetails.error = String(step.error);
        if (step.error) {
          stepDetails.errorDiagnostics = getBridgeErrorDiagnostics(step.error);
        }
        console.log(`Step ${index} (${step.name}):`, stepDetails);
      });
    }

    // Store result globally for easy copying (without JSON.stringify)
    (window as any).__lastBridgeResult = result;
    console.log("Bridge result stored in window.__lastBridgeResult");

    // Extract transaction hash and check result status
    let txHash: string | undefined;
    let sourceTxHash: string | undefined;
    let errorMessage: string | undefined;
    let pendingMessage: string | undefined;
    let shouldTreatAsPending = false;
    let wasForwarded = resolvedUseForwarder;

    if (typeof result === "string") {
      // If result is just a string, it's the transaction hash
      txHash = result;
    } else if (result && typeof result === "object") {
      // Check various possible hash properties at root level
      const resultObj = result as any;
      if (typeof resultObj.transactionHash === "string") {
        txHash = resultObj.transactionHash;
      } else if (typeof resultObj.hash === "string") {
        txHash = resultObj.hash;
      } else if (typeof resultObj.txHash === "string") {
        txHash = resultObj.txHash;
      }

      // If no tx hash at root level, check steps array
      if (Array.isArray(resultObj.steps)) {
        // Prioritize the "mint" step (final transaction), otherwise take the last step with a txHash
        let lastTxHash: string | undefined;
        for (const step of resultObj.steps) {
          const stepTxHash =
            typeof step.txHash === "string"
              ? step.txHash
              : typeof step.transactionHash === "string"
                ? step.transactionHash
                : undefined;

          if (
            !sourceTxHash &&
            isBridgeSourceTransactionStep(step.name) &&
            stepTxHash
          ) {
            sourceTxHash = stepTxHash;
          }

          if (!stepTxHash) {
            continue;
          }

          lastTxHash = stepTxHash;

          if (!txHash && step.name === "mint") {
            txHash = stepTxHash;
            break;
          }
        }

        if (!txHash && lastTxHash) {
          txHash = lastTxHash;
        }
      }

      // Check steps array for any errors or stuck pending steps
      if (Array.isArray(resultObj.steps)) {
        wasForwarded =
          resolvedUseForwarder ||
          resultObj.steps.some((step: any) => step?.forwarded === true);

        // First check for explicit errors
        const failedStep = resultObj.steps.find(
          (step: any) => step.state === "error",
        );
        if (failedStep?.error) {
          const stepError = failedStep.error;
          // Extract meaningful error message
          if (typeof stepError === "object") {
            errorMessage =
              (stepError as any).message ||
              (stepError as any).details ||
              String(stepError);
          } else {
            errorMessage = String(stepError);
          }
        }

        // Check for stuck pending steps (especially burn and mint which are longer operations)
        const pendingSteps = resultObj.steps.filter(
          (step: any) => step.state === "pending",
        );
        if (pendingSteps.length > 0) {
          const stuckSteps = pendingSteps.map((s: any) => s.name).join(", ");

          // If we have multiple pending steps or non-approve pending steps, this likely means they're stuck
          if (
            pendingSteps.length > 1 ||
            (pendingSteps[0]?.name !== "approve" &&
              resultObj.state !== "pending")
          ) {
            errorMessage =
              errorMessage ||
              `Bridge appeared to complete but steps are still pending: ${stuckSteps}. ` +
                `This may indicate the transaction is waiting for on-chain settlement. ` +
                `Check the explorer or try again in a few moments.`;
          }
        }

        const submittedBridgeStep = [...resultObj.steps]
          .reverse()
          .find(
            (step: any) =>
              ACTIONABLE_PENDING_BRIDGE_STEPS.has(step.name) &&
              typeof step.txHash === "string",
          );

        const actionableFailedStep = resultObj.steps.find(
          (step: any) =>
            step.state === "error" &&
            ACTIONABLE_PENDING_BRIDGE_STEPS.has(step.name),
        );

        const actionableFailedStepMessage =
          actionableFailedStep?.errorMessage ||
          (actionableFailedStep?.error
            ? getBridgeErrorMessage(actionableFailedStep.error)
            : "");

        if (
          submittedBridgeStep?.txHash &&
          (isBridgeTimeoutError(actionableFailedStepMessage) ||
            isBridgeNetworkError(actionableFailedStepMessage) ||
            isBridgeRelayerFailureMessage(actionableFailedStepMessage))
        ) {
          shouldTreatAsPending = true;
          txHash = txHash || submittedBridgeStep.txHash;
          pendingMessage = createPendingBridgeMessage({
            lastStep: actionableFailedStep?.name || submittedBridgeStep.name,
            lastTxHash: submittedBridgeStep.txHash,
            events: [],
          });
        }
      }

      // Circle's response has a 'state' field: 'success', 'pending', 'error', or 'failed'
      // But also check if any step failed (steps might show errors even if state is 'success')
      if (resultObj.state === "error" || resultObj.state === "failed") {
        errorMessage =
          errorMessage || resultObj.error || "Bridge transaction failed";
      } else if (resultObj.state === "success" && errorMessage) {
        // Steps had errors even though state says success - treat as failure
        errorMessage = `Step failed: ${errorMessage}`;
      }
    }

    if (shouldTreatAsPending) {
      return {
        success: true,
        status: "pending",
        estimatedTime: estimateBridgeTime(request.fromChain, request.toChain),
        transactionHash: txHash,
        sourceTransactionHash: sourceTxHash ?? txHash,
        forwarded: wasForwarded,
        message:
          pendingMessage ||
          "Bridge transaction was submitted and is still settling on-chain.",
      };
    }

    // Success only if state is success AND no step errors
    const isSuccess = (result as any)?.state === "success" && !errorMessage;
    const isPending = (result as any)?.state === "pending";

    if (isSuccess && txHash) {
      return {
        success: true,
        status: "completed",
        estimatedTime: estimateBridgeTime(request.fromChain, request.toChain),
        transactionHash: txHash,
        sourceTransactionHash: sourceTxHash,
        forwarded: wasForwarded,
      };
    } else if (isSuccess) {
      // State is success but no tx hash - still pending attestation
      return {
        success: true,
        status: wasForwarded ? "completed" : "pending",
        estimatedTime: estimateBridgeTime(request.fromChain, request.toChain),
        transactionHash: txHash,
        sourceTransactionHash: sourceTxHash,
        forwarded: wasForwarded,
        message: wasForwarded
          ? "Circle Forwarder confirmed the destination mint."
          : undefined,
      };
    } else if (isPending) {
      // Bridge is in pending state - it's processing but not yet complete
      // This is normal for burn/mint steps which require on-chain settlement
      const pendingSteps =
        (result as any)?.steps
          ?.filter((s: any) => s.state === "pending")
          .map((s: any) => s.name)
          .join(", ") || "settlement";

      return {
        success: true,
        status: "pending",
        estimatedTime: estimateBridgeTime(request.fromChain, request.toChain),
        transactionHash: txHash,
        sourceTransactionHash: sourceTxHash ?? txHash,
        forwarded: wasForwarded,
        message: `Bridge is in progress. Waiting for ${pendingSteps} to complete on-chain. This typically takes 2-5 minutes.`,
      };
    } else {
      return {
        success: false,
        error:
          errorMessage ||
          `Bridge failed with state: ${(result as any)?.state || "unknown"}`,
      };
    }
  } catch (error) {
    console.error("Bridge error:", error);
    console.error(
      "Bridge error diagnostics:",
      getBridgeErrorDiagnostics(error),
    );

    const rawErrorMessage = getBridgeErrorMessage(error);

    if (
      bridgeProgress.lastTxHash &&
      hasActionableBridgeProgress(bridgeProgress) &&
      (isBridgeTimeoutError(rawErrorMessage) ||
        isBridgeNetworkError(rawErrorMessage) ||
        isBridgeRelayerFailureMessage(rawErrorMessage))
    ) {
      const sourceBridgeTxHash = [...bridgeProgress.events]
        .reverse()
        .find(
          (event) =>
            isBridgeSourceTransactionStep(event.step) &&
            typeof event.txHash === "string",
        )?.txHash;

      console.warn(
        "Treating bridge error as pending because a bridge transaction was already submitted",
        {
          error: rawErrorMessage,
          lastStep: bridgeProgress.lastStep,
          txHash: bridgeProgress.lastTxHash,
        },
      );

      return {
        success: true,
        status: "pending",
        estimatedTime: estimateBridgeTime(request.fromChain, request.toChain),
        transactionHash: bridgeProgress.lastTxHash,
        sourceTransactionHash: sourceBridgeTxHash ?? bridgeProgress.lastTxHash,
        forwarded: resolvedUseForwarder,
        message: createPendingBridgeMessage(bridgeProgress),
      };
    }

    let errorMessage = rawErrorMessage;

    // Check for specific error patterns
    if (isBridgeTimeoutError(rawErrorMessage)) {
      errorMessage =
        "Bridge transaction is taking longer than expected. The bridge may still be pending on-chain. Check your wallet for pending transactions, then try again once the network settles.";
    } else if (isBridgeNetworkError(rawErrorMessage)) {
      errorMessage =
        "Network connection error during bridge. The RPC endpoint may be unavailable. Check your connection and try again.";
    } else if (isBridgeRelayerFailureMessage(rawErrorMessage)) {
      errorMessage =
        "Circle is still finalizing the destination mint for this bridge. Check the recipient wallet balance before trying again.";
    } else if (
      rawErrorMessage.toLowerCase().includes("user rejected") ||
      rawErrorMessage.toLowerCase().includes("rejected")
    ) {
      errorMessage =
        "Transaction rejected by wallet. Please check your wallet and try again.";
    } else if (rawErrorMessage.toLowerCase().includes("insufficient")) {
      errorMessage =
        "Insufficient balance or insufficient gas for bridge transaction.";
    }

    console.error("Final bridge error message:", errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  } finally {
    if (shouldTrackEvmWalletChain) {
      await restoreActiveWalletChain(
        initialWalletChainId,
        request.walletClient,
      );
    }
  }
}

/**
 * Get a viem public client for a specific chain
 * Can be used to initialize Bridge Kit ViemAdapter
 */
export function getViemClient(chainId: string): PublicClient | null {
  const chainConfig =
    SUPPORTED_CHAINS[chainId as keyof typeof SUPPORTED_CHAINS];
  if (!chainConfig || isSolanaBridgeChain(chainId)) return null;

  return createEVMPublicClient(chainConfig.chainId, chainConfig.rpcUrl);
}

/**
 * Validate if a bridge route is supported
 */
export function isCircleBridgeRouteReady(
  fromChain: string,
  toChain: string,
  tokenSymbol: string = "USDC",
): boolean {
  if (!CIRCLE_CHAIN_OBJECTS[fromChain] || !CIRCLE_CHAIN_OBJECTS[toChain]) {
    return false;
  }

  return (
    isBridgeTokenSupportedOnChain(fromChain, tokenSymbol) &&
    isBridgeTokenSupportedOnChain(toChain, tokenSymbol)
  );
}

export function getUnavailableCircleRouteError(
  fromChain: string,
  toChain: string,
  tokenSymbol: string = "USDC",
): string | null {
  if (isCircleBridgeRouteReady(fromChain, toChain, tokenSymbol)) {
    return null;
  }

  const symbol = tokenSymbol.toUpperCase();
  if (symbol === "EURC") {
    if (isSolanaBridgeChain(fromChain) || isSolanaBridgeChain(toChain)) {
      return "EURC bridging is EVM-only. Circle CCTP expanded assets do not support Solana.";
    }

    return "EURC can be bridged between Ethereum, Base, and Arc on mainnet, or Ethereum Sepolia, Base Sepolia, and Arc Testnet.";
  }

  return "This bridge route is not available.";
}

export function isBridgeRouteSupported(
  fromChain: string,
  toChain: string,
): boolean {
  const fromSupported = fromChain in SUPPORTED_CHAINS;
  const toSupported = toChain in SUPPORTED_CHAINS;
  const sameChain = fromChain === toChain;
  const fromMode = getBridgeNetworkMode(fromChain);
  const toMode = getBridgeNetworkMode(toChain);

  return (
    fromSupported &&
    toSupported &&
    !sameChain &&
    fromMode !== null &&
    fromMode === toMode
  );
}

/**
 * Get supported bridge routes
 */
export function getSupportedBridgeRoutes(): Array<{
  from: string;
  to: string;
  fromName: string;
  toName: string;
}> {
  const routes: Array<{
    from: string;
    to: string;
    fromName: string;
    toName: string;
  }> = [];

  Object.entries(SUPPORTED_CHAINS).forEach(([fromChainId, fromConfig]) => {
    Object.entries(SUPPORTED_CHAINS).forEach(([toChainId, toConfig]) => {
      if (isBridgeRouteSupported(fromChainId, toChainId)) {
        routes.push({
          from: fromChainId,
          to: toChainId,
          fromName: fromConfig.name,
          toName: toConfig.name,
        });
      }
    });
  });

  return routes;
}

/**
 * Get bridge fees for a specific route and amount.
 * Circle's protocol fee is deducted from the bridged amount, while Tower's
 * custom fee is added on top of the source-chain wallet debit when configured.
 */
export async function getBridgeFees(
  fromChain: string,
  toChain: string,
  amount: string,
  tokenSymbol: string = "USDC",
): Promise<BridgeFeeQuote> {
  const fallbackQuote = getBridgeFeeQuote(fromChain, amount, tokenSymbol);
  const normalizedTokenSymbol = tokenSymbol.toUpperCase();
  const fromChainObj = CIRCLE_CHAIN_OBJECTS[fromChain];
  const toChainObj = CIRCLE_CHAIN_OBJECTS[toChain];

  // The bridge UI always uses Circle's forwarder. Mirror the provider's
  // high-tier quote here so the displayed receive amount and its minimum are
  // not based on the old, fixed protocol-fee approximation.
  if (
    normalizedTokenSymbol !== "USDC" ||
    fromChain === toChain ||
    !fromChainObj ||
    !toChainObj ||
    !Number.isInteger(fromChainObj.cctp.domain) ||
    !Number.isInteger(toChainObj.cctp.domain)
  ) {
    return fallbackQuote;
  }

  try {
    const amountInMinorUnits = parseUnits(amount, 6);
    if (amountInMinorUnits <= 0n) {
      return fallbackQuote;
    }

    const fees = await getCctpFastForwardingFees(
      fromChainObj.cctp.domain,
      toChainObj.cctp.domain,
      fromChainObj.isTestnet,
    );
    const circleFee = Number(
      formatUnits(calculateFastForwardingMaxFee(amountInMinorUnits, fees), 6),
    );

    return Number.isFinite(circleFee)
      ? getBridgeFeeQuote(fromChain, amount, tokenSymbol, circleFee)
      : fallbackQuote;
  } catch (error) {
    // Fee quotation is informational. The bridge execution path always obtains
    // a fresh quote and remains the authoritative minimum-amount check.
    console.warn("Unable to obtain Circle forwarding fee quote:", error);
    return fallbackQuote;
  }
}

/**
 * Get supported tokens for bridging
 * Can filter by chain if needed
 */
export function getSupportedTokens(filterByChain?: string): SupportedToken[] {
  const chainEntries = Object.entries(SUPPORTED_CHAINS);
  const usdcAddresses = Object.fromEntries(
    chainEntries.map(([id, config]) => [id, config.usdcAddress]),
  );
  const allTokens: SupportedToken[] = [
    {
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      chains: chainEntries.map(([id]) => id),
      chainAddresses: usdcAddresses,
      logo: "/assets/usdc.svg",
    },
    {
      symbol: "EURC",
      name: "Euro Coin",
      decimals: 6,
      chains: Object.keys(BRIDGE_EURC_ADDRESSES),
      chainAddresses: { ...BRIDGE_EURC_ADDRESSES },
      logo: "/assets/eurc.svg",
    },
  ];

  if (filterByChain && filterByChain !== "all") {
    return allTokens.filter((token) => token.chains.includes(filterByChain));
  }

  return allTokens;
}

/**
 * Get token address for a specific chain
 */
export function getTokenAddressForChain(
  tokenSymbol: string,
  chainId: string,
): string | null {
  const tokens = getSupportedTokens();
  const token = tokens.find((t) => t.symbol === tokenSymbol);

  if (!token) return null;
  return token.chainAddresses[chainId] || null;
}

/**
 * Get the default USDC token configuration
 */
export function getUSDCToken(): SupportedToken {
  const tokens = getSupportedTokens();
  const usdc = tokens.find((t) => t.symbol === "USDC");
  if (!usdc) {
    throw new Error("USDC token not found in supported tokens");
  }
  return usdc;
}

/**
 * Estimate bridge time between chains
 */
export function estimateBridgeTime(fromChain: string, toChain: string): string {
  // Different chains have different settlement times
  const timeMap: Record<string, string> = {
    "arc-testnet": "1-2 minutes",
    arc: "1-2 minutes",
    "base-sepolia": "2-5 minutes",
    base: "2-5 minutes",
    "optimism-sepolia": "3-7 minutes",
    optimism: "3-7 minutes",
    "avalanche-fuji": "2-5 minutes",
    avalanche: "2-5 minutes",
    "arbitrum-sepolia": "2-5 minutes",
    arbitrum: "2-5 minutes",
    solana: "5-15 seconds",
    "solana-mainnet": "5-15 seconds",
  };

  return timeMap[toChain] || "2-5 minutes";
}

/**
 * Format bridge amount to proper decimal places
 */
export function formatBridgeAmount(
  amount: string,
  decimals: number = 6,
): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return "0.00";
  return num.toFixed(decimals);
}

/**
 * Remove whitespace and invisible clipboard characters that commonly sneak into pasted wallet addresses.
 */
export function normalizeWalletAddress(address: string): string {
  return address.replace(/[\s\u200B-\u200D\uFEFF]/g, "").trim();
}
/**
 * Validate wallet address format based on chain
 */
export function isValidAddress(
  address: string,
  chainType: "evm" | "solana",
): boolean {
  const normalizedAddress = normalizeWalletAddress(address);

  if (chainType === "evm") {
    if (!/^0x[a-fA-F0-9]{40}$/.test(normalizedAddress)) {
      return false;
    }

    return (
      normalizedAddress.toLowerCase() !==
      "0x0000000000000000000000000000000000000000"
    );
  } else if (chainType === "solana") {
    // Solana address: base58 (no 0, O, I, l), uppercase and lowercase, 32-44 characters
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(normalizedAddress);
  }
  return false;
}

export default {
  bridgeTokens,
  isBridgeRouteSupported,
  isCircleBridgeRouteReady,
  getUnavailableCircleRouteError,
  getSupportedBridgeRoutes,
  getSupportedTokens,
  getTokenAddressForChain,
  getUSDCToken,
  getBridgeFees,
  estimateBridgeTime,
  formatBridgeAmount,
  normalizeWalletAddress,
  isValidAddress,
  getViemClient,
  createEVMPublicClient: createEVMPublicClient,
  initializeCircleSDK,
  SUPPORTED_CHAINS,
  VIEM_CHAIN_MAP,
};
