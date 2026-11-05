import {
  concatHex,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  fallback,
  getAddress,
  http,
  isAddress,
  numberToHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

import {
  AERO_CHAIN_ID,
  AERO_MAINNET_TOKENS,
  aeroArcMainnet,
} from "@/lib/aeroDex";
import { getArcMainnetRpcUrls } from "@/lib/arcRpc";
import { getTokenDecimalsByAddress } from "@/lib/swapApiContract";
import { isUniswapEnabled } from "@/lib/uniswapEnabled";
import {
  encodeTowerSwapExecution,
  getTowerSwapExecutorV2Address,
  isTowerSwapExecutorV2Enabled,
} from "@/lib/towerSwapExecutorV2";

export { isUniswapEnabled };

export const UNISWAP_DEX_ID = "uniswap" as const;
export const UNISWAP_DEX_NAME = "Uniswap" as const;
export const UNISWAP_CHAIN_ID = AERO_CHAIN_ID;
export const UNISWAP_QUOTE_SOURCE = "uniswap" as const;

export const UNISWAP_POOL_MANAGER =
  "0x8366a39CC670B4001A1121B8F6A443A643e40951" as Address;
export const UNISWAP_QUOTER =
  "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94" as Address;
export const UNISWAP_STATE_VIEW =
  "0xF3334192D15450CdD385c8B70e03F9A6bD9E673b" as Address;
export const UNISWAP_UNIVERSAL_ROUTER =
  "0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1" as Address;
export const UNISWAP_UNIVERSAL_ROUTER_V4 =
  "0x8702463e73f74d0b6765aBceb314Ef07aCb92650" as Address;
export const UNISWAP_PERMIT2 =
  "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;
export const UNISWAP_HOOKS_NONE = zeroAddress;

const TOWER_SWAP_FEE_MODE = "tower-swap-executor" as const;
const DEFAULT_GAS_LIMIT = 900_000n;
const EXECUTOR_GAS_LIMIT = 1_800_000n;
const DEFAULT_APPROVAL_GAS_LIMIT = 100_000n;
const NORMALIZED_DECIMALS = 18;
const BPS_DENOMINATOR = 10_000n;
const DEFAULT_TOWER_SWAP_FEE_BPS = 30;
const EXECUTOR_FEE_STATE_TTL_MS = 30_000;
const FEE_STATE_TIMEOUT_MS = 800;
const QUOTE_TIMEOUT_MS = 12_000;
const QUOTE_CACHE_SOFT_TTL_MS = 8_000;
const QUOTE_CACHE_HARD_TTL_MS = 120_000;
const SWAP_DEADLINE_SECONDS = 20 * 60;
const UINT128_MAX = (1n << 128n) - 1n;
const UNISWAP_SWAP_EXECUTOR_MAINNET_DEFAULT =
  "0xeB8940752Fa12944d3b2D736d51fA36E4dA32BC8" as Address;
const UNISWAP_SWAP_FEE_RECIPIENT_DEFAULT =
  "0xb3966683724303400B6fECDa1963825d994B546a" as Address;

const UNISWAP_SUPPORTED_TOKENS = [
  AERO_MAINNET_TOKENS.USDC,
  AERO_MAINNET_TOKENS.EURC,
  AERO_MAINNET_TOKENS.cirBTC,
] as const;

const UNISWAP_FEE_TIERS = [
  { fee: 100, tickSpacing: 1 },
  { fee: 500, tickSpacing: 10 },
  { fee: 3000, tickSpacing: 60 },
  { fee: 10000, tickSpacing: 100 },
  { fee: 10000, tickSpacing: 200 },
] as const;

const V4_SWAP_COMMAND = 0x10;
const V4_ACTIONS = {
  SWAP_EXACT_IN_SINGLE: 0x06,
  SWAP_EXACT_IN: 0x07,
  SETTLE_ALL: 0x0c,
  TAKE_ALL: 0x0f,
} as const;

const POOL_KEY_COMPONENTS = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

const PATH_KEY_COMPONENTS = [
  { name: "intermediateCurrency", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
  { name: "hookData", type: "bytes" },
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
  {
    type: "function",
    name: "routeTargets",
    stateMutability: "view",
    inputs: [{ name: "target", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "approvalSpenders",
    stateMutability: "view",
    inputs: [{ name: "spender", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "platformFeeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "treasury",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const UNISWAP_ADAPTER_ABI = [
  {
    type: "function",
    name: "swapExactInput",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "routeTarget", type: "address" },
      { name: "routeCalldata", type: "bytes" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const V4_QUOTER_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [...POOL_KEY_COMPONENTS],
          },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "quoteExactInput",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "exactCurrency", type: "address" },
          {
            name: "path",
            type: "tuple[]",
            components: [...PATH_KEY_COMPONENTS],
          },
          { name: "exactAmount", type: "uint128" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

const UNIVERSAL_ROUTER_ABI = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export type UniswapPoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export type UniswapPathKey = {
  intermediateCurrency: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
  hookData: Hex;
};

export type UniswapQuoteHop = {
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  tickSpacing: number;
};

export type UniswapQuoteMeta = {
  source: typeof UNISWAP_QUOTE_SOURCE;
  fromChain: number;
  toChain: number;
  protocol: string;
  routerAddress: Address;
  poolManager: Address;
  quoter: Address;
  srcDecimals: number;
  destDecimals: number;
  amount: string;
  srcToken: string;
  destToken: string;
  routeKind: "single" | "multi";
  poolKey?: UniswapPoolKey;
  zeroForOne?: boolean;
  path?: UniswapPathKey[];
  hops: UniswapQuoteHop[];
};

export type UniswapQuote = {
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
  priceImpact: number;
  gasEstimate: string;
  slippage: number;
  feeMode: "none" | typeof TOWER_SWAP_FEE_MODE;
  feeBps?: number;
  feeRecipient?: string;
  platformFeeAmount?: string;
  platformFeeAmountNative?: string;
  uniswap: UniswapQuoteMeta;
  route: {
    type: "single" | "multi";
    rawPath?: string;
    hops: Array<{
      dexId: typeof UNISWAP_DEX_ID;
      dex?: typeof UNISWAP_DEX_ID;
      dexName: typeof UNISWAP_DEX_NAME;
      dexRouter: string;
      path: string[];
      feeTier?: number;
      amountIn: string;
      amountOut: string;
      priceImpact: number;
    }>;
  };
};

export type UniswapSwapTransaction = {
  to: string;
  data: Hex;
  value: string;
  from: string;
  gasLimit: string;
  chainId: number;
  expectedUserOutput?: string;
  feeMode: "none" | typeof TOWER_SWAP_FEE_MODE;
  feeBps?: number;
  feeRecipient?: string;
  feeToken?: string;
  platformFeeAmount?: string;
  executorAddress?: string;
  inputToken?: string;
  outputToken?: string;
  inputAmountNative?: string;
};

type UniswapQuoteCacheEntry = {
  quote: UniswapQuote;
  fetchedAt: number;
};

type UniswapExecutorFeeState = {
  enabled: boolean;
  feeBps: number;
  treasury: Address | null;
};

type QuotedUniswapRoute = {
  amountOut: bigint;
  gasEstimate: bigint;
  routeKind: "single" | "multi";
  poolKey?: UniswapPoolKey;
  zeroForOne?: boolean;
  path?: UniswapPathKey[];
  hops: UniswapQuoteHop[];
};

const uniswapQuoteCache = new Map<string, UniswapQuoteCacheEntry>();

let executorFeeStateCache: {
  state: UniswapExecutorFeeState;
  expiresAt: number;
} | null = null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const resolveOptionalAddress = (value?: string | null) =>
  value && isAddress(value) ? getAddress(value) : null;

const parseTowerSwapFeeBps = (value?: string | null) => {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= Number(BPS_DENOMINATOR)
    ? parsed
    : DEFAULT_TOWER_SWAP_FEE_BPS;
};

const UNISWAP_SWAP_FEE_BPS = parseTowerSwapFeeBps(
  process.env.NEXT_PUBLIC_TOWER_SWAP_FEE_BPS ||
    process.env.TOWER_SWAP_FEE_BPS ||
    process.env.NEXT_PUBLIC_SWAP_FEE_BPS ||
    process.env.SWAP_FEE_BPS,
);

const UNISWAP_SWAP_FEE_RECIPIENT =
  resolveOptionalAddress(
    process.env.NEXT_PUBLIC_TOWER_SWAP_FEE_RECIPIENT ||
      process.env.TOWER_SWAP_FEE_RECIPIENT ||
      process.env.NEXT_PUBLIC_TOWER_SWAP_EXECUTOR_TREASURY ||
      process.env.TOWER_SWAP_EXECUTOR_TREASURY,
  ) || getAddress(UNISWAP_SWAP_FEE_RECIPIENT_DEFAULT);

const scaleAmount = (amount: bigint, fromDecimals: number, toDecimals: number) => {
  if (fromDecimals === toDecimals) {
    return amount;
  }

  return fromDecimals < toDecimals
    ? amount * 10n ** BigInt(toDecimals - fromDecimals)
    : amount / 10n ** BigInt(fromDecimals - toDecimals);
};

const toHexQuantity = (value: bigint | number | string) => {
  if (typeof value === "string" && value.startsWith("0x")) {
    return `0x${BigInt(value).toString(16)}` as Hex;
  }

  return `0x${BigInt(value).toString(16)}` as Hex;
};

const withTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const getQuoteCacheKey = (params: {
  srcToken: string;
  destToken: string;
  amount: string;
  slippageBps: number;
  adapterAddress?: Address | null;
}) =>
  `${params.srcToken.toLowerCase()}:${params.destToken.toLowerCase()}:${params.amount}:${params.slippageBps}:${(
    params.adapterAddress || "direct"
  ).toLowerCase()}`;

const readCachedQuote = (cacheKey: string, maxAgeMs: number) => {
  const cached = uniswapQuoteCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.fetchedAt > maxAgeMs) {
    return null;
  }

  return cached.quote;
};

const createUniswapPublicClient = () => {
  const urls = getArcMainnetRpcUrls();
  return createPublicClient({
    chain: aeroArcMainnet,
    transport: fallback(
      urls.map((url) =>
        http(url, {
          retryCount: 1,
          timeout: 8_000,
        }),
      ),
    ),
  });
};

const sortCurrencies = (tokenA: Address, tokenB: Address) => {
  const left = getAddress(tokenA);
  const right = getAddress(tokenB);
  return left.toLowerCase() < right.toLowerCase()
    ? ([left, right] as const)
    : ([right, left] as const);
};

const buildPoolKey = (
  tokenA: Address,
  tokenB: Address,
  fee: number,
  tickSpacing: number,
): UniswapPoolKey => {
  const [currency0, currency1] = sortCurrencies(tokenA, tokenB);
  return {
    currency0,
    currency1,
    fee,
    tickSpacing,
    hooks: UNISWAP_HOOKS_NONE,
  };
};

const toActionBytes = (...actions: number[]) =>
  concatHex(actions.map((action) => numberToHex(action, { size: 1 })));

const encodeSettleAll = (currency: Address, maxAmount: bigint) =>
  encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
    ],
    [currency, maxAmount],
  );

const encodeTakeAll = (currency: Address, minAmount: bigint) =>
  encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
    ],
    [currency, minAmount],
  );

const encodeExactInputSingle = (params: {
  poolKey: UniswapPoolKey;
  zeroForOne: boolean;
  amountIn: bigint;
  amountOutMinimum: bigint;
}) =>
  encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [...POOL_KEY_COMPONENTS],
          },
          { name: "zeroForOne", type: "bool" },
          { name: "amountIn", type: "uint128" },
          { name: "amountOutMinimum", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    [
      {
        poolKey: params.poolKey,
        zeroForOne: params.zeroForOne,
        amountIn: params.amountIn,
        amountOutMinimum: params.amountOutMinimum,
        hookData: "0x",
      },
    ],
  );

const encodeExactInput = (params: {
  currencyIn: Address;
  path: UniswapPathKey[];
  amountIn: bigint;
  amountOutMinimum: bigint;
}) =>
  encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "currencyIn", type: "address" },
          {
            name: "path",
            type: "tuple[]",
            components: [...PATH_KEY_COMPONENTS],
          },
          { name: "amountIn", type: "uint128" },
          { name: "amountOutMinimum", type: "uint128" },
        ],
      },
    ],
    [
      {
        currencyIn: params.currencyIn,
        path: params.path,
        amountIn: params.amountIn,
        amountOutMinimum: params.amountOutMinimum,
      },
    ],
  );

