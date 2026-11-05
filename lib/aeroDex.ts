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
  type PublicClient,
} from "viem";

import {
  quoteExactInputOnPool,
  token1PerToken0FromSqrtPriceX96,
} from "@/lib/aeroQuoteMath";
import { ARC_MAINNET_CONFIG, TOKEN_CONTRACTS } from "@/lib/arcNetwork";
import { ARC_MAINNET_RPC_ENDPOINTS, ARC_MAINNET_RPC_PROXY_PATH } from "@/lib/arcRpc";
import { BRIDGE_EURC_ADDRESSES } from "@/lib/bridgeNetworks";
import {
  encodeTowerSwapExecution,
  getTowerSwapExecutorV2Address,
} from "@/lib/towerSwapExecutorV2";

export const AERO_DEX_ID = "aero" as const;
export const AERO_DEX_NAME = "Aero" as const;
export const AERO_CHAIN_ID = 5042;
export const AERO_PUBLIC_RPC_URL = ARC_MAINNET_CONFIG.rpcUrl;
export const AERO_PROXY_RPC_PATH = ARC_MAINNET_RPC_PROXY_PATH;

export const aeroArcMainnet = {
  id: AERO_CHAIN_ID,
  name: "Arc",
  nativeCurrency: {
    decimals: 18,
    name: "USD Coin",
    symbol: "USDC",
  },
  rpcUrls: {
    default: { http: [AERO_PUBLIC_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: ARC_MAINNET_CONFIG.explorerUrl },
  },
  testnet: false,
} as const;

export const AERO_ADDRESSES = {
  factory: "0xb89Df768aF2CFE637ceB352c587Fe8edAf491d03",
  poolImplementation: "0x0Df9fc8730eeC048e9832B31B4bFf4351158e19B",
  poolNonSwapPath: "0x22557c01cf181B14b925D83008eD1D19150cd50B",
  poolTape: "0x967f5352A6448e22D7361E149103350c49345Ee9",
  dynamicSwapFeeHook: "0xaAf164008441F112eB2858d9F7A2dB1B84b1E415",
  metaquoter: "0x61d0Aa4a814a68F3119019f9f17ACa517FEa6D49",
  nftDescriptor: "0xB9236346228Af5AfB7742841391b82Fda374dE01",
  nftDescriptorLib: "0xA7dB74E459AEdd3Ba4d8D691fBe37AE37195493B",
  nftPositionManager: "0xc84bB45D43CD25D02b83B4C085eaA4e08da8f473",
  nftSvgLib: "0x888b8D0433C4Fe0167DC24123b650B3f2446C8C8",
  swapRouter: "0xb4702E1375F712da2e0d5F534c30c0c1513EdB2B",
} as const satisfies Record<string, Address>;

const TOWER_SWAP_FEE_MODE = "tower-swap-executor" as const;
const DEFAULT_AERO_SWAP_FEE_BPS = 25;
const AERO_SWAP_EXECUTOR_DEFAULT =
  "0xeB8940752Fa12944d3b2D736d51fA36E4dA32BC8" as Address;
const AERO_ADAPTER_DEFAULT =
  "0x8Cef6E2465fb09D2b512B1CaC94F74734741B30a" as Address;
const AERO_SWAP_FEE_RECIPIENT_DEFAULT =
  "0xb3966683724303400B6fECDa1963825d994B546a" as Address;

const parseAeroSwapFeeBps = (value?: string | null) => {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 10_000
    ? parsed
    : DEFAULT_AERO_SWAP_FEE_BPS;
};

const resolveOptionalAeroAddress = (value?: string | null) =>
  value && isAddress(value) ? getAddress(value) : null;

export const AERO_SWAP_EXECUTOR_ADDRESS =
  getTowerSwapExecutorV2Address() ||
  resolveOptionalAeroAddress(
    process.env.NEXT_PUBLIC_TOWER_SWAP_EXECUTOR_MAINNET_ADDRESS ||
      process.env.TOWER_SWAP_EXECUTOR_MAINNET_ADDRESS,
  ) || getAddress(AERO_SWAP_EXECUTOR_DEFAULT);

export const AERO_ADAPTER_ADDRESS =
  resolveOptionalAeroAddress(
    process.env.NEXT_PUBLIC_AERO_ADAPTER_V2_MAINNET_ADDRESS ||
      process.env.AERO_ADAPTER_V2_MAINNET_ADDRESS ||
      process.env.NEXT_PUBLIC_AERO_ADAPTER_MAINNET_ADDRESS ||
      process.env.AERO_ADAPTER_MAINNET_ADDRESS,
  ) || getAddress(AERO_ADAPTER_DEFAULT);

const AERO_SWAP_FEE_BPS = parseAeroSwapFeeBps(
  process.env.NEXT_PUBLIC_TOWER_SWAP_FEE_BPS ||
    process.env.TOWER_SWAP_FEE_BPS ||
    process.env.NEXT_PUBLIC_SWAP_FEE_BPS ||
    process.env.SWAP_FEE_BPS,
);

const AERO_SWAP_FEE_RECIPIENT =
  resolveOptionalAeroAddress(
    process.env.NEXT_PUBLIC_TOWER_SWAP_FEE_RECIPIENT ||
      process.env.TOWER_SWAP_FEE_RECIPIENT ||
      process.env.NEXT_PUBLIC_TOWER_SWAP_EXECUTOR_TREASURY ||
      process.env.TOWER_SWAP_EXECUTOR_TREASURY,
  ) || getAddress(AERO_SWAP_FEE_RECIPIENT_DEFAULT);

export const AERO_TICK_SPACINGS = [1, 10, 50, 100, 200, 2000] as const;
export type AeroTickSpacing = (typeof AERO_TICK_SPACINGS)[number];

export const AERO_MAINNET_TOKENS = {
  USDC: getAddress(TOKEN_CONTRACTS.USDC),
  EURC: getAddress(BRIDGE_EURC_ADDRESSES.arc),
  cirBTC: getAddress("0x171A4217b86A807A64eB94757Db6849fb4bDbAA0"),
  CIRBTC: getAddress("0x171A4217b86A807A64eB94757Db6849fb4bDbAA0"),
  WETH: getAddress("0x128cC466B61f542da60c70e3aA11c10e19B84EDB"),
} as const satisfies Record<string, Address>;

export const AERO_TOKEN_DECIMALS: Record<string, number> = {
  [AERO_MAINNET_TOKENS.USDC.toLowerCase()]: 6,
  [AERO_MAINNET_TOKENS.EURC.toLowerCase()]: 6,
  [AERO_MAINNET_TOKENS.cirBTC.toLowerCase()]: 8,
  [AERO_MAINNET_TOKENS.WETH.toLowerCase()]: 18,
};

const AERO_INTERMEDIATE_TOKENS: Address[] = [AERO_MAINNET_TOKENS.USDC];

const AERO_FACTORY_ABI = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "tickSpacing", type: "int24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
  {
    type: "function",
    name: "tickSpacings",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "int24[]" }],
  },
] as const;

