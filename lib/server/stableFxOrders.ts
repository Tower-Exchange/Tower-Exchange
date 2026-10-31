import { randomUUID } from "node:crypto";

import {
  getAddress,
  isAddress,
  isHash,
  formatUnits,
  type Address,
  type Hex,
} from "viem";

import {
  createStableFxFundingPresign,
  createStableFxTrade,
  createStableFxTradableQuote,
  findRecentStableFxTradeByQuoteId,
  fundStableFxTrade,
  getStableFxTrade,
  isStableFxEnabled,
  StableFxError,
  type StableFxTrade,
  type StableFxTypedData,
} from "@/lib/server/circleStableFx";
import { supabaseAdmin } from "@/lib/server/devApiSupabase";
import {
  broadcastStableFxPayout,
  findExistingStableFxPayout,
  findStableFxSettlementReceipt,
  getStableFxPayoutReceipt,
  getStableFxPermit2Allowance,
  getStableFxTokenBalance,
  getStableFxTakerConfig,
  parseStableFxAmount,
  signStableFxTypedData,
  validateStableFxTradeIntentTypedData,
  validateStableFxPermitTypedData,
  verifyExactStableFxDeposit,
} from "@/lib/server/stableFxTaker";
import {
  isStableFxAmount,
  isStableFxPair,
  normalizeStableFxCurrency,
  type StableFxCurrency,
} from "@/lib/stableFx";
import {
  calculateTowerStableFxFee,
  getTowerStableFxFeeBps,
} from "@/lib/server/stableFxFees";

type OrderStatus =
  | "awaiting_deposit"
  | "deposit_verified"
  | "executing"
  | "funding_submitting"
  | "funding_submitted"
  | "funding_submission_unknown"
  | "settlement_completed"
  | "payout_submitting"
  | "payout_broadcast"
  | "completed"
  | "refund_required"
  | "needs_review";

type StableFxOrderRow = {
  id: string;
  customer_address: string;
  recipient_address: string;
  taker_address: string;
  from_currency: StableFxCurrency;
  to_currency: StableFxCurrency;
  /** Net source-token principal submitted to Circle. */
  source_amount: string;
  source_amount_raw: string;
  /** Gross customer input/deposit before the Tower StableFX fee. */
  customer_amount: string | null;
  customer_amount_raw: string | null;
  tower_fee_amount: string | null;
  tower_fee_amount_raw: string | null;
  tower_fee_bps: number;
  status: OrderStatus;
  idempotency_key: string;
  deposit_tx_hash: string | null;
  deposit_block_number: string | null;
  quote_id: string | null;
  quote_expires_at: string | null;
  trade_typed_data: unknown;
  trade_signature: string | null;
  trade_id: string | null;
  contract_trade_id: string | null;
  circle_status: string | null;
  funding_typed_data: unknown;
  funding_signature: string | null;
  settlement_tx_hash: string | null;
  output_amount_raw: string | null;
  payout_tx_hash: string | null;
  payout_amount_raw: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

type UnknownRecord = Record<string, unknown>;

const STABLEFX_ACTIVITY_TYPE = "Swap via Circle StableFX";
const STABLEFX_ACTIVITY_USD_PRICES: Record<StableFxCurrency, number> = {
  USDC: 1,
  EURC: 1.08,
  GBPA: 1.3,
  MXNB: 0.055,
  AUDF: 0.65,
};

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asOrder(value: unknown): StableFxOrderRow {
  const order = value as StableFxOrderRow & {
    source_amount?: string | number;
    source_amount_raw?: string | number;
    customer_amount?: string | number | null;
    customer_amount_raw?: string | number | null;
    tower_fee_amount?: string | number | null;
    tower_fee_amount_raw?: string | number | null;
  };
  const optionalNumericString = (numeric: string | number | null | undefined) =>
    typeof numeric === "string" || typeof numeric === "number"
      ? String(numeric)
      : null;

  // PostgREST may deserialize PostgreSQL NUMERIC values as JavaScript numbers
  // (for example `2` rather than `"2"`). Circle quote validation intentionally
  // accepts only decimal strings, and the raw amount must remain string-safe for
  // BigInt. Normalize at the database boundary so a confirmed customer deposit
  // can always proceed to quote creation and EIP-712 signing.
  return {
    ...order,
    source_amount: String(order.source_amount),
    source_amount_raw: String(order.source_amount_raw),
    customer_amount: optionalNumericString(order.customer_amount),
    customer_amount_raw: optionalNumericString(order.customer_amount_raw),
    tower_fee_amount: optionalNumericString(order.tower_fee_amount),
    tower_fee_amount_raw: optionalNumericString(order.tower_fee_amount_raw),
  };
}

function orderError(message: string, status = 500): never {
  throw new StableFxError(message, status);
}

function typedDataFromDb(value: unknown, field: string): StableFxTypedData {
  const typedData = asRecord(value);
  const domain = asRecord(typedData?.domain);
  const types = asRecord(typedData?.types);
  const message = asRecord(typedData?.message);
  if (
    !domain ||
    !types ||
    !message ||
    typeof typedData?.primaryType !== "string"
  ) {
    orderError(`Stored ${field} is invalid. This order requires manual review.`, 500);
  }
  return typedData as unknown as StableFxTypedData;
}

function normalizeAddress(value: string, label: string): Address {
  if (!isAddress(value)) orderError(`Invalid ${label}.`, 500);
  return getAddress(value);
}

// Circle currently returns very short-lived tradable quotes. Reserve only a
// tiny clock/transport guard; the surrounding execution path must otherwise
// use the quote immediately. Quote expiry is independent of the FX settlement
// tenor selected for the trade.
const EXECUTABLE_QUOTE_MINIMUM_REMAINING_MS = 250;
const MAX_EXECUTABLE_QUOTE_RENEWALS = 1;

function isQuoteExpiredOrExpiring(order: StableFxOrderRow) {
  if (!order.quote_expires_at) return false;
  const expiry = Date.parse(order.quote_expires_at);
  return (
    Number.isFinite(expiry) &&
    expiry <= Date.now() + EXECUTABLE_QUOTE_MINIMUM_REMAINING_MS
  );
}

async function getOrder(orderId: string): Promise<StableFxOrderRow> {
  const { data, error } = await supabaseAdmin
    .from("stablefx_orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (error) orderError("Unable to read the StableFX order.");
  if (!data) orderError("StableFX order not found.", 404);
  return asOrder(data);
}

async function updateOrder(
  orderId: string,
  patch: Record<string, unknown>,
  expectedStatuses?: OrderStatus[],
) {
  let query = supabaseAdmin
    .from("stablefx_orders")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", orderId);
  if (expectedStatuses?.length) query = query.in("status", expectedStatuses);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) orderError("Unable to update the StableFX order.");
  return data ? asOrder(data) : null;
}

async function markForReview(
  order: StableFxOrderRow,
  reason: string,
  status: "refund_required" | "needs_review" = "needs_review",
): Promise<StableFxOrderRow> {
  console.error("StableFX order requires review", { orderId: order.id, status, reason });
  return (
    (await updateOrder(order.id, { status, failure_reason: reason })) ?? order
  );
}

function publicOrder(order: StableFxOrderRow) {
  return {
    id: order.id,
    status: order.status,
    fromCurrency: order.from_currency,
    toCurrency: order.to_currency,
    // sourceAmount is the Circle principal; customerAmount remains the gross
    // value shown/paid by the customer.
    sourceAmount: order.source_amount,
    customerAmount: order.customer_amount ?? order.source_amount,
    towerFee: {
      amount: order.tower_fee_amount ?? "0",
      amountRaw: order.tower_fee_amount_raw ?? "0",
      basisPoints: order.tower_fee_bps ?? 0,
    },
    recipientAddress: order.recipient_address,
    deposit: {
      transactionHash: order.deposit_tx_hash,
      blockNumber: order.deposit_block_number,
    },
    trade: {
      id: order.trade_id,
      contractTradeId: order.contract_trade_id,
      status: order.circle_status,
      quoteId: order.quote_id,
      settlementTransactionHash: order.settlement_tx_hash,
    },
    payout: {
      transactionHash: order.payout_tx_hash,
      amountRaw: order.payout_amount_raw,
    },
    failureReason: order.failure_reason,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
  };
}

function customerDepositAmountRaw(order: StableFxOrderRow) {
  try {
    return BigInt(order.customer_amount_raw ?? order.source_amount_raw);
  } catch {
    orderError("Stored StableFX customer deposit amount is invalid.", 500);
  }
}

/**
 * StableFX takes the risk buffer when it records the trade onchain. The
 * subsequent funding Permit2 must therefore cover only the part of the trade
 * principal that is not already held in escrow.
 */
function remainingStableFxFundingAmount(sourceAmount: bigint, collateralAmount: bigint) {
  if (collateralAmount > sourceAmount) {
    throw new StableFxError(
      "Circle returned StableFX collateral greater than this trade's source amount.",
      502,
    );
  }
  return sourceAmount - collateralAmount;
}

function assertOrderOwner(order: StableFxOrderRow, wallet: string) {
  if (order.customer_address.toLowerCase() !== wallet.toLowerCase()) {
    orderError("This StableFX order belongs to a different wallet.", 403);
  }
}

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected StableFX execution error.";
}

