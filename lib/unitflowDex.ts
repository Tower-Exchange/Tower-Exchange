import {
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { TOKEN_CONTRACTS } from "@/lib/arcNetwork";
import {
  ERC20_APPROVE_ABI,
  PERMIT2_APPROVE_ABI,
  SYNTHRA_CHAIN_ID,
} from "@/lib/synthraDex";

export const UNITFLOW_PUBLIC_RPC_URL = "https://rpc.testnet.arc.io";
export const UNITFLOW_PROXY_RPC_PATH = "/api/rpc/5042002";

export const unitFlowArcTestnet = {
  id: SYNTHRA_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "USDC",
    symbol: "USDC",
  },
  rpcUrls: {
    default: { http: [UNITFLOW_PUBLIC_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
} as const;

export const UNITFLOW_FEE_TIERS = [3000] as const;
export type UnitFlowFeeTier = (typeof UNITFLOW_FEE_TIERS)[number];

export const UNITFLOW_ADDRESSES = {
  factory: "0xAb6A8AAb7d490007634ef59d424b5d89688a1971",
  quoter: "0x121aeB6DEf00F6F67665008CaC1C19805886ed1a",
  universalRouter: "0xC43cC6A1E0F6EB48Cd4131522C1C73B13f3Da0F1",
  permit2: "0x4ce562f687d0ced27b79ba51d79b63bd978f7f48",
} as const satisfies Record<string, Address>;

export const UNITFLOW_NATIVE_USDC = TOKEN_CONTRACTS.USDC as Address;
export const UNITFLOW_WRAPPED_USDC = TOKEN_CONTRACTS.WUSDC_SYNTHRA as Address;

const UNITFLOW_QUOTER_ABI = [
  {
    type: "function",
    name: "quoteExactInput",
    stateMutability: "nonpayable",
    inputs: [
      { name: "path", type: "bytes" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const UNITFLOW_UNIVERSAL_ROUTER_ABI = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
    ],
    outputs: [],
  },
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

const UNITFLOW_UNIVERSAL_ROUTER_COMMANDS = {
  V3_SWAP_EXACT_IN: "0x00",
  WRAP_NATIVE: "0x0b",
  UNWRAP_NATIVE: "0x0c",
} as const;

const UNITFLOW_WUSDC_EURC_FEE: UnitFlowFeeTier = 3000;

export interface UnitFlowRoute {
  tokens: Address[];
  fees: UnitFlowFeeTier[];
  path: Hex;
}

export interface UnitFlowQuote {
  dexId: "unitflow";
  dexName: "UnitFlow";
  chainId: typeof SYNTHRA_CHAIN_ID;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  route: UnitFlowRoute;
}

export interface UnitFlowTransaction {
  to: Address;
  data: Hex;
  value: Hex;
  chainId: typeof SYNTHRA_CHAIN_ID;
}

type UnitFlowDirectPairConfig = {
  key: string;
  tokens: readonly [Address, Address];
  fee: UnitFlowFeeTier;
  poolAddress: Address;
};

export function normalizeUnitFlowAddress(address: string): Address {
  if (!isAddress(address)) {
    throw new Error(`Invalid EVM address: ${address}`);
  }

  return getAddress(address);
}

const getDefaultUnitFlowRpcUrl = () =>
  typeof window === "undefined" ? UNITFLOW_PUBLIC_RPC_URL : UNITFLOW_PROXY_RPC_PATH;

export function createUnitFlowPublicClient(rpcUrl = getDefaultUnitFlowRpcUrl()) {
  return createPublicClient({
    chain: {
      ...unitFlowArcTestnet,
      rpcUrls: {
        default: { http: [rpcUrl] },
      },
    },
    transport: http(rpcUrl),
  });
}

export function isUnitFlowNativeUsdc(address: string) {
  return (
    normalizeUnitFlowAddress(address).toLowerCase() ===
    normalizeUnitFlowAddress(UNITFLOW_NATIVE_USDC).toLowerCase()
  );
}

export function toUnitFlowPoolToken(address: string): Address {
  return isUnitFlowNativeUsdc(address)
    ? normalizeUnitFlowAddress(UNITFLOW_WRAPPED_USDC)
    : normalizeUnitFlowAddress(address);
}

export function sortUnitFlowTokens(tokenA: string, tokenB: string): [Address, Address] {
  const a = normalizeUnitFlowAddress(tokenA);
  const b = normalizeUnitFlowAddress(tokenB);

  if (a.toLowerCase() === b.toLowerCase()) {
    throw new Error("UnitFlow route construction requires two different tokens");
  }

  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

const UNITFLOW_DIRECT_PAIRS: readonly UnitFlowDirectPairConfig[] = [
  {
    key: "WUSDC/EURC",
    tokens: sortUnitFlowTokens(TOKEN_CONTRACTS.WUSDC_SYNTHRA, TOKEN_CONTRACTS.EURC),
    fee: UNITFLOW_WUSDC_EURC_FEE,
    poolAddress: normalizeUnitFlowAddress(
      "0x13873aD4296AC255361BeA54681FdCC55eF9c316",
    ),
  },
] as const;

const getUnitFlowDirectPair = (tokenA: string, tokenB: string) => {
  const [sortedTokenA, sortedTokenB] = sortUnitFlowTokens(
    toUnitFlowPoolToken(tokenA),
    toUnitFlowPoolToken(tokenB),
  );

  return (
    UNITFLOW_DIRECT_PAIRS.find(
      ({ tokens }) =>
        tokens[0].toLowerCase() === sortedTokenA.toLowerCase() &&
        tokens[1].toLowerCase() === sortedTokenB.toLowerCase(),
    ) ?? null
  );
};

export function isUnitFlowSupportedPair(tokenA: string, tokenB: string) {
  try {
    return getUnitFlowDirectPair(tokenA, tokenB) !== null;
  } catch {
    return false;
  }
}

export function encodeUnitFlowV3Path(tokens: string[], fees: readonly number[]): Hex {
  if (tokens.length < 2) {
    throw new Error("A UnitFlow path needs at least two tokens");
  }

  if (fees.length !== tokens.length - 1) {
    throw new Error("UnitFlow path fee count must be token count minus one");
  }

  const packedTypes = tokens.flatMap((_, index) =>
    index < fees.length ? (["address", "uint24"] as const) : (["address"] as const),
  );
  const packedValues = tokens.flatMap((token, index) =>
    index < fees.length
      ? ([normalizeUnitFlowAddress(token), fees[index]] as const)
      : ([normalizeUnitFlowAddress(token)] as const),
  );

  return encodePacked(packedTypes, packedValues);
}

export function buildUnitFlowRouteFromTokens(
  tokenIn: string,
  tokenOut: string,
): UnitFlowRoute | null {
  const normalizedTokenIn = normalizeUnitFlowAddress(tokenIn);
  const normalizedTokenOut = normalizeUnitFlowAddress(tokenOut);
  const poolTokenIn = toUnitFlowPoolToken(normalizedTokenIn);
  const poolTokenOut = toUnitFlowPoolToken(normalizedTokenOut);
  const directPair = getUnitFlowDirectPair(poolTokenIn, poolTokenOut);

  if (!directPair) {
    return null;
  }

  return {
    tokens: [poolTokenIn, poolTokenOut],
    fees: [directPair.fee],
    path: encodeUnitFlowV3Path(
      [poolTokenIn, poolTokenOut],
      [directPair.fee],
    ),
  };
}

export async function quoteUnitFlowRoute(
  client: PublicClient,
  route: UnitFlowRoute,
  amountIn: bigint | string,
  tokenIn: string,
  tokenOut: string,
): Promise<UnitFlowQuote | null> {
  try {
    const amountOut = (await client.readContract({
      address: UNITFLOW_ADDRESSES.quoter,
      abi: UNITFLOW_QUOTER_ABI,
      functionName: "quoteExactInput",
      args: [route.path, BigInt(amountIn)],
    })) as bigint;

    return {
      dexId: "unitflow",
      dexName: "UnitFlow",
      chainId: SYNTHRA_CHAIN_ID,
      tokenIn: normalizeUnitFlowAddress(tokenIn),
      tokenOut: normalizeUnitFlowAddress(tokenOut),
      amountIn: BigInt(amountIn),
      amountOut,
      route,
    };
  } catch (error) {
    console.warn("[UnitFlow] quote unavailable:", error);
    return null;
  }
}

export async function getBestUnitFlowQuote(
  client: PublicClient,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint | string,
): Promise<UnitFlowQuote | null> {
  const route = buildUnitFlowRouteFromTokens(tokenIn, tokenOut);

  if (!route) {
    return null;
  }

  return quoteUnitFlowRoute(client, route, amountIn, tokenIn, tokenOut);
}

export function calculateUnitFlowAmountOutMinimum(
  amountOut: bigint | string,
  slippageBps: number,
): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10000) {
    throw new Error("Slippage must be an integer between 0 and 9999 basis points");
  }

  return (BigInt(amountOut) * BigInt(10000 - slippageBps)) / 10000n;
}

export function buildUnitFlowExactInputTransaction(params: {
  quote: UnitFlowQuote;
  recipient: string;
  slippageBps: number;
  deadline?: bigint | number;
  payerIsUser?: boolean;
  wrapNativeInput?: boolean;
  unwrapNativeOutput?: boolean;
}): UnitFlowTransaction {
  const recipient = normalizeUnitFlowAddress(params.recipient);
  const deadline =
    params.deadline == null
      ? BigInt(Math.floor(Date.now() / 1000) + 20 * 60)
      : BigInt(params.deadline);
  const amountOutMinimum = calculateUnitFlowAmountOutMinimum(
    params.quote.amountOut,
    params.slippageBps,
  );
  const commandList = [
    ...(params.wrapNativeInput ? [UNITFLOW_UNIVERSAL_ROUTER_COMMANDS.WRAP_NATIVE] : []),
    UNITFLOW_UNIVERSAL_ROUTER_COMMANDS.V3_SWAP_EXACT_IN,
    ...(params.unwrapNativeOutput
      ? [UNITFLOW_UNIVERSAL_ROUTER_COMMANDS.UNWRAP_NATIVE]
      : []),
  ];
  const commands = `0x${commandList.map((command) => command.slice(2)).join("")}` as Hex;
  const inputs = [
    ...(params.wrapNativeInput
      ? [
          encodeAbiParameters(
            [
              { name: "recipient", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            [UNITFLOW_ADDRESSES.universalRouter, params.quote.amountIn],
          ),
        ]
      : []),
    encodeAbiParameters(
      [
        { name: "recipient", type: "address" },
        { name: "amountIn", type: "uint256" },
        { name: "amountOutMinimum", type: "uint256" },
        { name: "path", type: "bytes" },
        { name: "payerIsUser", type: "bool" },
      ],
      [
        params.unwrapNativeOutput ? UNITFLOW_ADDRESSES.universalRouter : recipient,
        params.quote.amountIn,
        amountOutMinimum,
        params.quote.route.path,
        params.payerIsUser ?? !params.wrapNativeInput,
      ],
    ),
    ...(params.unwrapNativeOutput
      ? [
          encodeAbiParameters(
            [
              { name: "recipient", type: "address" },
              { name: "amountMinimum", type: "uint256" },
            ],
            [recipient, amountOutMinimum],
          ),
        ]
      : []),
  ];

  return {
    to: UNITFLOW_ADDRESSES.universalRouter,
    data: encodeFunctionData({
      abi: UNITFLOW_UNIVERSAL_ROUTER_ABI,
      functionName: "execute",
      args: [commands, inputs, deadline],
    }),
    value: params.wrapNativeInput ? `0x${params.quote.amountIn.toString(16)}` : "0x0",
    chainId: SYNTHRA_CHAIN_ID,
  };
}

export function buildUnitFlowApprovalTransaction(params: {
  tokenAddress: string;
  amount: bigint | string;
  spender?: string;
}): UnitFlowTransaction {
  return {
    to: normalizeUnitFlowAddress(params.tokenAddress),
    data: encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [
        normalizeUnitFlowAddress(params.spender ?? UNITFLOW_ADDRESSES.universalRouter),
        BigInt(params.amount),
      ],
    }),
    value: "0x0",
    chainId: SYNTHRA_CHAIN_ID,
  };
}

export function buildUnitFlowPermit2ApproveTransaction(params: {
  tokenAddress: string;
  amount: bigint | string;
  spender?: string;
  expiration?: bigint | number;
}): UnitFlowTransaction {
  const maxUint48 = 2 ** 48 - 1;

  return {
    to: UNITFLOW_ADDRESSES.permit2,
    data: encodeFunctionData({
      abi: PERMIT2_APPROVE_ABI,
      functionName: "approve",
      args: [
        normalizeUnitFlowAddress(params.tokenAddress),
        normalizeUnitFlowAddress(params.spender ?? UNITFLOW_ADDRESSES.universalRouter),
        BigInt(params.amount),
        params.expiration == null ? maxUint48 : Number(params.expiration),
      ],
    }),
    value: "0x0",
    chainId: SYNTHRA_CHAIN_ID,
  };
}

export function getUnitFlowDexInfo() {
  return {
    id: "unitflow",
    name: "UnitFlow",
    routerAddress: UNITFLOW_ADDRESSES.universalRouter,
    factoryAddress: UNITFLOW_ADDRESSES.factory,
    universalRouterAddress: UNITFLOW_ADDRESSES.universalRouter,
    permit2Address: UNITFLOW_ADDRESSES.permit2,
    type: "v3" as const,
    chainId: SYNTHRA_CHAIN_ID,
    enabled: true,
    supportedTokens: [TOKEN_CONTRACTS.USDC, TOKEN_CONTRACTS.EURC],
    feeTiers: UNITFLOW_FEE_TIERS,
    poolAddresses: UNITFLOW_DIRECT_PAIRS.map((pair) => pair.poolAddress),
  };
}
