import { NextRequest, NextResponse } from "next/server";

import {
  createStableFxReferenceQuote,
  isStableFxEnabled,
  StableFxError,
} from "@/lib/server/circleStableFx";
import { getTrustedClientIp } from "@/lib/server/clientIp";
import { withFrontendOriginGate } from "@/lib/server/frontendRequestGuard";
import { createIpRateLimiter } from "@/lib/server/ipRateLimit";
import { requireWalletSession } from "@/lib/server/walletSession";
import {
  normalizeStableFxCurrency,
  STABLEFX_ARC_MAINNET_TOKENS,
  STABLEFX_CURRENCIES,
  isStableFxAmount,
  type StableFxAmountSide,
} from "@/lib/stableFx";
import { parseUnits } from "viem";
import { calculateTowerStableFxFee } from "@/lib/server/stableFxFees";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const quoteRateLimit = createIpRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
});

async function handleStableFxQuotePost(request: NextRequest) {
  const rate = quoteRateLimit.consume(getTrustedClientIp(request.headers));
  if (rate.limited) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  const { wallet, response: sessionError } = requireWalletSession(request);
  if (sessionError || !wallet) {
    return sessionError ??
      NextResponse.json(
        { error: "Wallet session required. Please sign in." },
        { status: 401 },
      );
  }

  if (!isStableFxEnabled()) {
    return NextResponse.json(
      { error: "StableFX is not enabled for this environment." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const fromCurrency = normalizeStableFxCurrency(body?.fromCurrency);
  const toCurrency = normalizeStableFxCurrency(body?.toCurrency);
  const amount = typeof body?.amount === "string" ? body.amount.trim() : "";
  const amountSide: StableFxAmountSide =
    body?.amountSide === "to" ? "to" : "from";

  if (!fromCurrency || !toCurrency || !amount) {
    return NextResponse.json(
      {
        error:
          `fromCurrency, toCurrency, and a positive amount are required. Supported currencies: ${STABLEFX_CURRENCIES.join(", ")}.`,
      },
      { status: 400 },
    );
  }
  if (!isStableFxAmount(amount)) {
    return NextResponse.json(
      { error: "amount must be a positive decimal with no more than 6 decimal places." },
      { status: 400 },
    );
  }
  if (amountSide !== "from") {
    return NextResponse.json(
      {
        error:
          "StableFX quotes currently require a source amount so Tower can calculate the source-token fee.",
      },
      { status: 400 },
    );
  }

  try {
    // The customer-entered amount is gross. Tower's configured source-token
    // fee is retained by the taker, and Circle quotes only the net principal.
    const sourceToken = STABLEFX_ARC_MAINNET_TOKENS[fromCurrency];
    const grossAmountRaw = parseUnits(amount, sourceToken.decimals);
    const towerFee = calculateTowerStableFxFee({
      grossAmountRaw,
      tokenDecimals: sourceToken.decimals,
    });
    const quote = await createStableFxReferenceQuote({
      fromCurrency,
      toCurrency,
      amount: towerFee.tradeAmount,
      amountSide,
    });

    return NextResponse.json({
      success: true,
      quote: {
        ...quote,
        towerFee: {
          currency: fromCurrency,
          amount: towerFee.feeAmount,
          basisPoints: towerFee.basisPoints,
          tradeAmount: towerFee.tradeAmount,
        },
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to obtain a StableFX quote right now.";
    const status = error instanceof StableFxError ? error.status : 502;

    return NextResponse.json({ error: message }, { status });
  }
}

export const POST = withFrontendOriginGate(handleStableFxQuotePost);
