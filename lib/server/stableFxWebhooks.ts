import { createHash } from "node:crypto";

import { StableFxError } from "@/lib/server/circleStableFx";
import { supabaseAdmin } from "@/lib/server/devApiSupabase";
import { reconcileStableFxWebhookTrade } from "@/lib/server/stableFxOrders";

type UnknownRecord = Record<string, unknown>;

type StableFxWebhookEventRow = {
  delivery_hash: string;
  status: "received" | "processing" | "processed" | "failed";
  attempts: number;
  processing_started_at: string | null;
};

type ParsedStableFxWebhook = {
  notificationType: string;
  subscriptionId: string | null;
  tradeId: string | null;
  contractTradeId: string | null;
  payload: UnknownRecord;
};

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const result = nonEmptyString(value);
    if (result) return result;
  }
  return null;
}

function parseStableFxWebhook(value: unknown): ParsedStableFxWebhook {
  const payload = asRecord(value);
  const notificationType = nonEmptyString(payload?.notificationType);
  if (!payload || !notificationType) {
    throw new StableFxError("Circle webhook payload is missing notificationType.", 400);
  }

  const trade = asRecord(payload.trade);
  const contractCall = asRecord(payload.contractCall);
  return {
    notificationType,
    subscriptionId: nonEmptyString(payload.subscriptionId),
    // Trade notifications include trade.id. Contract notifications can instead
    // identify the trade with tradeId or contractTradeId.
    tradeId: firstString(payload.tradeId, trade?.id, trade?.tradeId, contractCall?.tradeId),
    contractTradeId: firstString(
      payload.contractTradeId,
      trade?.contractTradeId,
      contractCall?.contractTradeId,
    ),
    payload,
  };
}

function deliveryHash(rawBody: Uint8Array) {
  return createHash("sha256").update(rawBody).digest("hex");
}

function webhookErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected webhook processing error.";
  return message.slice(0, 1_000);
}

async function getWebhookEvent(deliveryHashValue: string) {
  const { data, error } = await supabaseAdmin
    .from("stablefx_webhook_events")
    .select("delivery_hash, status, attempts, processing_started_at")
    .eq("delivery_hash", deliveryHashValue)
    .maybeSingle();
  if (error || !data) {
    throw new StableFxError("Unable to load the StableFX webhook delivery.", 500);
  }
  return data as StableFxWebhookEventRow;
}

async function createOrLoadWebhookEvent(params: {
  deliveryHashValue: string;
  event: ParsedStableFxWebhook;
}) {
  const { data, error } = await supabaseAdmin
    .from("stablefx_webhook_events")
    .insert({
      delivery_hash: params.deliveryHashValue,
      notification_type: params.event.notificationType,
      subscription_id: params.event.subscriptionId,
      trade_id: params.event.tradeId,
      contract_trade_id: params.event.contractTradeId,
      payload: params.event.payload,
    })
    .select("delivery_hash, status, attempts, processing_started_at")
    .maybeSingle();

  if (data) return { event: data as StableFxWebhookEventRow, duplicate: false };
  if (error?.code !== "23505") {
    console.error("Unable to record StableFX webhook delivery", { error });
    throw new StableFxError("Unable to record the StableFX webhook delivery.", 500);
  }
  return { event: await getWebhookEvent(params.deliveryHashValue), duplicate: true };
}

async function claimWebhookEvent(event: StableFxWebhookEventRow) {
  if (event.status === "processed") return false;
  if (event.status === "processing") {
    const startedAt = event.processing_started_at ? Date.parse(event.processing_started_at) : NaN;
    // Let an active handler finish. A later trade event or the reconciliation
    // worker still provides recovery if this process is interrupted.
    if (Number.isFinite(startedAt) && Date.now() - startedAt < 120_000) return false;
  }

  const { data, error } = await supabaseAdmin
    .from("stablefx_webhook_events")
    .update({
      status: "processing",
      attempts: Math.max(0, Number(event.attempts) || 0) + 1,
      processing_started_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("delivery_hash", event.delivery_hash)
    .in("status", ["received", "failed", "processing"])
    .select("delivery_hash")
    .maybeSingle();
  if (error) {
    throw new StableFxError("Unable to claim the StableFX webhook delivery.", 500);
  }
  return Boolean(data);
}

async function completeWebhookEvent(deliveryHashValue: string) {
  const { error } = await supabaseAdmin
    .from("stablefx_webhook_events")
    .update({
      status: "processed",
      processed_at: new Date().toISOString(),
      processing_started_at: null,
      last_error: null,
    })
    .eq("delivery_hash", deliveryHashValue)
    .eq("status", "processing");
  if (error) throw new StableFxError("Unable to complete the StableFX webhook delivery.", 500);
}

async function failWebhookEvent(deliveryHashValue: string, error: unknown) {
  const { error: updateError } = await supabaseAdmin
    .from("stablefx_webhook_events")
    .update({
      status: "failed",
      processing_started_at: null,
      last_error: webhookErrorMessage(error),
    })
    .eq("delivery_hash", deliveryHashValue)
    .eq("status", "processing");
  if (updateError) {
    console.error("Unable to record StableFX webhook failure", { updateError });
  }
}

export async function processStableFxWebhook(params: {
  rawBody: Uint8Array;
  payload: unknown;
}) {
  const event = parseStableFxWebhook(params.payload);
  const deliveryHashValue = deliveryHash(params.rawBody);
  const persisted = await createOrLoadWebhookEvent({ deliveryHashValue, event });
  const claimed = await claimWebhookEvent(persisted.event);
  if (!claimed) {
    return { duplicate: true, notificationType: event.notificationType, result: null };
  }

  try {
    // Circle uses this event when an operator tests the endpoint. It is signed
    // but intentionally does not contain a StableFX trade reference.
    if (event.notificationType === "webhooks.test") {
      await completeWebhookEvent(deliveryHashValue);
      return { duplicate: false, notificationType: event.notificationType, result: "test" };
    }

    if (!event.notificationType.startsWith("stablefx.")) {
      await completeWebhookEvent(deliveryHashValue);
      return { duplicate: false, notificationType: event.notificationType, result: "ignored" };
    }

    if (!event.tradeId && !event.contractTradeId) {
      console.error("Circle StableFX webhook has no trade reference", {
        notificationType: event.notificationType,
        deliveryHash: deliveryHashValue,
      });
      await completeWebhookEvent(deliveryHashValue);
      return {
        duplicate: false,
        notificationType: event.notificationType,
        result: "missing_trade_reference",
      };
    }

    const reconciliation = await reconcileStableFxWebhookTrade({
      notificationType: event.notificationType,
      tradeId: event.tradeId,
      contractTradeId: event.contractTradeId,
    });
    await completeWebhookEvent(deliveryHashValue);
    return {
      duplicate: false,
      notificationType: event.notificationType,
      result: reconciliation.matched ? reconciliation.status : "unmatched_trade",
    };
  } catch (error) {
    await failWebhookEvent(deliveryHashValue, error);
    throw error;
  }
}
