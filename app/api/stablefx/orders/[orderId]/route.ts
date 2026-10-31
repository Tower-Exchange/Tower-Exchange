import { NextRequest, NextResponse } from "next/server";

import { StableFxError } from "@/lib/server/circleStableFx";
import { withFrontendOriginGate } from "@/lib/server/frontendRequestGuard";
import { getStableFxOrderForCustomer } from "@/lib/server/stableFxOrders";
import { requireWalletSession } from "@/lib/server/walletSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ orderId: string }> };

async function handleOrderGet(request: NextRequest, context: RouteContext) {
  const { wallet, response: sessionError } = requireWalletSession(request);
  if (sessionError || !wallet) {
    return sessionError ?? NextResponse.json({ error: "Wallet session required." }, { status: 401 });
  }
  try {
    const { orderId } = await context.params;
    const order = await getStableFxOrderForCustomer({
      orderId,
      customerAddress: wallet,
    });
    return NextResponse.json({ success: true, order });
  } catch (error) {
    const status = error instanceof StableFxError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to retrieve StableFX order." },
      { status },
    );
  }
}

export const GET = withFrontendOriginGate(handleOrderGet);