/**
 * A completed order has a confirmed Arc payout. Record that payout once in
 * the user-visible activity ledger so the same result appears anywhere Tower
 * renders swap and bridge history. The order itself always remains completed
 * even if activity rendering is temporarily unavailable.
 */
async function recordCompletedStableFxActivity(order: StableFxOrderRow) {
  if (!order.payout_tx_hash) return;

  try {
    const walletAddress = order.customer_address.toLowerCase();
    const transactionHash = order.payout_tx_hash.toLowerCase();
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("activities")
      .select("id")
      .eq("wallet_address", walletAddress)
      .eq("type", STABLEFX_ACTIVITY_TYPE)
      .eq("transaction_hash", transactionHash)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }
    if (existing) return;

    const amount = Number.parseFloat(order.customer_amount ?? order.source_amount);
    const amountUsd = Number.isFinite(amount)
      ? amount * STABLEFX_ACTIVITY_USD_PRICES[order.from_currency]
      : null;
    const { error: insertError } = await supabaseAdmin.from("activities").insert({
      wallet_address: walletAddress,
      type: STABLEFX_ACTIVITY_TYPE,
      source_currency_ticker: order.from_currency,
      destination_currency_ticker: order.to_currency,
      source_network_name: "Arc",
      destination_network_name: "Arc",
      destination_address: order.recipient_address,
      status: "Successful",
      amount: Number.isFinite(amount) ? amount : null,
      amount_usd: amountUsd,
      transaction_hash: transactionHash,
      timestamp: order.updated_at,
    });

    if (insertError) {
      throw new Error(insertError.message);
    }
  } catch (error) {
    console.error("Unable to record completed StableFX activity", {
      orderId: order.id,
      error: failureMessage(error),
    });
  }
}

