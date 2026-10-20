"use client";

/**
 * Unified Deposit: fund a Circle Gateway (Unified Balance) account from
 * another chain, then spend it to the user's Arc wallet.
 * Testnet only for now.
 */

import { AppKit } from "@circle-fin/app-kit";
import { isAddress, type PublicClient } from "viem";
import {
  SUPPORTED_CHAINS,
  createBridgeKitAdapterFromClients,
  ensureWalletOnBridgeChain,
} from "@/lib/bridgeService";

export const FAST_DEPOSIT_SOURCE_KEYS = [
  "ethereum-sepolia",
  "arbitrum-sepolia",
  "optimism-sepolia",
  "unichain-sepolia",
] as const;

export type FastDepositSourceKey = (typeof FAST_DEPOSIT_SOURCE_KEYS)[number];

export const UNIFIED_DESTINATION = {
  key: "arc-testnet",
  circleChain: "Arc_Testnet",
  name: "Arc Testnet",
} as const;

const NETWORK_TYPE = "testnet" as const;

let kit: AppKit | null = null;
const getKit = () => (kit ??= new AppKit());

export const getFastDepositSources = () =>
  FAST_DEPOSIT_SOURCE_KEYS.map((key) => ({
    key,
    name: SUPPORTED_CHAINS[key].name,
    circleChain: SUPPORTED_CHAINS[key].circleChain,
  }));

type UnifiedKit = AppKit["unifiedBalance"];
export type UnifiedBalances = Awaited<ReturnType<UnifiedKit["getBalances"]>>;
export type DepositEstimate = Awaited<ReturnType<UnifiedKit["estimateDeposit"]>>;
export type DepositOutcome = Awaited<ReturnType<UnifiedKit["deposit"]>>;
export type SpendEstimate = Awaited<ReturnType<UnifiedKit["estimateSpend"]>>;
export type SpendOutcome = Awaited<ReturnType<UnifiedKit["spend"]>>;
type FeeEntries = NonNullable<DepositEstimate["fees"]>;

export type WalletContext = {
  publicClient: PublicClient | undefined;
  walletClient: unknown;
};

const createAdapter = (ctx: WalletContext, circleChain: string) =>
  createBridgeKitAdapterFromClients(
    ctx.publicClient,
    ctx.walletClient,
    circleChain,
  );

/** Optional Tower fee taken out of the spend amount. */
export const getSpendFee = () => {
  const value =
    process.env.NEXT_PUBLIC_UNIFIED_SPEND_FEE_USDC?.trim() ?? "0.10";
  const recipientAddress = (
    process.env.NEXT_PUBLIC_BRIDGE_FEE_RECIPIENT_EVM ??
    process.env.NEXT_PUBLIC_BRIDGE_FEE_RECIPIENT ??
    ""
  ).trim();

  if (!isAddress(recipientAddress) || !(Number.parseFloat(value) > 0)) {
    return null;
  }
  return { value, recipientAddress };
};

/** Sum of fee entries paid in USDC (gas is paid in the chain's native coin). */
export const sumUsdcFees = (fees?: FeeEntries) =>
  (fees ?? [])
    .filter((fee) => fee.token === "USDC")
    .reduce((total, fee) => total + (Number.parseFloat(fee.amount) || 0), 0);

export const getUnifiedBalances = (address: string) =>
  getKit().unifiedBalance.getBalances({
    token: "USDC",
    sources: { address },
    networkType: NETWORK_TYPE,
    includePending: true,
  });

export async function estimateFastDeposit(
  ctx: WalletContext,
  sourceKey: FastDepositSourceKey,
  amount: string,
) {
  const source = SUPPORTED_CHAINS[sourceKey];
  const adapter = await createAdapter(ctx, source.circleChain);
  const estimate = await getKit().unifiedBalance.estimateDeposit({
    from: { adapter, chain: source.circleChain },
    amount,
    token: "USDC",
    to: { chain: UNIFIED_DESTINATION.circleChain },
    config: { transferSpeed: "FAST" },
  });
  return { adapter, estimate };
}

/** Fast deposit: credits the Unified Balance on Arc within seconds. */
export async function fastDeposit(
  ctx: WalletContext,
  sourceKey: FastDepositSourceKey,
  amount: string,
) {
  await ensureWalletOnBridgeChain(sourceKey, ctx.walletClient as never);
  // Quote is fetched right before deposit so it cannot be expired.
  const { adapter, estimate } = await estimateFastDeposit(
    ctx,
    sourceKey,
    amount,
  );
  const result = await getKit().unifiedBalance.deposit({
    ...estimate,
    from: { adapter, chain: SUPPORTED_CHAINS[sourceKey].circleChain },
  });
  return { result, estimate };
}

const buildSpendParams = async (
  ctx: WalletContext,
  recipientAddress: string,
  amount: string,
) => {
  const adapter = await createAdapter(ctx, UNIFIED_DESTINATION.circleChain);
  const fee = getSpendFee();
  return {
    from: { adapter },
    to: {
      chain: UNIFIED_DESTINATION.circleChain,
      recipientAddress,
      useForwarder: true,
    },
    amount,
    token: "USDC" as const,
    ...(fee ? { config: { customFee: fee } } : {}),
  };
};

export async function estimateSpendToArc(
  ctx: WalletContext,
  recipientAddress: string,
  amount: string,
) {
  const params = await buildSpendParams(ctx, recipientAddress, amount);
  return getKit().unifiedBalance.estimateSpend(params);
}

export type SpendStep = "prepared" | "signed";

const SPEND_STEP_EVENTS: Record<SpendStep, string> = {
  prepared: "gateway.spend.step.buildBurnIntents",
  signed: "gateway.spend.step.signBurnIntents",
};

/** Spend: mints USDC from the Unified Balance to the user's Arc wallet. */
export async function spendToArc(
  ctx: WalletContext,
  recipientAddress: string,
  amount: string,
  onStep?: (step: SpendStep) => void,
) {
  const unified = getKit().unifiedBalance;
  const handlers = (Object.keys(SPEND_STEP_EVENTS) as SpendStep[]).map(
    (step) => ({ event: SPEND_STEP_EVENTS[step], handler: () => onStep?.(step) }),
  );
  handlers.forEach(({ event, handler }) => unified.on(event, handler));

  try {
    const params = await buildSpendParams(ctx, recipientAddress, amount);
    return await unified.spend(params);
  } finally {
    handlers.forEach(({ event, handler }) => unified.off(event, handler));
  }
}

export const getUnifiedErrorMessage = (error: unknown) =>
  error instanceof Error && error.message
    ? error.message
    : "Something went wrong. Please try again.";
