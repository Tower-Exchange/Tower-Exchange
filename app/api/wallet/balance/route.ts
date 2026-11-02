import { NextRequest, NextResponse } from "next/server";
import {
  type PublicClient,
  createPublicClient,
  http,
  erc20Abi,
  formatUnits,
  getAddress,
  isAddress,
} from "viem";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { ARC_MAINNET_RPC_ENDPOINTS, ARC_RPC_ENDPOINTS } from "@/lib/arcRpc";
import {
  BRIDGE_EURC_ADDRESSES,
  BRIDGE_EURC_DECIMALS,
  BRIDGE_USDC_ADDRESSES,
  isNativeArcUsdcChain,
  isSolanaBridgeChain,
} from "@/lib/bridgeNetworks";
import { STABLEFX_ARC_MAINNET_TOKENS } from "@/lib/stableFx";
import { getTrustedClientIp } from "@/lib/server/clientIp";
import { withFrontendOriginGate } from "@/lib/server/frontendRequestGuard";
import { createIpRateLimiter } from "@/lib/server/ipRateLimit";

const ARC_NATIVE_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const ARC_NATIVE_USDC_DECIMALS = 18;
const SOLANA_DEVNET_RPC_URL = "https://api.devnet.solana.com";
const SOLANA_MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";
const RPC_TIMEOUT_MS = 8_000;

const splitRpcEnv = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const uniqueRpcUrls = (...lists: Array<string | string[] | undefined>) =>
  Array.from(
    new Set(
      lists
        .flat()
        .filter((url): url is string => Boolean(url && url.trim()))
        .map((url) => url.trim()),
    ),
  );

const ETHEREUM_SEPOLIA_RPC_URLS = uniqueRpcUrls(
  splitRpcEnv(process.env.ETHEREUM_SEPOLIA_RPC_URLS),
  splitRpcEnv(process.env.NEXT_PUBLIC_ETHEREUM_SEPOLIA_RPC_URLS),
  [
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://ethereum-sepolia.publicnode.com",
    "https://sepolia.drpc.org",
  ],
);

const SONIC_TESTNET_RPC_URLS = uniqueRpcUrls(
  splitRpcEnv(process.env.SONIC_RPC_URLS),
  splitRpcEnv(process.env.NEXT_PUBLIC_SONIC_RPC_URLS),
  ["https://rpc.testnet.soniclabs.com"],
);

const KNOWN_ERC20_DECIMALS: Record<string, number> = {
  ...Object.fromEntries(
    Object.values(BRIDGE_USDC_ADDRESSES)
      .filter((address) => address.startsWith("0x"))
      .map((address) => [
        address.toLowerCase(),
        address.toLowerCase() === ARC_NATIVE_USDC_ADDRESS
          ? ARC_NATIVE_USDC_DECIMALS
          : 6,
      ]),
  ),
  "0x171a4217b86a807a64eb94757db6849fb4bdbaa0": 8,
  ...Object.fromEntries(
    Object.values(BRIDGE_EURC_ADDRESSES).map((address) => [
      address.toLowerCase(),
      BRIDGE_EURC_DECIMALS,
    ]),
  ),
  ...Object.fromEntries(
    Object.values(STABLEFX_ARC_MAINNET_TOKENS).map(({ address, decimals }) => [
      address.toLowerCase(),
      decimals,
    ]),
  ),
};

