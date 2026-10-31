import { NextRequest, NextResponse } from "next/server";
import { isFrontendBrowserRequest } from "@/lib/server/frontendRequestGuard";
import {
  getRpcClientIp,
  inspectRpcProxyRequest,
} from "@/lib/server/rpcProxyGuard";

export const dynamic = "force-dynamic";

const splitRpcEnv = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const uniqueRpcEndpoints = (...lists: string[][]) =>
  Array.from(new Set(lists.flat().filter(Boolean)));

const SOLANA_RPC_ENDPOINTS = uniqueRpcEndpoints(
  splitRpcEnv(process.env.SOLANA_DEVNET_RPC_URLS),
  splitRpcEnv(process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URLS),
  splitRpcEnv(process.env.SOLANA_RPC_URLS),
  splitRpcEnv(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS),
  [
    process.env.SOLANA_DEVNET_RPC_URL,
    process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL,
    process.env.SOLANA_RPC_URL,
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
  ].filter((value): value is string => Boolean(value && value.trim())),
  ["https://api.devnet.solana.com"],
);

const SOLANA_MAINNET_RPC_ENDPOINTS = uniqueRpcEndpoints(
  splitRpcEnv(process.env.SOLANA_MAINNET_RPC_URLS),
  splitRpcEnv(process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URLS),
  [
    process.env.SOLANA_MAINNET_RPC_URL,
    process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL,
  ].filter((value): value is string => Boolean(value && value.trim())),
  ["https://api.mainnet-beta.solana.com"],
);

const RETRYABLE_RPC_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const RPC_RETRY_DELAY_MS = 400;

