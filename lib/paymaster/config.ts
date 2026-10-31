import type { Address } from "viem";

// Circle Paymaster v0.7 (https://developers.circle.com/paymaster). Each address
// below was checked onchain: the paymaster's token() is that chain's USDC and
// its entryPoint() is the v0.7 EntryPoint.

export type PaymasterChainKey =
  | "base"
  | "arbitrum"
  | "base-sepolia"
  | "arbitrum-sepolia";

export type PaymasterChainConfig = {
  key: PaymasterChainKey;
  chainId: number;
  usdc: Address;
  paymaster: Address;
};

const PAYMASTER_MAINNET: Address = "0x6C973eBe80dCD8660841D4356bf15c32460271C9";
const PAYMASTER_TESTNET: Address = "0x31BE08D380A21fc740883c0BC434FcFc88740b58";

export const PAYMASTER_CHAINS: Record<PaymasterChainKey, PaymasterChainConfig> =
  {
    base: {
      key: "base",
      chainId: 8453,
      usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      paymaster: PAYMASTER_MAINNET,
    },
    arbitrum: {
      key: "arbitrum",
      chainId: 42161,
      usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      paymaster: PAYMASTER_MAINNET,
    },
    "base-sepolia": {
      key: "base-sepolia",
      chainId: 84532,
      usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      paymaster: PAYMASTER_TESTNET,
    },
    "arbitrum-sepolia": {
      key: "arbitrum-sepolia",
      chainId: 421614,
      usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      paymaster: PAYMASTER_TESTNET,
    },
  };

export const getPaymasterChain = (
  chainKey: string | null | undefined,
): PaymasterChainConfig | null =>
  (PAYMASTER_CHAINS as Record<string, PaymasterChainConfig | undefined>)[
    chainKey ?? ""
  ] ?? null;

export const getPaymasterChainById = (
  chainId: number | null | undefined,
): PaymasterChainConfig | null =>
  Object.values(PAYMASTER_CHAINS).find((chain) => chain.chainId === chainId) ??
  null;

export const isPaymasterChain = (chainKey: string | null | undefined) =>
  getPaymasterChain(chainKey) !== null;

export const PAYMASTER_CHAIN_IDS = Object.values(PAYMASTER_CHAINS).map(
  (chain) => chain.chainId,
);

export const USDC_DECIMALS = 6;

// Allowance signed to the paymaster with each permit. It only caps what the
// paymaster can pull for gas; unused prefund is refunded after each operation.
export const PAYMASTER_PERMIT_ALLOWANCE = 10_000_000n; // 10 USDC

// USDC kept free in the Gas Account on top of the bridge amount (UI check only).
export const GAS_ACCOUNT_GAS_BUFFER = 500_000n; // 0.50 USDC

// Left behind when withdrawing max, so the withdrawal can pay its own gas.
export const GAS_ACCOUNT_WITHDRAW_RESERVE = 250_000n; // 0.25 USDC

// From Circle's quickstart. The post-op limit must be at least the paymaster's
// additionalGasCharge (35,000 on the live contracts).
export const PAYMASTER_VERIFICATION_GAS_LIMIT = 200_000n;
export const PAYMASTER_POST_OP_GAS_LIMIT = 35_000n;

export const USER_OPERATION_TIMEOUT_MS = 180_000;