export async function createStableFxDepositOrder(params: {
  customerAddress: string;
  fromCurrency: unknown;
  toCurrency: unknown;
  amount: unknown;
  amountSide: unknown;
  expectedTowerFeeBps?: unknown;
}) {
  if (!isStableFxEnabled()) {
    orderError("StableFX is not enabled for this environment.", 503);
  }
  const fromCurrency = normalizeStableFxCurrency(params.fromCurrency);
  const toCurrency = normalizeStableFxCurrency(params.toCurrency);
  const amount = typeof params.amount === "string" ? params.amount.trim() : "";
  if (!fromCurrency || !toCurrency || !isStableFxPair(fromCurrency, toCurrency)) {
    orderError("Choose an enabled StableFX currency pair.", 400);
  }
  if (!isStableFxAmount(amount)) {
    orderError("amount must be a positive decimal with no more than 6 decimal places.", 400);
  }
  // A fixed source amount is required to prove the customer deposit before an
  // executable quote exists. Destination-amount orders need a separate balance
  // / reservation product and are intentionally not treated as exact deposits.
  if (params.amountSide !== undefined && params.amountSide !== "from") {
    orderError("Live StableFX orders currently require a fixed source amount.", 400);
  }

  const config = getStableFxTakerConfig();
  const sourceToken = config.tokens[fromCurrency];
  const customerAmountRaw = parseStableFxAmount(amount, sourceToken);
  if (customerAmountRaw <= 0n) orderError("amount must be greater than zero.", 400);
  const configuredFeeBps = getTowerStableFxFeeBps();
  if (params.expectedTowerFeeBps !== undefined) {
    if (
      typeof params.expectedTowerFeeBps !== "number" ||
      !Number.isSafeInteger(params.expectedTowerFeeBps)
    ) {
      orderError("StableFX fee configuration is invalid. Refresh the quote.", 400);
    }
    if (params.expectedTowerFeeBps !== configuredFeeBps) {
      orderError("Tower StableFX fee changed. Refresh the quote before depositing.", 409);
    }
  }
  const towerFee = calculateTowerStableFxFee({
    grossAmountRaw: customerAmountRaw,
    tokenDecimals: sourceToken.decimals,
    basisPoints: configuredFeeBps,
  });
  const customerAddress = normalizeAddress(params.customerAddress, "customer wallet");

  const { data, error } = await supabaseAdmin
    .from("stablefx_orders")
    .insert({
      customer_address: customerAddress.toLowerCase(),
      recipient_address: customerAddress.toLowerCase(),
      taker_address: config.address.toLowerCase(),
      from_currency: fromCurrency,
      to_currency: toCurrency,
      source_amount: towerFee.tradeAmount,
      source_amount_raw: towerFee.tradeAmountRaw.toString(),
      customer_amount: amount,
      customer_amount_raw: towerFee.grossAmountRaw.toString(),
      tower_fee_amount: towerFee.feeAmount,
      tower_fee_amount_raw: towerFee.feeAmountRaw.toString(),
      tower_fee_bps: towerFee.basisPoints,
      status: "awaiting_deposit",
      idempotency_key: randomUUID(),
    })
    .select("*")
    .single();
  if (error || !data) {
    console.error("Unable to create StableFX deposit order", { error });
    orderError("Unable to create a StableFX order.");
  }
  const order = asOrder(data);
  return {
    order: publicOrder(order),
    depositInstruction: {
      chainId: 5042,
      tokenAddress: sourceToken.address,
      tokenDecimals: sourceToken.decimals,
      amount: order.customer_amount ?? order.source_amount,
      amountRaw: order.customer_amount_raw ?? order.source_amount_raw,
      to: config.address,
      functionName: "transfer",
      args: [
        config.address,
        order.customer_amount_raw ?? order.source_amount_raw,
      ],
    },
  };
}

