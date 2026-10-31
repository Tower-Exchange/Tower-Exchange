import { NextRequest, NextResponse } from "next/server";

import { StableFxError } from "@/lib/server/circleStableFx";
import { getTrustedClientIp } from "@/lib/server/clientIp";
import { withFrontendOriginGate } from "@/lib/server/frontendRequestGuard";
import { createIpRateLimiter } from "@/lib/server/ipRateLimit";
import { submitStableFxDeposit } from "@/lib/server/stableFxOrders";
import { requireWalletSession } from "@/lib/server/walletSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const depositRateLimit = createIpRateLimiter({ windowMs: 60_000, maxRequests: 8 });
type RouteContext = { params: Promise<{ orderId: string }> };

async function handleDepositPost(request: NextRequest, context: RouteContext) {
  const rate = depositRateLimit.consume(getTrustedClientIp(request.headers));
  if (rate.limited) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please wait for the Arc confirmation." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }
  const { wallet, response: sessionError } = requireWalletSession(request);
  if (sessionError || !wallet) {
    return sessionError ?? NextResponse.json({ error: "Wallet session required." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const { orderId } = await context.params;
    const order = await submitStableFxDeposit({
      orderId,
      customerAddress: wallet,
      transactionHash: body?.transactionHash,
    });
    return NextResponse.json({ success: true, order }, { status: 202 });
  } catch (error) {
    const status = error instanceof StableFxError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to process StableFX deposit." },
      { status },
    );
  }
}

export const POST = withFrontendOriginGate(handleDepositPost);
