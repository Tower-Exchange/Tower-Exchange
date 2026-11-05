import { NextResponse } from "next/server";
import { recurringOrdersUnavailablePayload } from "@/lib/recurringOrders";

export const runtime = "nodejs";

// AUDIT NOTE: This entry point intentionally does not invoke the Supabase
// function or any contract. Recurring orders are unavailable pending a new
// audited design, including deterministic price-floor protections.
const unavailable = () =>
  NextResponse.json(recurringOrdersUnavailablePayload, { status: 503 });

export const GET = unavailable;
export const POST = unavailable;
export async function HEAD() {
  return new Response(null, { status: 503 });
}
