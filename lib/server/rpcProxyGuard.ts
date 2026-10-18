import { NextRequest, NextResponse } from "next/server";
import { getTrustedClientIp } from "@/lib/server/clientIp";

const MAX_BATCH_SIZE = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 300;
const RATE_LIMIT_MAX_BROADCASTS = 20;

const EVM_READ_METHODS = new Set([
  "eth_blobbasefee",
  "eth_blocknumber",
  "eth_call",
  "eth_chainid",
  "eth_createaccesslist",
  "eth_estimategas",
  "eth_feehistory",
  "eth_gasprice",
  "eth_getbalance",
  "eth_getblockbyhash",
  "eth_getblockbynumber",
  "eth_getblocktransactioncountbyhash",
  "eth_getblocktransactioncountbynumber",
  "eth_getcode",
  "eth_getheaderbyhash",
  "eth_getheaderbynumber",
  "eth_getlogs",
  "eth_getproof",
  "eth_getstorageat",
  "eth_gettransactionbyblockhashandindex",
  "eth_gettransactionbyblocknumberandindex",
  "eth_gettransactionbyhash",
  "eth_gettransactioncount",
  "eth_gettransactionreceipt",
  "eth_getunclebyblockhashandindex",
  "eth_getunclebyblocknumberandindex",
  "eth_getunclecountbyblockhash",
  "eth_getunclecountbyblocknumber",
  "eth_maxpriorityfeepergas",
  "eth_protocolversion",
  "eth_syncing",
  "net_listening",
  "net_peercount",
  "net_version",
  "web3_clientversion",
  "web3_sha3",
]);

const SOLANA_METHODS = new Set([
  "getaccountinfo",
  "getaddresslookuptable",
  "getbalance",
  "getblock",
  "getblockheight",
  "getfeeformessage",
  "getgenesishash",
  "gethealth",
  "getlatestblockhash",
  "getminimumbalanceforrentexemption",
  "getmultipleaccounts",
  "getrecentblockhash",
  "getrecentprioritizationfees",
  "getsignaturesforaddress",
  "getsignaturestatuses",
  "getslot",
  "gettokenaccountbalance",
  "gettokenaccountsbyowner",
  "gettransaction",
  "getversion",
  "isblockhashvalid",
  "sendtransaction",
  "simulatetransaction",
]);

const BROADCAST_METHODS = new Set(["eth_sendrawtransaction", "sendtransaction"]);

/**
 * Chains where the app may broadcast signed transactions through this proxy.
 * Includes Arc and the CCTP EVM networks Tower bridges on (mainnet + current
 * testnets). Mempool and pending-filter methods stay denied on every chain.
 */
const BROADCAST_CHAIN_IDS = new Set([
  "1", // Ethereum
  "10", // Optimism
  "130", // Unichain
  "137", // Polygon
  "146", // Sonic
  "1301", // Unichain Sepolia
  "8453", // Base
  "14601", // Sonic testnet
  "43113", // Avalanche Fuji
  "43114", // Avalanche
  "42161", // Arbitrum
  "5042", // Arc mainnet
  "59141", // Linea Sepolia
  "59144", // Linea
  "80002", // Polygon Amoy
  "84532", // Base Sepolia
  "5042002", // Arc testnet
  "11155111", // Ethereum Sepolia
  "11155420", // OP Sepolia
  "421614", // Arbitrum Sepolia
  "solana",
  "solana-mainnet",
]);

type RpcCall = {
  method: string;
  id: unknown;
};

type RateBucket = {
  windowStart: number;
  requests: number;
  broadcasts: number;
};

const rateBuckets = new Map<string, RateBucket>();

const normalizeMethod = (method: unknown) =>
  typeof method === "string" ? method.trim().toLowerCase() : "";

const jsonRpcError = (id: unknown, code: number, message: string) =>
  NextResponse.json(
    {
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code, message },
    },
    { status: 200 },
  );

export const getRpcClientIp = (request: NextRequest) =>
  getTrustedClientIp(request.headers);

