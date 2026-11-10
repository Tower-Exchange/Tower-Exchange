import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  hasSquireBadgeClaimAllowlist,
  isSquireBadgeClaimAllowlisted,
} from "@/lib/server/squireBadgeClaimAllowlist";
import {
  isBadgeClaimingEnabled,
  BADGE_CLAIMING_DISABLED_MESSAGE,
} from "@/lib/badgeClaimingEnabled";

const BADGE_ID = "squire";
const EVM_WALLET_ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/;
export const runtime = "nodejs";

type SquireBadgeStatus = {
  walletAddress: string;
  badgeId: typeof BADGE_ID;
  volumeUsd: number;
  bridgeCount: number;
  swapCount: number;
  recurringOrdersCount: number;
  aiMessagesSentCount: number;
  criteriaMetCount: number;
  isEligible: boolean;
  isClaimed: boolean;
};

type SquireBadgeStatusRow = {
  wallet_address?: string | null;
  badge_id?: string | null;
  volume_usd?: number | string | null;
  bridge_count?: number | string | null;
  swap_count?: number | string | null;
  recurring_orders_count?: number | string | null;
  ai_messages_sent_count?: number | string | null;
  criteria_met_count?: number | string | null;
  is_eligible?: boolean | null;
  is_claimed?: boolean | null;
};

const applyClaimAllowlistOverride = (badge: SquireBadgeStatus) => {
  if (!hasSquireBadgeClaimAllowlist()) {
    return badge;
  }

  return {
    ...badge,
    isEligible:
      badge.isClaimed || isSquireBadgeClaimAllowlisted(badge.walletAddress),
  };
};

function createSupabaseRouteClient() {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for squire badge routes.",
    );
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

const normalizeWalletAddress = (walletAddress: unknown) =>
  typeof walletAddress === "string" && walletAddress.trim()
    ? walletAddress.trim().toLowerCase()
    : null;

const normalizeNumber = (value: number | string | null | undefined) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
};

const normalizeCount = (value: number | string | null | undefined) =>
  Math.max(0, Math.trunc(normalizeNumber(value)));

const isIgnorableQueryError = (message: string) => {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("does not exist") ||
    normalized.includes("could not find") ||
    normalized.includes("schema cache") ||
    normalized.includes("permission denied")
  );
};

const normalizeStatusRow = (
  row: SquireBadgeStatusRow | null | undefined,
  fallbackWalletAddress: string,
): SquireBadgeStatus | null => {
  if (!row) {
    return null;
  }

  const volumeUsd = normalizeNumber(row.volume_usd);
  const bridgeCount = normalizeCount(row.bridge_count);
  const swapCount = normalizeCount(row.swap_count);
  const recurringOrdersCount = normalizeCount(row.recurring_orders_count);
  const aiMessagesSentCount = normalizeCount(row.ai_messages_sent_count);
  const criteriaMetCount = normalizeCount(row.criteria_met_count);

  return {
    walletAddress: row.wallet_address || fallbackWalletAddress,
    badgeId: BADGE_ID,
    volumeUsd,
    bridgeCount,
    swapCount,
    recurringOrdersCount,
    aiMessagesSentCount,
    criteriaMetCount,
    isEligible: row.is_eligible === true || criteriaMetCount >= 3,
    isClaimed: row.is_claimed === true,
  };
};

const countQuery = async (
  queryPromise: PromiseLike<{ count: number | null; error: { message: string } | null }>,
) => {
  const { count, error } = await queryPromise;

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
};

const getClaimedStatus = async (
  supabase: ReturnType<typeof createSupabaseRouteClient>,
  walletAddress: string,
) => {
  const { count, error } = await supabase
    .from("user_badges")
    .select("badge_id", { count: "exact", head: true })
    .eq("wallet_address", walletAddress)
    .eq("badge_id", BADGE_ID);

  if (error) {
    if (isIgnorableQueryError(error.message)) {
      return false;
    }

    throw new Error(error.message);
  }

  return (count ?? 0) > 0;
};