async function executeOrder(
  orderId: string,
  executableQuoteRenewals = 0,
): Promise<StableFxOrderRow> {
  let order = await getOrder(orderId);
  if (
    order.status !== "deposit_verified" &&
    order.status !== "executing"
  ) {
    return order;
  }

  const claimed = await updateOrder(order.id, { status: "executing", failure_reason: null }, [
    "deposit_verified",
    "executing",
  ]);
  if (!claimed) return getOrder(order.id);
  order = claimed;

  try {
    const config = getStableFxTakerConfig();
    const sourceToken = config.tokens[order.from_currency];
    const destinationToken = config.tokens[order.to_currency];
    const sourceAmount = BigInt(order.source_amount_raw);
    const sourceAmountForQuote = formatUnits(sourceAmount, sourceToken.decimals);
    let expectedCollateralAmount: bigint | undefined;
    let expectedDestinationAmount: bigint | undefined;
    let finalQuoteWasPreflighted = false;
    let tradeTypedData = order.trade_typed_data
      ? typedDataFromDb(order.trade_typed_data, "trade typed data")
      : null;

    if (!order.quote_id) {
      // Circle's executable quotes currently have only a few seconds of
      // validity. Use one unsigned quote to obtain its Permit2 contract and
      // collateral requirement for the on-chain preflight, then request a
      // completely fresh quote for the signature and trade submission below.
      const preflightQuote = await createStableFxTradableQuote({
        fromCurrency: order.from_currency,
        toCurrency: order.to_currency,
        amount: sourceAmountForQuote,
        amountSide: "from",
        recipientAddress: config.address,
      });
      if (!preflightQuote.id || !preflightQuote.from.amount || !preflightQuote.to.amount) {
        throw new StableFxError("Circle returned an incomplete executable quote.", 502);
      }
      if (parseStableFxAmount(preflightQuote.from.amount, sourceToken) !== sourceAmount) {
        throw new StableFxError(
          "The executable StableFX quote changed the deposited source amount.",
          502,
        );
      }
      const preflightCollateralAmount =
        preflightQuote.collateral === null
          ? 0n
          : parseStableFxAmount(preflightQuote.collateral, sourceToken);
      const preflightDestinationAmount = parseStableFxAmount(
        preflightQuote.to.amount,
        destinationToken,
      );
      const preflightIntent = validateStableFxTradeIntentTypedData({
        typedData: preflightQuote.typedData,
        expectedSourceToken: sourceToken,
        expectedSourceAmount: sourceAmount,
        expectedDestinationToken: destinationToken,
        expectedDestinationAmount: preflightDestinationAmount,
        expectedQuoteId: preflightQuote.id,
        expectedCollateralAmount: preflightCollateralAmount,
        expectedRecipient: config.address,
      });

      const [takerBalance, allowance] = await Promise.all([
        getStableFxTokenBalance({
          token: sourceToken,
          owner: config.address,
        }),
        getStableFxPermit2Allowance({
          token: sourceToken,
          owner: config.address,
          permit2: preflightIntent.permit2,
        }),
      ]);
      // The collateral is a portion of the source amount and is withdrawn
      // first when Circle records the trade. Tower must have enough for the
      // trade principal in total, not principal plus collateral.
      remainingStableFxFundingAmount(sourceAmount, preflightIntent.collateralAmount);
      if (takerBalance < sourceAmount) {
        return (
          (await markForReview(
            order,
            "Tower taker wallet does not have enough of the source token to cover this StableFX trade.",
            "refund_required",
          )) ?? order
        );
      }
      if (allowance < sourceAmount) {
        return (
          (await markForReview(
            order,
            "Tower taker wallet has not granted sufficient ERC-20 allowance for this StableFX trade. Increase the Permit2 allowance before creating this trade.",
            "refund_required",
          )) ?? order
        );
      }

      const quote = await createStableFxTradableQuote({
        fromCurrency: order.from_currency,
        toCurrency: order.to_currency,
        amount: sourceAmountForQuote,
        amountSide: "from",
        recipientAddress: config.address,
      });
      if (!quote.id || !quote.from.amount || !quote.to.amount) {
        throw new StableFxError("Circle returned an incomplete executable quote.", 502);
      }
      if (parseStableFxAmount(quote.from.amount, sourceToken) !== sourceAmount) {
        throw new StableFxError(
          "The executable StableFX quote changed the deposited source amount.",
          502,
        );
      }
      expectedCollateralAmount =
        quote.collateral === null
          ? 0n
          : parseStableFxAmount(quote.collateral, sourceToken);
      expectedDestinationAmount = parseStableFxAmount(quote.to.amount, destinationToken);
      const finalIntent = validateStableFxTradeIntentTypedData({
        typedData: quote.typedData,
        expectedSourceToken: sourceToken,
        expectedSourceAmount: sourceAmount,
        expectedDestinationToken: destinationToken,
        expectedDestinationAmount,
        expectedQuoteId: quote.id,
        expectedCollateralAmount,
        expectedRecipient: config.address,
      });
      if (finalIntent.permit2.toLowerCase() !== preflightIntent.permit2.toLowerCase()) {
        throw new StableFxError(
          "Circle returned a different Permit2 contract for the executable StableFX quote.",
          502,
        );
      }
      remainingStableFxFundingAmount(sourceAmount, finalIntent.collateralAmount);
      if (takerBalance < sourceAmount) {
        return (
          (await markForReview(
            order,
            "Tower taker wallet does not have enough of the source token to cover this StableFX trade.",
            "refund_required",
          )) ?? order
        );
      }
      if (allowance < sourceAmount) {
        return (
          (await markForReview(
            order,
            "Tower taker wallet has not granted sufficient ERC-20 allowance for this StableFX trade. Increase the Permit2 allowance before creating this trade.",
            "refund_required",
          )) ?? order
        );
      }

      const signature = await signStableFxTypedData(config, quote.typedData);
      // Circle's executable quotes are only valid for a few seconds. Start the
      // durable quote/signature write, but do not make the customer wait for a
      // Supabase round-trip before sending Circle the idempotent trade request.
      // The initial order already persists the idempotency key, and the final
      // update below records both the quote and trade atomically after Circle
      // acknowledges it.
      const quotePersistence = updateOrder(order.id, {
        quote_id: quote.id,
        quote_expires_at: quote.expiresAt,
        trade_typed_data: quote.typedData,
        trade_signature: signature,
      }, ["executing"]);
      let trade: StableFxTrade;
      try {
        console.info("Submitting StableFX trade immediately", {
          orderId: order.id,
          quoteId: quote.id,
          quoteExpiresAt: quote.expiresAt,
          remainingMs: quote.expiresAt ? Date.parse(quote.expiresAt) - Date.now() : null,
        });
        trade = await createStableFxTrade({
          quoteId: quote.id,
          address: config.address,
          message: quote.typedData.message,
          signature,
          idempotencyKey: order.idempotency_key,
          fromCurrency: order.from_currency,
          toCurrency: order.to_currency,
        });
      } catch (error) {
        // Do not leave a rejected persistence promise unobserved. It is safe
        // to retain the quote details for support/recovery when Circle rejects
        // the idempotent create request.
        await quotePersistence.catch(() => null);
        throw error;
      }

      await quotePersistence.catch((error) => {
        console.error("Unable to persist StableFX quote before trade recovery", {
          orderId: order.id,
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
      const saved = await updateOrder(order.id, {
        quote_id: quote.id,
        quote_expires_at: quote.expiresAt,
        trade_typed_data: quote.typedData,
        trade_signature: signature,
        trade_id: trade.id,
        contract_trade_id: trade.contractTradeId,
        circle_status: trade.status,
      }, ["executing"]);
      if (!saved) return getOrder(order.id);
      order = saved;
      tradeTypedData = quote.typedData;
      finalQuoteWasPreflighted = true;
    }

    if (!tradeTypedData) orderError("StableFX trade signing data is missing.");
    const { permit2, collateralAmount } = validateStableFxTradeIntentTypedData({
      typedData: tradeTypedData,
      expectedSourceToken: sourceToken,
      expectedSourceAmount: sourceAmount,
      expectedDestinationToken: destinationToken,
      expectedDestinationAmount,
      expectedQuoteId: order.quote_id ?? "",
      expectedCollateralAmount,
      expectedRecipient: config.address,
    });
    const remainingFundingAmount = remainingStableFxFundingAmount(
      sourceAmount,
      collateralAmount,
    );
    if (!finalQuoteWasPreflighted) {
      // This branch only resumes a quote persisted by an earlier process. New
      // orders do this work before their final short-lived quote is requested.
      const [takerBalance, allowance] = await Promise.all([
        getStableFxTokenBalance({
          token: sourceToken,
          owner: config.address,
        }),
        getStableFxPermit2Allowance({
          token: sourceToken,
          owner: config.address,
          permit2,
        }),
      ]);
      // Once Circle has supplied an on-chain contract ID, it has recorded the
      // trade and already withdrawn the collateral. A resumed order therefore
      // needs only the unfunded remainder. Before that point, it still needs
      // the whole source amount so Circle can collect its collateral.
      const requiredBalance = order.contract_trade_id
        ? remainingFundingAmount
        : sourceAmount;
      if (takerBalance < requiredBalance) {
        return (
          (await markForReview(
            order,
            order.contract_trade_id
              ? "Tower taker wallet does not have enough of the source token remaining to fund this StableFX trade after collateral."
              : "Tower taker wallet does not have enough of the source token to cover this StableFX trade.",
            "refund_required",
          )) ?? order
        );
      }
      if (allowance < requiredBalance) {
        return (
          (await markForReview(
            order,
            order.contract_trade_id
              ? "Tower taker wallet has not granted sufficient ERC-20 allowance for the remaining StableFX funding amount. Increase the Permit2 allowance before funding this trade."
              : "Tower taker wallet has not granted sufficient ERC-20 allowance for this StableFX trade. Increase the Permit2 allowance before creating this trade.",
            "refund_required",
          )) ?? order
        );
      }
    }

    if (isQuoteExpiredOrExpiring(order) && !order.trade_id) {
      const expiry = order.quote_expires_at ? Date.parse(order.quote_expires_at) : Number.NaN;
      const remainingMs = Number.isFinite(expiry) ? expiry - Date.now() : null;
      console.warn("StableFX executable quote has insufficient time remaining", {
        orderId: order.id,
        quoteId: order.quote_id,
        quoteExpiresAt: order.quote_expires_at,
        remainingMs,
        executableQuoteRenewals,
      });

      if (executableQuoteRenewals < MAX_EXECUTABLE_QUOTE_RENEWALS) {
        // No Circle trade exists yet, so the old quote can safely be discarded.
        // Generate exactly one fresh executable quote rather than placing a
        // verified customer deposit into refund review because of a quote-TTL
        // race.
        const cleared = await updateOrder(
          order.id,
          {
            quote_id: null,
            quote_expires_at: null,
            trade_typed_data: null,
            trade_signature: null,
          },
          ["executing"],
        );
        if (!cleared) return getOrder(order.id);
        return executeOrder(order.id, executableQuoteRenewals + 1);
      }

      return (
        (await markForReview(
          order,
          "Circle returned executable quotes that expired before a trade was created. Refund the verified deposit.",
          "refund_required",
        )) ?? order
      );
    }

    if (!order.trade_signature) {
      const signature = await signStableFxTypedData(config, tradeTypedData);
      const saved = await updateOrder(order.id, { trade_signature: signature }, ["executing"]);
      if (!saved) return getOrder(order.id);
      order = saved;
    }

    if (!order.trade_id) {
      if (!order.quote_id || !order.trade_signature) {
        orderError("StableFX trade data is incomplete.");
      }
      const trade = await createStableFxTrade({
        quoteId: order.quote_id,
        address: config.address,
        message: tradeTypedData.message,
        signature: order.trade_signature,
        idempotencyKey: order.idempotency_key,
        fromCurrency: order.from_currency,
        toCurrency: order.to_currency,
      });
      const saved = await updateOrder(order.id, {
        trade_id: trade.id,
        contract_trade_id: trade.contractTradeId,
        circle_status: trade.status,
      }, ["executing"]);
      if (!saved) return getOrder(order.id);
      order = saved;
    }

    // Circle returns the off-chain trade immediately, then records it on Arc
    // asynchronously. There is no funding Permit2 to request until that
    // record supplies `contractTradeId`; retain the trade ID and wait for the
    // next webhook/reconciliation read instead of classifying the deposit as
    // failed or refundable.
    if (!order.contract_trade_id) {
      console.info("StableFX trade is awaiting its on-chain contract ID", {
        orderId: order.id,
        tradeId: order.trade_id,
        circleStatus: order.circle_status,
      });
      return reconcileStableFxOrder(order);
    }
    let fundingTypedData = order.funding_typed_data
      ? typedDataFromDb(order.funding_typed_data, "funding typed data")
      : null;
    if (!fundingTypedData) {
      const funding = await createStableFxFundingPresign({
        contractTradeId: order.contract_trade_id,
      });
      validateStableFxPermitTypedData({
        typedData: funding.typedData,
        expectedToken: sourceToken,
        expectedAmount: remainingFundingAmount,
      });
      const saved = await updateOrder(order.id, {
        funding_typed_data: funding.typedData,
      }, ["executing"]);
      if (!saved) return getOrder(order.id);
      order = saved;
      fundingTypedData = funding.typedData;
    }

    validateStableFxPermitTypedData({
      typedData: fundingTypedData,
      expectedToken: sourceToken,
      expectedAmount: remainingFundingAmount,
    });
    if (!order.funding_signature) {
      const signature = await signStableFxTypedData(config, fundingTypedData);
      const saved = await updateOrder(order.id, { funding_signature: signature }, ["executing"]);
      if (!saved) return getOrder(order.id);
      order = saved;
    }
    const fundingSignature = order.funding_signature;
    if (!fundingSignature) orderError("StableFX funding signature is missing.");

    // Persist the unknown state before a non-idempotent funding submission. If
    // the process dies after Circle receives it, reconciliation will query the
    // trade rather than risk submitting the same Permit2 authorisation twice.
    const submitting = await updateOrder(order.id, { status: "funding_submitting" }, [
      "executing",
    ]);
    if (!submitting) return getOrder(order.id);
    order = submitting;
    await fundStableFxTrade({
      signature: fundingSignature,
      permit2: fundingTypedData.message,
    });
    const funded = await updateOrder(order.id, {
      status: "funding_submitted",
      failure_reason: null,
    }, ["funding_submitting"]);
    return reconcileStableFxOrder(funded ?? order);
  } catch (error) {
    const reason = failureMessage(error);
    const current = await getOrder(orderId).catch(() => order);
    if (current.status === "funding_submitting") {
      return (
        (await markForReview(
          current,
          `Funding submission outcome is unknown: ${reason}`,
        )) ?? current
      );
    }
    if (!current.trade_id) {
      if (error instanceof StableFxError && error.outcomeUnknown) {
        // A 2xx response with an unexpected schema (or a transport/5xx
        // failure) can still mean Circle created the trade. Resolve that
        // immutable quote ID before treating the order as manual review.
        const recovered = await recoverCreatedTrade(current);
        if (recovered?.trade_id) return executeOrder(recovered.id);
        return (
          (await markForReview(current, reason, "needs_review")) ?? current
        );
      }
      return (
        (await markForReview(current, reason, "refund_required")) ?? current
      );
    }
    return (await markForReview(current, reason)) ?? current;
  }
}

async function recoverCreatedTrade(
  order: StableFxOrderRow,
): Promise<StableFxOrderRow | null> {
  if (!order.quote_id) return null;

  try {
    const trade = await findRecentStableFxTradeByQuoteId({
      quoteId: order.quote_id,
      fromCurrency: order.from_currency,
      toCurrency: order.to_currency,
    });
    if (!trade) return null;

    console.warn("Recovered accepted StableFX trade after response failure", {
      orderId: order.id,
      quoteId: order.quote_id,
      tradeId: trade.id,
      contractTradeId: trade.contractTradeId,
      status: trade.status,
    });
    return updateOrder(
      order.id,
      {
        status: "executing",
        trade_id: trade.id,
        contract_trade_id: trade.contractTradeId,
        circle_status: trade.status,
        failure_reason: null,
      },
      ["executing"],
    );
  } catch (error) {
    console.error("Unable to recover accepted StableFX trade", {
      orderId: order.id,
      quoteId: order.quote_id,
      message: failureMessage(error),
    });
    return null;
  }
}

async function broadcastPayout(order: StableFxOrderRow): Promise<StableFxOrderRow> {
  const config = getStableFxTakerConfig();
  const outputToken = config.tokens[order.to_currency];
  if (!order.output_amount_raw || BigInt(order.output_amount_raw) <= 0n) {
    return markForReview(order, "StableFX output amount is missing.");
  }
  const claimed = await updateOrder(order.id, { status: "payout_submitting" }, [
    "settlement_completed",
  ]);
  if (!claimed) return getOrder(order.id);

  try {
    const transactionHash = await broadcastStableFxPayout({
      config,
      token: outputToken,
      recipient: normalizeAddress(order.recipient_address, "payout recipient"),
      amount: BigInt(order.output_amount_raw),
    });
    return (
      (await updateOrder(order.id, {
        status: "payout_broadcast",
        payout_tx_hash: transactionHash,
        payout_amount_raw: order.output_amount_raw,
        failure_reason: null,
      }, ["payout_submitting"])) ?? claimed
    );
  } catch (error) {
    // A provider timeout may occur after broadcast. Do not try another payout:
    // an operator must reconcile the taker account and destination address.
    return (
      (await markForReview(
        claimed,
        `Payout broadcast outcome is unknown: ${failureMessage(error)}`,
      )) ?? claimed
    );
  }
}

/**
 * A payout may have been signed outside this process (for example, an
 * operator recovery) after Circle settled the trade. Verify the exact Arc
 * transfer before adopting it, so reconciliation never creates a duplicate
 * customer payout merely because the original hash was not stored.
 */
async function adoptExistingStableFxPayout(order: StableFxOrderRow) {
  if (
    order.status !== "settlement_completed" ||
    !order.settlement_tx_hash ||
    !isHash(order.settlement_tx_hash) ||
    !order.output_amount_raw ||
    BigInt(order.output_amount_raw) <= 0n
  ) {
    return null;
  }

  const config = getStableFxTakerConfig();
  const transactionHash = await findExistingStableFxPayout({
    settlementTransactionHash: order.settlement_tx_hash as Hex,
    token: config.tokens[order.to_currency],
    sender: config.address,
    recipient: normalizeAddress(order.recipient_address, "payout recipient"),
    expectedAmount: BigInt(order.output_amount_raw),
  });
  if (!transactionHash) return null;

  return (
    (await updateOrder(order.id, {
      status: "payout_broadcast",
      payout_tx_hash: transactionHash,
      payout_amount_raw: order.output_amount_raw,
      failure_reason: null,
    }, ["settlement_completed"])) ?? getOrder(order.id)
  );
}

export async function reconcileStableFxOrder(order: StableFxOrderRow): Promise<StableFxOrderRow> {
  if (order.status === "completed") {
    await recordCompletedStableFxActivity(order);
    return order;
  }

  if (order.status === "needs_review" || order.status === "refund_required") {
    return order;
  }

  if (order.status === "payout_broadcast" && order.payout_tx_hash && isHash(order.payout_tx_hash)) {
    const receipt = await getStableFxPayoutReceipt(order.payout_tx_hash as Hex);
    if (!receipt) return order;
    if (receipt.status === "success") {
      const completed =
        (await updateOrder(order.id, { status: "completed", failure_reason: null }, [
          "payout_broadcast",
        ])) ?? order;
      await recordCompletedStableFxActivity(completed);
      return completed;
    }
    return (
      (await markForReview(order, "The payout transaction reverted on Arc.")) ?? order
    );
  }

  if (order.status === "payout_submitting") {
    return (
      (await markForReview(
        order,
        "Payout submission was interrupted before its transaction hash was recorded. Reconcile the taker wallet before any retry.",
      )) ?? order
    );
  }

  if (order.status === "settlement_completed") {
    const adoptedPayout = await adoptExistingStableFxPayout(order);
    if (adoptedPayout) return reconcileStableFxOrder(adoptedPayout);
    return broadcastPayout(order);
  }

  if (!order.trade_id) return order;

  try {
    const trade = await getStableFxTrade({
      tradeId: order.trade_id,
      fromCurrency: order.from_currency,
      toCurrency: order.to_currency,
    });
    const normalizedStatus = trade.status.toLowerCase();
    const receivedContractTradeId = trade.contractTradeId;
    let current =
      (await updateOrder(order.id, {
        circle_status: trade.status,
        ...(receivedContractTradeId
          ? { contract_trade_id: receivedContractTradeId }
          : {}),
      })) ?? order;

    // An initial create response may only contain the off-chain trade ID.
    // Once Circle subsequently records that trade on Arc, request and submit
    // the funding Permit2 through the normal idempotency-safe execution path.
    if (
      !order.contract_trade_id &&
      current.contract_trade_id &&
      current.status === "executing"
    ) {
      return executeOrder(current.id);
    }

    if (normalizedStatus === "completed") {
      if (!trade.settlementTransactionHash || !isHash(trade.settlementTransactionHash)) {
        return (
          (await markForReview(
            current,
            "Circle marked the trade completed without a verifiable settlement transaction hash.",
          )) ?? current
        );
      }
      const config = getStableFxTakerConfig();
      if (!trade.to.amount) {
        return (
          (await markForReview(
            current,
            "Circle marked the trade completed without a destination amount.",
          )) ?? current
        );
      }
      const received = await findStableFxSettlementReceipt({
        transactionHash: trade.settlementTransactionHash as Hex,
        token: config.tokens[current.to_currency],
        recipient: config.address,
        expectedAmount: parseStableFxAmount(
          trade.to.amount,
          config.tokens[current.to_currency],
        ),
      });
      current =
        (await updateOrder(current.id, {
          status: "settlement_completed",
          settlement_tx_hash: trade.settlementTransactionHash,
          output_amount_raw: received.toString(),
          failure_reason: null,
        }, ["executing", "funding_submitting", "funding_submitted", "funding_submission_unknown"])) ?? current;
      const adoptedPayout = await adoptExistingStableFxPayout(current);
      if (adoptedPayout) return reconcileStableFxOrder(adoptedPayout);
      return broadcastPayout(current);
    }

    if (normalizedStatus === "taker_funded") {
      if (current.status === "funding_submitting" || current.status === "funding_submission_unknown") {
        current =
          (await updateOrder(current.id, {
            status: "funding_submitted",
            failure_reason: null,
          }, ["funding_submitting", "funding_submission_unknown"])) ?? current;
      }
      return current;
    }

    if (normalizedStatus === "pending_settlement") {
      if (current.status === "funding_submitting" || current.status === "funding_submission_unknown") {
        return (
          (await markForReview(
            current,
            "Circle still reports pending settlement after an interrupted funding submission. Reconcile before retrying the Permit2 funding call.",
          )) ?? current
        );
      }
      return current;
    }

    if (/(failed|cancelled|expired|rejected|refunded|breached)/i.test(normalizedStatus)) {
      return (
        (await markForReview(
          current,
          `Circle reported StableFX trade status '${trade.status}'. Reconcile the verified customer deposit before refunding.`,
        )) ?? current
      );
    }
    return current;
  } catch (error) {
    return (
      (await markForReview(order, `StableFX reconciliation failed: ${failureMessage(error)}`)) ?? order
    );
  }
}

/**
 * Circle webhooks are a prompt to reconcile, not a source of settlement truth.
 * The trade and Arc receipt are always fetched and verified again before Tower
 * can pay a customer.
 */
export async function reconcileStableFxWebhookTrade(params: {
  notificationType: string;
  tradeId: string | null;
  contractTradeId: string | null;
}) {
  let order: StableFxOrderRow | null = null;

  if (params.tradeId) {
    const { data, error } = await supabaseAdmin
      .from("stablefx_orders")
      .select("*")
      .eq("trade_id", params.tradeId)
      .maybeSingle();
    if (error) orderError("Unable to find the StableFX order for this webhook.");
    order = data ? asOrder(data) : null;
  }

  if (!order && params.contractTradeId) {
    const { data, error } = await supabaseAdmin
      .from("stablefx_orders")
      .select("*")
      .eq("contract_trade_id", params.contractTradeId)
      .maybeSingle();
    if (error) orderError("Unable to find the StableFX order for this webhook.");
    order = data ? asOrder(data) : null;
  }

  if (!order) {
    // A Circle account can have trades not initiated by Tower's customer flow.
    // A signed notification for one of those trades is valid but irrelevant.
    return { matched: false, orderId: null, status: null };
  }

  let reconciled = await reconcileStableFxOrder(order);
  if (
    params.notificationType.startsWith("stablefx.contract.") &&
    params.notificationType.endsWith(".failed") &&
    reconciled.status !== "completed" &&
    reconciled.status !== "needs_review" &&
    reconciled.status !== "refund_required"
  ) {
    reconciled = await markForReview(
      reconciled,
      `Circle webhook reported '${params.notificationType}'. Reconcile the trade and verified customer deposit before any retry or refund.`,
    );
  }

  return { matched: true, orderId: reconciled.id, status: reconciled.status };
}

export async function submitStableFxDeposit(params: {
  orderId: string;
  customerAddress: string;
  transactionHash: unknown;
}) {
  const transactionHash =
    typeof params.transactionHash === "string" && isHash(params.transactionHash)
      ? (params.transactionHash as Hex)
      : null;
  if (!transactionHash) orderError("A valid Arc deposit transaction hash is required.", 400);

  const order: StableFxOrderRow = await getOrder(params.orderId);
  assertOrderOwner(order, params.customerAddress);
  if (order.deposit_tx_hash) {
    if (order.deposit_tx_hash.toLowerCase() !== transactionHash.toLowerCase()) {
      orderError("A different deposit transaction is already attached to this order.", 409);
    }
    return publicOrder(await reconcileStableFxOrder(order));
  }
  if (order.status !== "awaiting_deposit") {
    orderError("This StableFX order is no longer awaiting a deposit.", 409);
  }

  const config = getStableFxTakerConfig();
  const verification = await verifyExactStableFxDeposit({
    transactionHash,
    from: normalizeAddress(order.customer_address, "customer wallet"),
    to: config.address,
    token: config.tokens[order.from_currency],
    // Customer transfer is gross; Tower retains its fee and submits the stored
    // net source_amount_raw to Circle later in executeOrder.
    amount: customerDepositAmountRaw(order),
  });
  const updated = await updateOrder(order.id, {
    status: "deposit_verified",
    deposit_tx_hash: transactionHash,
    deposit_block_number: verification.blockNumber,
    failure_reason: null,
  }, ["awaiting_deposit"]);
  if (!updated) {
    const latest = await getOrder(order.id);
    if (latest.deposit_tx_hash?.toLowerCase() === transactionHash.toLowerCase()) {
      return publicOrder(await reconcileStableFxOrder(latest));
    }
    orderError("This StableFX order changed while the deposit was being verified.", 409);
  }

  return publicOrder(await executeOrder(updated.id));
}

/**
 * Customer-authorised recovery for an order where Circle accepted the trade
 * but Tower lost the create response before it could persist the trade IDs.
 * Only a non-terminal trade with the order's exact quote ID may be resumed.
 */
export async function resumeStableFxOrder(params: {
  orderId: string;
  customerAddress: string;
}) {
  const order = await getOrder(params.orderId);
  assertOrderOwner(order, params.customerAddress);

  if (order.status === "completed") return publicOrder(order);
  if (!order.quote_id) {
    orderError("This StableFX order has no executable quote to recover.", 409);
  }

  const trade = order.trade_id
    ? await getStableFxTrade({
        tradeId: order.trade_id,
        fromCurrency: order.from_currency,
        toCurrency: order.to_currency,
      })
    : await findRecentStableFxTradeByQuoteId({
        quoteId: order.quote_id,
        fromCurrency: order.from_currency,
        toCurrency: order.to_currency,
      });
  if (!trade) {
    orderError(
      "Circle has not made a recoverable StableFX trade available for this order.",
      409,
    );
  }

  const status = trade.status.toLowerCase();
  if (/(failed|cancelled|expired|rejected|refunded|breached)/i.test(status)) {
    const reason =
      `This StableFX trade is '${trade.status}' and cannot be funded. ` +
      "Refund the verified customer deposit instead.";
    // Preserve Circle's identifiers and terminal status for support, activity
    // reconciliation, and a safe manual refund. This does not transfer funds.
    await updateOrder(
      order.id,
      {
        status: "refund_required",
        trade_id: trade.id,
        contract_trade_id: trade.contractTradeId,
        circle_status: trade.status,
        failure_reason: reason,
      },
      ["deposit_verified", "executing", "needs_review", "refund_required"],
    );
    orderError(reason, 409);
  }

  const recovered = await updateOrder(
    order.id,
    {
      status: "executing",
      trade_id: trade.id,
      contract_trade_id: trade.contractTradeId,
      circle_status: trade.status,
      failure_reason: null,
    },
    ["deposit_verified", "executing", "needs_review", "refund_required"],
  );
  if (!recovered) {
    return publicOrder(await getOrder(order.id));
  }

  // The trade was accepted but Circle has not yet recorded it on Arc. Keep
  // the recovered IDs and let a subsequent webhook/order read resume funding.
  if (!recovered.contract_trade_id) return publicOrder(recovered);
  return publicOrder(await executeOrder(recovered.id));
}

export async function getStableFxOrderForCustomer(params: {
  orderId: string;
  customerAddress: string;
}) {
  const order = await getOrder(params.orderId);
  assertOrderOwner(order, params.customerAddress);
  return publicOrder(await reconcileStableFxOrder(order));
}

/**
 * Returns the customer's newest in-flight order without reconciling it with
 * Circle. This is deliberately read-only so the UI can restore an activity
 * card after a browser reload without submitting funding, payout, refund, or
 * any other state-changing StableFX action.
 */
export async function getLatestActiveStableFxOrderForCustomer(customerAddress: string) {
  const customer = normalizeAddress(customerAddress, "customer wallet").toLowerCase();
  const { data, error } = await supabaseAdmin
    .from("stablefx_orders")
    .select("*")
    .eq("customer_address", customer)
    .in("status", [
      "deposit_verified",
      "executing",
      "funding_submitting",
      "funding_submitted",
      "funding_submission_unknown",
      "settlement_completed",
      "payout_submitting",
      "payout_broadcast",
    ])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) orderError("Unable to load the active StableFX order.");
  return data ? publicOrder(asOrder(data)) : null;
}

export async function reconcilePendingStableFxOrders(limit = 25) {
  const { data, error } = await supabaseAdmin
    .from("stablefx_orders")
    .select("*")
    .in("status", [
      "deposit_verified",
      "executing",
      "funding_submitting",
      "funding_submitted",
      "funding_submission_unknown",
      "settlement_completed",
      "payout_submitting",
      "payout_broadcast",
    ])
    .order("updated_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 100)));
  if (error) orderError("Unable to load pending StableFX orders.");

  const results = await Promise.all(
    (data ?? []).map(async (row) => {
      const order = asOrder(row);
      try {
        const updated =
          order.status === "deposit_verified" || order.status === "executing"
            ? await executeOrder(order.id)
            : await reconcileStableFxOrder(order);
        return { id: order.id, status: updated.status };
      } catch (error) {
        console.error("StableFX cron order failed", { orderId: order.id, error });
        return { id: order.id, status: "error" };
      }
    }),
  );
  return results;
}
