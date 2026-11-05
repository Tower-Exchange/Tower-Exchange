import { NextResponse } from "next/server";
import { recurringOrdersUnavailablePayload } from "@/lib/recurringOrders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AUDIT NOTE: All reads and writes are blocked until recurring orders have a
// replacement design and audit. Historic database rows are deliberately kept.
const unavailable = () =>
  NextResponse.json(recurringOrdersUnavailablePayload, { status: 503 });

export const GET = unavailable;
export const POST = unavailable;
