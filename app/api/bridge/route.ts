/**
 * Server-side Bridge API Route
 * 
 * Handles bridge requests from the client via a server API.
 * This avoids CORS and RPC connectivity issues that occur with client-side calls.
 */

import { NextRequest, NextResponse } from "next/server";
import { BridgeKit } from "@circle-fin/bridge-kit";
import { ViemAdapter } from "@circle-fin/adapter-viem-v2";
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
  Sonic,
  SonicTestnet,
  Unichain,
  UnichainSepolia,
} from "@circle-fin/bridge-kit/chains";
import { createPublicClient, createWalletClient, http, isAddress, zeroAddress, Chain as ViemChain } from "viem";
import { ARC_MAINNET_PUBLIC_RPC_URL } from "@/lib/arcNetwork";
import {
  ArcMainnet,
  getCircleBridgeTokenRegistry,
  withCircleChainAwareViemAdapter,
} from "@/lib/circleArcMainnet";
import {
  BRIDGE_EURC_ADDRESSES,
  BRIDGE_USDC_ADDRESSES,
  getBridgeNetworkMode,
} from "@/lib/bridgeNetworks";
import { isPositiveDecimalAmount } from "@/lib/positiveAmount";
import { isEvmBridgeEnabled } from "@/lib/bridgeEnabled";

const getSupportedTokens = () => [
  {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    chainAddresses: BRIDGE_USDC_ADDRESSES,
  },
  {
    symbol: "EURC",
    name: "Euro Coin",
    decimals: 6,
    chainAddresses: BRIDGE_EURC_ADDRESSES,
  },
];


const RETRYABLE_RPC_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

const DIRECT_RPC_URLS: Record<number, string> = {
  1: "https://ethereum.publicnode.com",
  10: "https://mainnet.optimism.io",
  130: "https://mainnet.unichain.org",
  137: "https://polygon-rpc.com",
  146: "https://rpc.soniclabs.com",
  8453: "https://mainnet.base.org",
  43114: "https://api.avax.network/ext/bc/C/rpc",
  42161: "https://arb1.arbitrum.io/rpc",
  59144: "https://rpc.linea.build",
  5042: ARC_MAINNET_PUBLIC_RPC_URL,
  5042002: "https://rpc.testnet.arc.io",
  84532: "https://sepolia.base.org",
  11155420: "https://sepolia.optimism.io",
  43113: "https://api.avax-test.network/ext/bc/C/rpc",
  421614: "https://sepolia-rollup.arbitrum.io/rpc",
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
  59141: "https://rpc.sepolia.linea.build",
  80002: "https://rpc-amoy.polygon.technology",
  14601: "https://rpc.testnet.soniclabs.com",
  1301: "https://sepolia.unichain.org",
};