const RPC_URL_FALLBACKS: Record<string, string[]> = {
  "arc-testnet": [...ARC_RPC_ENDPOINTS],
  arc: [...ARC_MAINNET_RPC_ENDPOINTS],
  "5042": [...ARC_MAINNET_RPC_ENDPOINTS],
  "421614": [
    "https://sepolia-rollup.arbitrum.io/rpc",
    "https://arbitrum-sepolia-rpc.publicnode.com",
    "https://arbitrum-sepolia.drpc.org",
  ],
  "arbitrum-sepolia": [
    "https://sepolia-rollup.arbitrum.io/rpc",
    "https://arbitrum-sepolia-rpc.publicnode.com",
    "https://arbitrum-sepolia.drpc.org",
  ],
  arbitrum: [
    "https://arb1.arbitrum.io/rpc",
    "https://arbitrum-one.publicnode.com",
  ],
  "base-sepolia": ["https://sepolia.base.org"],
  base: ["https://mainnet.base.org"],
  "optimism-sepolia": ["https://sepolia.optimism.io"],
  optimism: ["https://mainnet.optimism.io"],
  "avalanche-fuji": ["https://api.avax-test.network/ext/bc/C/rpc"],
  avalanche: ["https://api.avax.network/ext/bc/C/rpc"],
  "ethereum-sepolia": ETHEREUM_SEPOLIA_RPC_URLS,
  "11155111": ETHEREUM_SEPOLIA_RPC_URLS,
  ethereum: [
    "https://ethereum-rpc.publicnode.com",
    "https://ethereum.publicnode.com",
  ],
  "linea-sepolia": ["https://rpc.sepolia.linea.build"],
  linea: ["https://rpc.linea.build"],
  "polygon-amoy": ["https://rpc-amoy.polygon.technology"],
  polygon: ["https://polygon.drpc.org", "https://polygon-rpc.com"],
  "sonic-testnet": SONIC_TESTNET_RPC_URLS,
  "14601": SONIC_TESTNET_RPC_URLS,
  sonic: ["https://rpc.soniclabs.com"],
  "unichain-sepolia": ["https://sepolia.unichain.org"],
  unichain: ["https://mainnet.unichain.org"],
  solana: [SOLANA_DEVNET_RPC_URL],
  "solana-mainnet": [SOLANA_MAINNET_RPC_URL],
};

const getRpcUrlsForChain = (chainId: string) => {
  return RPC_URL_FALLBACKS[String(chainId).toLowerCase()] ?? [];
};

const readWithRpcFallback = async <T,>(
  chainId: string,
  read: (publicClient: PublicClient) => Promise<T>,
) => {
  let lastError: unknown = null;
  const rpcUrls = getRpcUrlsForChain(chainId);

  if (!rpcUrls.length) {
    throw new Error(`No allow-listed RPC endpoints for chain ${chainId}`);
  }

  for (const candidateRpcUrl of rpcUrls) {
    try {
      const publicClient = createPublicClient({
        transport: http(candidateRpcUrl, {
          timeout: RPC_TIMEOUT_MS,
          retryCount: 0,
          fetchOptions: { cache: "no-store" },
        }),
      });

      return await read(publicClient);
    } catch (error) {
      lastError = error;
      console.warn(
        `Wallet balance RPC failed for ${chainId} using ${candidateRpcUrl}:`,
        error,
      );
    }
  }

  throw lastError ?? new Error("No RPC endpoints available");
};

const walletBalanceRateLimit = createIpRateLimiter({
  windowMs: 60_000,
  maxRequests: 120,
});

const isValidSolanaAddress = (address: string) => {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
};

const getSolanaConnection = (rpcUrl?: string) =>
  new Connection(rpcUrl || SOLANA_DEVNET_RPC_URL, "confirmed");

const readSolanaTokenBalance = async (
  address: string,
  rpcUrl: string,
  mintAddress: string,
) => {
  const connection = getSolanaConnection(rpcUrl);
  const owner = new PublicKey(address);
  const mint = new PublicKey(mintAddress);
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, {
    mint,
  });

  const total = tokenAccounts.value.reduce((sum, tokenAccount) => {
    const parsed = tokenAccount.account.data.parsed.info.tokenAmount;
    const uiAmount = Number(parsed.uiAmountString ?? parsed.uiAmount ?? 0);
    return sum + uiAmount;
  }, 0);

  return total.toFixed(6);
};

