import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/devApiSupabase";
import { normalizeWalletAddress } from "@/lib/server/wallet";
import {
  modeFromNetwork,
  normalizeTxHash,
  resolveChain,
  verifyActivityTransaction,
  verifyBridgeActivity,
  type NetworkMode,
} from "@/lib/server/txVerification";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOTAL_BUDGET_MS = 6_500; // Republic gives up at 8s
const QUERY_TIMEOUT_MS = 4_000;
const VERIFY_BATCH = 4;
const MAX_FRESH_CHECKS = 24; // RPC lookups per request; progress is cached
const PAGE_SIZE = 200;
const MAX_SCAN_ROWS = 2_000;
const RESOLVE_CHUNK = 8;
const MAX_MIN_COUNT = 1_000;
const MAX_MIN_VOLUME_USD = 1_000_000_000;
const VOLUME_KEY_PATTERN = /^tower_volume_(\d{1,7})$/;

type Completed = { assertionId: string; occurredAt: string };

type ActionContext = {
  wallet: string;
  key: string;
  mode: NetworkMode;
  since: string | null;
  minUsd: number | null;
  qualification: Record<string, unknown>;
  deadline: number;
};

type Handler = (ctx: ActionContext) => Promise<Completed | null>;

class BadRequestError extends Error {}

// thrown when a tx can't be confirmed yet, answered with a 202
class PendingError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("pending");
  }
}

type ActivityRow = {
  id: string;
  type?: string | null;
  timestamp?: string | null;
  created_at?: string | null;
  amount_usd?: number | string | null;
  transaction_hash?: string | null;
  source_network_name?: string | null;
  destination_network_name?: string | null;
  onchain_checked_at?: string | null;
  onchain_status?: "verified" | "rejected" | null;
  onchain_chain_id?: number | null;
  onchain_block_time?: string | null;
};

type Verdict = "verified" | "rejected" | "skip" | "unavailable";

type ResolvedRow = {
  row: ActivityRow;
  hash: string;
  verdict: Verdict;
  occurredAt: string;
};

/* ----------------------------- helpers ----------------------------- */

function sha256(value: string) {
  return createHash("sha256").update(value).digest();
}

function tokensMatch(received: string, expected: string) {
  return timingSafeEqual(sha256(received), sha256(expected));
}

