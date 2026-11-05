import { NextResponse } from "next/server";
import { recurringOrdersUnavailablePayload } from "@/lib/recurringOrders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AUDIT NOTE: Execution records are retained in Supabase but this inactive
// feature must not read or append them through the product API.
const unavailable = () =>
  NextResponse.json(recurringOrdersUnavailablePayload, { status: 503 });

export const GET = unavailable;
export const POST = unavailable;