export async function handleWalletBalancePost(request: NextRequest) {
  try {
    const { address, chainId, tokenAddress, balanceType } =
      await request.json();
    const normalizedChainId = String(chainId).toLowerCase();

    if (!address || !chainId) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 },
      );
    }

    const addressValid = isSolanaBridgeChain(normalizedChainId)
      ? isValidSolanaAddress(address)
      : isAddress(address);
    if (!addressValid) {
      return NextResponse.json(
        { error: "Invalid wallet address" },
        { status: 400 },
      );
    }

    // Never accept client-supplied rpcUrl (SSRF). Resolve allow-listed RPCs by chainId.
    const rpcUrls = getRpcUrlsForChain(normalizedChainId);
    if (!rpcUrls.length) {
      return NextResponse.json(
        { balance: "0.00", error: "Unsupported chain" },
        { status: 200 },
      );
    }
    const rpcUrl = rpcUrls[0];

    if (isSolanaBridgeChain(normalizedChainId)) {
      if (!isValidSolanaAddress(address)) {
        return NextResponse.json({ balance: "0.00" });
      }

      if (balanceType === "native") {
        const connection = getSolanaConnection(rpcUrl);
        const lamports = await connection.getBalance(new PublicKey(address));

        return NextResponse.json({
          balance: (lamports / LAMPORTS_PER_SOL).toFixed(6),
        });
      }

      const mintAddress = tokenAddress || getUSDCAddressForChain(normalizedChainId);
      if (!mintAddress) {
        return NextResponse.json(
          { balance: "0.00", error: "Token not supported on this chain" },
          { status: 200 },
        );
      }

      const formattedBalance = await readSolanaTokenBalance(
        address,
        rpcUrl,
        mintAddress,
      );

      return NextResponse.json({ balance: formattedBalance });
    }

    if (balanceType === "native") {
      const formattedBalance = await readWithRpcFallback(
        normalizedChainId,
        async (publicClient) => {
          const balance = await publicClient.getBalance({
            address: address as `0x${string}`,
          });

          return Number(formatUnits(balance, ARC_NATIVE_USDC_DECIMALS)).toFixed(
            6,
          );
        },
      );

      return NextResponse.json({
        balance: formattedBalance,
      });
    }

    const contractAddress =
      tokenAddress || getUSDCAddressForChain(normalizedChainId);
    if (!contractAddress) {
      return NextResponse.json(
        { balance: "0.00", error: "Token not supported on this chain" },
        { status: 200 },
      );
    }

    if (
      isNativeArcUsdcChain(normalizedChainId) &&
      contractAddress.toLowerCase() === ARC_NATIVE_USDC_ADDRESS
    ) {
      const formattedBalance = await readWithRpcFallback(
        normalizedChainId,
        async (publicClient) => {
          const balance = await publicClient.getBalance({
            address: address as `0x${string}`,
          });

          return Number(formatUnits(balance, ARC_NATIVE_USDC_DECIMALS)).toFixed(
            6,
          );
        },
      );

      return NextResponse.json({
        balance: formattedBalance,
      });
    }

    const formattedBalance = await readWithRpcFallback(
      normalizedChainId,
      async (publicClient) => {
        const token = getAddress(contractAddress.toLowerCase());
        const owner = getAddress(address.toLowerCase());
        const knownDecimals = KNOWN_ERC20_DECIMALS[token.toLowerCase()];

        const balance = (await publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [owner],
        })) as bigint;

        const decimals =
          knownDecimals ??
          Number(
            await publicClient.readContract({
              address: token,
              abi: erc20Abi,
              functionName: "decimals",
            }),
          );

        return Number(formatUnits(balance, decimals)).toFixed(6);
      },
    );

    return NextResponse.json({ balance: formattedBalance });
  } catch (error) {
    console.error("Error fetching wallet balance:", error);
    return NextResponse.json(
      { balance: "0.00", error: "Failed to fetch balance" },
      { status: 200 },
    );
  }
}

export const POST = withFrontendOriginGate(async (request: NextRequest) => {
  const rate = walletBalanceRateLimit.consume(getTrustedClientIp(request.headers));
  if (rate.limited) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  return handleWalletBalancePost(request);
});

function getUSDCAddressForChain(chainId: string): string | null {
  return BRIDGE_USDC_ADDRESSES[chainId.toLowerCase()] || null;
}