const calculateFallbackStatus = async (
  supabase: ReturnType<typeof createSupabaseRouteClient>,
  walletAddress: string,
): Promise<SquireBadgeStatus> => {
  try {
    // Try the optimized RPC function first
    const { data, error } = await supabase.rpc(
      "get_squire_badge_status_optimized",
      {
        input_wallet_address: walletAddress,
      },
    );

    if (!error && data) {
      const row = Array.isArray(data)
        ? (data[0] as SquireBadgeStatusRow | undefined)
        : (data as SquireBadgeStatusRow | null);
      const status = normalizeStatusRow(row, walletAddress);

      if (status) {
        return status;
      }
    }
  } catch (e) {
    console.warn("Optimized RPC failed:", e);
  }

  // Final fallback: use direct case-sensitive queries with minimal data fetching
  try {
    const [bridgeCount, swapCount, recurringOrdersCount, aiMessagesSentCount] =
      await Promise.all([
        countQuery(
          supabase
            .from("activities")
            .select("id", { count: "exact", head: true })
            .eq("wallet_address", walletAddress)
            .eq("status", "Successful")
            .ilike("type", "%bridge%"),
        ),
        countQuery(
          supabase
            .from("activities")
            .select("id", { count: "exact", head: true })
            .eq("wallet_address", walletAddress)
            .eq("status", "Successful")
            .ilike("type", "%swap%"),
        ),
        countQuery(
          supabase
            .from("recurring_orders")
            .select("id", { count: "exact", head: true })
            .eq("wallet_address", walletAddress),
        ),
        countQuery(
          supabase
            .from("ai_db")
            .select("id", { count: "exact", head: true })
            .eq("user_id", walletAddress),
        ),
      ]);

    // For volume, we'll use a simplified approach
    let volumeUsd = 0;
    try {
      const { data: volumeRows, error: volumeError } = await supabase
        .from("activities")
        .select("type, amount_usd, amount")
        .eq("wallet_address", walletAddress)
        .eq("status", "Successful")
        .limit(10000); // Add a limit to prevent timeout

      if (!volumeError && volumeRows) {
        volumeUsd = (volumeRows ?? []).reduce((total, row) => {
          const activityRow = row as {
            type?: string | null;
            amount_usd?: number | string | null;
            amount?: number | string | null;
          };

          if (!/swap|bridge/i.test(activityRow.type ?? "")) {
            return total;
          }

          return (
            total +
            normalizeNumber(activityRow.amount_usd ?? activityRow.amount)
          );
        }, 0);
      }
    } catch (volumeError) {
      console.warn("Volume calculation failed, using 0:", volumeError);
      volumeUsd = 0;
    }

    const criteriaMetCount = [
      volumeUsd >= 1,
      bridgeCount >= 10,
      swapCount >= 5,
      recurringOrdersCount >= 20,
      aiMessagesSentCount >= 1,
    ].filter(Boolean).length;

    const isClaimed = await getClaimedStatus(supabase, walletAddress);

    return {
      walletAddress,
      badgeId: BADGE_ID,
      volumeUsd,
      bridgeCount,
      swapCount,
      recurringOrdersCount,
      aiMessagesSentCount,
      criteriaMetCount,
      isEligible: criteriaMetCount >= 3,
      isClaimed,
    };
  } catch (fallbackError) {
    console.error("All fallback methods failed:", fallbackError);
    // Return minimal eligible status
    return {
      walletAddress,
      badgeId: BADGE_ID,
      volumeUsd: 0,
      bridgeCount: 0,
      swapCount: 0,
      recurringOrdersCount: 0,
      aiMessagesSentCount: 0,
      criteriaMetCount: 0,
      isEligible: false,
      isClaimed: false,
    };
  }
};

const getSquireBadgeStatus = async (
  supabase: ReturnType<typeof createSupabaseRouteClient>,
  walletAddress: string,
) => {
  // Try original RPC first
  try {
    const { data, error } = await supabase.rpc("get_squire_badge_status", {
      input_wallet_address: walletAddress,
    });

    if (!error) {
      const row = Array.isArray(data)
        ? (data[0] as SquireBadgeStatusRow | undefined)
        : (data as SquireBadgeStatusRow | null);
      const status = normalizeStatusRow(row, walletAddress);

      if (status) {
        return status;
      }
    } else {
      console.warn("Original RPC failed, trying optimized version:", error);
    }
  } catch (e) {
    console.warn("Original RPC error:", e);
  }

  // Fall back to calculateFallbackStatus which tries optimized RPC then direct queries
  return calculateFallbackStatus(supabase, walletAddress);
};

