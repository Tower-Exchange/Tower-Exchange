import type { Address } from "viem";

/**
 * Arc mainnet UnitFlow V3 deployments.
 *
 * Staging registry only. Live quotes and swaps still use `lib/unitflowDex.ts`
 * on Arc testnet (5042002). Do not import these addresses into the quote,
 * swap, or executor paths until supported token pools exist on 5042 and the
 * app is ready to switch networks.
 *
 * UnitFlow published a V3 factory, SwapRouter, and Quoter. There is no
 * Universal Router, Permit2, or WUSDC in this set, so Tower should use the
 * direct V3 router rather than deploy another UnitFlow adapter.
 */
export const UNITFLOW_MAINNET_CHAIN_ID = 5042;
export const UNITFLOW_MAINNET_PUBLIC_RPC_URL = "https://rpc.mainnet.arc.io";
export const UNITFLOW_MAINNET_PROXY_RPC_PATH = "/api/rpc/5042";
export const UNITFLOW_MAINNET_EXPLORER_URL = "https://arc.etherscan.io";

export const unitFlowArcMainnet = {
  id: UNITFLOW_MAINNET_CHAIN_ID,
  name: "Arc",
  nativeCurrency: {
    decimals: 18,
    name: "USD Coin",
    symbol: "USDC",
  },
  rpcUrls: {
    default: { http: [UNITFLOW_MAINNET_PUBLIC_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: UNITFLOW_MAINNET_EXPLORER_URL },
  },
  testnet: false,
} as const;

export const UNITFLOW_MAINNET_ADDRESSES = {
  factory: "0xc9719bF56c4C22BaA1549885B03F38a04897ff10",
  swapRouter: "0xc53D630e43d565DA0D84b8D637982cA61dC3f4B6",
  quoter: "0x73D01db0dfA3C7E31F97cDDB73F8Bbf21cAFcB08",
  nonfungiblePositionManager: "0x771AB382ca3770416D2C71E076fc6C3760Bb0ccf",
  tickLens: "0x1c2eC90a61b238Dc5e0D79F1D737d735E795Df66",
  multicall: "0xD4BB7b3b1e4563480cEd52Bf5Ff0b8d0B5012FE9",
} as const satisfies Record<string, Address>;

export const UNITFLOW_MAINNET_TOKENS = {
  USDC: "0x3600000000000000000000000000000000000000",
} as const satisfies Record<string, Address>;

export const UNITFLOW_MAINNET_FEE_TIERS = [100, 500, 3000, 10000] as const;
export type UnitFlowMainnetFeeTier = (typeof UNITFLOW_MAINNET_FEE_TIERS)[number];

/**
 * Fill this once UnitFlow publishes mainnet token addresses and seeded pools.
 * Do not copy testnet pool addresses or testnet token addresses except USDC.
 */
export const UNITFLOW_MAINNET_DIRECT_PAIRS: readonly {
  key: string;
  tokens: readonly [Address, Address];
  fee: UnitFlowMainnetFeeTier;
  poolAddress?: Address;
}[] = [];

export function getUnitFlowMainnetExecutorAllowlist() {
  return {
    routeTargets: [UNITFLOW_MAINNET_ADDRESSES.swapRouter],
    approvalSpenders: [UNITFLOW_MAINNET_ADDRESSES.swapRouter],
  } as const;
}
