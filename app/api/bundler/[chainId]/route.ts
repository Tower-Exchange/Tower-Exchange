import { NextRequest, NextResponse } from "next/server";
import { entryPoint07Address } from "viem/account-abstraction";
import { isFrontendBrowserRequest } from "@/lib/server/frontendRequestGuard";
import { getTrustedClientIp } from "@/lib/server/clientIp";
import { createIpRateLimiter } from "@/lib/server/ipRateLimit";
import { PAYMASTER_CHAIN_IDS } from "@/lib/paymaster/config";

export const dynamic = "force-dynamic";

// Bundler proxy for the Gas Account. Keeps the API key server-side and only
// forwards the ERC-4337 methods it needs. Upstream: BUNDLER_RPC_URL_TEMPLATE,
// else PIMLICO_API_KEY, else Pimlico's public (rate limited) endpoint.

const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH_SIZE = 5;
const UPSTREAM_TIMEOUT_MS = 30_000;

const ALLOWED_METHODS = new Set([
  "eth_sendUserOperation",
  "eth_estimateUserOperationGas",
  "eth_getUserOperationReceipt",
  "eth_getUserOperationByHash",
  "eth_supportedEntryPoints",
  "eth_chainId",
  "pimlico_getUserOperationGasPrice",
  "pimlico_getUserOperationStatus",
]);

const ENTRY_POINT_METHODS = new Set([
  "eth_sendUserOperation",
  "eth_estimateUserOperationGas",
]);

const rateLimiter = createIpRateLimiter({
  windowMs: 60_000,
  maxRequests: 120,
});

const jsonRpcError = (id: unknown, code: number, message: string) =>
  NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { status: 200, headers: { "cache-control": "no-store" } },
  );

const resolveUpstreamUrl = (chainId: string) => {
  const template = process.env.BUNDLER_RPC_URL_TEMPLATE?.trim();
  if (template) {
    return template.replaceAll("{chainId}", chainId);
  }

  const apiKey = process.env.PIMLICO_API_KEY?.trim();
  if (apiKey) {
    return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${encodeURIComponent(apiKey)}`;
  }

  return `https://public.pimlico.io/v2/${chainId}/rpc`;
};

type RpcCall = { id?: unknown; method?: unknown; params?: unknown };

const validateCall = (call: unknown): string | null => {
  if (!call || typeof call !== "object" || Array.isArray(call)) {
    return "Invalid request";
  }

  const { method, params } = call as RpcCall;
  if (typeof method !== "string" || !ALLOWED_METHODS.has(method)) {
    return "Method not allowed";
  }

  if (ENTRY_POINT_METHODS.has(method)) {
    const entryPoint = Array.isArray(params) ? params[1] : undefined;
    if (
      typeof entryPoint !== "string" ||
      entryPoint.toLowerCase() !== entryPoint07Address.toLowerCase()
    ) {
      return "Only ERC-4337 EntryPoint v0.7 is supported";
    }
  }

  return null;
};

type RouteContext = { params: Promise<{ chainId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!isFrontendBrowserRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { chainId } = await params;
  if (!PAYMASTER_CHAIN_IDS.includes(Number(chainId))) {
    return NextResponse.json(
      { error: `Unsupported bundler chain ID: ${chainId}` },
      { status: 400 },
    );
  }

  const limit = rateLimiter.consume(getTrustedClientIp(request.headers));
  if (limit.limited) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "retry-after": String(limit.retryAfterSeconds) },
      },
    );
  }

  const bodyText = await request.text();
  if (bodyText.length > MAX_BODY_BYTES) {
    return jsonRpcError(null, -32600, "Request too large");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }

  const calls = Array.isArray(parsed) ? parsed : [parsed];
  if (calls.length === 0 || calls.length > MAX_BATCH_SIZE) {
    return jsonRpcError(null, -32600, "Invalid batch size");
  }

  for (const call of calls) {
    const problem = validateCall(call);
    if (problem) {
      return jsonRpcError(
        (call as RpcCall | undefined)?.id ?? null,
        -32601,
        problem,
      );
    }
  }

  try {
    const upstream = await fetch(resolveUpstreamUrl(chainId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: bodyText,
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: {
        "cache-control": "no-store",
        "content-type":
          upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    console.error("Bundler proxy request failed:", error);
    return NextResponse.json(
      { error: "Bundler unavailable" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