const AERO_POOL_ABI = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "unlocked", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "liquidity",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint128" }],
  },
  {
    type: "function",
    name: "fee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint24" }],
  },
  {
    type: "function",
    name: "tickSpacing",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "int24" }],
  },
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
    name: "tickBitmap",
    stateMutability: "view",
    inputs: [{ name: "wordPosition", type: "int16" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ticks",
    stateMutability: "view",
    inputs: [{ name: "tick", type: "int24" }],
    outputs: [
      { name: "liquidityGross", type: "uint128" },
      { name: "liquidityNet", type: "int128" },
      { name: "stakedLiquidityNet", type: "int128" },
      { name: "feeGrowthOutside0X128", type: "uint256" },
      { name: "feeGrowthOutside1X128", type: "uint256" },
      { name: "rewardGrowthOutsideX128", type: "uint256" },
      { name: "tickCumulativeOutside", type: "int56" },
      { name: "secondsPerLiquidityOutsideX128", type: "uint160" },
      { name: "secondsOutside", type: "uint32" },
      { name: "initialized", type: "bool" },
    ],
  },
] as const;

const AERO_SWAP_ROUTER_ABI = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "tickSpacing", type: "int24" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "exactInput",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "path", type: "bytes" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
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

const AERO_ADAPTER_ABI = [
  {
    type: "function",
    name: "swapExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "tickSpacing", type: "int24" },
      { name: "amountIn", type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "swapExactInput",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "path", type: "bytes" },
      { name: "amountIn", type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const ZERO_ADDRESS = zeroAddress;
const BPS_DENOMINATOR = 10000n;
const EXECUTOR_FEE_STATE_TTL_MS = 30_000;

type AeroExecutorFeeState = {
  enabled: boolean;
  feeBps: number;
  treasury: Address | null;
};

let executorFeeStateCache: { state: AeroExecutorFeeState; expiresAt: number } | null =
  null;

export function normalizeAeroDexId(value?: string | null) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");

  if (
    normalized === "aero" ||
    normalized === "aerodrome" ||
    normalized === "aero-cl" ||
    normalized === "aero-slipstream" ||
    normalized.includes("aerodrome") ||
    normalized.includes("slipstream")
  ) {
    return AERO_DEX_ID;
  }

  return normalized;
}

export function normalizeAeroAddress(address: string): Address {
  if (!isAddress(address)) {
    throw new Error(`Invalid EVM address: ${address}`);
  }

  return getAddress(address);
}

const getDefaultAeroRpcUrl = () =>
  typeof window === "undefined" ? AERO_PUBLIC_RPC_URL : AERO_PROXY_RPC_PATH;

export function createAeroPublicClient(rpcUrl = getDefaultAeroRpcUrl()) {
  const urls =
    rpcUrl === AERO_PROXY_RPC_PATH
      ? [AERO_PROXY_RPC_PATH]
      : [rpcUrl, ...ARC_MAINNET_RPC_ENDPOINTS.filter(Boolean)];

  return createPublicClient({
    chain: {
      ...aeroArcMainnet,
      rpcUrls: {
        default: { http: urls as string[] },
      },
    },
    transport: urls.length > 1 ? fallback(urls.map((url) => http(url))) : http(urls[0]),
  });
}

async function getAeroExecutorFeeState(
  client: PublicClient,
): Promise<AeroExecutorFeeState> {
  if (executorFeeStateCache && Date.now() < executorFeeStateCache.expiresAt) {
    return executorFeeStateCache.state;
  }

  const disabledState: AeroExecutorFeeState = {
    enabled: false,
    feeBps: AERO_SWAP_FEE_BPS,
    treasury: AERO_SWAP_FEE_RECIPIENT,
  };

  try {
    const [onChainFeeBps, treasury] = await Promise.all([
      client.readContract({
        address: AERO_SWAP_EXECUTOR_ADDRESS,
        abi: TOWER_SWAP_EXECUTOR_ABI,
        functionName: "platformFeeBps",
      }),
      client.readContract({
        address: AERO_SWAP_EXECUTOR_ADDRESS,
        abi: TOWER_SWAP_EXECUTOR_ABI,
        functionName: "treasury",
      }),
    ]);

    const feeBps = Number(onChainFeeBps) > 0 ? Number(onChainFeeBps) : AERO_SWAP_FEE_BPS;
    const resolvedTreasury =
      treasury && isAddress(treasury) && treasury.toLowerCase() !== ZERO_ADDRESS
        ? getAddress(treasury)
        : AERO_SWAP_FEE_RECIPIENT;
    const state: AeroExecutorFeeState = {
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
    console.warn("[Aero] executor fee state unavailable:", error);
    executorFeeStateCache = {
      state: disabledState,
      expiresAt: Date.now() + EXECUTOR_FEE_STATE_TTL_MS,
    };
    return disabledState;
  }
}

export function getAeroDexInfo() {
  return {
    id: AERO_DEX_ID,
    name: AERO_DEX_NAME,
    enabled: true,
    type: "v3",
    chainId: AERO_CHAIN_ID,
    routerAddress: AERO_ADDRESSES.swapRouter,
    factoryAddress: AERO_ADDRESSES.factory,
    quoterAddress: AERO_ADDRESSES.metaquoter,
    supportedTokens: [
      AERO_MAINNET_TOKENS.USDC,
      AERO_MAINNET_TOKENS.EURC,
      AERO_MAINNET_TOKENS.cirBTC,
    ],
    feeTiers: AERO_TICK_SPACINGS,
  } as const;
}

export function getAeroTokenDecimals(address: string) {
  return AERO_TOKEN_DECIMALS[address.toLowerCase()] ?? 18;
}

const AERO_TESTNET_ADDRESS_ALIASES: Record<string, Address> = {
  [TOKEN_CONTRACTS.CIRBTC.toLowerCase()]: AERO_MAINNET_TOKENS.cirBTC,
  [TOKEN_CONTRACTS.cirBTC.toLowerCase()]: AERO_MAINNET_TOKENS.cirBTC,
  [TOKEN_CONTRACTS.EURC.toLowerCase()]: AERO_MAINNET_TOKENS.EURC,
};

export function getAeroMainnetTokenAddress(symbol?: string | null) {
  if (!symbol) {
    return undefined;
  }

  const normalized = symbol.trim();
  if (isAddress(normalized)) {
    const aliased = AERO_TESTNET_ADDRESS_ALIASES[normalized.toLowerCase()];
    return aliased ?? getAddress(normalized);
  }

  const mapped =
    AERO_MAINNET_TOKENS[normalized as keyof typeof AERO_MAINNET_TOKENS] ||
    AERO_MAINNET_TOKENS[normalized.toUpperCase() as keyof typeof AERO_MAINNET_TOKENS];

  return mapped;
}

export function getArcSwapTokenAddress(
  symbol: string,
  mode: "testnet" | "mainnet" = "mainnet",
) {
  if (mode === "mainnet") {
    return getAeroMainnetTokenAddress(symbol) ?? TOKEN_CONTRACTS[symbol];
  }

  return TOKEN_CONTRACTS[symbol];
}

const scaleAmount = (amount: bigint, fromDecimals: number, toDecimals: number) => {
  if (fromDecimals === toDecimals) {
    return amount;
  }

  return fromDecimals < toDecimals
    ? amount * 10n ** BigInt(toDecimals - fromDecimals)
    : amount / 10n ** BigInt(fromDecimals - toDecimals);
};

const toHexQuantity = (value: bigint | number) => `0x${BigInt(value).toString(16)}` as Hex;

type AeroHop = {
  tokenIn: Address;
  tokenOut: Address;
  pool: Address;
  tickSpacing: number;
  feePips: number;
  amountIn: bigint;
  amountOut: bigint;
};

export type AeroQuote = {
  inputToken: Address;
  outputToken: Address;
  inputAmount: string;
  swapInputAmount: string;
  outputAmount: string;
  minOut: string;
  inputAmountNative: string;
  swapInputAmountNative: string;
  outputAmountNative: string;
  minOutNative: string;
  priceImpact: number;
  gasEstimate: string;
  slippage: number;
  feeMode: "none" | "tower-swap-executor";
  feeBps?: number;
  feeRecipient?: Address;
  platformFeeAmount?: string;
  platformFeeAmountNative?: string;
  route: {
    type: "single" | "multi";
    hops: Array<{
      dexId: typeof AERO_DEX_ID;
      dex: typeof AERO_DEX_ID;
      dexName: typeof AERO_DEX_NAME;
      dexRouter: Address;
      path: Address[];
      feeTier: number;
      feeTiers?: number[];
      amountIn: string;
      amountOut: string;
      priceImpact: number;
      liquidity: string;
    }>;
  };
};

const getPoolCacheKey = (tokenA: Address, tokenB: Address, tickSpacing: number) =>
  `${tokenA.toLowerCase()}:${tokenB.toLowerCase()}:${tickSpacing}`;

const AERO_KNOWN_POOLS: Array<{
  tokenA: Address;
  tokenB: Address;
  tickSpacing: number;
  pool: Address;
}> = [
  {
    tokenA: AERO_MAINNET_TOKENS.USDC,
    tokenB: AERO_MAINNET_TOKENS.EURC,
    tickSpacing: 1,
    pool: "0xbe080aC37ad1305DFCc9521F5e6F68CFDc41B7fa",
  },
  {
    tokenA: AERO_MAINNET_TOKENS.USDC,
    tokenB: AERO_MAINNET_TOKENS.cirBTC,
    tickSpacing: 50,
    pool: "0xd945cAEe4635BcD7FB8A9fA74dC1D0c4C1472782",
  },
  {
    tokenA: AERO_MAINNET_TOKENS.WETH,
    tokenB: AERO_MAINNET_TOKENS.USDC,
    tickSpacing: 50,
    pool: "0x6F302dECb49fB30B2D2c609BDD16e04e7Dd096FC",
  },
  {
    tokenA: AERO_MAINNET_TOKENS.WETH,
    tokenB: AERO_MAINNET_TOKENS.cirBTC,
    tickSpacing: 10,
    pool: "0x72DfF32c9C5c28758565bE0a7d4E6E42FB498506",
  },
];

const poolCache = new Map<string, Address | null>(
  AERO_KNOWN_POOLS.flatMap((entry) => {
    const pool = getAddress(entry.pool);
    return [
      [getPoolCacheKey(entry.tokenA, entry.tokenB, entry.tickSpacing), pool],
      [getPoolCacheKey(entry.tokenB, entry.tokenA, entry.tickSpacing), pool],
    ];
  }),
);

const knownTickSpacingsForPair = (tokenIn: Address, tokenOut: Address) => {
  const tokenInKey = tokenIn.toLowerCase();
  const tokenOutKey = tokenOut.toLowerCase();

  return AERO_KNOWN_POOLS.filter((entry) => {
    const tokenA = entry.tokenA.toLowerCase();
    const tokenB = entry.tokenB.toLowerCase();
    return (
      (tokenA === tokenInKey && tokenB === tokenOutKey) ||
      (tokenA === tokenOutKey && tokenB === tokenInKey)
    );
  }).map((entry) => entry.tickSpacing);
};

async function getUsdPriceFromUsdcPool(
  client: PublicClient,
  token: Address,
) {
  const usdc = AERO_MAINNET_TOKENS.USDC.toLowerCase();
  const tokenKey = token.toLowerCase();
  const knownPool = AERO_KNOWN_POOLS.find((entry) => {
    const tokenA = entry.tokenA.toLowerCase();
    const tokenB = entry.tokenB.toLowerCase();
    return (
      (tokenA === usdc && tokenB === tokenKey) ||
      (tokenB === usdc && tokenA === tokenKey)
    );
  });

  if (!knownPool) {
    return null;
  }

  const pool = getAddress(knownPool.pool);
  const [slot0, token0Address] = await Promise.all([
    client.readContract({
      address: pool,
      abi: AERO_POOL_ABI,
      functionName: "slot0",
    }),
    client.readContract({
      address: pool,
      abi: AERO_POOL_ABI,
      functionName: "token0",
    }),
  ]);

  const sqrtPriceX96 = slot0[0];
  const token0 = getAddress(token0Address as Address);
  const token1 =
    token0.toLowerCase() === usdc ? token : AERO_MAINNET_TOKENS.USDC;
  const token1PerToken0 = token1PerToken0FromSqrtPriceX96(
    sqrtPriceX96,
    getAeroTokenDecimals(token0),
    getAeroTokenDecimals(token1),
  );

  if (!Number.isFinite(token1PerToken0) || token1PerToken0 <= 0) {
    return null;
  }

  return token0.toLowerCase() === usdc ? 1 / token1PerToken0 : token1PerToken0;
}

export async function getAeroUsdSpotPrices(client?: PublicClient) {
  const aeroClient = client ?? createAeroPublicClient();

  const [EURC, cirBTC] = await Promise.all([
    getUsdPriceFromUsdcPool(aeroClient, AERO_MAINNET_TOKENS.EURC).catch(
      () => null,
    ),
    getUsdPriceFromUsdcPool(aeroClient, AERO_MAINNET_TOKENS.cirBTC).catch(
      () => null,
    ),
  ]);

  return {
    USDC: 1,
    EURC,
    cirBTC,
  };
}

async function getAeroPoolAddress(
  client: PublicClient,
  tokenA: Address,
  tokenB: Address,
  tickSpacing: number,
) {
  const cacheKey = getPoolCacheKey(tokenA, tokenB, tickSpacing);
  if (poolCache.has(cacheKey)) {
    return poolCache.get(cacheKey) ?? null;
  }

  const pool = (await client.readContract({
    address: AERO_ADDRESSES.factory,
    abi: AERO_FACTORY_ABI,
    functionName: "getPool",
    args: [tokenA, tokenB, tickSpacing],
  })) as Address;

  const resolved = !pool || pool.toLowerCase() === ZERO_ADDRESS ? null : getAddress(pool);
  poolCache.set(cacheKey, resolved);
  return resolved;
}

async function quotePoolHop(params: {
  client: PublicClient;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  tickSpacing: number;
}): Promise<AeroHop | null> {
  const pool = await getAeroPoolAddress(
    params.client,
    params.tokenIn,
    params.tokenOut,
    params.tickSpacing,
  );
  if (!pool) {
    return null;
  }

  const [slot0, liquidity, feePips, token0] = await Promise.all([
    params.client.readContract({
      address: pool,
      abi: AERO_POOL_ABI,
      functionName: "slot0",
    }),
    params.client.readContract({
      address: pool,
      abi: AERO_POOL_ABI,
      functionName: "liquidity",
    }),
    params.client.readContract({
      address: pool,
      abi: AERO_POOL_ABI,
      functionName: "fee",
    }),
    params.client.readContract({
      address: pool,
      abi: AERO_POOL_ABI,
      functionName: "token0",
    }),
  ]);

  if (liquidity === 0n) {
    return null;
  }

  const zeroForOne =
    params.tokenIn.toLowerCase() === (token0 as Address).toLowerCase();

  const bitmapCache = new Map<number, bigint>();
  const amountOut = await quoteExactInputOnPool({
    zeroForOne,
    amountIn: params.amountIn,
    sqrtPriceX96: slot0[0],
    tick: Number(slot0[1]),
    liquidity,
    tickSpacing: params.tickSpacing,
    feePips: Number(feePips),
    readBitmap: async (wordPos) => {
      const cached = bitmapCache.get(wordPos);
      if (cached !== undefined) {
        return cached;
      }
      const value = (await params.client.readContract({
        address: pool,
        abi: AERO_POOL_ABI,
        functionName: "tickBitmap",
        args: [wordPos],
      })) as bigint;
      bitmapCache.set(wordPos, value);
      return value;
    },
    readTick: async (tick) => {
      const value = await params.client.readContract({
        address: pool,
        abi: AERO_POOL_ABI,
        functionName: "ticks",
        args: [tick],
      });
      return {
        liquidityNet: value[1],
        initialized: value[9],
      };
    },
  });

  if (amountOut <= 0n) {
    return null;
  }

  return {
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    pool,
    tickSpacing: params.tickSpacing,
    feePips: Number(feePips),
    amountIn: params.amountIn,
    amountOut,
  };
}

async function quoteBestDirectHop(params: {
  client: PublicClient;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
}) {
  const knownSpacings = knownTickSpacingsForPair(params.tokenIn, params.tokenOut);
  const tickSpacings = knownSpacings.length > 0 ? knownSpacings : AERO_TICK_SPACINGS;
  const quotes = await Promise.all(
    tickSpacings.map((tickSpacing) =>
      quotePoolHop({
        ...params,
        tickSpacing,
      }).catch(() => null),
    ),
  );

  return quotes.reduce<AeroHop | null>((best, quote) => {
    if (!quote) {
      return best;
    }
    if (!best || quote.amountOut > best.amountOut) {
      return quote;
    }
    return best;
  }, null);
}

async function quoteAeroRoute(params: {
  client: PublicClient;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
}) {
  const direct = await quoteBestDirectHop(params);
  if (direct) {
    return [direct];
  }

  for (const intermediate of AERO_INTERMEDIATE_TOKENS) {
    if (
      intermediate.toLowerCase() === params.tokenIn.toLowerCase() ||
      intermediate.toLowerCase() === params.tokenOut.toLowerCase()
    ) {
      continue;
    }

    const firstHop = await quoteBestDirectHop({
      client: params.client,
      tokenIn: params.tokenIn,
      tokenOut: intermediate,
      amountIn: params.amountIn,
    });
    if (!firstHop) {
      continue;
    }

    const secondHop = await quoteBestDirectHop({
      client: params.client,
      tokenIn: intermediate,
      tokenOut: params.tokenOut,
      amountIn: firstHop.amountOut,
    });
    if (!secondHop) {
      continue;
    }

    return [firstHop, secondHop];
  }

  return null;
}

const encodePackedV3Path = (tokens: Address[], tickSpacings: number[]) => {
  if (tokens.length !== tickSpacings.length + 1) {
    throw new Error("Aero path length mismatch");
  }

  let path = "0x" as Hex;
  for (let index = 0; index < tickSpacings.length; index += 1) {
    const token = tokens[index].slice(2).toLowerCase();
    const spacing = tickSpacings[index];
    const spacingHex = (spacing & 0xffffff).toString(16).padStart(6, "0");
    path = `${path}${token}${spacingHex}` as Hex;
  }
  path = `${path}${tokens[tokens.length - 1].slice(2).toLowerCase()}` as Hex;
  return path;
};

export async function getAeroQuote(params: {
  client?: PublicClient;
  inputToken: string;
  outputToken: string;
  inputAmount: string | bigint;
  slippageBps: number;
}): Promise<AeroQuote | null> {
  const client = params.client ?? createAeroPublicClient();
  const tokenIn = normalizeAeroAddress(params.inputToken);
  const tokenOut = normalizeAeroAddress(params.outputToken);
  const amountInNative = BigInt(params.inputAmount);

  if (tokenIn.toLowerCase() === tokenOut.toLowerCase() || amountInNative <= 0n) {
    return null;
  }

  const feeState = await getAeroExecutorFeeState(client);
  const shouldCollectExecutorFee = feeState.enabled;
  const platformFeeAmountNative = shouldCollectExecutorFee
    ? (amountInNative * BigInt(feeState.feeBps)) / BPS_DENOMINATOR
    : 0n;
  const swapInputAmountNative = amountInNative - platformFeeAmountNative;

  if (swapInputAmountNative <= 0n) {
    return null;
  }

  try {
    const hops = await quoteAeroRoute({
      client,
      tokenIn,
      tokenOut,
      amountIn: swapInputAmountNative,
    });

    if (!hops?.length) {
      return null;
    }

    const amountOutNative = hops[hops.length - 1].amountOut;
    const minOutNative =
      (amountOutNative * BigInt(BPS_DENOMINATOR - BigInt(params.slippageBps))) /
      BPS_DENOMINATOR;
    const inputDecimals = getAeroTokenDecimals(tokenIn);
    const outputDecimals = getAeroTokenDecimals(tokenOut);
    const tickSpacings = hops.map((hop) => hop.tickSpacing);
    const path = hops.flatMap((hop, index) =>
      index === 0 ? [hop.tokenIn, hop.tokenOut] : [hop.tokenOut],
    );
    const priceImpact = hops.reduce((total, hop) => total + hop.feePips, 0) / 100;

    return {
      inputToken: tokenIn,
      outputToken: tokenOut,
      inputAmount: scaleAmount(amountInNative, inputDecimals, 18).toString(),
      swapInputAmount: scaleAmount(swapInputAmountNative, inputDecimals, 18).toString(),
      outputAmount: scaleAmount(amountOutNative, outputDecimals, 18).toString(),
      minOut: scaleAmount(minOutNative, outputDecimals, 18).toString(),
      inputAmountNative: amountInNative.toString(),
      swapInputAmountNative: swapInputAmountNative.toString(),
      outputAmountNative: amountOutNative.toString(),
      minOutNative: minOutNative.toString(),
      priceImpact,
      gasEstimate: hops.length > 1 ? "450000" : "280000",
      slippage: params.slippageBps,
      feeMode: shouldCollectExecutorFee ? TOWER_SWAP_FEE_MODE : "none",
      feeBps: shouldCollectExecutorFee ? feeState.feeBps : undefined,
      feeRecipient: shouldCollectExecutorFee
        ? feeState.treasury || undefined
        : undefined,
      platformFeeAmount:
        platformFeeAmountNative > 0n
          ? scaleAmount(platformFeeAmountNative, inputDecimals, 18).toString()
          : undefined,
      platformFeeAmountNative:
        platformFeeAmountNative > 0n ? platformFeeAmountNative.toString() : undefined,
      route: {
        type: hops.length > 1 ? "multi" : "single",
        hops: [
          {
            dexId: AERO_DEX_ID,
            dex: AERO_DEX_ID,
            dexName: AERO_DEX_NAME,
            dexRouter: AERO_ADDRESSES.swapRouter,
            path,
            feeTier: tickSpacings[0],
            feeTiers: tickSpacings,
            amountIn: swapInputAmountNative.toString(),
            amountOut: amountOutNative.toString(),
            priceImpact,
            liquidity: amountOutNative.toString(),
          },
        ],
      },
    };
  } catch (error) {
    console.warn("[Aero] quote unavailable:", error);
    return null;
  }
}

export function isAeroQuote(quote: unknown): quote is AeroQuote {
  if (!quote || typeof quote !== "object") {
    return false;
  }

  const hop = (quote as AeroQuote).route?.hops?.[0];
  return normalizeAeroDexId(hop?.dexId || hop?.dexName) === AERO_DEX_ID;
}

const resolveQuoteNativeAmount = (
  nativeValue: unknown,
  normalizedValue: unknown,
  token: Address,
) => {
  if (typeof nativeValue === "string" && nativeValue.trim()) {
    return BigInt(nativeValue);
  }

  if (typeof normalizedValue === "string" && normalizedValue.trim()) {
    return scaleAmount(BigInt(normalizedValue), 18, getAeroTokenDecimals(token));
  }

  return 0n;
};

export async function buildAeroSwapTransaction(params: {
  quote: AeroQuote;
  userAddress: string;
  client?: PublicClient;
}) {
  const client = params.client ?? createAeroPublicClient();
  const userAddress = normalizeAeroAddress(params.userAddress);
  const tokenIn = normalizeAeroAddress(params.quote.inputToken);
  const tokenOut = normalizeAeroAddress(params.quote.outputToken);
  const hop = params.quote.route.hops[0];
  const pathTokens = (hop?.path?.length ? hop.path : [tokenIn, tokenOut]).map((token) =>
    normalizeAeroAddress(token),
  );
  const tickSpacings =
    hop?.feeTiers?.length === pathTokens.length - 1
      ? hop.feeTiers
      : pathTokens.slice(0, -1).map(() => hop?.feeTier ?? 1);
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
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  const outputAmountNative = resolveQuoteNativeAmount(
    params.quote.outputAmountNative,
    params.quote.outputAmount,
    tokenOut,
  ).toString();
  const useFeePath = params.quote.feeMode === TOWER_SWAP_FEE_MODE;
  const feeRecipient = params.quote.feeRecipient
    ? normalizeAeroAddress(params.quote.feeRecipient)
    : AERO_SWAP_FEE_RECIPIENT;
  const platformFeeAmountNative = resolveQuoteNativeAmount(
    params.quote.platformFeeAmountNative,
    params.quote.platformFeeAmount,
    tokenIn,
  );
  const useAdapterPath = Boolean(useFeePath && AERO_ADAPTER_ADDRESS);
  const approvalSpender = useAdapterPath
    ? AERO_SWAP_EXECUTOR_ADDRESS
    : AERO_ADDRESSES.swapRouter;
  const routeAmountIn = useFeePath ? swapInputAmountNative : amountInNative;
  const collectPlatformFee =
    useFeePath && !useAdapterPath && platformFeeAmountNative > 0n;

  if (useAdapterPath && AERO_ADAPTER_ADDRESS) {
    const [routeAllowed, spenderAllowed] = await Promise.all([
      client.readContract({
        address: AERO_SWAP_EXECUTOR_ADDRESS,
        abi: TOWER_SWAP_EXECUTOR_ABI,
        functionName: "routeTargets",
        args: [AERO_ADAPTER_ADDRESS],
      }),
      client.readContract({
        address: AERO_SWAP_EXECUTOR_ADDRESS,
        abi: TOWER_SWAP_EXECUTOR_ABI,
        functionName: "approvalSpenders",
        args: [AERO_ADAPTER_ADDRESS],
      }),
    ]);

    if (!routeAllowed || !spenderAllowed) {
      throw new Error(
        "Aero adapter is not allowlisted on TowerSwapExecutor. Run configure:tower-swap-executor:mainnet after deploying the adapter.",
      );
    }
  }

  const allowance = (await client.readContract({
    address: tokenIn,
    abi: ERC20_ALLOWANCE_ABI,
    functionName: "allowance",
    args: [userAddress, approvalSpender],
  })) as bigint;

  const approvalAmount = useAdapterPath ? amountInNative : routeAmountIn;
  const approvalTxs: Array<{
    to: Address;
    data: Hex;
    from: Address;
    gasLimit: Hex;
    value: Hex;
    label: string;
    spender?: Address;
    amountRaw: string;
    token: Address;
  }> = [];

  if (allowance < approvalAmount) {
    approvalTxs.push({
      to: tokenIn,
      data: encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [approvalSpender, approvalAmount],
      }),
      from: userAddress,
      gasLimit: toHexQuantity(100000),
      value: "0x0",
      label: useAdapterPath ? "Executor approval" : "Aero router approval",
      spender: approvalSpender,
      amountRaw: approvalAmount.toString(),
      token: tokenIn,
    });
  }

  if (collectPlatformFee) {
    approvalTxs.push({
      to: tokenIn,
      data: encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [feeRecipient, platformFeeAmountNative],
      }),
      from: userAddress,
      gasLimit: toHexQuantity(100000),
      value: "0x0",
      label: "Platform fee",
      amountRaw: platformFeeAmountNative.toString(),
      token: tokenIn,
    });
  }

  const approval =
    approvalTxs.length === 0
      ? null
      : approvalTxs.length === 1
        ? approvalTxs[0]
        : approvalTxs;

  const tickSpacing = tickSpacings[0] || 1;
  const routeCalldata =
    pathTokens.length === 2
      ? useAdapterPath && AERO_ADAPTER_ADDRESS
        ? encodeFunctionData({
            abi: AERO_ADAPTER_ABI,
            functionName: "swapExactInputSingle",
            args: [
              pathTokens[0],
              pathTokens[1],
              tickSpacing,
              routeAmountIn,
              minOutNative,
              AERO_SWAP_EXECUTOR_ADDRESS,
              deadline,
            ],
          })
        : encodeFunctionData({
            abi: AERO_SWAP_ROUTER_ABI,
            functionName: "exactInputSingle",
            args: [
              {
                tokenIn: pathTokens[0],
                tokenOut: pathTokens[1],
                tickSpacing,
                recipient: userAddress,
                deadline,
                amountIn: routeAmountIn,
                amountOutMinimum: minOutNative,
                sqrtPriceLimitX96: 0n,
              },
            ],
          })
      : useAdapterPath && AERO_ADAPTER_ADDRESS
        ? encodeFunctionData({
            abi: AERO_ADAPTER_ABI,
            functionName: "swapExactInput",
            args: [
              pathTokens[0],
              encodePackedV3Path(pathTokens, tickSpacings),
              routeAmountIn,
              minOutNative,
              AERO_SWAP_EXECUTOR_ADDRESS,
              deadline,
            ],
          })
        : encodeFunctionData({
            abi: AERO_SWAP_ROUTER_ABI,
            functionName: "exactInput",
            args: [
              {
                path: encodePackedV3Path(pathTokens, tickSpacings),
                recipient: userAddress,
                deadline,
                amountIn: routeAmountIn,
                amountOutMinimum: minOutNative,
              },
            ],
          });

  const data =
    useAdapterPath && AERO_ADAPTER_ADDRESS
      ? encodeTowerSwapExecution(
          {
            tokenIn,
            tokenOut,
            amountIn: amountInNative,
            minAmountOut: minOutNative,
            recipient: userAddress,
            routeTarget: AERO_ADAPTER_ADDRESS,
            approvalSpender: AERO_ADAPTER_ADDRESS,
            routeCalldata,
          },
          deadline,
        )
      : routeCalldata;

  return {
    approval,
    swap: {
      to: useAdapterPath ? AERO_SWAP_EXECUTOR_ADDRESS : AERO_ADDRESSES.swapRouter,
      data,
      value: "0x0",
      from: userAddress,
      gasLimit: toHexQuantity(
        useAdapterPath
          ? pathTokens.length > 2
            ? 1400000
            : 1100000
          : pathTokens.length > 2
            ? 650000
            : 450000,
      ),
      chainId: AERO_CHAIN_ID,
      expectedUserOutput: outputAmountNative,
      feeMode: useFeePath ? TOWER_SWAP_FEE_MODE : "none",
      feeBps: useFeePath ? params.quote.feeBps : undefined,
      feeRecipient: useFeePath ? feeRecipient : undefined,
      feeToken: useFeePath ? tokenIn : undefined,
      platformFeeAmount: useFeePath
        ? params.quote.platformFeeAmountNative
        : undefined,
      executorAddress: useAdapterPath ? AERO_SWAP_EXECUTOR_ADDRESS : undefined,
      inputAmountNative: amountInNative.toString(),
    },
  };
}
