import {
  createPublicClient,
  encodeFunctionData,
  fallback,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { TOKEN_CONTRACTS, TOKEN_DECIMALS } from "@/lib/arcNetwork";
import { ARC_RPC_ENDPOINTS, ARC_RPC_PROXY_PATH, getArcRpcUrls } from "@/lib/arcRpc";
import { QCAD_SWAP_PAIRS_ENABLED } from "@/lib/swapTokens";

export const TOWER_DEX_ID = "tower-dex" as const;
export const TOWER_DEX_NAME = "Tower" as const;
export const TOWER_DEX_CHAIN_ID = 5042002;
export const TOWER_DEX_PUBLIC_RPC_URL = "https://rpc.testnet.arc.io";
export const TOWER_DEX_PROXY_RPC_PATH = ARC_RPC_PROXY_PATH;
const TOWER_SWAP_FEE_MODE = "tower-swap-executor" as const;
const DEFAULT_TOWER_SWAP_FEE_BPS = 25;
const BPS_DENOMINATOR = 10000n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const TOWER_DEX_ROUTER_ADDRESS = normalizeTowerDexAddress(
  process.env.NEXT_PUBLIC_TOWER_DEX_ROUTER_ADDRESS ||
    process.env.TOWER_DEX_ROUTER_ADDRESS ||
    "0xDf115b4f2F22B9255B2E63348423B6C5B379Bce2",
);

const TOWER_SWAP_EXECUTOR_ADDRESS = normalizeTowerDexAddress(
  process.env.NEXT_PUBLIC_TOWER_SWAP_EXECUTOR_ADDRESS ||
    process.env.TOWER_SWAP_EXECUTOR_ADDRESS ||
    "0x2De8906a641d65d490bC60A4179d961d59742bCb",
);

const parseTowerSwapFeeBps = (value?: string | null) => {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= Number(BPS_DENOMINATOR)
    ? parsed
    : DEFAULT_TOWER_SWAP_FEE_BPS;
};

const resolveOptionalTowerDexAddress = (value?: string | null) =>
  value && isAddress(value) ? getAddress(value) : null;

const TOWER_DEX_ADAPTER_ADDRESS = resolveOptionalTowerDexAddress(
  process.env.NEXT_PUBLIC_TOWER_DEX_ADAPTER_ADDRESS ||
    process.env.TOWER_DEX_ADAPTER_ADDRESS ||
    process.env.NEXT_PUBLIC_TOWER_AMM_ADAPTER_ADDRESS ||
    process.env.TOWER_AMM_ADAPTER_ADDRESS,
);

const TOWER_SWAP_FEE_BPS = parseTowerSwapFeeBps(
  process.env.NEXT_PUBLIC_TOWER_SWAP_FEE_BPS ||
    process.env.TOWER_SWAP_FEE_BPS ||
    process.env.NEXT_PUBLIC_SWAP_FEE_BPS ||
    process.env.SWAP_FEE_BPS,
);

const TOWER_SWAP_FEE_RECIPIENT = resolveOptionalTowerDexAddress(
  process.env.NEXT_PUBLIC_TOWER_SWAP_FEE_RECIPIENT ||
    process.env.TOWER_SWAP_FEE_RECIPIENT ||
    process.env.NEXT_PUBLIC_TOWER_SWAP_EXECUTOR_TREASURY ||
    process.env.TOWER_SWAP_EXECUTOR_TREASURY ||
    "0xe71dD45E7d21409b04b609D0E6C67FFff592d43d",
);
const ARC_NATIVE_USDC_ADDRESS = normalizeTowerDexAddress(TOKEN_CONTRACTS.USDC);

type SupportedTowerDexSymbol = keyof typeof TOKEN_DECIMALS;

type TowerDexDirectPair = {
  key: string;
  token0Symbol: SupportedTowerDexSymbol;
  token1Symbol: SupportedTowerDexSymbol;
  token0: Address;
  token1: Address;
};

const TOWER_DEX_PAIR_DEFINITIONS = [
  {
    key: "USDC/EURC",
    token0Symbol: "USDC",
    token1Symbol: "EURC",
  },
  {
    key: "EURC/USDT",
    token0Symbol: "EURC",
    token1Symbol: "USDT",
  },
  {
    key: "USDC/USDT",
    token0Symbol: "USDC",
    token1Symbol: "USDT",
  },
  {
    key: "USDC/cirBTC",
    token0Symbol: "USDC",
    token1Symbol: "cirBTC",
  },
  {
    key: "EURC/cirBTC",
    token0Symbol: "EURC",
    token1Symbol: "cirBTC",
  },
  {
    key: "USDT/cirBTC",
    token0Symbol: "USDT",
    token1Symbol: "cirBTC",
  },
  {
    key: "USDC/cNGN",
    token0Symbol: "USDC",
    token1Symbol: "cNGN",
  },
  {
    key: "USDT/cNGN",
    token0Symbol: "USDT",
    token1Symbol: "cNGN",
  },
  {
    key: "EURC/cNGN",
    token0Symbol: "EURC",
    token1Symbol: "cNGN",
  },
  {
    key: "cirBTC/cNGN",
    token0Symbol: "cirBTC",
    token1Symbol: "cNGN",
  },
  ...(QCAD_SWAP_PAIRS_ENABLED
    ? ([
        {
          key: "USDC/QCAD",
          token0Symbol: "USDC",
          token1Symbol: "QCAD",
        },
        {
          key: "USDT/QCAD",
          token0Symbol: "USDT",
          token1Symbol: "QCAD",
        },
        {
          key: "EURC/QCAD",
          token0Symbol: "EURC",
          token1Symbol: "QCAD",
        },
        {
          key: "cirBTC/QCAD",
          token0Symbol: "cirBTC",
          token1Symbol: "QCAD",
        },
        {
          key: "cNGN/QCAD",
          token0Symbol: "cNGN",
          token1Symbol: "QCAD",
        },
      ] as const)
    : []),
] as const satisfies readonly {
  key: string;
  token0Symbol: SupportedTowerDexSymbol;
  token1Symbol: SupportedTowerDexSymbol;
}[];

const TOWER_DEX_PAIRS: readonly TowerDexDirectPair[] =
  TOWER_DEX_PAIR_DEFINITIONS.map((pair) => ({
    ...pair,
    token0: normalizeTowerDexAddress(TOKEN_CONTRACTS[pair.token0Symbol]),
    token1: normalizeTowerDexAddress(TOKEN_CONTRACTS[pair.token1Symbol]),
  }));

const TOWER_DEX_ROUTER_ABI = [
  {
    type: "function",
    name: "factory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getAmountsOut",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path", type: "address[]" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapExactTokensForTokens",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

const TOWER_DEX_FACTORY_ABI = [
  {
    type: "function",
    name: "getPair",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
    ],
    outputs: [{ name: "pair", type: "address" }],
  },
] as const;

let towerDexFactoryAddressPromise: Promise<Address> | null = null;
const towerDexPairAddressCache = new Map<string, Address | null>();

const getTowerDexPairCacheKey = (tokenA: Address, tokenB: Address) => {
  const [firstToken, secondToken] = [tokenA.toLowerCase(), tokenB.toLowerCase()].sort();
  return `${firstToken}:${secondToken}`;
};

const getTowerDexFactoryAddress = async (client: PublicClient) => {
  if (!towerDexFactoryAddressPromise) {
    towerDexFactoryAddressPromise = (async () =>
      normalizeTowerDexAddress(
        (await client.readContract({
          address: TOWER_DEX_ROUTER_ADDRESS,
          abi: TOWER_DEX_ROUTER_ABI,
          functionName: "factory",
        })) as string,
      ))();
  }

  try {
    return await towerDexFactoryAddressPromise;
  } catch (error) {
    towerDexFactoryAddressPromise = null;
    throw error;
  }
};

const resolveTowerDexPairAddress = async (
  client: PublicClient,
  pair: TowerDexDirectPair,
): Promise<Address | null> => {
  const cacheKey = getTowerDexPairCacheKey(pair.token0, pair.token1);
  if (towerDexPairAddressCache.has(cacheKey)) {
    return towerDexPairAddressCache.get(cacheKey) ?? null;
  }

  const factoryAddress = await getTowerDexFactoryAddress(client);
  const pairAddress = normalizeTowerDexAddress(
    (await client.readContract({
      address: factoryAddress,
      abi: TOWER_DEX_FACTORY_ABI,
      functionName: "getPair",
      args: [pair.token0, pair.token1],
    })) as string,
  );

  const resolvedPairAddress =
    pairAddress.toLowerCase() === ZERO_ADDRESS.toLowerCase() ? null : pairAddress;
  towerDexPairAddressCache.set(cacheKey, resolvedPairAddress);
  return resolvedPairAddress;
};

const TOWER_DEX_ADAPTER_ABI = [
  {
    type: "function",
    name: "swap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const TOWER_SWAP_EXECUTOR_ABI = [
  {
    type: "function",
    name: "executeSwap",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "minAmountOut", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "routeTarget", type: "address" },
          { name: "approvalSpender", type: "address" },
          { name: "routeCalldata", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "feeAmount", type: "uint256" },
      { name: "inputRefund", type: "uint256" },
    ],
  },
] as const;

const TOWER_DEX_PAIR_ABI = [
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "token1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
] as const;

const ERC20_ALLOWANCE_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;



type TowerDexTokenSnapshot = {
  address: Address;
  symbol: SupportedTowerDexSymbol;
  decimals: number;
};

type TowerDexPairSnapshot = {
  pairAddress: Address;
  token0: TowerDexTokenSnapshot;
  token1: TowerDexTokenSnapshot;
  tokenIn: TowerDexTokenSnapshot;
  tokenOut: TowerDexTokenSnapshot;
};

export type TowerDexQuote = {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  swapInputAmount?: string;
  outputAmount: string;
  minOut: string;
  inputAmountNative: string;
  swapInputAmountNative?: string;
  outputAmountNative: string;
  minOutNative: string;
  platformFeeAmount?: string;
  platformFeeAmountNative?: string;
  priceImpact: number;
  gasEstimate: string;
  slippage: number;
  feeBps?: number;
  feeRecipient?: string;
  feeMode: typeof TOWER_SWAP_FEE_MODE | "none";
  route: {
    type: "single";
      hops: Array<{
        dexId: typeof TOWER_DEX_ID;
        dex?: typeof TOWER_DEX_ID;
        dexName: typeof TOWER_DEX_NAME;
        dexRouter: string;
        path: string[];
      amountIn: string;
      amountOut: string;
      priceImpact: number;
      liquidity?: string;
    }>;
  };
};

export type TowerDexTransaction = {
  to: string;
  data: Hex;
  value: string;
  gasLimit: string;
  chainId: number;
};

const getDefaultTowerDexRpcUrl = () =>
  typeof window === "undefined"
    ? ARC_RPC_ENDPOINTS[0] || TOWER_DEX_PUBLIC_RPC_URL
    : TOWER_DEX_PROXY_RPC_PATH;

export function createTowerDexPublicClient(
  rpcUrl = getDefaultTowerDexRpcUrl(),
) {
  const serverRpcUrls =
    typeof window === "undefined"
      ? getArcRpcUrls(rpcUrl)
      : [rpcUrl];

  return createPublicClient({
    chain: {
      id: TOWER_DEX_CHAIN_ID,
      name: "Arc Testnet",
      nativeCurrency: {
        decimals: 18,
        name: "USDC",
        symbol: "USDC",
      },
      rpcUrls: {
        default: { http: serverRpcUrls },
      },
    },
    transport:
      typeof window === "undefined"
        ? fallback(
            serverRpcUrls.map((url) =>
              http(url, {
                retryCount: 1,
                timeout: 12_000,
              }),
            ),
          )
        : http(rpcUrl, {
            retryCount: 2,
            timeout: 12_000,
          }),
  });
}

export function normalizeTowerDexAddress(address: string): Address {
  if (!isAddress(address)) {
    throw new Error(`Invalid Tower DEX address: ${address}`);
  }

  return getAddress(address);
}

export function normalizeTowerDexId(rawDexId?: string | null) {
  const normalized = rawDexId?.trim().toLowerCase().replace(/[\s_]+/g, "-");

  if (!normalized) {
    return undefined;
  }

  if (
    normalized === TOWER_DEX_ID ||
    normalized === "tower" ||
    normalized === "tower-amm"
  ) {
    return TOWER_DEX_ID;
  }

  return undefined;
}

function isArcNativeUsdcToken(tokenAddress?: string | Address | null) {
  if (!tokenAddress) {
    return false;
  }

  return normalizeTowerDexAddress(tokenAddress) === ARC_NATIVE_USDC_ADDRESS;
}

const TOWER_DEX_ENABLED =
  process.env.NEXT_PUBLIC_TOWER_DEX_ENABLED !== "false" &&
  process.env.TOWER_DEX_ENABLED !== "false";

export function isTowerDexEnabled() {
  return TOWER_DEX_ENABLED;
}

export function getTowerDexInfo() {
  return {
    id: TOWER_DEX_ID,
    name: TOWER_DEX_NAME,
    routerAddress: TOWER_DEX_ROUTER_ADDRESS,
    executorRouteTargetAddress:
      TOWER_DEX_ADAPTER_ADDRESS ?? TOWER_DEX_ROUTER_ADDRESS,
    type: "v2" as const,
    chainId: TOWER_DEX_CHAIN_ID,
    enabled: isTowerDexEnabled(),
    supportedTokens: Array.from(
      new Set(
        TOWER_DEX_PAIRS.flatMap((pair) => [pair.token0, pair.token1]),
      ),
    ),
    poolAddresses: [],
  };
}

const findSupportedTowerDexPair = (tokenIn: string, tokenOut: string) => {
  const normalizedTokenIn = normalizeTowerDexAddress(tokenIn).toLowerCase();
  const normalizedTokenOut = normalizeTowerDexAddress(tokenOut).toLowerCase();

  for (const pair of TOWER_DEX_PAIRS) {
    const matchesForward =
      pair.token0.toLowerCase() === normalizedTokenIn &&
      pair.token1.toLowerCase() === normalizedTokenOut;
    const matchesReverse =
      pair.token1.toLowerCase() === normalizedTokenIn &&
      pair.token0.toLowerCase() === normalizedTokenOut;

    if (matchesForward || matchesReverse) {
      return {
        pair,
        matchesForward,
      };
    }
  }

  return null;
};

const createTowerDexTokenSnapshot = (
  symbol: SupportedTowerDexSymbol,
  address: Address,
): TowerDexTokenSnapshot => ({
  address,
  symbol,
  decimals: TOKEN_DECIMALS[symbol],
});

const getTowerDexPair = async (
  client: PublicClient,
  tokenIn: string,
  tokenOut: string,
): Promise<TowerDexPairSnapshot | null> => {
  const supportedPair = findSupportedTowerDexPair(tokenIn, tokenOut);
  if (!supportedPair) {
    return null;
  }

  const pairAddress = await resolveTowerDexPairAddress(client, supportedPair.pair);
  if (!pairAddress) {
    return null;
  }

  const token0 = createTowerDexTokenSnapshot(
    supportedPair.pair.token0Symbol,
    supportedPair.pair.token0,
  );
  const token1 = createTowerDexTokenSnapshot(
    supportedPair.pair.token1Symbol,
    supportedPair.pair.token1,
  );

  return {
    pairAddress,
    token0,
    token1,
    tokenIn: supportedPair.matchesForward ? token0 : token1,
    tokenOut: supportedPair.matchesForward ? token1 : token0,
  };
};

export function isTowerDexSupportedPair(tokenIn: string, tokenOut: string) {
  try {
    return findSupportedTowerDexPair(tokenIn, tokenOut) !== null;
  } catch {
    return false;
  }
}

const scaleAmount = (
  amount: bigint,
  fromDecimals: number,
  toDecimals: number,
) => {
  if (fromDecimals === toDecimals) {
    return amount;
  }

  return fromDecimals < toDecimals
    ? amount * 10n ** BigInt(toDecimals - fromDecimals)
    : amount / 10n ** BigInt(fromDecimals - toDecimals);
};

const toHexQuantity = (value: bigint | number) =>
  `0x${BigInt(value).toString(16)}`;

const getTokenDecimalsByAddress = (address: Address) => {
  const normalizedAddress = address.toLowerCase();

  for (const [symbol, contractAddress] of Object.entries(TOKEN_CONTRACTS)) {
    if (contractAddress.toLowerCase() === normalizedAddress) {
      return TOKEN_DECIMALS[symbol] ?? 18;
    }
  }

  return 18;
};

const resolveQuoteNativeAmount = (
  nativeValue: string | undefined | null,
  scaled18Value: string | undefined | null,
  tokenAddress: Address,
) => {
  if (nativeValue != null && nativeValue !== "") {
    return BigInt(nativeValue);
  }

  if (scaled18Value == null || scaled18Value === "") {
    throw new Error("Quote is missing required amount fields.");
  }

  return scaleAmount(
    BigInt(scaled18Value),
    18,
    getTokenDecimalsByAddress(tokenAddress),
  );
};

const calculatePriceImpactBps = (
  amountIn: bigint,
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
) => {
  if (amountIn <= 0n || amountOut <= 0n || reserveIn <= 0n || reserveOut <= 0n) {
    return 0;
  }

  const scale = 10n ** 18n;
  const spotPrice = (reserveOut * scale) / reserveIn;
  const executionPrice = (amountOut * scale) / amountIn;

  if (executionPrice >= spotPrice) {
    return 0;
  }

  return Number(((spotPrice - executionPrice) * 10000n) / spotPrice);
};

const getPairReserves = async (
  client: PublicClient,
  pair: TowerDexPairSnapshot,
) => {
  const reserves = (await client.readContract({
    address: pair.pairAddress,
    abi: TOWER_DEX_PAIR_ABI,
    functionName: "getReserves",
  })) as readonly [bigint, bigint, number];
  const [reserve0, reserve1] = reserves;

  if (pair.token0.address.toLowerCase() === pair.tokenIn.address.toLowerCase()) {
    return {
      reserveIn: reserve0,
      reserveOut: reserve1,
    };
  }

  return {
    reserveIn: reserve1,
    reserveOut: reserve0,
  };
};

export async function getTowerDexQuote(params: {
  client?: PublicClient;
  inputToken: string;
  outputToken: string;
  inputAmount: string | bigint;
  slippageBps: number;
}): Promise<TowerDexQuote | null> {
  if (!isTowerDexEnabled()) {
    return null;
  }

  const client = params.client ?? createTowerDexPublicClient();
  const pair = await getTowerDexPair(
    client,
    params.inputToken,
    params.outputToken,
  );
  if (!pair) {
    return null;
  }
  const path = [pair.tokenIn.address, pair.tokenOut.address];
  const amountInNative = BigInt(params.inputAmount);
  const shouldCollectExecutorFee =
    Boolean(TOWER_DEX_ADAPTER_ADDRESS) &&
    Boolean(TOWER_SWAP_FEE_RECIPIENT) &&
    TOWER_SWAP_FEE_BPS > 0;
  const platformFeeAmountNative =
    shouldCollectExecutorFee
      ? (amountInNative * BigInt(TOWER_SWAP_FEE_BPS)) / BPS_DENOMINATOR
      : 0n;
  const swapInputAmountNative = amountInNative - platformFeeAmountNative;

  if (swapInputAmountNative <= 0n) {
    return null;
  }

  try {
    const amounts = (await client.readContract({
      address: TOWER_DEX_ROUTER_ADDRESS,
      abi: TOWER_DEX_ROUTER_ABI,
      functionName: "getAmountsOut",
      args: [swapInputAmountNative, path],
    })) as readonly bigint[];
    const amountOutNative = amounts[amounts.length - 1];
    const minOutNative =
      (amountOutNative * BigInt(10000 - params.slippageBps)) / 10000n;

    const { reserveIn, reserveOut } = await getPairReserves(client, pair);
    const priceImpact = calculatePriceImpactBps(
      swapInputAmountNative,
      amountOutNative,
      reserveIn,
      reserveOut,
    );

    return {
      inputToken: pair.tokenIn.address,
      outputToken: pair.tokenOut.address,
      inputAmount: scaleAmount(amountInNative, pair.tokenIn.decimals, 18).toString(),
      swapInputAmount: scaleAmount(
        swapInputAmountNative,
        pair.tokenIn.decimals,
        18,
      ).toString(),
      outputAmount: scaleAmount(
        amountOutNative,
        pair.tokenOut.decimals,
        18,
      ).toString(),
      minOut: scaleAmount(minOutNative, pair.tokenOut.decimals, 18).toString(),
      inputAmountNative: amountInNative.toString(),
      swapInputAmountNative: swapInputAmountNative.toString(),
      outputAmountNative: amountOutNative.toString(),
      minOutNative: minOutNative.toString(),
      platformFeeAmount:
        platformFeeAmountNative > 0n
          ? scaleAmount(platformFeeAmountNative, pair.tokenIn.decimals, 18).toString()
          : undefined,
      platformFeeAmountNative:
        platformFeeAmountNative > 0n ? platformFeeAmountNative.toString() : undefined,
      priceImpact,
      gasEstimate: "300000",
      slippage: params.slippageBps,
      feeBps: shouldCollectExecutorFee ? TOWER_SWAP_FEE_BPS : undefined,
      feeRecipient: shouldCollectExecutorFee
        ? TOWER_SWAP_FEE_RECIPIENT || undefined
        : undefined,
      feeMode: shouldCollectExecutorFee ? TOWER_SWAP_FEE_MODE : "none",
      route: {
        type: "single",
        hops: [
          {
            dexId: TOWER_DEX_ID,
            dex: TOWER_DEX_ID,
            dexName: TOWER_DEX_NAME,
            dexRouter: TOWER_DEX_ROUTER_ADDRESS,
            path,
            amountIn: swapInputAmountNative.toString(),
            amountOut: amountOutNative.toString(),
            priceImpact,
            liquidity: reserveOut.toString(),
          },
        ],
      },
    };
  } catch (error) {
    console.warn("[Tower DEX] quote unavailable:", error);
    return null;
  }
}

export function isTowerDexQuote(quote: unknown): quote is TowerDexQuote {
  if (!quote || typeof quote !== "object") {
    return false;
  }

  const dzap = (quote as { dzap?: { source?: string } }).dzap;
  if (dzap?.source === "dzap") {
    return false;
  }

  const route = (quote as TowerDexQuote).route;
  const hop = route?.hops?.[0];
  return normalizeTowerDexId(hop?.dexId || hop?.dexName) === TOWER_DEX_ID;
}

export async function buildTowerDexSwapTransaction(params: {
  quote: TowerDexQuote;
  userAddress: string;
  client?: PublicClient;
}) {
  const client = params.client ?? createTowerDexPublicClient();
  const userAddress = normalizeTowerDexAddress(params.userAddress);
  const tokenIn = normalizeTowerDexAddress(params.quote.inputToken);
  const tokenOut = normalizeTowerDexAddress(params.quote.outputToken);
  const path = [tokenIn, tokenOut];
  const amountInNative = resolveQuoteNativeAmount(
    params.quote.inputAmountNative,
    params.quote.inputAmount,
    tokenIn,
  );
  const swapInputAmountNative = resolveQuoteNativeAmount(
    params.quote.swapInputAmountNative ?? params.quote.inputAmountNative,
    params.quote.swapInputAmount ?? params.quote.inputAmount,
    tokenIn,
  );
  const minOutNative = resolveQuoteNativeAmount(
    params.quote.minOutNative,
    params.quote.minOut,
    tokenOut,
  );
  const platformFeeAmountNative =
    params.quote.platformFeeAmountNative != null &&
    params.quote.platformFeeAmountNative !== ""
      ? BigInt(params.quote.platformFeeAmountNative)
      : params.quote.platformFeeAmount
        ? scaleAmount(
            BigInt(params.quote.platformFeeAmount),
            18,
            getTokenDecimalsByAddress(tokenIn),
          )
        : 0n;
  const feeRecipient = resolveOptionalTowerDexAddress(params.quote.feeRecipient);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  const outputAmountNative = resolveQuoteNativeAmount(
    params.quote.outputAmountNative,
    params.quote.outputAmount,
    tokenOut,
  ).toString();
  const useExecutorFeePath =
    Boolean(TOWER_DEX_ADAPTER_ADDRESS) &&
    params.quote.feeMode === TOWER_SWAP_FEE_MODE;
  const approvalSpender = useExecutorFeePath
    ? TOWER_SWAP_EXECUTOR_ADDRESS
    : TOWER_DEX_ROUTER_ADDRESS;
  const allowance = (await client.readContract({
    address: tokenIn,
    abi: ERC20_ALLOWANCE_ABI,
    functionName: "allowance",
    args: [userAddress, approvalSpender],
  })) as bigint;

  const approval =
    allowance >= amountInNative
      ? null
      : {
          to: tokenIn,
          data: encodeFunctionData({
            abi: ERC20_APPROVE_ABI,
            functionName: "approve",
            args: [approvalSpender, amountInNative],
          }),
          from: userAddress,
          gasLimit: toHexQuantity(100000),
          label: useExecutorFeePath ? "Executor approval" : "Router approval",
          spender: approvalSpender,
          amountRaw: amountInNative.toString(),
          token: tokenIn,
        };

  if (!useExecutorFeePath) {
    return {
      approval,
      swap: {
        to: TOWER_DEX_ROUTER_ADDRESS,
        data: encodeFunctionData({
          abi: TOWER_DEX_ROUTER_ABI,
          functionName: "swapExactTokensForTokens",
          args: [amountInNative, minOutNative, path, userAddress, deadline],
        }),
        value: "0x0",
        from: userAddress,
        gasLimit: toHexQuantity(750000),
        chainId: TOWER_DEX_CHAIN_ID,
        expectedUserOutput: outputAmountNative,
        feeMode: "none",
        inputAmountNative: amountInNative.toString(),
      },
    };
  }

  if (!TOWER_DEX_ADAPTER_ADDRESS) {
    throw new Error("Tower DEX adapter is required for executor fee collection.");
  }

  const routeCalldata = encodeFunctionData({
    abi: TOWER_DEX_ADAPTER_ABI,
    functionName: "swap",
    args: [
      tokenIn,
      tokenOut,
      swapInputAmountNative,
      minOutNative,
      TOWER_SWAP_EXECUTOR_ADDRESS,
      deadline,
    ],
  });

  const swapParams = {
    tokenIn,
    tokenOut,
    amountIn: amountInNative,
    minAmountOut: minOutNative,
    recipient: userAddress,
    routeTarget: TOWER_DEX_ADAPTER_ADDRESS,
    approvalSpender: TOWER_DEX_ADAPTER_ADDRESS,
    routeCalldata,
  };

  const swap: TowerDexTransaction = {
    to: TOWER_SWAP_EXECUTOR_ADDRESS,
    data: encodeFunctionData({
      abi: TOWER_SWAP_EXECUTOR_ABI,
      functionName: "executeSwap",
      args: [swapParams],
    }),
    value: "0x0",
    gasLimit: toHexQuantity(2500000),
    chainId: TOWER_DEX_CHAIN_ID,
  };

  return {
    approval,
    swap: {
      ...swap,
      from: userAddress,
      platformFeeAmount: platformFeeAmountNative.toString(),
      expectedUserOutput: outputAmountNative,
      feeRecipient: feeRecipient || undefined,
      feeBps: params.quote.feeBps ?? TOWER_SWAP_FEE_BPS,
      feeMode: params.quote.feeMode,
      feeToken: tokenIn,
      executorAddress: TOWER_SWAP_EXECUTOR_ADDRESS,
      inputAmountNative: amountInNative.toString(),
    },
  };
}

