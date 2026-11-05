import { NextResponse } from "next/server";
import { recurringOrdersUnavailablePayload } from "@/lib/recurringOrders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AUDIT NOTE: Keeps historic URLs safe while blocking all recurring-order I/O.
const unavailable = () =>
  NextResponse.json(recurringOrdersUnavailablePayload, { status: 503 });

export const GET = unavailable;
export const PATCH = unavailable;
export const DELETE = unavailable;
