import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  PIONEER_BADGE_IDS,
  type PioneerBadgeId,
  type PioneerBadgeStatus,
} from "@/lib/pioneerBadge";
import {
  isBadgeClaimingEnabled,
  BADGE_CLAIMING_DISABLED_MESSAGE,
} from "@/lib/badgeClaimingEnabled";

export const runtime = "nodejs";

const EVM_WALLET_ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/;
const MINIMUM_TRANSACTION_COUNT = 10;
const MINIMUM_VOLUME_USD = 1_000;
const ACTIVITY_PAGE_SIZE = 1_000;

const BADGE_ACTIVITY_TYPES: Record<PioneerBadgeId, string> = {
  "swap-pioneer": "swap",
  "bridge-pioneer": "bridge",
};

type EligibilityStartRow = {
  starts_at?: string | null;
};

type ActivityAmountRow = {
  amount_usd?: number | string | null;
};

const isPioneerBadgeId = (value: unknown): value is PioneerBadgeId =>
  typeof value === "string" &&
  (PIONEER_BADGE_IDS as readonly string[]).includes(value);

const normalizeWalletAddress = (walletAddress: unknown) =>
  typeof walletAddress === "string" && walletAddress.trim()
    ? walletAddress.trim().toLowerCase()
    : null;

const normalizeUsdAmount = (value: number | string | null | undefined) => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

function createSupabaseRouteClient() {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for pioneer badge routes.",
    );
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

const parseBadgeRequest = async (request: NextRequest) => {
  const queryWalletAddress = request.nextUrl.searchParams.get("walletAddress");
  const queryBadgeId = request.nextUrl.searchParams.get("badgeId");

  if (queryWalletAddress || queryBadgeId) {
    return {
      walletAddress: normalizeWalletAddress(queryWalletAddress),
      badgeId: queryBadgeId,
    };
  }

  const body = (await request.json().catch(() => ({}))) as {
    walletAddress?: unknown;
    badgeId?: unknown;
  };

  return {
    walletAddress: normalizeWalletAddress(body.walletAddress),
    badgeId: body.badgeId,
  };
};

const validateRequest = (walletAddress: string | null, badgeId: unknown) => {
  if (!walletAddress) {
    return "Wallet address is required.";
  }

  if (!EVM_WALLET_ADDRESS_PATTERN.test(walletAddress)) {
    return "Wallet address is invalid.";
  }

  if (!isPioneerBadgeId(badgeId)) {
    return "Badge is invalid.";
  }

  return null;
};

const getEligibilityStart = async (
  supabase: ReturnType<typeof createSupabaseRouteClient>,
  badgeId: PioneerBadgeId,
) => {
  const { data, error } = await supabase
    .from("badge_eligibility_settings")
    .select("starts_at")
    .eq("badge_id", badgeId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const startsAt = (data as EligibilityStartRow | null)?.starts_at;
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) {
    throw new Error(`Missing eligibility start for ${badgeId}.`);
  }

  return startsAt;
};

const getActivityStats = async (
  supabase: ReturnType<typeof createSupabaseRouteClient>,
  walletAddress: string,
  badgeId: PioneerBadgeId,
  startsAt: string,
) => {
  const activityType = BADGE_ACTIVITY_TYPES[badgeId];
  const { count, error: countError } = await supabase
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("wallet_address", walletAddress)
    .eq("status", "Successful")
    .ilike("type", `%${activityType}%`)
    .gte("timestamp", startsAt);

  if (countError) {
    throw new Error(countError.message);
  }

  let volumeUsd = 0;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("activities")
      .select("amount_usd")
      .eq("wallet_address", walletAddress)
      .eq("status", "Successful")
      .ilike("type", `%${activityType}%`)
      .gte("timestamp", startsAt)
      .range(from, from + ACTIVITY_PAGE_SIZE - 1);

    if (error) {
      throw new Error(error.message);
    }

    const activityRows = (data ?? []) as ActivityAmountRow[];
    volumeUsd += activityRows.reduce(
      (total, row) => total + normalizeUsdAmount(row.amount_usd),
      0,
    );

    if (activityRows.length < ACTIVITY_PAGE_SIZE) {
      break;
    }

    from += ACTIVITY_PAGE_SIZE;
  }

  return {
    transactionCount: count ?? 0,
    volumeUsd,
  };
};