const RPC_ENDPOINTS: Record<string, string[]> = {
  "1": uniqueRpcEndpoints(
    splitRpcEnv(process.env.ETHEREUM_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_ETHEREUM_RPC_URLS),
    [
      "https://ethereum-rpc.publicnode.com",
      "https://ethereum.publicnode.com",
      "https://eth.llamarpc.com",
      "https://cloudflare-eth.com",
    ],
  ),
  "10": uniqueRpcEndpoints(
    splitRpcEnv(process.env.OPTIMISM_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_OPTIMISM_RPC_URLS),
    ["https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com"],
  ),
  "130": uniqueRpcEndpoints(
    splitRpcEnv(process.env.UNICHAIN_MAINNET_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_UNICHAIN_MAINNET_RPC_URLS),
    ["https://mainnet.unichain.org", "https://unichain-rpc.publicnode.com"],
  ),
  "1301": uniqueRpcEndpoints(
    splitRpcEnv(process.env.UNICHAIN_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_UNICHAIN_RPC_URLS),
    ["https://sepolia.unichain.org", "https://unichain-sepolia-rpc.publicnode.com"],
  ),
  "137": uniqueRpcEndpoints(
    splitRpcEnv(process.env.POLYGON_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_POLYGON_RPC_URLS),
    ["https://polygon.drpc.org", "https://polygon-rpc.com"],
  ),
  "146": uniqueRpcEndpoints(
    splitRpcEnv(process.env.SONIC_MAINNET_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_SONIC_MAINNET_RPC_URLS),
    ["https://rpc.soniclabs.com", "https://sonic-rpc.publicnode.com"],
  ),
  "14601": uniqueRpcEndpoints(
    splitRpcEnv(process.env.SONIC_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_SONIC_RPC_URLS),
    ["https://rpc.testnet.soniclabs.com"],
  ),
  "8453": uniqueRpcEndpoints(
    splitRpcEnv(process.env.BASE_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_BASE_RPC_URLS),
    ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
  ),
  "43113": uniqueRpcEndpoints(
    splitRpcEnv(process.env.AVALANCHE_FUJI_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_AVALANCHE_FUJI_RPC_URLS),
    [
      "https://api.avax-test.network/ext/bc/C/rpc",
      "https://avax-fuji.drpc.org",
      "https://avalanche-fuji.rpc.thirdweb.com",
    ],
  ),
  "43114": uniqueRpcEndpoints(
    splitRpcEnv(process.env.AVALANCHE_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_AVALANCHE_RPC_URLS),
    [
      "https://api.avax.network/ext/bc/C/rpc",
      "https://avalanche-c-chain-rpc.publicnode.com",
      "https://avax.drpc.org",
    ],
  ),
  "42161": uniqueRpcEndpoints(
    splitRpcEnv(process.env.ARBITRUM_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_ARBITRUM_RPC_URLS),
    ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one.publicnode.com"],
  ),
  "59141": uniqueRpcEndpoints(
    splitRpcEnv(process.env.LINEA_SEPOLIA_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URLS),
    splitRpcEnv(process.env.LINEA_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_LINEA_RPC_URLS),
    ["https://rpc.sepolia.linea.build", "https://linea-sepolia-rpc.publicnode.com"],
  ),
  "59144": uniqueRpcEndpoints(
    splitRpcEnv(process.env.LINEA_MAINNET_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_LINEA_MAINNET_RPC_URLS),
    ["https://rpc.linea.build", "https://linea-rpc.publicnode.com"],
  ),
  "80002": uniqueRpcEndpoints(
    splitRpcEnv(process.env.POLYGON_AMOY_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_POLYGON_AMOY_RPC_URLS),
    ["https://rpc-amoy.polygon.technology", "https://polygon-amoy.drpc.org"],
  ),
  "84532": uniqueRpcEndpoints(
    splitRpcEnv(process.env.BASE_SEPOLIA_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URLS),
    [
      "https://sepolia.base.org",
      "https://base-sepolia-rpc.publicnode.com",
      "https://base-sepolia.drpc.org",
      "https://base-sepolia.blockpi.network/v1/rpc/public",
    ],
  ),
  "421614": uniqueRpcEndpoints(
    splitRpcEnv(process.env.ARBITRUM_SEPOLIA_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URLS),
    [
      "https://sepolia-rollup.arbitrum.io/rpc",
      "https://arbitrum-sepolia-rpc.publicnode.com",
      "https://arbitrum-sepolia.drpc.org",
    ],
  ),
  "5042002": uniqueRpcEndpoints(
    splitRpcEnv(process.env.ARC_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_ARC_RPC_URLS),
    [
      process.env.ARC_ALCHEMY_RPC_URL,
      process.env.ARC_RPC_URL,
      process.env.ARC_TESTNET_RPC_URL,
      "https://rpc.drpc.testnet.arc.io",
      "https://rpc.quicknode.testnet.arc.io",
      "https://rpc.blockdaemon.testnet.arc.io",
      "https://rpc.testnet.arc.io",
    ].filter((value): value is string => Boolean(value && value.trim())),
  ),
  "5042": uniqueRpcEndpoints(
    splitRpcEnv(process.env.ARC_MAINNET_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URLS),
    [
      process.env.ARC_MAINNET_RPC_URL,
      process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL,
      process.env.ARC_MAINNET_ALCHEMY_RPC_URL,
      "https://rpc.mainnet.arc.io",
      "https://rpc.blockdaemon.mainnet.arc.io",
      "https://rpc.drpc.mainnet.arc.io",
      "https://rpc.quicknode.mainnet.arc.io",
    ].filter((value): value is string => Boolean(value && value.trim())),
  ),
  solana: SOLANA_RPC_ENDPOINTS,
  "solana-mainnet": SOLANA_MAINNET_RPC_ENDPOINTS,
  "11155111": uniqueRpcEndpoints(
    splitRpcEnv(process.env.ETHEREUM_SEPOLIA_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_ETHEREUM_SEPOLIA_RPC_URLS),
    [
      "https://ethereum-sepolia-rpc.publicnode.com",
      "https://ethereum-sepolia.publicnode.com",
      "https://sepolia.drpc.org",
      "https://eth-sepolia-public.blastapi.io",
    ],
  ),
  "11155420": uniqueRpcEndpoints(
    splitRpcEnv(process.env.OPTIMISM_SEPOLIA_RPC_URLS),
    splitRpcEnv(process.env.NEXT_PUBLIC_OPTIMISM_SEPOLIA_RPC_URLS),
    [
      "https://sepolia.optimism.io",
      "https://optimism-sepolia-rpc.publicnode.com",
      "https://optimism-sepolia.drpc.org",
    ],
  ),
};

