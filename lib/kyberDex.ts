import {
  createPublicClient,
  encodeFunctionData,
  fallback,
  getAddress,
  http,
  isAddress,
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
import {
  encodeTowerSwapExecution,
  getTowerSwapExecutorV2Address,
  isTowerSwapExecutorV2Enabled,
} from "@/lib/towerSwapExecutorV2";
import { isKyberEnabled } from "@/lib/kyberEnabled";
import { getTokenDecimalsByAddress } from "@/lib/swapApiContract";

export { isKyberEnabled };

export const KYBER_DEX_ID = "kyberswap" as const;
export const KYBER_DEX_NAME = "KyberSwap" as const;
export const KYBER_CHAIN_ID = AERO_CHAIN_ID;
export const KYBER_CHAIN_SLUG = "arc" as const;
export const KYBER_QUOTE_SOURCE = "kyberswap" as const;

export const KYBER_META_AGGREGATION_ROUTER_V2 =
  "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5" as Address;
export const KYBER_AGGREGATION_EXECUTOR_PROXY =
  "0x8F10B468b06c6FD214B65F87778827F7D113f996" as Address;
export const KYBER_PERMIT2_ADDRESS =
  "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;

const KYBER_API_URL_DEFAULT = "https://aggregator-api.kyberswap.com";
const KYBER_CLIENT_ID_DEFAULT = "tower-exchange";
const KYBER_NATIVE_TOKEN =
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;
const TOWER_SWAP_FEE_MODE = "tower-swap-executor" as const;
const DEFAULT_GAS_LIMIT = 800000n;
const EXECUTOR_GAS_LIMIT = 1_600_000n;
const DEFAULT_APPROVAL_GAS_LIMIT = 100000n;
const NORMALIZED_DECIMALS = 18;
const BPS_DENOMINATOR = 10_000n;
const DEFAULT_TOWER_SWAP_FEE_BPS = 30;
const EXECUTOR_FEE_STATE_TTL_MS = 30_000;
const QUOTE_TIMEOUT_MS = 8_000;
const BUILD_TIMEOUT_MS = 20_000;
const QUOTE_CACHE_SOFT_TTL_MS = 8_000;
const QUOTE_CACHE_HARD_TTL_MS = 120_000;
const KYBER_MAX_SLIPPAGE_BPS = 2_000;
const KYBER_SWAP_EXECUTOR_MAINNET_DEFAULT =
  "0xeB8940752Fa12944d3b2D736d51fA36E4dA32BC8" as Address;
const KYBER_SWAP_FEE_RECIPIENT_DEFAULT =
  "0xb3966683724303400B6fECDa1963825d994B546a" as Address;

const KYBER_SUPPORTED_TOKENS = [
  AERO_MAINNET_TOKENS.USDC,
  AERO_MAINNET_TOKENS.EURC,
  AERO_MAINNET_TOKENS.cirBTC,
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

const KYBER_ADAPTER_ABI = [
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

export type KyberRouteSummary = Record<string, unknown>;

export type KyberQuoteMeta = {
  source: typeof KYBER_QUOTE_SOURCE;
  fromChain: number;
  toChain: number;
  protocol: string;
  routerAddress: Address;
  routeSummary: KyberRouteSummary;
  srcDecimals: number;
  destDecimals: number;
  amount: string;
  srcToken: string;
  destToken: string;
  amountOutUsd?: string;
  amountInUsd?: string;
};

export type KyberQuote = {
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
  kyber: KyberQuoteMeta;
  route: {
    type: "single" | "multi" | "split";
    rawPath?: string;
    hops: Array<{
      dexId: typeof KYBER_DEX_ID;
      dex?: typeof KYBER_DEX_ID;
      dexName: typeof KYBER_DEX_NAME;
      dexRouter: string;
      path: string[];
      amountIn: string;
      amountOut: string;
      priceImpact: number;
    }>;
  };
};

export type KyberSwapTransaction = {
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

type KyberRouteHop = {
  pool?: unknown;
  tokenIn?: unknown;
  tokenOut?: unknown;
  swapAmount?: unknown;
  amountOut?: unknown;
  exchange?: unknown;
};

type KyberQuoteCacheEntry = {
  quote: KyberQuote;
  fetchedAt: number;
};

type KyberExecutorFeeState = {
  enabled: boolean;
  feeBps: number;
  treasury: Address | null;
};

const kyberQuoteCache = new Map<string, KyberQuoteCacheEntry>();

let executorFeeStateCache: {
  state: KyberExecutorFeeState;
  expiresAt: number;
} | null = null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

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

const KYBER_SWAP_FEE_BPS = parseTowerSwapFeeBps(
  process.env.NEXT_PUBLIC_TOWER_SWAP_FEE_BPS ||
    process.env.TOWER_SWAP_FEE_BPS ||
    process.env.NEXT_PUBLIC_SWAP_FEE_BPS ||
    process.env.SWAP_FEE_BPS,
);

const KYBER_SWAP_FEE_RECIPIENT =
  resolveOptionalAddress(
    process.env.NEXT_PUBLIC_TOWER_SWAP_FEE_RECIPIENT ||
      process.env.TOWER_SWAP_FEE_RECIPIENT ||
      process.env.NEXT_PUBLIC_TOWER_SWAP_EXECUTOR_TREASURY ||
      process.env.TOWER_SWAP_EXECUTOR_TREASURY,
  ) || getAddress(KYBER_SWAP_FEE_RECIPIENT_DEFAULT);

const getKyberApiBaseUrl = () =>
  (
    process.env.KYBERSWAP_API_URL ||
    process.env.NEXT_PUBLIC_KYBERSWAP_API_URL ||
    KYBER_API_URL_DEFAULT
  )
    .trim()
    .replace(/\/$/, "");

const getKyberClientId = () =>
  process.env.KYBERSWAP_CLIENT_ID?.trim() ||
  process.env.NEXT_PUBLIC_KYBERSWAP_CLIENT_ID?.trim() ||
  KYBER_CLIENT_ID_DEFAULT;

const getKyberApiKey = () =>
  process.env.KYBERSWAP_API_KEY?.trim() || process.env.KYBER_API_KEY?.trim() || "";

const getKyberHeaders = () => {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Client-Id": getKyberClientId(),
  };
  const apiKey = getKyberApiKey();
  if (apiKey) {
    headers["X-Api-Key"] = apiKey;
  }
  return headers;
};

const scaleAmount = (amount: bigint, fromDecimals: number, toDecimals: number) => {
  if (fromDecimals === toDecimals) {
    return amount;
  }

  return fromDecimals < toDecimals
    ? amount * 10n ** BigInt(toDecimals - fromDecimals)
    : amount / 10n ** BigInt(fromDecimals - toDecimals);
};

const toBigIntQuantity = (value: unknown, fallback = 0n) => {
  const raw = asString(value);
  if (!raw) {
    return fallback;
  }

  try {
    if (raw.startsWith("0x") || raw.startsWith("0X")) {
      return BigInt(raw);
    }
    if (!/^\d+$/.test(raw)) {
      return fallback;
    }
    return BigInt(raw);
  } catch {
    return fallback;
  }
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
  const cached = kyberQuoteCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.fetchedAt > maxAgeMs) {
    return null;
  }

  return cached.quote;
};

const createKyberPublicClient = () => {
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

const isKyberNativeToken = (token: string) =>
  token.toLowerCase() === KYBER_NATIVE_TOKEN.toLowerCase() ||
  token.toLowerCase() === zeroAddress;

const parsePriceImpactBps = (amountInUsd?: string | null, amountOutUsd?: string | null) => {
  const inputUsd = Number(amountInUsd);
  const outputUsd = Number(amountOutUsd);
  if (!Number.isFinite(inputUsd) || !Number.isFinite(outputUsd) || inputUsd <= 0) {
    return 0;
  }

  return Math.max(0, Math.round((1 - outputUsd / inputUsd) * 10_000));
};

const flattenKyberRoute = (route: unknown): KyberRouteHop[] => {
  if (!Array.isArray(route)) {
    return [];
  }

  return route.flatMap((path) => (Array.isArray(path) ? path : [])).filter(isRecord);
};

const isAllowedKyberRouteTarget = (target: Address) => {
  const normalized = target.toLowerCase();
  return (
    normalized === KYBER_META_AGGREGATION_ROUTER_V2.toLowerCase() ||
    normalized === KYBER_AGGREGATION_EXECUTOR_PROXY.toLowerCase() ||
    (!isTowerSwapExecutorV2Enabled() &&
      normalized === KYBER_PERMIT2_ADDRESS.toLowerCase())
  );
};

export function getKyberExecutorAddress(): Address {
  const executorV2 = getTowerSwapExecutorV2Address();
  if (executorV2) return executorV2;
  return (
    resolveOptionalAddress(
      process.env.NEXT_PUBLIC_TOWER_SWAP_EXECUTOR_MAINNET_ADDRESS ||
        process.env.TOWER_SWAP_EXECUTOR_MAINNET_ADDRESS,
    ) || getAddress(KYBER_SWAP_EXECUTOR_MAINNET_DEFAULT)
  );
}

export function getKyberAdapterAddress(): Address | null {
  return resolveOptionalAddress(
    process.env.NEXT_PUBLIC_KYBERSWAP_ADAPTER_V2_MAINNET_ADDRESS ||
      process.env.KYBERSWAP_ADAPTER_V2_MAINNET_ADDRESS ||
      process.env.NEXT_PUBLIC_KYBERSWAP_ADAPTER_MAINNET_ADDRESS ||
      process.env.KYBERSWAP_ADAPTER_MAINNET_ADDRESS ||
      process.env.NEXT_PUBLIC_KYBERSWAP_ADAPTER_ADDRESS,
  );
}

async function getKyberExecutorFeeState(
  executorAddress: Address,
): Promise<KyberExecutorFeeState> {
  if (executorFeeStateCache && Date.now() < executorFeeStateCache.expiresAt) {
    return executorFeeStateCache.state;
  }

  const disabledState: KyberExecutorFeeState = {
    enabled: false,
    feeBps: KYBER_SWAP_FEE_BPS,
    treasury: KYBER_SWAP_FEE_RECIPIENT,
  };

  try {
    const client = createKyberPublicClient();
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
      Number(onChainFeeBps) > 0 ? Number(onChainFeeBps) : KYBER_SWAP_FEE_BPS;
    const resolvedTreasury =
      treasury && isAddress(treasury) && treasury.toLowerCase() !== zeroAddress
        ? getAddress(treasury)
        : KYBER_SWAP_FEE_RECIPIENT;
    const state: KyberExecutorFeeState = {
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
    console.warn("[KyberSwap] executor fee state unavailable:", readErrorMessage(error));
    executorFeeStateCache = {
      state: disabledState,
      expiresAt: Date.now() + EXECUTOR_FEE_STATE_TTL_MS,
    };
    return disabledState;
  }
}

export function isKyberSupportedChain(chainId: number) {
  return chainId === KYBER_CHAIN_ID;
}

export function isKyberSupportedToken(token: string) {
  if (!isAddress(token)) {
    return false;
  }

  const normalized = getAddress(token).toLowerCase();
  return KYBER_SUPPORTED_TOKENS.some((supported) => supported.toLowerCase() === normalized);
}

export function isKyberSupportedPair(inputToken: string, outputToken: string) {
  return (
    isKyberSupportedToken(inputToken) &&
    isKyberSupportedToken(outputToken) &&
    inputToken.toLowerCase() !== outputToken.toLowerCase()
  );
}

export function normalizeKyberDexId(dexId?: string) {
  const normalized = String(dexId || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");

  if (
    normalized === KYBER_DEX_ID ||
    normalized === "kyber" ||
    normalized === "knc" ||
    normalized === "kyber-swap" ||
    normalized.includes("kyber")
  ) {
    return KYBER_DEX_ID;
  }

  return null;
}

export function getKyberDexInfo() {
  return {
    id: KYBER_DEX_ID,
    name: KYBER_DEX_NAME,
    enabled: isKyberEnabled(),
    type: "aggregator",
    chainId: KYBER_CHAIN_ID,
    routerAddress: getKyberAdapterAddress() || KYBER_META_AGGREGATION_ROUTER_V2,
    supportedTokens: KYBER_SUPPORTED_TOKENS,
  } as const;
}

export function isKyberQuote(quote: unknown): quote is KyberQuote {
  if (!isRecord(quote) || !isRecord(quote.kyber)) {
    return false;
  }

  return (
    quote.kyber.source === KYBER_QUOTE_SOURCE &&
    isRecord(quote.kyber.routeSummary) &&
    typeof quote.kyber.routerAddress === "string"
  );
}

const getPartnerFeeParams = () => {
  if (KYBER_SWAP_FEE_BPS <= 0 || !KYBER_SWAP_FEE_RECIPIENT) {
    return null;
  }

  return {
    feeAmount: String(KYBER_SWAP_FEE_BPS),
    chargeFeeBy: "currency_in" as const,
    isInBps: true,
    feeReceiver: KYBER_SWAP_FEE_RECIPIENT,
  };
};

const fetchKyberRoute = async (params: {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  includePartnerFee: boolean;
}) => {
  const url = new URL(`${getKyberApiBaseUrl()}/${KYBER_CHAIN_SLUG}/api/v1/routes`);
  url.searchParams.set("tokenIn", params.tokenIn);
  url.searchParams.set("tokenOut", params.tokenOut);
  url.searchParams.set("amountIn", params.amountIn);

  const partnerFee = params.includePartnerFee ? getPartnerFeeParams() : null;
  if (partnerFee) {
    url.searchParams.set("feeAmount", partnerFee.feeAmount);
    url.searchParams.set("chargeFeeBy", partnerFee.chargeFeeBy);
    url.searchParams.set("isInBps", String(partnerFee.isInBps));
    url.searchParams.set("feeReceiver", partnerFee.feeReceiver);
  }

  const response = await fetch(url, {
    method: "GET",
    headers: getKyberHeaders(),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  const message =
    (isRecord(payload) && (asString(payload.message) || asString(payload.error))) ||
    `KyberSwap quote HTTP ${response.status}`;

  if (!response.ok) {
    throw new Error(message);
  }

  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new Error("KyberSwap quote returned an empty payload");
  }

  const routeSummary = payload.data.routeSummary;
  const routerAddress = asString(payload.data.routerAddress);
  if (!isRecord(routeSummary) || !routerAddress || !isAddress(routerAddress)) {
    throw new Error("KyberSwap quote did not include a usable route");
  }

  return {
    routeSummary,
    routerAddress: getAddress(routerAddress),
  };
};

const encodeKyberRoute = async (params: {
  routeSummary: KyberRouteSummary;
  sender: Address;
  recipient: Address;
  slippageBps: number;
}) => {
  const url = `${getKyberApiBaseUrl()}/${KYBER_CHAIN_SLUG}/api/v1/route/build`;
  const slippageTolerance = Math.min(
    Math.max(params.slippageBps, 0),
    KYBER_MAX_SLIPPAGE_BPS,
  );

  const response = await fetch(url, {
    method: "POST",
    headers: getKyberHeaders(),
    body: JSON.stringify({
      routeSummary: params.routeSummary,
      sender: params.sender,
      recipient: params.recipient,
      origin: params.sender,
      slippageTolerance,
      ignoreCappedSlippage: params.slippageBps > KYBER_MAX_SLIPPAGE_BPS,
      source: getKyberClientId(),
    }),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  const message =
    (isRecord(payload) && (asString(payload.message) || asString(payload.error))) ||
    `KyberSwap encode HTTP ${response.status}`;

  if (!response.ok) {
    throw new Error(message);
  }

  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new Error("KyberSwap encode returned an empty payload");
  }

  const data = asString(payload.data.data);
  const routerAddress = asString(payload.data.routerAddress);
  if (!data || !data.startsWith("0x") || !routerAddress || !isAddress(routerAddress)) {
    throw new Error("KyberSwap did not return encoded swap calldata");
  }

  return {
    data: data as Hex,
    routerAddress: getAddress(routerAddress),
    amountOut: asString(payload.data.amountOut),
    gas: asString(payload.data.gas),
    transactionValue: asString(payload.data.transactionValue) || "0",
  };
};

const mapKyberQuote = (params: {
  srcToken: Address;
  destToken: Address;
  amountIn: bigint;
  swapInputAmountNative: bigint;
  srcDecimals: number;
  destDecimals: number;
  slippageBps: number;
  routeSummary: KyberRouteSummary;
  routerAddress: Address;
  shouldCollectExecutorFee: boolean;
  feeBps: number;
  treasury: Address | null;
  platformFeeAmountNative: bigint;
}): KyberQuote | null => {
  const amountOut = toBigIntQuantity(params.routeSummary.amountOut);
  if (amountOut <= 0n) {
    return null;
  }

  const minOut =
    (amountOut * (BPS_DENOMINATOR - BigInt(params.slippageBps))) / BPS_DENOMINATOR;
  const priceImpact = parsePriceImpactBps(
    asString(params.routeSummary.amountInUsd),
    asString(params.routeSummary.amountOutUsd),
  );
  const hopsRaw = flattenKyberRoute(params.routeSummary.route);
  const protocol =
    hopsRaw
      .map((hop) => asString(hop.exchange))
      .filter((exchange): exchange is string => Boolean(exchange))
      .join(" > ") || KYBER_DEX_NAME;
  const routePaths = Array.isArray(params.routeSummary.route)
    ? params.routeSummary.route
    : [];
  const hops =
    hopsRaw.length > 0
      ? hopsRaw.map((hop) => ({
          dexId: KYBER_DEX_ID,
          dex: KYBER_DEX_ID,
          dexName: KYBER_DEX_NAME,
          dexRouter: params.routerAddress,
          path: [
            resolveOptionalAddress(asString(hop.tokenIn)) || params.srcToken,
            resolveOptionalAddress(asString(hop.tokenOut)) || params.destToken,
          ],
          amountIn: asString(hop.swapAmount) || params.swapInputAmountNative.toString(),
          amountOut: asString(hop.amountOut) || amountOut.toString(),
          priceImpact,
        }))
      : [
          {
            dexId: KYBER_DEX_ID,
            dex: KYBER_DEX_ID,
            dexName: KYBER_DEX_NAME,
            dexRouter: params.routerAddress,
            path: [params.srcToken, params.destToken],
            amountIn: params.swapInputAmountNative.toString(),
            amountOut: amountOut.toString(),
            priceImpact,
          },
        ];

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
    outputAmount: scaleAmount(amountOut, params.destDecimals, NORMALIZED_DECIMALS).toString(),
    minOut: scaleAmount(minOut, params.destDecimals, NORMALIZED_DECIMALS).toString(),
    inputAmountNative: params.amountIn.toString(),
    swapInputAmountNative: params.swapInputAmountNative.toString(),
    outputAmountNative: amountOut.toString(),
    minOutNative: minOut.toString(),
    priceImpact,
    gasEstimate: params.shouldCollectExecutorFee
      ? EXECUTOR_GAS_LIMIT.toString()
      : toBigIntQuantity(params.routeSummary.gas, DEFAULT_GAS_LIMIT).toString(),
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
    kyber: {
      source: KYBER_QUOTE_SOURCE,
      fromChain: KYBER_CHAIN_ID,
      toChain: KYBER_CHAIN_ID,
      protocol,
      routerAddress: params.routerAddress,
      routeSummary: params.routeSummary,
      srcDecimals: params.srcDecimals,
      destDecimals: params.destDecimals,
      amount: params.swapInputAmountNative.toString(),
      srcToken: params.srcToken,
      destToken: params.destToken,
      amountInUsd: asString(params.routeSummary.amountInUsd) || undefined,
      amountOutUsd: asString(params.routeSummary.amountOutUsd) || undefined,
    },
    route: {
      type:
        routePaths.length > 1 ? "split" : hops.length > 1 ? "multi" : "single",
      rawPath: protocol,
      hops,
    },
  };
};

export async function getKyberQuote(params: {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  slippageBps: number;
  chainId: number;
}): Promise<KyberQuote | null> {
  if (!isKyberEnabled() || !isKyberSupportedChain(params.chainId)) {
    return null;
  }

  if (!isKyberSupportedPair(params.inputToken, params.outputToken)) {
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
  const adapterAddress = getKyberAdapterAddress();
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
    const executorAddress = getKyberExecutorAddress();
    const canCollectExecutorFee =
      Boolean(adapterAddress && executorAddress) &&
      !isKyberNativeToken(srcToken) &&
      !isKyberNativeToken(destToken);
    const disabledFeeState: KyberExecutorFeeState = {
      enabled: false,
      feeBps: KYBER_SWAP_FEE_BPS,
      treasury: KYBER_SWAP_FEE_RECIPIENT,
    };
    const assumedFeeState: KyberExecutorFeeState = canCollectExecutorFee
      ? executorFeeStateCache?.state ?? {
          enabled: true,
          feeBps: KYBER_SWAP_FEE_BPS,
          treasury: KYBER_SWAP_FEE_RECIPIENT,
        }
      : disabledFeeState;
    if (canCollectExecutorFee && !executorFeeStateCache) {
      void getKyberExecutorFeeState(executorAddress);
    }
    const feeState = assumedFeeState;
    const shouldCollectExecutorFee = canCollectExecutorFee && feeState.enabled;
    const platformFeeAmountNative = shouldCollectExecutorFee
      ? (amountIn * BigInt(feeState.feeBps)) / BPS_DENOMINATOR
      : 0n;
    const swapInputAmountNative = amountIn - platformFeeAmountNative;

    if (swapInputAmountNative <= 0n) {
      return staleCachedQuote;
    }

    const { routeSummary, routerAddress } = await withTimeout(
      fetchKyberRoute({
        tokenIn: srcToken,
        tokenOut: destToken,
        amountIn: swapInputAmountNative.toString(),
        includePartnerFee: !shouldCollectExecutorFee,
      }),
      QUOTE_TIMEOUT_MS,
      `KyberSwap quote timed out after ${QUOTE_TIMEOUT_MS}ms`,
    );
    const mappedQuote = mapKyberQuote({
      srcToken,
      destToken,
      amountIn,
      swapInputAmountNative,
      srcDecimals,
      destDecimals,
      slippageBps: params.slippageBps,
      routeSummary,
      routerAddress,
      shouldCollectExecutorFee,
      feeBps: feeState.feeBps,
      treasury: feeState.treasury,
      platformFeeAmountNative,
    });
    if (!mappedQuote) {
      return staleCachedQuote;
    }

    kyberQuoteCache.set(cacheKey, {
      quote: mappedQuote,
      fetchedAt: Date.now(),
    });
    return mappedQuote;
  } catch (error) {
    if (staleCachedQuote) {
      console.warn(
        "[KyberSwap] quote unavailable, reusing cached route:",
        readErrorMessage(error),
      );
      return staleCachedQuote;
    }

    console.warn("[KyberSwap] quote unavailable:", readErrorMessage(error));
    return null;
  }
}

export async function buildKyberSwapTransaction(params: {
  quote: KyberQuote;
  userAddress: string;
}) {
  if (!isAddress(params.userAddress)) {
    throw new Error("Missing userAddress for KyberSwap swap");
  }

  const meta = params.quote.kyber;
  const userAddress = getAddress(params.userAddress);
  const srcToken = getAddress(meta.srcToken);
  const destToken = getAddress(meta.destToken);
  const amountIn = BigInt(params.quote.inputAmountNative || meta.amount);
  const swapInputAmountNative = BigInt(
    params.quote.swapInputAmountNative || meta.amount,
  );
  const adapterAddress = getKyberAdapterAddress();
  const executorAddress = getKyberExecutorAddress();
  const useFeePath = params.quote.feeMode === TOWER_SWAP_FEE_MODE;
  const useAdapterPath = Boolean(useFeePath && adapterAddress && executorAddress);
  const minOutNativeRaw = BigInt(params.quote.minOutNative || "0");
  const minOutNative =
    minOutNativeRaw > 0n ? minOutNativeRaw : useAdapterPath ? 1n : 0n;
  const nativeInput = isKyberNativeToken(srcToken);
  const approvalSpender = useAdapterPath
    ? executorAddress
    : getAddress(meta.routerAddress || KYBER_META_AGGREGATION_ROUTER_V2);
  const approvalAmount = useAdapterPath ? amountIn : swapInputAmountNative;
  let needsApproval = !nativeInput;

  if (useFeePath && !useAdapterPath) {
    throw new Error(
      "KyberSwap adapter is not configured for TowerSwapExecutor fees. Set NEXT_PUBLIC_KYBERSWAP_ADAPTER_MAINNET_ADDRESS after deploying the adapter.",
    );
  }

  if (useAdapterPath && adapterAddress) {
    const publicClient = createKyberPublicClient();
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
        "KyberSwap adapter is not allowlisted on TowerSwapExecutor. Run deploy:kyberswap-adapter:mainnet or configure:tower-swap-executor:mainnet after deploying the adapter.",
      );
    }
  }

  const encoded = await withTimeout(
    encodeKyberRoute({
      routeSummary: meta.routeSummary,
      sender: useAdapterPath ? (adapterAddress as Address) : userAddress,
      recipient: useAdapterPath ? executorAddress : userAddress,
      slippageBps: params.quote.slippage,
    }),
    BUILD_TIMEOUT_MS,
    `KyberSwap encode timed out after ${BUILD_TIMEOUT_MS}ms`,
  );

  const routeTarget = encoded.routerAddress;
  if (useAdapterPath && !isAllowedKyberRouteTarget(routeTarget)) {
    throw new Error(
      `KyberSwap target ${routeTarget} is not MetaAggregationRouterV2, AggregationExecutorProxy, or Permit2`,
    );
  }

  const swapValue = toBigIntQuantity(encoded.transactionValue, 0n);
  if (useAdapterPath && swapValue > 0n) {
    throw new Error(
      "KyberSwap native-value swaps cannot collect Tower executor fees",
    );
  }

  if (!nativeInput) {
    try {
      const publicClient = createKyberPublicClient();
      const allowance = (await publicClient.readContract({
        address: srcToken,
        abi: ERC20_ALLOWANCE_ABI,
        functionName: "allowance",
        args: [userAddress, approvalSpender],
      })) as bigint;
      needsApproval = allowance < approvalAmount;
    } catch (error) {
      console.warn(
        "[KyberSwap] allowance check failed, requesting approval:",
        readErrorMessage(error),
      );
      needsApproval = true;
    }
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
        label: useAdapterPath ? "Executor approval" : "KyberSwap approval",
        spender: approvalSpender,
        amountRaw: approvalAmount.toString(),
        token: srcToken,
      }
    : null;

  const adapterCalldata =
    useAdapterPath && adapterAddress
      ? encodeFunctionData({
          abi: KYBER_ADAPTER_ABI,
          functionName: "swapExactInput",
          args: [
            srcToken,
            destToken,
            swapInputAmountNative,
            minOutNative,
            executorAddress,
            routeTarget,
            encoded.data,
          ],
        })
      : null;

  const swapData =
    adapterCalldata && adapterAddress
      ? encodeTowerSwapExecution(
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
          BigInt(Math.floor(Date.now() / 1000) + 20 * 60),
        )
      : encoded.data;

  const feeRecipient = params.quote.feeRecipient
    ? getAddress(params.quote.feeRecipient)
    : KYBER_SWAP_FEE_RECIPIENT;

  return {
    approval,
    swap: {
      to: useAdapterPath ? executorAddress : routeTarget,
      data: swapData,
      value: toHexQuantity(useAdapterPath ? 0n : swapValue),
      from: userAddress,
      gasLimit: toHexQuantity(
        useAdapterPath
          ? EXECUTOR_GAS_LIMIT
          : encoded.gas || params.quote.gasEstimate || DEFAULT_GAS_LIMIT,
      ),
      chainId: KYBER_CHAIN_ID,
      expectedUserOutput:
        encoded.amountOut ||
        params.quote.outputAmountNative ||
        params.quote.minOutNative,
      feeMode: useAdapterPath ? TOWER_SWAP_FEE_MODE : "none",
      feeBps: useAdapterPath ? params.quote.feeBps : undefined,
      feeRecipient: useAdapterPath ? feeRecipient : undefined,
      feeToken: useAdapterPath ? srcToken : undefined,
      platformFeeAmount: useAdapterPath
        ? params.quote.platformFeeAmountNative
        : undefined,
      executorAddress: useAdapterPath ? executorAddress : undefined,
      inputToken: srcToken,
      outputToken: destToken,
      inputAmountNative: amountIn.toString(),
    } satisfies KyberSwapTransaction,
  };
}