const getBridgeRpcUrl = (chainId: number) => {
  const directRpc = DIRECT_RPC_URLS[chainId];
  if (directRpc) return directRpc;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${baseUrl}/api/rpc/${chainId}`;
};

const getBridgeRpcUrls = (chainId: number) => {
  const primaryUrl = getBridgeRpcUrl(chainId);
  return [primaryUrl];
};


// Map chain IDs to chain name keys for token lookup
const CHAIN_ID_TO_TOKEN_KEY: Record<number, string> = {
  1: "ethereum",
  10: "optimism",
  130: "unichain",
  137: "polygon",
  146: "sonic",
  8453: "base",
  43114: "avalanche",
  42161: "arbitrum",
  59144: "linea",
  5042: "arc",
  5042002: "arc-testnet",
  84532: "base-sepolia",
  11155420: "optimism-sepolia",
  43113: "avalanche-fuji",
  421614: "arbitrum-sepolia",
  11155111: "ethereum-sepolia",
  59141: "linea-sepolia",
  80002: "polygon-amoy",
  14601: "sonic-testnet",
  1301: "unichain-sepolia",
};

// Map chain IDs to Circle chain identifiers
const CHAIN_ID_TO_CIRCLE_CHAIN: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  130: "Unichain",
  137: "Polygon",
  146: "Sonic",
  8453: "Base",
  43114: "Avalanche",
  42161: "Arbitrum",
  59144: "Linea",
  5042: "Arc",
  5042002: "Arc_Testnet",
  84532: "Base_Sepolia",
  11155420: "Optimism_Sepolia",
  43113: "Avalanche_Fuji",
  421614: "Arbitrum_Sepolia",
  11155111: "Ethereum_Sepolia",
  59141: "Linea_Sepolia",
  80002: "Polygon_Amoy_Testnet",
  14601: "Sonic_Testnet",
  1301: "Unichain_Sepolia",
};

// Map Circle's chain definitions to their actual viem Chain objects
const CIRCLE_CHAIN_OBJECTS = {
  Ethereum,
  Optimism,
  Unichain,
  Polygon,
  Sonic,
  Base,
  Avalanche,
  Arbitrum,
  Linea,
  Arc: ArcMainnet,
  Arc_Testnet: ArcTestnet,
  Base_Sepolia: BaseSepolia,
  Optimism_Sepolia: OptimismSepolia,
  Avalanche_Fuji: AvalancheFuji,
  Arbitrum_Sepolia: ArbitrumSepolia,
  Ethereum_Sepolia: EthereumSepolia,
  Linea_Sepolia: LineaSepolia,
  Polygon_Amoy_Testnet: PolygonAmoy,
  Sonic_Testnet: SonicTestnet,
  Unichain_Sepolia: UnichainSepolia,
} as const;

const isUsableEvmRecipient = (address: string) =>
  isAddress(address) && address.toLowerCase() !== zeroAddress.toLowerCase();

export interface BridgeRequestBody {
  fromChainId: number;
  toChainId: number;
  amount: string;
  token: string;
  recipientAddress: string;
  senderAddress?: string;
  useForwarder?: boolean;
}

export interface BridgeResponseBody {
  success: boolean;
  transactionHash?: string;
  status?: string;
  error?: string;
  estimatedTime?: string;
}

/**
 * Create a Bridge Kit adapter with custom RPC endpoints for server-side use
 */
async function createServerBridgeAdapter(): Promise<any> {
  // Get all supported chains as full Viem Chain objects with all properties
  const supportedChains = Object.values(CIRCLE_CHAIN_OBJECTS);

  const adapterOptions = {
    getPublicClient: ({ chain }: { chain: ViemChain }) => {
      const rpcUrls = getBridgeRpcUrls(chain.id);
      if (!rpcUrls.length) {
        throw new Error(`No RPC configured for chain: ${chain.name} (${chain.id})`);
      }
      return createPublicClient({
        chain,
        transport: http(rpcUrls[0], {
          retryCount: 5,
          timeout: 30000, // 30 second timeout for server-side
        }),
      });
    },
    getWalletClient: ({ chain }: { chain: ViemChain }) => {
      const rpcUrls = getBridgeRpcUrls(chain.id);
      if (!rpcUrls.length) {
        throw new Error(`No RPC configured for chain: ${chain.name} (${chain.id})`);
      }
      return createWalletClient({
        chain,
        transport: http(rpcUrls[0], {
          retryCount: 5,
          timeout: 30000,
        }),
        account: undefined,
      });
    },
  };

  const capabilities = {
    addressContext: 'developer-controlled' as const,
    supportedChains,
  };

  return withCircleChainAwareViemAdapter(
    new (ViemAdapter as any)(adapterOptions, capabilities),
  );
}

/**
 * POST /api/bridge
 * 
 * Initiates a bridge transaction on the server-side.
 * 
 * Request body:
 * {
 *   fromChainId: number,
 *   toChainId: number,
 *   amount: string,
 *   token: string,
 *   recipientAddress: string
 * }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    if (!isEvmBridgeEnabled()) {
      return NextResponse.json(
        { success: false, error: "EVM bridging is temporarily disabled." },
        { status: 503 },
      );
    }

    const body = (await request.json()) as BridgeRequestBody;

    // Validate request
    if (
      !body.fromChainId ||
      !body.toChainId ||
      !body.amount ||
      !body.token ||
      !body.recipientAddress
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields: fromChainId, toChainId, amount, token, recipientAddress",
        },
        { status: 400 }
      );
    }

    if (!isPositiveDecimalAmount(body.amount)) {
      return NextResponse.json(
        {
          success: false,
          error: "Amount must be a positive number",
        },
        { status: 400 }
      );
    }

    if (!isUsableEvmRecipient(body.recipientAddress)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid recipient address",
        },
        { status: 400 }
      );
    }

    if (body.senderAddress && !isUsableEvmRecipient(body.senderAddress)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid sender address",
        },
        { status: 400 }
      );
    }

    const fromTokenKey = CHAIN_ID_TO_TOKEN_KEY[body.fromChainId];
    const toTokenKey = CHAIN_ID_TO_TOKEN_KEY[body.toChainId];
    const fromMode = getBridgeNetworkMode(fromTokenKey);
    const toMode = getBridgeNetworkMode(toTokenKey);

    if (!fromTokenKey || !toTokenKey || !fromMode || fromMode !== toMode) {
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported chain. From: ${body.fromChainId}, To: ${body.toChainId}`,
        },
        { status: 400 }
      );
    }

    const tokenSymbol = String(body.token || "USDC").toUpperCase();
    const tokenAddresses =
      tokenSymbol === "EURC"
        ? BRIDGE_EURC_ADDRESSES
        : tokenSymbol === "USDC"
          ? BRIDGE_USDC_ADDRESSES
          : null;

    if (
      !tokenAddresses ||
      !tokenAddresses[fromTokenKey] ||
      !tokenAddresses[toTokenKey]
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            tokenSymbol === "EURC"
              ? "EURC can be bridged between Ethereum, Base, and Arc on mainnet, or Ethereum Sepolia, Base Sepolia, and Arc Testnet."
              : `Token ${body.token} not available on the selected route`,
        },
        { status: 400 }
      );
    }

    const fromCircleChain = CHAIN_ID_TO_CIRCLE_CHAIN[body.fromChainId];
    const toCircleChain = CHAIN_ID_TO_CIRCLE_CHAIN[body.toChainId];

    if (!fromCircleChain || !toCircleChain) {
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported chain. From: ${body.fromChainId}, To: ${body.toChainId}`,
        },
        { status: 400 }
      );
    }

    console.log("Server-side bridge request:", {
      from: fromCircleChain,
      to: toCircleChain,
      amount: body.amount,
      token: body.token,
      recipient: body.recipientAddress,
    });

    // Initialize BridgeKit
    const kit = new BridgeKit();

    // Create adapter with server-side RPC configuration
    const adapter = await createServerBridgeAdapter();

    // Execute the bridge transaction
    // Use viem Chain objects from Circle's chain definitions
    const fromChainObj = CIRCLE_CHAIN_OBJECTS[fromCircleChain as keyof typeof CIRCLE_CHAIN_OBJECTS];
    const toChainObj = CIRCLE_CHAIN_OBJECTS[toCircleChain as keyof typeof CIRCLE_CHAIN_OBJECTS];

    if (!fromChainObj || !toChainObj) {
      return NextResponse.json(
        {
          success: false,
          error: `Chain object not found for ${fromCircleChain} or ${toCircleChain}`,
        },
        { status: 400 }
      );
    }

    // Use sender address from request or default to recipient (for testing)
    const senderAddress = body.senderAddress || body.recipientAddress;

    // Get token address from supported tokens
    const allTokens = getSupportedTokens();
    const tokenDef = allTokens.find(
      (t) => t.symbol.toLowerCase() === (body.token || "USDC").toLowerCase()
    );

    if (!tokenDef) {
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported token: ${body.token}`,
        },
        { status: 400 }
      );
    }

    // Get token address for source chain
    const fromChainTokenKey = CHAIN_ID_TO_TOKEN_KEY[body.fromChainId];
    const tokenAddress = tokenDef.chainAddresses[fromChainTokenKey];

    if (!tokenAddress) {
      return NextResponse.json(
        {
          success: false,
          error: `Token ${body.token} not available on source chain`,
        },
        { status: 400 }
      );
    }

    const result = await (kit.bridge as any)({
      from: {
        adapter,
        chain: fromChainObj,
        address: senderAddress,
      },
      to: {
        chain: toChainObj,
        recipientAddress: body.recipientAddress,
        useForwarder: body.useForwarder ?? true,
      },
      amount: body.amount,
      token: tokenSymbol,
      invocationMeta: {
        tokens: getCircleBridgeTokenRegistry({
          arcMainnet: body.fromChainId === 5042 || body.toChainId === 5042,
        }),
      },
    });

    console.log("Bridge transaction result type:", typeof result);
    console.log("Bridge transaction result keys:", result ? Object.keys(result) : "null/undefined");
    console.log("Bridge transaction result:", JSON.stringify(result, null, 2));

    // Extract transaction hash from result - ensure it's a string
    let txHash: string | undefined;
    if (typeof result === "string") {
      // Result is directly a hash string
      txHash = result;
    } else if (result && typeof result === "object") {
      // Try common hash properties
      if (typeof result.transactionHash === "string") {
        txHash = result.transactionHash;
      } else if (typeof result.hash === "string") {
        txHash = result.hash;
      } else if (typeof result.txHash === "string") {
        txHash = result.txHash;
      }
      // If still no hash found, don't set it
    }

    return NextResponse.json(
      {
        success: true,
        transactionHash: txHash, // Will be undefined if no hash found
        status: "pending",
        estimatedTime: "2-5 minutes",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Bridge API error:", error);

    let errorMessage = "Unknown bridge error";
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === "string") {
      errorMessage = error;
    } else if (error && typeof error === "object" && "message" in error) {
      errorMessage = String((error as any).message);
    }

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