const parseRpcCalls = (
  bodyText: string,
): { calls: RpcCall[]; firstId: unknown } | { parseError: true } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { parseError: true };
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return { parseError: true };
    }

    return {
      calls: parsed.map((entry) => ({
        method: normalizeMethod(
          entry && typeof entry === "object"
            ? (entry as { method?: unknown }).method
            : "",
        ),
        id:
          entry && typeof entry === "object"
            ? (entry as { id?: unknown }).id
            : null,
      })),
      firstId:
        parsed[0] && typeof parsed[0] === "object"
          ? (parsed[0] as { id?: unknown }).id
          : null,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return { parseError: true };
  }

  const record = parsed as { method?: unknown; id?: unknown };
  return {
    calls: [{ method: normalizeMethod(record.method), id: record.id }],
    firstId: record.id,
  };
};

export const isRpcMethodAllowed = (chainId: string, method: string) => {
  const normalized = normalizeMethod(method);
  if (!normalized) {
    return false;
  }

  if (chainId === "solana" || chainId === "solana-mainnet") {
    return SOLANA_METHODS.has(normalized);
  }

  if (normalized === "eth_sendrawtransaction") {
    return BROADCAST_CHAIN_IDS.has(chainId);
  }

  return EVM_READ_METHODS.has(normalized);
};

const consumeRateLimit = (ip: string, broadcastCount: number) => {
  const now = Date.now();
  const existing = rateBuckets.get(ip);
  const bucket =
    !existing || now - existing.windowStart >= RATE_LIMIT_WINDOW_MS
      ? { windowStart: now, requests: 0, broadcasts: 0 }
      : existing;

  bucket.requests += 1;
  bucket.broadcasts += broadcastCount;
  rateBuckets.set(ip, bucket);

  if (rateBuckets.size > 20_000) {
    for (const [key, value] of rateBuckets) {
      if (now - value.windowStart >= RATE_LIMIT_WINDOW_MS) {
        rateBuckets.delete(key);
      }
    }
  }

  if (bucket.requests > RATE_LIMIT_MAX_REQUESTS) {
    return {
      limited: true as const,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((bucket.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000),
      ),
    };
  }

  if (bucket.broadcasts > RATE_LIMIT_MAX_BROADCASTS) {
    return {
      limited: true as const,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((bucket.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000),
      ),
    };
  }

  return { limited: false as const };
};

export const inspectRpcProxyRequest = (params: {
  chainId: string;
  bodyText: string;
  clientIp: string;
  allowBroadcast?: boolean;
}): { ok: true } | { ok: false; response: NextResponse } => {
  const parsed = parseRpcCalls(params.bodyText);
  if ("parseError" in parsed) {
    return {
      ok: false,
      response: jsonRpcError(null, -32700, "Parse error"),
    };
  }

  if (parsed.calls.length > MAX_BATCH_SIZE) {
    return {
      ok: false,
      response: jsonRpcError(
        parsed.firstId,
        -32600,
        `Batch too large. Maximum ${MAX_BATCH_SIZE} calls per request.`,
      ),
    };
  }

  const broadcastCount = parsed.calls.filter((call) =>
    BROADCAST_METHODS.has(call.method),
  ).length;

  if (broadcastCount > 0 && !params.allowBroadcast) {
    const blocked = parsed.calls.find((call) =>
      BROADCAST_METHODS.has(call.method),
    );
    return {
      ok: false,
      response: jsonRpcError(blocked?.id ?? parsed.firstId, -32601, "Method not found"),
    };
  }

  const rate = consumeRateLimit(params.clientIp, broadcastCount);
  if (rate.limited) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          jsonrpc: "2.0",
          id: parsed.firstId ?? null,
          error: {
            code: -32000,
            message: "Rate limit exceeded. Please slow down.",
          },
        },
        {
          status: 429,
          headers: { "Retry-After": String(rate.retryAfterSeconds) },
        },
      ),
    };
  }

  const blocked = parsed.calls.find(
    (call) => !isRpcMethodAllowed(params.chainId, call.method),
  );
  if (blocked) {
    return {
      ok: false,
      response: jsonRpcError(blocked.id, -32601, "Method not found"),
    };
  }

  return { ok: true };
};

export const resetRpcProxyRateLimitForTests = () => {
  rateBuckets.clear();
};
