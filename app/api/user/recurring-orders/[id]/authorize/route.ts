import { NextResponse } from "next/server";
import { recurringOrdersUnavailablePayload } from "@/lib/recurringOrders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AUDIT NOTE: No new token approvals or on-chain authorizations may be made.
export const POST = () =>
  NextResponse.json(recurringOrdersUnavailablePayload, { status: 503 });
