import type { Address } from "viem";

/**
 * Arc mainnet Synthra V3 deployments from
 * https://docs.synthra.org/docs/contract-addresses#arc-mainnet-5042-
 *
 * This module is a staging registry only. Live quotes and swaps still use
 * `lib/synthraDex.ts` on Arc testnet (5042002). Do not import these addresses
 * into the quote, swap, or executor paths until supported token pools exist
 * on 5042 and the app is ready to switch networks.
 *
 * Most V3 addresses are CREATE2-identical to Robinhood Chain (4663). The
 * Universal Router is the exception and is Arc-specific. Always key caches
 * by chain id + address. The Arc LaunchPad address string is the same as
 * the Robinhood Universal Router.
 */
export const SYNTHRA_MAINNET_CHAIN_ID = 5042;
export const SYNTHRA_MAINNET_PUBLIC_RPC_URL = "https://rpc.mainnet.arc.io";
export const SYNTHRA_MAINNET_PROXY_RPC_PATH = "/api/rpc/5042";
export const SYNTHRA_MAINNET_EXPLORER_URL = "https://arc.etherscan.io";

export const synthraArcMainnet = {
  id: SYNTHRA_MAINNET_CHAIN_ID,
  name: "Arc",
  nativeCurrency: {
    decimals: 18,
    name: "USD Coin",
    symbol: "USDC",
  },
  rpcUrls: {
    default: { http: [SYNTHRA_MAINNET_PUBLIC_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: SYNTHRA_MAINNET_EXPLORER_URL },
  },
  testnet: false,
} as const;

export const SYNTHRA_MAINNET_ADDRESSES = {
  factory: "0x6307fc239C7964942c1BfFE51930E55606619c74",
  universalRouter: "0xe4C51D643A7d6D94be2646e482C59CF681B7AcEB",
  swapRouter02: "0xa50eDe66a573eE5bB37E28AF5789B76aE5FEb828",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  quoterV2: "0x9c179A7335B3fc841F59Aa6a62daf6d5c61b65D7",
  nonfungiblePositionManager: "0x2743b771659fD9CE13970d7367e7e84AF6a31049",
  tickLens: "0x4A43Bd076160779F8120b48fb99Ce8adB5A25C8d",
  multicall2: "0x2619d7c51B74b271a657e7174f9283DC95852a46",
  protocolFeeRecipient: "0x1CAB229e4D75E4DE0EC890bef0295a32BAaa1328",
  unsupportedProtocol: "0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f",
} as const satisfies Record<string, Address>;

export const SYNTHRA_MAINNET_TOKENS = {
  USDC: "0x3600000000000000000000000000000000000000",
} as const satisfies Record<string, Address>;

export const SYNTHRA_MAINNET_POOL_INIT_CODE_HASH =
  "0xd57f04bba45e2c271c16c370a90dc3bbfa3e4f5c9ffff0981b979a7bcdeac7c3";

/** Factory feeAmountTickSpacing values observed on Arc mainnet. */
export const SYNTHRA_MAINNET_FEE_TIERS = [100, 500, 3000, 10000] as const;
export type SynthraMainnetFeeTier = (typeof SYNTHRA_MAINNET_FEE_TIERS)[number];

/**
 * Native wrapping, unwrapping, and value-carrying Universal Router commands
 * are unsupported on Arc. Quotes and swaps must stay ERC-20 only, including
 * USDC at the 0x3600… predeploy.
 */
export const SYNTHRA_MAINNET_SUPPORTS_NATIVE_WRAP = false;

/**
 * Fill this once Synthra publishes mainnet token addresses and seeded pools.
 * Do not copy testnet pool addresses or testnet token addresses except USDC.
 */
export const SYNTHRA_MAINNET_DIRECT_PAIRS: readonly {
  key: string;
  tokens: readonly [Address, Address];
  fee: SynthraMainnetFeeTier;
  poolAddress?: Address;
}[] = [];

export function getSynthraMainnetExecutorAllowlist() {
  return {
    routeTargets: [SYNTHRA_MAINNET_ADDRESSES.universalRouter],
    approvalSpenders: [
      SYNTHRA_MAINNET_ADDRESSES.universalRouter,
      SYNTHRA_MAINNET_ADDRESSES.swapRouter02,
      SYNTHRA_MAINNET_ADDRESSES.permit2,
    ],
  } as const;
}
