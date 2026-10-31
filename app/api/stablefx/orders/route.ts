import { NextRequest, NextResponse } from "next/server";

import {
  createStableFxDepositOrder,
  getLatestActiveStableFxOrderForCustomer,
} from "@/lib/server/stableFxOrders";
import { StableFxError } from "@/lib/server/circleStableFx";
import { getTrustedClientIp } from "@/lib/server/clientIp";
import { withFrontendOriginGate } from "@/lib/server/frontendRequestGuard";
import { createIpRateLimiter } from "@/lib/server/ipRateLimit";
import { requireWalletSession } from "@/lib/server/walletSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const orderRateLimit = createIpRateLimiter({
  windowMs: 60_000,
  maxRequests: 5,
});
const activeOrderRateLimit = createIpRateLimiter({
  windowMs: 60_000,
  maxRequests: 30,
});

async function handleActiveOrderGet(request: NextRequest) {
  const rate = activeOrderRateLimit.consume(getTrustedClientIp(request.headers));
  if (rate.limited) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please slow down." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const { wallet, response: sessionError } = requireWalletSession(request);
  if (sessionError || !wallet) {
    return sessionError ?? NextResponse.json({ error: "Wallet session required." }, { status: 401 });
  }

  try {
    const order = await getLatestActiveStableFxOrderForCustomer(wallet);
    return NextResponse.json({ success: true, order });
  } catch (error) {
    const status = error instanceof StableFxError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to retrieve active StableFX order." },
      { status },
    );
  }
}

async function handleCreateOrder(request: NextRequest) {
  const rate = orderRateLimit.consume(getTrustedClientIp(request.headers));
  if (rate.limited) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please slow down." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const { wallet, response: sessionError } = requireWalletSession(request);
  if (sessionError || !wallet) {
    return sessionError ?? NextResponse.json({ error: "Wallet session required." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const result = await createStableFxDepositOrder({
      customerAddress: wallet,
      fromCurrency: body?.fromCurrency,
      toCurrency: body?.toCurrency,
      amount: body?.amount,
      amountSide: body?.amountSide,
      expectedTowerFeeBps: body?.expectedTowerFeeBps,
    });
    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (error) {
    const status = error instanceof StableFxError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create StableFX order." },
      { status },
    );
  }
}

export const POST = withFrontendOriginGate(handleCreateOrder);
export const GET = withFrontendOriginGate(handleActiveOrderGet);
