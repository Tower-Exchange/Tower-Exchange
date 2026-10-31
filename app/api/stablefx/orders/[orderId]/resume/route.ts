import { NextRequest, NextResponse } from "next/server";

import { StableFxError } from "@/lib/server/circleStableFx";
import { getTrustedClientIp } from "@/lib/server/clientIp";
import { withFrontendOriginGate } from "@/lib/server/frontendRequestGuard";
import { createIpRateLimiter } from "@/lib/server/ipRateLimit";
import { resumeStableFxOrder } from "@/lib/server/stableFxOrders";
import { requireWalletSession } from "@/lib/server/walletSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resumeRateLimit = createIpRateLimiter({ windowMs: 60_000, maxRequests: 3 });
type RouteContext = { params: Promise<{ orderId: string }> };

async function handleResumePost(request: NextRequest, context: RouteContext) {
  const rate = resumeRateLimit.consume(getTrustedClientIp(request.headers));
  if (rate.limited) {
    return NextResponse.json(
      { error: "Too many recovery attempts. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const { wallet, response: sessionError } = requireWalletSession(request);
  if (sessionError || !wallet) {
    return sessionError ?? NextResponse.json({ error: "Wallet session required." }, { status: 401 });
  }

  try {
    const { orderId } = await context.params;
    const order = await resumeStableFxOrder({ orderId, customerAddress: wallet });
    return NextResponse.json({ success: true, order }, { status: 202 });
  } catch (error) {
    const status = error instanceof StableFxError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to resume StableFX order." },
      { status },
    );
  }
}

export const POST = withFrontendOriginGate(handleResumePost);