const encodeV4SwapCalldata = (params: {
  actions: Hex;
  swapParams: Hex[];
  deadline: bigint;
}) => {
  const v4SwapInput = encodeAbiParameters(
    [
      { type: "bytes" },
      { type: "bytes[]" },
    ],
    [params.actions, params.swapParams],
  );

  return encodeFunctionData({
    abi: UNIVERSAL_ROUTER_ABI,
    functionName: "execute",
    args: [
      numberToHex(V4_SWAP_COMMAND, { size: 1 }),
      [v4SwapInput],
      params.deadline,
    ],
  });
};

export function getUniswapExecutorAddress(): Address {
  const executorV2 = getTowerSwapExecutorV2Address();
  if (executorV2) return executorV2;
  return (
    resolveOptionalAddress(
      process.env.NEXT_PUBLIC_TOWER_SWAP_EXECUTOR_MAINNET_ADDRESS ||
        process.env.TOWER_SWAP_EXECUTOR_MAINNET_ADDRESS,
    ) || getAddress(UNISWAP_SWAP_EXECUTOR_MAINNET_DEFAULT)
  );
}

export function getUniswapAdapterAddress(): Address | null {
  return resolveOptionalAddress(
    process.env.NEXT_PUBLIC_UNISWAP_ADAPTER_V2_MAINNET_ADDRESS ||
      process.env.UNISWAP_ADAPTER_V2_MAINNET_ADDRESS ||
      process.env.NEXT_PUBLIC_UNISWAP_ADAPTER_MAINNET_ADDRESS ||
      process.env.UNISWAP_ADAPTER_MAINNET_ADDRESS ||
      process.env.NEXT_PUBLIC_UNISWAP_ADAPTER_ADDRESS,
  );
}

