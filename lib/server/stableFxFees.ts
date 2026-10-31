import { formatUnits } from "viem";

import { StableFxError } from "@/lib/server/circleStableFx";

const BPS_DENOMINATOR = 10_000n;
const MAX_TOWER_STABLEFX_FEE_BPS = 1_000;

export type StableFxTowerFee = {
  basisPoints: number;
  grossAmountRaw: bigint;
  tradeAmountRaw: bigint;
  feeAmountRaw: bigint;
  tradeAmount: string;
  feeAmount: string;
};

/**
 * Tower's StableFX markup is deliberately independent of the DEX fee setting.
 * Railway/local environment changes are picked up on the next server start or
 * deployment; it is never a browser-controlled value.
 */
export function getTowerStableFxFeeBps() {
  const configured = process.env.TOWER_STABLEFX_FEE_BPS?.trim();
  if (!configured) return 0;
  if (!/^\d+$/.test(configured)) {
    throw new StableFxError(
      "TOWER_STABLEFX_FEE_BPS must be a whole-number basis-point value.",
      503,
    );
  }

  const feeBps = Number(configured);
  if (!Number.isSafeInteger(feeBps) || feeBps > MAX_TOWER_STABLEFX_FEE_BPS) {
    throw new StableFxError(
      `TOWER_STABLEFX_FEE_BPS must be between 0 and ${MAX_TOWER_STABLEFX_FEE_BPS}.`,
      503,
    );
  }
  return feeBps;
}

/**
 * Customers enter a gross source amount. Tower retains the rounded-down source
 * token fee and sends the remaining principal to Circle StableFX. Rounding down
 * guarantees the customer is never charged more than the configured rate.
 */
export function calculateTowerStableFxFee(params: {
  grossAmountRaw: bigint;
  tokenDecimals: number;
  basisPoints?: number;
}): StableFxTowerFee {
  const basisPoints = params.basisPoints ?? getTowerStableFxFeeBps();
  const feeAmountRaw =
    (params.grossAmountRaw * BigInt(basisPoints)) / BPS_DENOMINATOR;
  const tradeAmountRaw = params.grossAmountRaw - feeAmountRaw;
  if (params.grossAmountRaw <= 0n || tradeAmountRaw <= 0n) {
    throw new StableFxError(
      "The StableFX fee leaves no amount available for the Circle trade.",
      400,
    );
  }

  return {
    basisPoints,
    grossAmountRaw: params.grossAmountRaw,
    tradeAmountRaw,
    feeAmountRaw,
    tradeAmount: formatUnits(tradeAmountRaw, params.tokenDecimals),
    feeAmount: formatUnits(feeAmountRaw, params.tokenDecimals),
  };
}