const parseWalletRequest = async (request: NextRequest) => {
  const queryWalletAddress = request.nextUrl.searchParams.get("walletAddress");

  if (queryWalletAddress) {
    return normalizeWalletAddress(queryWalletAddress);
  }

  const body = (await request.json().catch(() => ({}))) as {
    walletAddress?: unknown;
  };

  return normalizeWalletAddress(body.walletAddress);
};

const validateWalletAddress = (walletAddress: string | null) => {
  if (!walletAddress) {
    return "Wallet address is required.";
  }

  if (!EVM_WALLET_ADDRESS_PATTERN.test(walletAddress)) {
    return "Wallet address is invalid.";
  }

  return null;
};

export async function GET(request: NextRequest) {
  try {
    const walletAddress = await parseWalletRequest(request);
    const validationError = validateWalletAddress(walletAddress);

    if (validationError || !walletAddress) {
      return NextResponse.json(
        { success: false, message: validationError },
        { status: 400 },
      );
    }

    const supabase = createSupabaseRouteClient();
    const badge = applyClaimAllowlistOverride(
      await getSquireBadgeStatus(supabase, walletAddress),
    );

    return NextResponse.json({ success: true, badge });
  } catch (error) {
    console.error("Error checking squire badge eligibility:", error);

    // Expose the error message to help debug the 500.
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Internal server error";

    return NextResponse.json(
      {
        success: false,
        message: "Unable to check badge eligibility right now.",
        debug: message,
      },
      { status: 500 },
    );
  }
}


export async function POST(request: NextRequest) {
  try {
    if (!isBadgeClaimingEnabled()) {
      return NextResponse.json(
        {
          success: false,
          message: BADGE_CLAIMING_DISABLED_MESSAGE,
        },
        { status: 403 },
      );
    }

    const walletAddress = await parseWalletRequest(request);
    const validationError = validateWalletAddress(walletAddress);

    if (validationError || !walletAddress) {
      return NextResponse.json(
        { success: false, message: validationError },
        { status: 400 },
      );
    }

    const supabase = createSupabaseRouteClient();
    const currentStatus = applyClaimAllowlistOverride(
      await getSquireBadgeStatus(supabase, walletAddress),
    );

    if (currentStatus.isClaimed) {
      return NextResponse.json({ success: true, badge: currentStatus });
    }

    if (!currentStatus.isEligible) {
      return NextResponse.json(
        {
          success: false,
          message: hasSquireBadgeClaimAllowlist()
            ? "This wallet is not currently eligible to claim the Squire badge."
            : "Squire badge eligibility requires at least 3 criteria.",
          badge: currentStatus,
        },
        { status: 403 },
      );
    }

    const { error } = await supabase.rpc("claim_squire_badge", {
      input_wallet_address: walletAddress,
    });

    if (!error) {
      return NextResponse.json({
        success: true,
        badge: {
          ...currentStatus,
          isClaimed: true,
        },
      });
    } else {
      console.warn("Squire badge claim RPC failed, falling back:", error);
    }

    const { error: insertError } = await supabase.from("user_badges").upsert(
      {
        wallet_address: walletAddress,
        badge_id: BADGE_ID,
        metadata: {
          volume_usd: currentStatus.volumeUsd,
          bridge_count: currentStatus.bridgeCount,
          swap_count: currentStatus.swapCount,
          recurring_orders_count: currentStatus.recurringOrdersCount,
          ai_messages_sent_count: currentStatus.aiMessagesSentCount,
          criteria_met_count: currentStatus.criteriaMetCount,
        },
      },
      { onConflict: "wallet_address,badge_id" },
    );

    if (insertError) {
      throw new Error(insertError.message);
    }

    return NextResponse.json({
      success: true,
      badge: {
        ...currentStatus,
        isClaimed: true,
      },
    });
  } catch (error) {
    console.error("Error claiming squire badge:", error);
    const debug =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Internal server error";

    return NextResponse.json(
      {
        success: false,
        message: "Unable to claim badge right now.",
        debug,
      },
      { status: 500 },
    );
  }
}