export function getUniswapRouterAddress(): Address {
  return (
    resolveOptionalAddress(
      process.env.NEXT_PUBLIC_UNISWAP_UNIVERSAL_ROUTER_ADDRESS ||
        process.env.UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
    ) || UNISWAP_UNIVERSAL_ROUTER_V4
  );
}

const isAllowedUniswapRouteTarget = (target: Address) => {
  const normalized = target.toLowerCase();
  return (
    normalized === getUniswapRouterAddress().toLowerCase() ||
    normalized === UNISWAP_UNIVERSAL_ROUTER.toLowerCase() ||
    normalized === UNISWAP_UNIVERSAL_ROUTER_V4.toLowerCase() ||
    (!isTowerSwapExecutorV2Enabled() &&
      normalized === UNISWAP_PERMIT2.toLowerCase())
  );
};

async function getUniswapExecutorFeeState(
  executorAddress: Address,
): Promise<UniswapExecutorFeeState> {
  if (executorFeeStateCache && Date.now() < executorFeeStateCache.expiresAt) {
    return executorFeeStateCache.state;
  }

  const disabledState: UniswapExecutorFeeState = {
    enabled: false,
    feeBps: UNISWAP_SWAP_FEE_BPS,
    treasury: UNISWAP_SWAP_FEE_RECIPIENT,
  };

  try {
    const client = createUniswapPublicClient();
    const [onChainFeeBps, treasury] = await Promise.all([
      client.readContract({
        address: executorAddress,
        abi: TOWER_SWAP_EXECUTOR_ABI,
        functionName: "platformFeeBps",
      }),
      client.readContract({
        address: executorAddress,
        abi: TOWER_SWAP_EXECUTOR_ABI,
        functionName: "treasury",
      }),
    ]);

    const feeBps =
      Number(onChainFeeBps) > 0 ? Number(onChainFeeBps) : UNISWAP_SWAP_FEE_BPS;
    const resolvedTreasury =
      treasury && isAddress(treasury) && treasury.toLowerCase() !== zeroAddress
        ? getAddress(treasury)
        : UNISWAP_SWAP_FEE_RECIPIENT;
    const state: UniswapExecutorFeeState = {
      enabled: Boolean(feeBps > 0 && resolvedTreasury),
      feeBps,
      treasury: resolvedTreasury,
    };
    executorFeeStateCache = {
      state,
      expiresAt: Date.now() + EXECUTOR_FEE_STATE_TTL_MS,
    };
    return state;
  } catch (error) {
    console.warn("[Uniswap] executor fee state unavailable:", readErrorMessage(error));
    executorFeeStateCache = {
      state: disabledState,
      expiresAt: Date.now() + EXECUTOR_FEE_STATE_TTL_MS,
    };
    return disabledState;
  }
}

