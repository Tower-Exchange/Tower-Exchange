import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/devApiSupabase";
import { walletError } from "@/lib/server/wallet";
import { requireOwnedWalletSession } from "@/lib/server/walletSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { wallet, response } = requireOwnedWalletSession(request);
    if (response || !wallet) {
      return response ?? walletError("Wallet session required.", 401);
    }

    const { searchParams } = new URL(request.url);
    const limitRaw = Number.parseInt(searchParams.get("limit") || "100", 10);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 500)
      : 100;
    const ascending = searchParams.get("ascending") === "true";

    const { data, error } = await supabaseAdmin
      .from("activities")
      .select("*")
      .eq("wallet_address", wallet)
      .order("timestamp", { ascending })
      .limit(limit);

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    console.error("GET /api/user/activities failed:", error);
    return walletError(
      error instanceof Error ? error.message : "Failed to fetch activities",
      500,
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const { wallet, response } = requireOwnedWalletSession(request, body);
    if (response || !wallet) {
      return response ?? walletError("Wallet session required.", 401);
    }

    const type =
      typeof body.type === "string" && body.type.trim() ? body.type.trim() : null;
    if (!type) {
      return walletError("Activity type is required.");
    }

    const sourceTicker =
      typeof body.source_currency_ticker === "string"
        ? body.source_currency_ticker.trim()
        : "";
    const destinationTicker =
      typeof body.destination_currency_ticker === "string"
        ? body.destination_currency_ticker.trim()
        : "";

    if (
      type.toLowerCase() === "swap" &&
      (!sourceTicker ||
        !destinationTicker ||
        sourceTicker.toLowerCase() === "token" ||
        destinationTicker.toLowerCase() === "token")
    ) {
      return walletError("Swap activities require recognized token tickers.");
    }

    const parseOptionalNumber = (value: unknown) => {
      const parsed =
        typeof value === "number"
          ? value
          : typeof value === "string"
            ? Number.parseFloat(value)
            : null;
      return parsed != null && Number.isFinite(parsed) ? parsed : null;
    };

    const amount = parseOptionalNumber(body.amount);
    const amountUsd = parseOptionalNumber(body.amount_usd);
    if (type.toLowerCase() === "swap" && (amount == null || amountUsd == null)) {
      return walletError("Swap activities require valid amount and amount_usd values.");
    }

    const row = {
      wallet_address: wallet,
      type,
      source_currency_ticker: sourceTicker || null,
      destination_currency_ticker: destinationTicker || null,
      source_network_name:
        typeof body.source_network_name === "string"
          ? body.source_network_name
          : null,
      destination_network_name:
        typeof body.destination_network_name === "string"
          ? body.destination_network_name
          : null,
      destination_address:
        typeof body.destination_address === "string" && body.destination_address.trim()
          ? body.destination_address.trim()
          : null,
      status:
        typeof body.status === "string" && body.status.trim()
          ? body.status
          : "Successful",
      amount,
      amount_usd: amountUsd,
      fee: parseOptionalNumber(body.fee),
      fee_currency_ticker:
        typeof body.fee_currency_ticker === "string"
          ? body.fee_currency_ticker
          : null,
      transaction_hash:
        typeof body.transaction_hash === "string" &&
        body.transaction_hash.trim()
          ? body.transaction_hash.trim().slice(0, 200)
          : null,
      // server time, so a client can't backdate activity
      timestamp: new Date().toISOString(),
    };

    // same wallet/type/tx hash is only logged once
    if (row.transaction_hash) {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from("activities")
        .select("*")
        .eq("wallet_address", wallet)
        .eq("type", type)
        .ilike("transaction_hash", row.transaction_hash)
        .limit(1)
        .maybeSingle();

      if (existingError) {
        throw new Error(existingError.message);
      }
      if (existing) {
        return NextResponse.json({ success: true, data: existing });
      }
    }

    const { data, error } = await supabaseAdmin
      .from("activities")
      .insert(row)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("POST /api/user/activities failed:", error);
    return walletError(
      error instanceof Error ? error.message : "Failed to insert activity",
      500,
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const { wallet, response } = requireOwnedWalletSession(request, body);
    if (response || !wallet) {
      return response ?? walletError("Wallet session required.", 401);
    }

    const id =
      request.nextUrl.searchParams.get("id") ||
      (typeof body.id === "string" ? body.id : null);
    if (!id) {
      return walletError("id is required.");
    }

    const { data, error } = await supabaseAdmin
      .from("activities")
      .delete()
      .eq("id", id)
      .eq("wallet_address", wallet)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      return walletError("Activity not found for wallet.", 404);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/user/activities failed:", error);
    return walletError(
      error instanceof Error ? error.message : "Failed to delete activity",
      500,
    );
  }
}