function withTimeout<T>(work: PromiseLike<T>, ms = QUERY_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Query timed out")), ms);
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function toIso(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toNumber(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowTime(row: ActivityRow) {
  return toIso(row.timestamp) ?? toIso(row.created_at) ?? new Date().toISOString();
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function assertTime(ctx: ActionContext) {
  if (ctx.deadline - Date.now() < 1_200) throw new PendingError(15);
}

const ACTIVITY_COLUMNS =
  "id, type, timestamp, created_at, amount_usd, transaction_hash, source_network_name, destination_network_name, onchain_status, onchain_chain_id, onchain_block_time, onchain_checked_at";

// a cached bridge rejection expires so a wrong one can't stick
const BRIDGE_REJECTION_TTL_MS = 6 * 60 * 60 * 1000;

// pending rows are included: bridges logged mid-settlement never get updated
function activityQuery(ctx: ActionContext, typePattern: string | null) {
  let query = supabaseAdmin
    .from("activities")
    .select(ACTIVITY_COLUMNS)
    .eq("wallet_address", ctx.wallet)
    .in("status", ["Successful", "Pending"])
    .not("transaction_hash", "is", null);

  query = typePattern
    ? query.ilike("type", typePattern)
    : query.or("type.ilike.%swap%,type.ilike.%bridge%");

  if (ctx.since) query = query.gte("timestamp", ctx.since);
  if (ctx.minUsd != null) query = query.gte("amount_usd", ctx.minUsd);
  return query
    .order("timestamp", { ascending: true })
    .order("id", { ascending: true });
}

function rowChains(ctx: ActionContext, row: ActivityRow) {
  const isBridge = (row.type ?? "").toLowerCase().includes("bridge");
  return {
    isBridge,
    source: resolveChain(row.source_network_name, ctx.mode),
    destination: isBridge ? resolveChain(row.destination_network_name, ctx.mode) : null,
  };
}

// verified/rejected is cached on the row; unavailable is not
async function resolveRows(
  ctx: ActionContext,
  rows: ActivityRow[],
  budget: { fresh: number },
): Promise<ResolvedRow[]> {
  const resolved: ResolvedRow[] = [];

  // rows we can settle without an rpc call
  const precheck = (row: ActivityRow): ResolvedRow | null => {
    const hash = normalizeTxHash(row.transaction_hash);
    const fallbackTime = rowTime(row);
    if (!hash) return { row, hash: "", verdict: "skip", occurredAt: fallbackTime };

    const chains = rowChains(ctx, row);
    if (!chains.source && !chains.destination) {
      return { row, hash, verdict: "skip", occurredAt: fallbackTime };
    }

    // cached verdict
    const chainIds = [chains.source?.id, chains.destination?.id];
    if (row.onchain_chain_id != null && chainIds.includes(row.onchain_chain_id)) {
      if (row.onchain_status === "verified") {
        return {
          row,
          hash,
          verdict: "verified",
          occurredAt: toIso(row.onchain_block_time) ?? fallbackTime,
        };
      }
      const checkedAt = row.onchain_checked_at ? Date.parse(row.onchain_checked_at) : 0;
      const staleBridgeRejection =
        chains.isBridge && Date.now() - checkedAt > BRIDGE_REJECTION_TTL_MS;
      if (row.onchain_status === "rejected" && !staleBridgeRejection) {
        return { row, hash, verdict: "rejected", occurredAt: fallbackTime };
      }
    }
    return null;
  };

  const checkOne = async (row: ActivityRow): Promise<ResolvedRow> => {
    const hash = normalizeTxHash(row.transaction_hash) ?? "";
    const fallbackTime = rowTime(row);
    // bridges can be proven on either chain, swaps only on the source chain
    const { isBridge, source: chain, destination: destinationChain } = rowChains(ctx, row);

    const createdAt = toIso(row.created_at) ?? fallbackTime;
    const ageMs = Date.now() - new Date(createdAt).getTime();
    const check = isBridge
      ? await verifyBridgeActivity({
          hash,
          wallet: ctx.wallet,
          sourceNetwork: row.source_network_name,
          destinationNetwork: row.destination_network_name,
          mode: ctx.mode,
          ageMs,
        })
      : await verifyActivityTransaction({
          hash,
          wallet: ctx.wallet,
          networkName: row.source_network_name,
          mode: ctx.mode,
          enforceTarget: (row.type ?? "").toLowerCase().includes("swap"),
          ageMs,
        });

    if (check.outcome === "verified" || check.outcome === "rejected") {
      const verified = check.outcome === "verified";
      await supabaseAdmin
        .from("activities")
        .update({
          onchain_status: check.outcome,
          onchain_chain_id: verified ? check.chainId : (chain?.id ?? destinationChain?.id),
          onchain_block_time: verified ? check.blockTime : null,
          onchain_checked_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      return {
        row,
        hash,
        verdict: check.outcome,
        occurredAt: verified ? check.blockTime : fallbackTime,
      };
    }

    return {
      row,
      hash,
      verdict: check.outcome === "unsupported" ? "skip" : "unavailable",
      occurredAt: fallbackTime,
    };
  };

  for (let i = 0; i < rows.length; i += VERIFY_BATCH) {
    assertTime(ctx);
    const batch = rows.slice(i, i + VERIFY_BATCH);

    const results = await Promise.all(
      batch.map(async (row) => {
        const decided = precheck(row);
        if (decided) return decided;

        if (budget.fresh <= 0) {
          return {
            row,
            hash: normalizeTxHash(row.transaction_hash) ?? "",
            verdict: "unavailable" as Verdict,
            occurredAt: rowTime(row),
          };
        }
        budget.fresh -= 1;
        return checkOne(row);
      }),
    );
    resolved.push(...results);
  }

  return resolved;
}

type Scope = {
  typePattern: string | null;
  name: "swap" | "bridge" | "activity" | "volume";
};

const SWAPS: Scope = { typePattern: "%swap%", name: "swap" };
const BRIDGES: Scope = { typePattern: "%bridge%", name: "bridge" };
const ANY_ACTIVITY: Scope = { typePattern: null, name: "activity" };
const VOLUME: Scope = { typePattern: null, name: "volume" };

function readThreshold(
  value: unknown,
  name: string,
  opts: { integer: boolean; max: number },
): number | null {
  if (value === undefined || value === null) return null;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    parsed > opts.max ||
    (opts.integer && !Number.isInteger(parsed))
  ) {
    throw new BadRequestError(
      `qualification.${name} must be a positive ${opts.integer ? "integer" : "number"} up to ${opts.max}`,
    );
  }
  return parsed;
}

type Hit = { hash: string; occurredAt: string };

// walks proven events oldest first until both thresholds are met
async function scanProvenEvents(
  ctx: ActionContext,
  scope: Scope,
  need: { count: number; volumeUsd: number },
): Promise<Hit | null> {
  const budget = { fresh: MAX_FRESH_CHECKS };
  const counted = new Set<string>();
  let count = 0;
  let volume = 0;
  let sawUnavailable = false;

  for (let from = 0; from < MAX_SCAN_ROWS; from += PAGE_SIZE) {
    const { data, error } = await withTimeout(
      activityQuery(ctx, scope.typePattern).range(from, from + PAGE_SIZE - 1),
    );
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as ActivityRow[];
    for (let i = 0; i < rows.length; i += RESOLVE_CHUNK) {
      const resolved = await resolveRows(
        ctx,
        rows.slice(i, i + RESOLVE_CHUNK),
        budget,
      );

      for (const entry of resolved) {
        if (entry.verdict === "unavailable") sawUnavailable = true;
        if (entry.verdict !== "verified" || counted.has(entry.hash)) continue;
        counted.add(entry.hash);
        count += 1;
        volume += toNumber(entry.row.amount_usd);
        if (count >= need.count && volume >= need.volumeUsd) {
          return { hash: entry.hash, occurredAt: entry.occurredAt };
        }
      }
    }
    if (rows.length < PAGE_SIZE) break;
  }

  // some rows aren't provable yet, so don't answer "no"
  if (sawUnavailable) throw new PendingError(30);
  return null;
}

// qualification: minCount, minVolumeUsd (cumulative), minUsd (per tx), since
// with no thresholds the first proven event completes it and its hash is the assertionId
function thresholdHandler(scope: Scope): Handler {
  return async (ctx) => {
    const keyVolume = VOLUME_KEY_PATTERN.exec(ctx.key);
    const minVolumeUsd = keyVolume
      ? Number(keyVolume[1])
      : readThreshold(ctx.qualification.minVolumeUsd, "minVolumeUsd", {
          integer: false,
          max: MAX_MIN_VOLUME_USD,
        });
    const minCount = readThreshold(ctx.qualification.minCount, "minCount", {
      integer: true,
      max: MAX_MIN_COUNT,
    });

    if (scope === VOLUME && minVolumeUsd == null) {
      throw new BadRequestError(
        "Volume actions need a threshold: use tower_volume_<usd> or qualification.minVolumeUsd",
      );
    }

    const need = { count: minCount ?? 1, volumeUsd: minVolumeUsd ?? 0 };
    const hit = await scanProvenEvents(ctx, scope, need);
    if (!hit) return null;

    // same requirement must always give the same id
    let assertionId: string;
    if (scope === VOLUME && minCount == null) {
      assertionId = `tower_volume_${need.volumeUsd}_${ctx.wallet}`; // legacy shape
    } else if (scope !== VOLUME && minCount == null && minVolumeUsd == null) {
      assertionId = hit.hash; // first proven event
    } else {
      assertionId = `tower_${scope.name}_n${need.count}_v${need.volumeUsd}_${ctx.wallet}`;
    }
    return { assertionId, occurredAt: hit.occurredAt };
  };
}

// the badge is derived from activity, so it needs one proven swap or bridge too
async function squireBadgeHandler(ctx: ActionContext): Promise<Completed | null> {
  const { data, error } = await withTimeout(
    supabaseAdmin
      .from("user_badges")
      .select("claimed_at")
      .ilike("wallet_address", ctx.wallet)
      .eq("badge_id", "squire")
      .limit(1),
  );
  if (error) throw new Error(error.message);

  const row = data?.[0] as { claimed_at?: string | null } | undefined;
  if (!row) return null;

  const proven = await scanProvenEvents(ctx, ANY_ACTIVITY, { count: 1, volumeUsd: 0 });
  if (!proven) return null;

  return {
    assertionId: `tower_squire_badge_${ctx.wallet}`,
    occurredAt: toIso(row.claimed_at) ?? new Date().toISOString(),
  };
}

async function recurringOrderHandler(ctx: ActionContext): Promise<Completed | null> {
  let query = supabaseAdmin
    .from("recurring_orders")
    .select("id, created_at, onchain_authorized, authorization_transaction_hash")
    .eq("wallet_address", ctx.wallet)
    .eq("onchain_authorized", true)
    .not("authorization_transaction_hash", "is", null);
  if (ctx.since) query = query.gte("created_at", ctx.since);

  const { data, error } = await withTimeout(
    query.order("created_at", { ascending: true }).limit(3),
  );
  if (error) throw new Error(error.message);

  let unavailable = false;
  for (const order of (data ?? []) as Array<{
    id: string;
    created_at?: string | null;
    authorization_transaction_hash: string;
  }>) {
    assertTime(ctx);
    const created = toIso(order.created_at) ?? new Date().toISOString();
    const check = await verifyActivityTransaction({
      hash: order.authorization_transaction_hash,
      wallet: ctx.wallet,
      networkName: "arc",
      mode: ctx.mode,
      enforceTarget: false,
      ageMs: Date.now() - new Date(created).getTime(),
    });

    if (check.outcome === "verified") {
      return {
        assertionId: `tower_recurring_order_${order.id}`,
        occurredAt: check.blockTime,
      };
    }
    if (check.outcome === "unavailable") unavailable = true;
  }

  if (unavailable) throw new PendingError(30);
  return null;
}

// ai_db is client-writable, low trust
async function aiChatHandler(ctx: ActionContext): Promise<Completed | null> {
  let query = supabaseAdmin
    .from("ai_db")
    .select("created_at")
    .eq("user_id", ctx.wallet)
    .neq("user_query", "[Transaction Confirmed]");
  if (ctx.since) query = query.gte("created_at", ctx.since);

  const { data, error } = await withTimeout(
    query.order("created_at", { ascending: true }).limit(1),
  );
  if (error) throw new Error(error.message);

  const row = data?.[0] as { created_at?: string | null } | undefined;
  if (!row) return null;
  return {
    assertionId: `tower_ai_chat_${ctx.wallet}`,
    occurredAt: toIso(row.created_at) ?? new Date().toISOString(),
  };
}

/* Exact allowlist: unknown verification IDs are rejected, never fuzzy-matched. */
const HANDLERS: Record<string, Handler> = {
  tower_swap: thresholdHandler(SWAPS),
  tower_swap_completed: thresholdHandler(SWAPS),
  tower_bridge: thresholdHandler(BRIDGES),
  tower_bridge_completed: thresholdHandler(BRIDGES),
  tower_any_activity: thresholdHandler(ANY_ACTIVITY),
  tower_volume: thresholdHandler(VOLUME),
  tower_squire_badge: squireBadgeHandler,
  tower_squire_badge_claimed: squireBadgeHandler,
  tower_recurring_order: recurringOrderHandler,
  tower_ai_chat: aiChatHandler,
};

function resolveHandler(key: string): Handler | null {
  if (VOLUME_KEY_PATTERN.test(key)) return thresholdHandler(VOLUME);
  return HANDLERS[key] ?? null;
}

/* ------------------------------ routes ------------------------------ */

export async function GET() {
  return json({
    service: "Tower Exchange - Legion Partner Verification API",
    status: "active",
    supportedActions: [...Object.keys(HANDLERS), "tower_volume_<usd>"],
  });
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? "unknown";
  const startedAt = Date.now();

  try {
    // fail closed when the secret isn't set
    const expectedSecret = process.env.LEGION_WEBHOOK_SECRET?.trim();
    if (!expectedSecret) {
      console.error("[legion] LEGION_WEBHOOK_SECRET is not configured");
      return json({ error: "Verification service not configured" }, 503);
    }

    const token = request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim();
    // old secret stays valid while rotating
    const previousSecret = process.env.LEGION_WEBHOOK_SECRET_PREVIOUS?.trim();
    const authorized =
      !!token &&
      (tokensMatch(token, expectedSecret) ||
        (!!previousSecret && tokensMatch(token, previousSecret)));
    if (!authorized) {
      // lengths and short hashes only, never the token
      const fingerprint = (value?: string) =>
        value ? sha256(value).toString("hex").slice(0, 8) : "none";
      console.warn(
        `[legion] unauthorized requestId=${requestId} ` +
          `authHeader=${request.headers.has("authorization") ? "present" : "missing"} ` +
          `received(len=${token?.length ?? 0},fp=${fingerprint(token)}) ` +
          `expected(len=${expectedSecret.length},fp=${fingerprint(expectedSecret)}) ` +
          `ua=${request.headers.get("user-agent") ?? "none"}`,
      );
      return json({ error: "Unauthorized" }, 401);
    }

    const body = (await request.json().catch(() => null)) as {
      action?: { key?: unknown; version?: unknown };
      subject?: { kind?: unknown; identifier?: unknown; network?: unknown };
      qualification?: unknown;
    } | null;
    if (!body || typeof body !== "object") {
      return json({ error: "Malformed JSON body" }, 400);
    }

    if (body.subject?.kind !== "wallet") {
      return json({ error: "subject.kind must be 'wallet'" }, 400);
    }
    const wallet = normalizeWalletAddress(body.subject.identifier);
    if (!wallet) {
      return json({ error: "subject.identifier must be an EVM address" }, 400);
    }

    const key =
      typeof body.action?.key === "string" ? body.action.key.trim().toLowerCase() : "";
    if (!key) {
      return json({ error: "action.key is required" }, 400);
    }
    const handler = resolveHandler(key);
    if (!handler) {
      return json({ error: `Unsupported action.key '${key}'` }, 400);
    }

    const qualification =
      body.qualification &&
      typeof body.qualification === "object" &&
      !Array.isArray(body.qualification)
        ? (body.qualification as Record<string, unknown>)
        : {};
    // reject bad values instead of ignoring them, a dropped `since` would count old activity
    const minUsd =
      qualification.minUsd === 0
        ? null // 0 simply means "no minimum"
        : readThreshold(qualification.minUsd, "minUsd", {
            integer: false,
            max: MAX_MIN_VOLUME_USD,
          });
    let since: string | null = null;
    if (qualification.since !== undefined && qualification.since !== null) {
      since = toIso(qualification.since);
      if (!since) {
        throw new BadRequestError(
          "qualification.since must be an ISO date-time, e.g. 2026-10-12T00:00:00Z",
        );
      }
    }
    const network =
      typeof body.subject.network === "string" ? body.subject.network : null;

    const ctx: ActionContext = {
      wallet,
      key,
      mode: modeFromNetwork(network),
      qualification,
      since,
      minUsd,
      deadline: startedAt + TOTAL_BUDGET_MS,
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    let result: Completed | null;
    try {
      result = await Promise.race([
        handler(ctx),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new PendingError(15)), TOTAL_BUDGET_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    console.info(
      `[legion] requestId=${requestId} key=${key} network=${network} wallet=${wallet.slice(0, 8)}… -> ${result ? "completed" : "incomplete"} (${Date.now() - startedAt}ms)`,
    );

    if (!result) {
      return json({ status: "incomplete", completed: false });
    }

    return json({
      status: "completed",
      completed: true,
      assertionId: result.assertionId.slice(0, 256),
      occurredAt: result.occurredAt,
    });
  } catch (error) {
    if (error instanceof BadRequestError) {
      return json({ error: error.message }, 400);
    }
    if (error instanceof PendingError) {
      console.info(`[legion] requestId=${requestId} -> pending (${Date.now() - startedAt}ms)`);
      return json({ status: "pending", retryAfterSeconds: error.retryAfterSeconds }, 202);
    }
    // 5xx so republic shows "unavailable" and leaves progress alone
    console.error(`[legion] verification failed (requestId=${requestId}):`, error);
    return json({ error: "Verification temporarily unavailable" }, 503);
  }
}
