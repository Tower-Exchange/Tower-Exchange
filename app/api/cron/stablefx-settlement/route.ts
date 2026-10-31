import { NextRequest, NextResponse } from "next/server";

import { StableFxError } from "@/lib/server/circleStableFx";
import { reconcilePendingStableFxOrders } from "@/lib/server/stableFxOrders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorizedCronRequest(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  // A production deployment must configure CRON_SECRET. Keeping local dev
  // usable matches the existing recurring-order cron route.
  return !secret || request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handleCron(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const limitParam = Number(request.nextUrl.searchParams.get("limit") ?? "25");
    const results = await reconcilePendingStableFxOrders(limitParam);
    return NextResponse.json({ success: true, processed: results.length, results });
  } catch (error) {
    const status = error instanceof StableFxError ? error.status : 500;
    console.error("StableFX settlement cron failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "StableFX settlement job failed." },
      { status },
    );
  }
}

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}