const getClaimedStatus = async (
  supabase: ReturnType<typeof createSupabaseRouteClient>,
  walletAddress: string,
  badgeId: PioneerBadgeId,
) => {
  const { count, error } = await supabase
    .from("user_badges")
    .select("badge_id", { count: "exact", head: true })
    .eq("wallet_address", walletAddress)
    .eq("badge_id", badgeId);

  if (error) {
    throw new Error(error.message);
  }

  return (count ?? 0) > 0;
};

const getPioneerBadgeStatus = async (
  supabase: ReturnType<typeof createSupabaseRouteClient>,
  walletAddress: string,
  badgeId: PioneerBadgeId,
): Promise<PioneerBadgeStatus> => {
  const startsAt = await getEligibilityStart(supabase, badgeId);
  const [{ transactionCount, volumeUsd }, isClaimed] = await Promise.all([
    getActivityStats(supabase, walletAddress, badgeId, startsAt),
    getClaimedStatus(supabase, walletAddress, badgeId),
  ]);

  return {
    walletAddress,
    badgeId,
    transactionCount,
    volumeUsd,
    startsAt,
    minimumTransactionCount: MINIMUM_TRANSACTION_COUNT,
    minimumVolumeUsd: MINIMUM_VOLUME_USD,
    isEligible:
      transactionCount >= MINIMUM_TRANSACTION_COUNT &&
      volumeUsd >= MINIMUM_VOLUME_USD,
    isClaimed,
  };
};

const toErrorResponse = (error: unknown) => {
  const debug =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Internal server error";

  return NextResponse.json(
    {
      success: false,
      message: "Unable to check badge eligibility right now.",
      debug,
    },
    { status: 500 },
  );
};

export async function GET(request: NextRequest) {
  try {
    const { walletAddress, badgeId } = await parseBadgeRequest(request);
    const validationError = validateRequest(walletAddress, badgeId);

    if (validationError || !walletAddress || !isPioneerBadgeId(badgeId)) {
      return NextResponse.json(
        { success: false, message: validationError },
        { status: 400 },
      );
    }

    const badge = await getPioneerBadgeStatus(
      createSupabaseRouteClient(),
      walletAddress,
      badgeId,
    );

    return NextResponse.json({ success: true, badge });
  } catch (error) {
    console.error("Error checking pioneer badge eligibility:", error);
    return toErrorResponse(error);
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

    const { walletAddress, badgeId } = await parseBadgeRequest(request);
    const validationError = validateRequest(walletAddress, badgeId);

    if (validationError || !walletAddress || !isPioneerBadgeId(badgeId)) {
      return NextResponse.json(
        { success: false, message: validationError },
        { status: 400 },
      );
    }

    const supabase = createSupabaseRouteClient();
    const currentStatus = await getPioneerBadgeStatus(
      supabase,
      walletAddress,
      badgeId,
    );

    if (currentStatus.isClaimed) {
      return NextResponse.json({ success: true, badge: currentStatus });
    }

    if (!currentStatus.isEligible) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Pioneer badge eligibility requires at least 10 successful transactions and $1,000 in volume after the program start date.",
          badge: currentStatus,
        },
        { status: 403 },
      );
    }

    const { error } = await supabase.from("user_badges").upsert(
      {
        wallet_address: walletAddress,
        badge_id: badgeId,
        metadata: {
          transaction_count: currentStatus.transactionCount,
          volume_usd: currentStatus.volumeUsd,
          eligibility_starts_at: currentStatus.startsAt,
        },
      },
      { onConflict: "wallet_address,badge_id" },
    );

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      success: true,
      badge: {
        ...currentStatus,
        isClaimed: true,
      },
    });
  } catch (error) {
    console.error("Error claiming pioneer badge:", error);
    return toErrorResponse(error);
  }
}