export function isUniswapSupportedChain(chainId: number) {
  return chainId === UNISWAP_CHAIN_ID;
}

export function isUniswapSupportedToken(token: string) {
  if (!isAddress(token)) {
    return false;
  }

  const normalized = getAddress(token).toLowerCase();
  return UNISWAP_SUPPORTED_TOKENS.some(
    (supported) => supported.toLowerCase() === normalized,
  );
}

export function isUniswapSupportedPair(inputToken: string, outputToken: string) {
  return (
    isUniswapSupportedToken(inputToken) &&
    isUniswapSupportedToken(outputToken) &&
    inputToken.toLowerCase() !== outputToken.toLowerCase()
  );
}

export function normalizeUniswapDexId(dexId?: string) {
  const normalized = String(dexId || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");

  if (
    normalized === UNISWAP_DEX_ID ||
    normalized === "uni" ||
    normalized === "uniswap-v4" ||
    normalized === "uniswap-v3" ||
    normalized.includes("uniswap")
  ) {
    return UNISWAP_DEX_ID;
  }

  return null;
}

export function getUniswapDexInfo() {
  return {
    id: UNISWAP_DEX_ID,
    name: UNISWAP_DEX_NAME,
    enabled: isUniswapEnabled(),
    type: "amm",
    chainId: UNISWAP_CHAIN_ID,
    routerAddress: getUniswapAdapterAddress() || getUniswapRouterAddress(),
    quoterAddress: UNISWAP_QUOTER,
    universalRouterAddress: getUniswapRouterAddress(),
    permit2Address: UNISWAP_PERMIT2,
    supportedTokens: UNISWAP_SUPPORTED_TOKENS,
    feeTiers: UNISWAP_FEE_TIERS.map((tier) => tier.fee),
  } as const;
}

export function isUniswapQuote(quote: unknown): quote is UniswapQuote {
  if (!isRecord(quote) || !isRecord(quote.uniswap)) {
    return false;
  }

  return (
    quote.uniswap.source === UNISWAP_QUOTE_SOURCE &&
    typeof quote.uniswap.routerAddress === "string" &&
    (quote.uniswap.routeKind === "single" || quote.uniswap.routeKind === "multi")
  );
}

const parseQuotedAmount = (result: unknown) => {
  if (Array.isArray(result) && result.length >= 1) {
    try {
      const amountOut = BigInt(result[0] as bigint | number | string);
      const gasEstimate =
        result.length > 1 ? BigInt(result[1] as bigint | number | string) : 0n;
      return amountOut > 0n ? { amountOut, gasEstimate } : null;
    } catch {
      return null;
    }
  }

  if (isRecord(result)) {
    try {
      const amountOut = BigInt((result.amountOut as bigint | number | string) || 0);
      const gasEstimate = BigInt(
        (result.gasEstimate as bigint | number | string) || 0,
      );
      return amountOut > 0n ? { amountOut, gasEstimate } : null;
    } catch {
      return null;
    }
  }

  return null;
};

async function quoteExactInputSingle(params: {
  poolKey: UniswapPoolKey;
  zeroForOne: boolean;
  exactAmount: bigint;
}): Promise<{ amountOut: bigint; gasEstimate: bigint } | null> {
  if (params.exactAmount <= 0n || params.exactAmount > UINT128_MAX) {
    return null;
  }

  try {
    const client = createUniswapPublicClient();
    const { result } = await client.simulateContract({
      address: UNISWAP_QUOTER,
      abi: V4_QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [
        {
          poolKey: params.poolKey,
          zeroForOne: params.zeroForOne,
          exactAmount: params.exactAmount,
          hookData: "0x",
        },
      ],
      account: UNISWAP_SWAP_FEE_RECIPIENT,
    });
    return parseQuotedAmount(result);
  } catch {
    return null;
  }
}

async function quoteExactInput(params: {
  currencyIn: Address;
  path: UniswapPathKey[];
  exactAmount: bigint;
}): Promise<{ amountOut: bigint; gasEstimate: bigint } | null> {
  if (params.exactAmount <= 0n || params.exactAmount > UINT128_MAX) {
    return null;
  }

  try {
    const client = createUniswapPublicClient();
    const { result } = await client.simulateContract({
      address: UNISWAP_QUOTER,
      abi: V4_QUOTER_ABI,
      functionName: "quoteExactInput",
      args: [
        {
          exactCurrency: params.currencyIn,
          path: params.path,
          exactAmount: params.exactAmount,
        },
      ],
      account: UNISWAP_SWAP_FEE_RECIPIENT,
    });
    return parseQuotedAmount(result);
  } catch {
    return null;
  }
}

async function quoteBestSingleHop(params: {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
}): Promise<QuotedUniswapRoute | null> {
  const quotes = await Promise.all(
    UNISWAP_FEE_TIERS.map(async (tier) => {
      const poolKey = buildPoolKey(
        params.tokenIn,
        params.tokenOut,
        tier.fee,
        tier.tickSpacing,
      );
      const zeroForOne =
        params.tokenIn.toLowerCase() === poolKey.currency0.toLowerCase();
      const quoted = await quoteExactInputSingle({
        poolKey,
        zeroForOne,
        exactAmount: params.amountIn,
      });
      if (!quoted) {
        return null;
      }

      return {
        amountOut: quoted.amountOut,
        gasEstimate: quoted.gasEstimate,
        routeKind: "single" as const,
        poolKey,
        zeroForOne,
        hops: [
          {
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            fee: tier.fee,
            tickSpacing: tier.tickSpacing,
          },
        ],
      };
    }),
  );

  return quotes.reduce<QuotedUniswapRoute | null>((best, quote) => {
    if (!quote) {
      return best;
    }
    if (!best || quote.amountOut > best.amountOut) {
      return quote;
    }
    return best;
  }, null);
}

async function quoteUsdcHop(params: {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
}): Promise<QuotedUniswapRoute | null> {
  const usdc = AERO_MAINNET_TOKENS.USDC;
  if (
    params.tokenIn.toLowerCase() === usdc.toLowerCase() ||
    params.tokenOut.toLowerCase() === usdc.toLowerCase()
  ) {
    return null;
  }

  const firstHopQuotes = await Promise.all(
    UNISWAP_FEE_TIERS.map(async (tier) => {
      const quoted = await quoteExactInputSingle({
        poolKey: buildPoolKey(params.tokenIn, usdc, tier.fee, tier.tickSpacing),
        zeroForOne:
          params.tokenIn.toLowerCase() < usdc.toLowerCase(),
        exactAmount: params.amountIn,
      });
      if (!quoted) {
        return null;
      }
      return { ...quoted, fee: tier.fee, tickSpacing: tier.tickSpacing };
    }),
  );

  const bestFirstHop = firstHopQuotes.reduce<
    { amountOut: bigint; gasEstimate: bigint; fee: number; tickSpacing: number } | null
  >((best, quote) => {
    if (!quote) {
      return best;
    }
    if (!best || quote.amountOut > best.amountOut) {
      return quote;
    }
    return best;
  }, null);

  if (!bestFirstHop) {
    return null;
  }

  const secondHopQuotes = await Promise.all(
    UNISWAP_FEE_TIERS.map(async (tier) => {
      const path: UniswapPathKey[] = [
        {
          intermediateCurrency: usdc,
          fee: bestFirstHop.fee,
          tickSpacing: bestFirstHop.tickSpacing,
          hooks: UNISWAP_HOOKS_NONE,
          hookData: "0x",
        },
        {
          intermediateCurrency: params.tokenOut,
          fee: tier.fee,
          tickSpacing: tier.tickSpacing,
          hooks: UNISWAP_HOOKS_NONE,
          hookData: "0x",
        },
      ];
      const quoted =
        (await quoteExactInput({
          currencyIn: params.tokenIn,
          path,
          exactAmount: params.amountIn,
        })) ||
        (await quoteExactInputSingle({
          poolKey: buildPoolKey(
            usdc,
            params.tokenOut,
            tier.fee,
            tier.tickSpacing,
          ),
          zeroForOne: usdc.toLowerCase() < params.tokenOut.toLowerCase(),
          exactAmount: bestFirstHop.amountOut,
        }));
      if (!quoted) {
        return null;
      }
      return {
        amountOut: quoted.amountOut,
        gasEstimate: quoted.gasEstimate + bestFirstHop.gasEstimate,
        routeKind: "multi" as const,
        path,
        hops: [
          {
            tokenIn: params.tokenIn,
            tokenOut: usdc,
            fee: bestFirstHop.fee,
            tickSpacing: bestFirstHop.tickSpacing,
          },
          {
            tokenIn: usdc,
            tokenOut: params.tokenOut,
            fee: tier.fee,
            tickSpacing: tier.tickSpacing,
          },
        ],
      };
    }),
  );

  return secondHopQuotes.reduce<QuotedUniswapRoute | null>((best, quote) => {
    if (!quote) {
      return best;
    }
    if (!best || quote.amountOut > best.amountOut) {
      return quote;
    }
    return best;
  }, null);
}

async function quoteBestUniswapRoute(params: {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
}): Promise<QuotedUniswapRoute | null> {
  const [direct, hop] = await Promise.all([
    quoteBestSingleHop(params),
    quoteUsdcHop(params),
  ]);

  if (direct && hop) {
    return hop.amountOut > direct.amountOut ? hop : direct;
  }

  return direct || hop;
}

const mapUniswapQuote = (params: {
  srcToken: Address;
  destToken: Address;
  amountIn: bigint;
  swapInputAmountNative: bigint;
  srcDecimals: number;
  destDecimals: number;
  slippageBps: number;
  quoted: QuotedUniswapRoute;
  shouldCollectExecutorFee: boolean;
  feeBps: number;
  treasury: Address | null;
  platformFeeAmountNative: bigint;
}): UniswapQuote => {
  const minOut =
    (params.quoted.amountOut * (BPS_DENOMINATOR - BigInt(params.slippageBps))) /
    BPS_DENOMINATOR;
  const hops = params.quoted.hops.map((hop, index) => ({
    dexId: UNISWAP_DEX_ID,
    dex: UNISWAP_DEX_ID,
    dexName: UNISWAP_DEX_NAME,
    dexRouter: getUniswapRouterAddress(),
    path: [hop.tokenIn, hop.tokenOut],
    feeTier: hop.fee,
    amountIn:
      index === 0 ? params.swapInputAmountNative.toString() : params.quoted.amountOut.toString(),
    amountOut: params.quoted.amountOut.toString(),
    priceImpact: 0,
  }));

  return {
    inputToken: params.srcToken,
    outputToken: params.destToken,
    inputAmount: scaleAmount(
      params.amountIn,
      params.srcDecimals,
      NORMALIZED_DECIMALS,
    ).toString(),
    swapInputAmount: scaleAmount(
      params.swapInputAmountNative,
      params.srcDecimals,
      NORMALIZED_DECIMALS,
    ).toString(),
    outputAmount: scaleAmount(
      params.quoted.amountOut,
      params.destDecimals,
      NORMALIZED_DECIMALS,
    ).toString(),
    minOut: scaleAmount(minOut, params.destDecimals, NORMALIZED_DECIMALS).toString(),
    inputAmountNative: params.amountIn.toString(),
    swapInputAmountNative: params.swapInputAmountNative.toString(),
    outputAmountNative: params.quoted.amountOut.toString(),
    minOutNative: minOut.toString(),
    priceImpact: 0,
    gasEstimate: params.shouldCollectExecutorFee
      ? EXECUTOR_GAS_LIMIT.toString()
      : (params.quoted.gasEstimate > 0n
          ? params.quoted.gasEstimate
          : DEFAULT_GAS_LIMIT
        ).toString(),
    slippage: params.slippageBps,
    feeMode: params.shouldCollectExecutorFee ? TOWER_SWAP_FEE_MODE : "none",
    feeBps: params.shouldCollectExecutorFee ? params.feeBps : undefined,
    feeRecipient: params.shouldCollectExecutorFee
      ? params.treasury || undefined
      : undefined,
    platformFeeAmount:
      params.platformFeeAmountNative > 0n
        ? scaleAmount(
            params.platformFeeAmountNative,
            params.srcDecimals,
            NORMALIZED_DECIMALS,
          ).toString()
        : undefined,
    platformFeeAmountNative:
      params.platformFeeAmountNative > 0n
        ? params.platformFeeAmountNative.toString()
        : undefined,
    uniswap: {
      source: UNISWAP_QUOTE_SOURCE,
      fromChain: UNISWAP_CHAIN_ID,
      toChain: UNISWAP_CHAIN_ID,
      protocol:
        params.quoted.routeKind === "multi" ? "Uniswap v4 multi-hop" : "Uniswap v4",
      routerAddress: getUniswapRouterAddress(),
      poolManager: UNISWAP_POOL_MANAGER,
      quoter: UNISWAP_QUOTER,
      srcDecimals: params.srcDecimals,
      destDecimals: params.destDecimals,
      amount: params.swapInputAmountNative.toString(),
      srcToken: params.srcToken,
      destToken: params.destToken,
      routeKind: params.quoted.routeKind,
      poolKey: params.quoted.poolKey,
      zeroForOne: params.quoted.zeroForOne,
      path: params.quoted.path,
      hops: params.quoted.hops,
    },
    route: {
      type: params.quoted.routeKind,
      rawPath: params.quoted.hops
        .map((hop) => `${hop.tokenIn}->${hop.tokenOut}@${hop.fee}`)
        .join(" > "),
      hops,
    },
  };
};

export async function getUniswapQuote(params: {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  slippageBps: number;
  chainId: number;
}): Promise<UniswapQuote | null> {
  if (!isUniswapEnabled() || !isUniswapSupportedChain(params.chainId)) {
    return null;
  }

  if (!isUniswapSupportedPair(params.inputToken, params.outputToken)) {
    return null;
  }

  let amountIn: bigint;
  try {
    amountIn = BigInt(params.inputAmount);
  } catch {
    return null;
  }

  if (amountIn <= 0n) {
    return null;
  }

  const srcToken = getAddress(params.inputToken);
  const destToken = getAddress(params.outputToken);
  const adapterAddress = getUniswapAdapterAddress();
  const cacheKey = getQuoteCacheKey({
    srcToken,
    destToken,
    amount: amountIn.toString(),
    slippageBps: params.slippageBps,
    adapterAddress,
  });
  const freshCachedQuote = readCachedQuote(cacheKey, QUOTE_CACHE_SOFT_TTL_MS);
  if (freshCachedQuote) {
    return freshCachedQuote;
  }

  const staleCachedQuote = readCachedQuote(cacheKey, QUOTE_CACHE_HARD_TTL_MS);

  try {
    const srcDecimals = getTokenDecimalsByAddress(srcToken);
    const destDecimals = getTokenDecimalsByAddress(destToken);
    const executorAddress = getUniswapExecutorAddress();
    const canCollectExecutorFee = Boolean(adapterAddress && executorAddress);
    const disabledFeeState: UniswapExecutorFeeState = {
      enabled: false,
      feeBps: UNISWAP_SWAP_FEE_BPS,
      treasury: UNISWAP_SWAP_FEE_RECIPIENT,
    };
    const feeState = canCollectExecutorFee
      ? await withTimeout(
          getUniswapExecutorFeeState(executorAddress),
          FEE_STATE_TIMEOUT_MS,
          "Uniswap executor fee state timed out",
        ).catch(() => disabledFeeState)
      : disabledFeeState;
    const shouldCollectExecutorFee = canCollectExecutorFee && feeState.enabled;
    const platformFeeAmountNative = shouldCollectExecutorFee
      ? (amountIn * BigInt(feeState.feeBps)) / BPS_DENOMINATOR
      : 0n;
    const swapInputAmountNative = amountIn - platformFeeAmountNative;

    if (swapInputAmountNative <= 0n) {
      return staleCachedQuote;
    }

    const quoted = await withTimeout(
      quoteBestUniswapRoute({
        tokenIn: srcToken,
        tokenOut: destToken,
        amountIn: swapInputAmountNative,
      }),
      QUOTE_TIMEOUT_MS,
      `Uniswap quote timed out after ${QUOTE_TIMEOUT_MS}ms`,
    );

    if (!quoted) {
      return staleCachedQuote;
    }

    const mappedQuote = mapUniswapQuote({
      srcToken,
      destToken,
      amountIn,
      swapInputAmountNative,
      srcDecimals,
      destDecimals,
      slippageBps: params.slippageBps,
      quoted,
      shouldCollectExecutorFee,
      feeBps: feeState.feeBps,
      treasury: feeState.treasury,
      platformFeeAmountNative,
    });

    uniswapQuoteCache.set(cacheKey, {
      quote: mappedQuote,
      fetchedAt: Date.now(),
    });
    return mappedQuote;
  } catch (error) {
    if (staleCachedQuote) {
      console.warn(
        "[Uniswap] quote unavailable, reusing cached route:",
        readErrorMessage(error),
      );
      return staleCachedQuote;
    }

    console.warn("[Uniswap] quote unavailable:", readErrorMessage(error));
    return null;
  }
}

const encodeUniswapRouteCalldata = (params: {
  quote: UniswapQuote;
  amountIn: bigint;
  minOut: bigint;
  deadline: bigint;
}) => {
  const meta = params.quote.uniswap;

  if (meta.routeKind === "multi") {
    if (!meta.path || meta.path.length === 0) {
      throw new Error("Uniswap multi-hop quote is missing a v4 path");
    }

    return encodeV4SwapCalldata({
      actions: toActionBytes(
        V4_ACTIONS.SWAP_EXACT_IN,
        V4_ACTIONS.SETTLE_ALL,
        V4_ACTIONS.TAKE_ALL,
      ),
      swapParams: [
        encodeExactInput({
          currencyIn: getAddress(meta.srcToken),
          path: meta.path,
          amountIn: params.amountIn,
          amountOutMinimum: params.minOut,
        }),
        encodeSettleAll(getAddress(meta.srcToken), params.amountIn),
        encodeTakeAll(getAddress(meta.destToken), params.minOut),
      ],
      deadline: params.deadline,
    });
  }

  if (!meta.poolKey || typeof meta.zeroForOne !== "boolean") {
    throw new Error("Uniswap single-hop quote is missing a v4 pool key");
  }

  return encodeV4SwapCalldata({
    actions: toActionBytes(
      V4_ACTIONS.SWAP_EXACT_IN_SINGLE,
      V4_ACTIONS.SETTLE_ALL,
      V4_ACTIONS.TAKE_ALL,
    ),
    swapParams: [
      encodeExactInputSingle({
        poolKey: meta.poolKey,
        zeroForOne: meta.zeroForOne,
        amountIn: params.amountIn,
        amountOutMinimum: params.minOut,
      }),
      encodeSettleAll(getAddress(meta.srcToken), params.amountIn),
      encodeTakeAll(getAddress(meta.destToken), params.minOut),
    ],
    deadline: params.deadline,
  });
};

export async function buildUniswapSwapTransaction(params: {
  quote: UniswapQuote;
  userAddress: string;
}) {
  if (!isAddress(params.userAddress)) {
    throw new Error("Missing userAddress for Uniswap swap");
  }

  const meta = params.quote.uniswap;
  const userAddress = getAddress(params.userAddress);
  const srcToken = getAddress(meta.srcToken);
  const destToken = getAddress(meta.destToken);
  const amountIn = BigInt(params.quote.inputAmountNative || meta.amount);
  const swapInputAmountNative = BigInt(
    params.quote.swapInputAmountNative || meta.amount,
  );
  const adapterAddress = getUniswapAdapterAddress();
  const executorAddress = getUniswapExecutorAddress();
  const routerAddress = getUniswapRouterAddress();
  const minOutNativeRaw = BigInt(params.quote.minOutNative || "0");
  const minOutNative = minOutNativeRaw > 0n ? minOutNativeRaw : 1n;
  const deadline = BigInt(
    Math.floor(Date.now() / 1000) + SWAP_DEADLINE_SECONDS,
  );
  const approvalSpender = executorAddress;
  const approvalAmount = amountIn;
  let needsApproval = true;

  if (!adapterAddress) {
    throw new Error(
      "Uniswap adapter is not configured for TowerSwapExecutor. Set NEXT_PUBLIC_UNISWAP_ADAPTER_MAINNET_ADDRESS after deploying the adapter.",
    );
  }

  {
    const publicClient = createUniswapPublicClient();
    const [routeAllowed, spenderAllowed] = await Promise.all([
      publicClient.readContract({
        address: executorAddress,
        abi: TOWER_SWAP_EXECUTOR_ABI,
        functionName: "routeTargets",
        args: [adapterAddress],
      }),
      publicClient.readContract({
        address: executorAddress,
        abi: TOWER_SWAP_EXECUTOR_ABI,
        functionName: "approvalSpenders",
        args: [adapterAddress],
      }),
    ]);

    if (!routeAllowed || !spenderAllowed) {
      throw new Error(
        "Uniswap adapter is not allowlisted on TowerSwapExecutor. Run deploy:uniswap-adapter:mainnet or configure:tower-swap-executor:mainnet after deploying the adapter.",
      );
    }
  }

  if (!isAllowedUniswapRouteTarget(routerAddress)) {
    throw new Error(
      `Uniswap target ${routerAddress} is not Universal Router or Permit2`,
    );
  }

  const routeCalldata = encodeUniswapRouteCalldata({
    quote: params.quote,
    amountIn: swapInputAmountNative,
    minOut: minOutNative,
    deadline,
  });

  try {
    const publicClient = createUniswapPublicClient();
    const allowance = (await publicClient.readContract({
      address: srcToken,
      abi: ERC20_ALLOWANCE_ABI,
      functionName: "allowance",
      args: [userAddress, approvalSpender],
    })) as bigint;
    needsApproval = allowance < approvalAmount;
  } catch (error) {
    console.warn(
      "[Uniswap] allowance check failed, requesting approval:",
      readErrorMessage(error),
    );
    needsApproval = true;
  }

  const approval = needsApproval
    ? {
        to: srcToken,
        data: encodeFunctionData({
          abi: ERC20_APPROVE_ABI,
          functionName: "approve",
          args: [approvalSpender, approvalAmount],
        }),
        from: userAddress,
        gasLimit: toHexQuantity(DEFAULT_APPROVAL_GAS_LIMIT),
        value: "0x0",
        label: "Executor approval",
        spender: approvalSpender,
        amountRaw: approvalAmount.toString(),
        token: srcToken,
      }
    : null;

  const adapterCalldata = encodeFunctionData({
    abi: UNISWAP_ADAPTER_ABI,
    functionName: "swapExactInput",
    args: [
      srcToken,
      destToken,
      swapInputAmountNative,
      minOutNative,
      executorAddress,
      routerAddress,
      routeCalldata,
    ],
  });

  const swapData = encodeTowerSwapExecution(
    {
      tokenIn: srcToken,
      tokenOut: destToken,
      amountIn,
      minAmountOut: minOutNative,
      recipient: userAddress,
      routeTarget: adapterAddress,
      approvalSpender: adapterAddress,
      routeCalldata: adapterCalldata,
    },
    deadline,
  );

  const feeRecipient = params.quote.feeRecipient
    ? getAddress(params.quote.feeRecipient)
    : UNISWAP_SWAP_FEE_RECIPIENT;

  return {
    approval,
    swap: {
      to: executorAddress,
      data: swapData,
      value: toHexQuantity(0n),
      from: userAddress,
      gasLimit: toHexQuantity(EXECUTOR_GAS_LIMIT),
      chainId: UNISWAP_CHAIN_ID,
      expectedUserOutput:
        params.quote.outputAmountNative || params.quote.minOutNative,
      feeMode: TOWER_SWAP_FEE_MODE,
      feeBps: params.quote.feeBps,
      feeRecipient,
      feeToken: srcToken,
      platformFeeAmount: params.quote.platformFeeAmountNative,
      executorAddress,
      inputToken: srcToken,
      outputToken: destToken,
      inputAmountNative: amountIn.toString(),
    } satisfies UniswapSwapTransaction,
  };
}