const NULL_RESULT_FALLBACK_METHODS = new Set([
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
]);

const shouldTryNextRpcForNullResult = (
  requestBody: string,
  responseBody: string,
) => {
  try {
    const requestJson = JSON.parse(requestBody) as { method?: string };
    const responseJson = JSON.parse(responseBody) as { result?: unknown };

    return (
      typeof requestJson.method === "string" &&
      NULL_RESULT_FALLBACK_METHODS.has(requestJson.method) &&
      responseJson.result === null
    );
  } catch {
    return false;
  }
};

type RouteContext = {
  params: Promise<{
    chainId: string;
  }>;
};

export async function handleRpcChainProxy(
  request: NextRequest,
  { params }: RouteContext,
  options: { allowBroadcast: boolean },
) {
  const { chainId } = await params;
  const rpcUrls = RPC_ENDPOINTS[chainId];

  if (!rpcUrls) {
    return NextResponse.json(
      { error: `Unsupported RPC chain ID: ${chainId}` },
      { status: 400 }
    );
  }

  try {
    const body = await request.text();
    const inspection = inspectRpcProxyRequest({
      chainId,
      bodyText: body,
      clientIp: getRpcClientIp(request),
      allowBroadcast: options.allowBroadcast,
    });
    if (!inspection.ok) {
      return inspection.response;
    }

    let lastError: unknown = null;

    for (const [index, rpcUrl] of rpcUrls.entries()) {
      try {
        const upstreamResponse = await fetch(rpcUrl, {
          method: "POST",
          headers: {
            "content-type":
              request.headers.get("content-type") ?? "application/json",
          },
          body,
          cache: "no-store",
          // Allow upstreams a brief chance to recover before we move on.
          next: { revalidate: 0 },
        });

        if (
          RETRYABLE_RPC_STATUS_CODES.has(upstreamResponse.status) &&
          index < rpcUrls.length - 1
        ) {
          lastError = new Error(
            `RPC ${rpcUrl} returned HTTP ${upstreamResponse.status}`
          );
          await new Promise((resolve) =>
            setTimeout(resolve, RPC_RETRY_DELAY_MS * (index + 1)),
          );
          continue;
        }

        if (!upstreamResponse.ok && rpcUrls.length > 1) {
          lastError = new Error(
            `RPC ${rpcUrl} returned HTTP ${upstreamResponse.status}`
          );
          continue;
        }

        const responseBody = await upstreamResponse.text();

        if (
          rpcUrls.length > 1 &&
          shouldTryNextRpcForNullResult(body, responseBody) &&
          rpcUrl !== rpcUrls[rpcUrls.length - 1]
        ) {
          lastError = new Error(
            `RPC ${rpcUrl} returned null transaction result`
          );
          continue;
        }

        return new NextResponse(responseBody, {
          status: upstreamResponse.status,
          headers: {
            "cache-control": "no-store",
            "content-type":
              upstreamResponse.headers.get("content-type") ??
              "application/json",
          },
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error("All RPC endpoints failed");
  } catch (error) {
    console.error(`RPC proxy error for chain ${chainId}:`, error);

    return NextResponse.json(
      { error: "Failed to reach upstream RPC endpoint" },
      { status: 502 }
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handleRpcChainProxy(request, context, {
    allowBroadcast: isFrontendBrowserRequest(request),
  });
}
