import { NextRequest, NextResponse } from "next/server";

import {
  StableFxError,
  verifyStableFxWebhookSignature,
} from "@/lib/server/circleStableFx";
import { processStableFxWebhook } from "@/lib/server/stableFxWebhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_WEBHOOK_BODY_BYTES = 1_000_000;

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isExpectedSubscription(subscriptionId: unknown) {
  const expected = process.env.CIRCLE_STABLEFX_WEBHOOK_SUBSCRIPTION_ID?.trim();
  return !expected || subscriptionId === expected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function HEAD() {
  // Circle validates webhook endpoints with HEAD before it can send POSTs.
  return new NextResponse(null, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BODY_BYTES) {
    return noStoreJson({ error: "Webhook payload is too large." }, 413);
  }

  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    return noStoreJson({ error: "Webhook payload is too large." }, 413);
  }

  const signature = request.headers.get("x-circle-signature");
  const keyId = request.headers.get("x-circle-key-id");
  if (!signature || !keyId) {
    return noStoreJson({ error: "Missing Circle webhook signature." }, 401);
  }

  try {
    const valid = await verifyStableFxWebhookSignature({ rawBody, signature, keyId });
    if (!valid) return noStoreJson({ error: "Invalid Circle webhook signature." }, 401);

    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(rawBody).toString("utf8")) as unknown;
    } catch {
      return noStoreJson({ error: "Invalid webhook payload." }, 400);
    }
    if (!isRecord(payload)) {
      return noStoreJson({ error: "Invalid webhook payload." }, 400);
    }
    if (!isExpectedSubscription(payload.subscriptionId)) {
      console.error("Rejected Circle StableFX webhook from an unexpected subscription", {
        subscriptionId: payload.subscriptionId,
      });
      return noStoreJson({ error: "Unexpected Circle webhook subscription." }, 403);
    }

    const result = await processStableFxWebhook({ rawBody, payload });
    return noStoreJson({ received: true, ...result });
  } catch (error) {
    const status = error instanceof StableFxError ? error.status : 500;
    console.error("Circle StableFX webhook processing failed", {
      status,
      error: error instanceof Error ? error.message : error,
    });
    return noStoreJson(
      { error: status >= 500 ? "Webhook processing failed. Please retry." : "Invalid webhook payload." },
      status,
    );
  }
}
