import {
  createPublicKey,
  randomUUID,
  verify,
  type KeyObject,
} from "node:crypto";

import {
  isStableFxAmount,
  isStableFxPair,
  type StableFxAmountSide,
  type StableFxCurrency,
} from "@/lib/stableFx";

const DEFAULT_STABLEFX_API_BASE_URL = "https://api.circle.com";
const STABLEFX_QUOTES_PATH = "/v1/exchange/stablefx/quotes";
const STABLEFX_TRADES_PATH = "/v1/exchange/stablefx/trades";
// Tower settles StableFX trades on Circle's instant schedule. The reference
// quote and subsequent tradable quote must use the same tenor.
const STABLEFX_QUOTE_TENOR = "instant";
const CIRCLE_NOTIFICATION_PUBLIC_KEY_PATH = "/v2/notifications/publicKey";
const CIRCLE_WEBHOOK_KEY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Circle signing keys are public and immutable per key ID. This cache only
// lives for the current Node.js instance; a new X-Circle-Key-Id is fetched
// automatically after Circle rotates a signing key.
const webhookPublicKeyCache = new Map<string, KeyObject>();

type StableFxApiErrorBody = { code?: unknown; message?: unknown };
type UnknownRecord = Record<string, unknown>;

export type StableFxQuoteRequest = {
  fromCurrency: StableFxCurrency;
  toCurrency: StableFxCurrency;
  amount: string;
  amountSide: StableFxAmountSide;
};

export type StableFxTypedData = {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
};

export type StableFxReferenceQuote = {
  id: string | null;
  rate: string | number | null;
  from: { currency: StableFxCurrency; amount: string | null };
  to: { currency: StableFxCurrency; amount: string | null };
  fee: unknown;
  /**
   * Taker collateral required to record the trade. This is denominated in the
   * quote's `from` currency and is distinct from the trade notional.
   */
  collateral: string | null;
  expiresAt: string | null;
};

export type StableFxTradableQuote = StableFxReferenceQuote & {
  typedData: StableFxTypedData;
};

export type StableFxTrade = {
  id: string;
  /**
   * Circle creates the off-chain trade before it records it on Arc. The
   * initial successful response can therefore omit this ID; funding must wait
   * until a subsequent trade read/webhook supplies it.
   */
  contractTradeId: string | null;
  status: string;
  quoteId: string | null;
  from: { currency: StableFxCurrency; amount: string | null };
  to: { currency: StableFxCurrency; amount: string | null };
  settlementTransactionHash: string | null;
  raw: UnknownRecord;
};

export type StableFxFundingPresign = {
  typedData: StableFxTypedData;
  deliverables: unknown;
  receivables: unknown;
};

export class StableFxError extends Error {
  readonly status: number;
  /**
   * True only when Circle may have accepted a create-trade request but Tower
   * could not safely identify the resulting trade. Such an order must be
   * reconciled, never automatically refunded.
   */
  readonly outcomeUnknown: boolean;

  constructor(
    message: string,
    status: number,
    options?: { outcomeUnknown?: boolean },
  ) {
    super(message);
    this.name = "StableFxError";
    this.status = status;
    this.outcomeUnknown = options?.outcomeUnknown ?? false;
  }
}

function getStableFxApiKey() {
  return process.env.CIRCLE_STABLEFX_API_KEY?.trim() || "";
}

function getCircleWebhookApiKey() {
  return (
    process.env.CIRCLE_STABLEFX_WEBHOOK_API_KEY?.trim() ||
    getStableFxApiKey()
  );
}

function getStableFxApiBaseUrl() {
  const configuredUrl =
    process.env.CIRCLE_STABLEFX_API_BASE_URL?.trim() ||
    DEFAULT_STABLEFX_API_BASE_URL;

  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== "https:") throw new Error("HTTPS required");
    return url.origin;
  } catch {
    throw new StableFxError(
      "StableFX API configuration is invalid. Configure a valid HTTPS base URL.",
      500,
    );
  }
}

function getCircleWebhookApiBaseUrl() {
  const configuredUrl =
    process.env.CIRCLE_STABLEFX_WEBHOOK_API_BASE_URL?.trim() ||
    getStableFxApiBaseUrl();

  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== "https:") throw new Error("HTTPS required");
    return url.origin;
  } catch {
    throw new StableFxError(
      "Circle webhook configuration is invalid. Configure a valid HTTPS API base URL.",
      500,
    );
  }
}

export function isStableFxEnabled() {
  return (
    process.env.CIRCLE_STABLEFX_ENABLED === "true" &&
    Boolean(getStableFxApiKey())
  );
}

/**
 * Backward-compatible configuration guard. These are Tower-owned, Circle
 * approved taker accounts, never customer addresses. Live execution selects
 * one configured address through CIRCLE_STABLEFX_TAKER_ADDRESS.
 */
export function isStableFxTakerWalletAllowed(walletAddress: string) {
  const configuredWallets =
    process.env.CIRCLE_STABLEFX_TAKER_WALLETS?.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean) ?? [];
  return configuredWallets.includes(walletAddress.toLowerCase());
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

// JSON numbers above Number.MAX_SAFE_INTEGER cannot be signed safely after a
// normal JSON.parse round trip. Circle normally serializes large uint values as
// strings; fail closed if an API response uses an unsafe numeric literal.
function assertNoUnsafeNumbers(value: unknown) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new StableFxError(
        "Circle returned an unsafe numeric value in StableFX typed data.",
        502,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertNoUnsafeNumbers);
    return;
  }
  const record = asRecord(value);
  if (record) Object.values(record).forEach(assertNoUnsafeNumbers);
}

function unwrapData(value: unknown): UnknownRecord | null {
  const record = asRecord(value);
  if (!record) return null;
  return asRecord(record.data) ?? record;
}

/**
 * Most StableFX endpoints return their resource at the JSON root. Keep this
 * tolerant of the response envelopes used by Circle's API gateways as well:
 * `{ data: { trade: ... } }` and `{ trade: ... }`. A trade may be accepted
 * correctly by Circle even when a gateway adds one of these envelopes, so do
 * not turn that successful create into a customer refund.
 */
function unwrapTrade(value: unknown): UnknownRecord | null {
  const resource = unwrapData(value);
  if (!resource) return null;
  return asRecord(resource.trade) ?? resource;
}

function unexpectedTradeResponseDetails(value: unknown) {
  const root = asRecord(value);
  const data = asRecord(root?.data);
  const nestedTrade = asRecord(root?.trade) ?? asRecord(data?.trade);
  const resource = unwrapTrade(value);

  // Never log the full API payload. The schema is enough to diagnose an API
  // change and avoids accidentally recording opaque values in server logs.
  return {
    rootKeys: root ? Object.keys(root) : null,
    dataKeys: data ? Object.keys(data) : null,
    tradeKeys: nestedTrade ? Object.keys(nestedTrade) : null,
    resourceKeys: resource ? Object.keys(resource) : null,
    idType: typeof resource?.id,
    contractTradeIdType: typeof resource?.contractTradeId,
    statusType: typeof resource?.status,
  };
}

async function getCircleWebhookPublicKey(keyId: string): Promise<KeyObject> {
  if (!CIRCLE_WEBHOOK_KEY_ID_PATTERN.test(keyId)) {
    throw new StableFxError("Circle webhook signing-key ID is invalid.", 401);
  }

  const cached = webhookPublicKeyCache.get(keyId);
  if (cached) return cached;

  const apiKey = getCircleWebhookApiKey();
  if (!apiKey) {
    throw new StableFxError(
      "Circle webhook verification is not configured. Set CIRCLE_STABLEFX_WEBHOOK_API_KEY or CIRCLE_STABLEFX_API_KEY.",
      503,
    );
  }

  const response = await fetch(
    `${getCircleWebhookApiBaseUrl()}${CIRCLE_NOTIFICATION_PUBLIC_KEY_PATH}/${encodeURIComponent(keyId)}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Request-Id": randomUUID(),
      },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    console.error("Unable to fetch Circle webhook verification key", {
      keyId,
      status: response.status,
      requestId: response.headers.get("x-request-id"),
    });
    throw new StableFxError(
      "Circle webhook signature verification is temporarily unavailable.",
      response.status === 401 || response.status === 403 ? 503 : 502,
    );
  }

  const result = unwrapData((await response.json().catch(() => null)) as unknown);
  if (
    !result ||
    result.algorithm !== "ECDSA_SHA_256" ||
    typeof result.publicKey !== "string" ||
    !result.publicKey
  ) {
    throw new StableFxError("Circle returned an invalid webhook verification key.", 502);
  }

  try {
    const publicKey = createPublicKey({
      key: Buffer.from(result.publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    webhookPublicKeyCache.set(keyId, publicKey);
    return publicKey;
  } catch {
    throw new StableFxError("Circle returned an unusable webhook verification key.", 502);
  }
}

/**
 * Verifies the exact bytes Circle sent. Never JSON.parse before this check:
 * any re-serialization changes the signed payload.
 */
export async function verifyStableFxWebhookSignature(params: {
  rawBody: Uint8Array;
  signature: string;
  keyId: string;
}) {
  const publicKey = await getCircleWebhookPublicKey(params.keyId);
  try {
    return verify(
      "sha256",
      params.rawBody,
      publicKey,
      Buffer.from(params.signature, "base64"),
    );
  } catch {
    return false;
  }
}

function readAmount(
  value: unknown,
  expectedCurrency: StableFxCurrency,
): { currency: StableFxCurrency; amount: string | null } {
  const amount = asRecord(value);
  return {
    currency: expectedCurrency,
    amount:
      typeof amount?.amount === "string" || typeof amount?.amount === "number"
        ? String(amount.amount)
        : null,
  };
}

function readTypedData(value: unknown): StableFxTypedData {
  const typedData = asRecord(value);
  const domain = asRecord(typedData?.domain);
  const types = asRecord(typedData?.types);
  const message = asRecord(typedData?.message);
  if (
    !domain ||
    !types ||
    !message ||
    typeof typedData?.primaryType !== "string" ||
    !typedData.primaryType
  ) {
    throw new StableFxError(
      "Circle returned an invalid StableFX signing payload.",
      502,
    );
  }
  assertNoUnsafeNumbers(typedData);

  const normalizedTypes: StableFxTypedData["types"] = {};
  for (const [typeName, fields] of Object.entries(types)) {
    if (!Array.isArray(fields)) {
      throw new StableFxError("Circle returned invalid StableFX typed-data fields.", 502);
    }
    normalizedTypes[typeName] = fields.map((field) => {
      const fieldRecord = asRecord(field);
      if (
        !fieldRecord ||
        typeof fieldRecord.name !== "string" ||
        typeof fieldRecord.type !== "string"
      ) {
        throw new StableFxError(
          "Circle returned invalid StableFX typed-data fields.",
          502,
        );
      }
      return { name: fieldRecord.name, type: fieldRecord.type };
    });
  }

  return { domain, types: normalizedTypes, primaryType: typedData.primaryType, message };
}

function normalizeQuote(
  value: unknown,
  request: StableFxQuoteRequest,
): StableFxReferenceQuote {
  const quote = unwrapData(value);
  if (!quote) throw new StableFxError("Circle returned an invalid StableFX quote.", 502);

  return {
    id: typeof quote.id === "string" ? quote.id : null,
    rate:
      typeof quote.rate === "string" || typeof quote.rate === "number"
        ? quote.rate
        : null,
    from: readAmount(quote.from, request.fromCurrency),
    to: readAmount(quote.to, request.toCurrency),
    fee: quote.fee ?? null,
    collateral:
      typeof quote.collateral === "string" || typeof quote.collateral === "number"
        ? String(quote.collateral)
        : null,
    expiresAt:
      typeof quote.expiresAt === "string"
        ? quote.expiresAt
        : typeof quote.expiry === "string"
          ? quote.expiry
          : null,
  };
}

function normalizeTrade(
  value: unknown,
  currencies: Pick<StableFxQuoteRequest, "fromCurrency" | "toCurrency">,
): StableFxTrade {
  const trade = unwrapTrade(value);
  if (
    !trade ||
    typeof trade.id !== "string" ||
    !trade.id ||
    typeof trade.status !== "string"
  ) {
    console.error(
      "Circle returned an unexpected successful StableFX trade response",
      unexpectedTradeResponseDetails(value),
    );
    throw new StableFxError(
      "Circle acknowledged the StableFX trade request with an unexpected response. The trade outcome must be reconciled before any refund.",
      502,
      { outcomeUnknown: true },
    );
  }

  return {
    id: trade.id,
    contractTradeId:
      typeof trade.contractTradeId === "string" ||
      typeof trade.contractTradeId === "number"
        ? String(trade.contractTradeId)
        : null,
    status: trade.status,
    quoteId: typeof trade.quoteId === "string" ? trade.quoteId : null,
    from: readAmount(trade.from, currencies.fromCurrency),
    to: readAmount(trade.to, currencies.toCurrency),
    settlementTransactionHash:
      typeof trade.settlementTransactionHash === "string"
        ? trade.settlementTransactionHash
        : null,
    raw: trade,
  };
}

async function getCircleError(response: Response) {
  const payload = (await response.json().catch(() => null)) as unknown;
  const body = asRecord(payload) as StableFxApiErrorBody | null;
  if (typeof body?.message === "string" && body.message.trim()) return body.message;
  return `Circle StableFX request failed with HTTP ${response.status}.`;
}

function getCirclePayloadError(value: unknown) {
  const body = asRecord(value) as StableFxApiErrorBody | null;
  if (
    body &&
    (typeof body.code === "number" || typeof body.code === "string") &&
    typeof body.message === "string" &&
    body.message.trim()
  ) {
    return body.message;
  }
  return null;
}

async function requestStableFx<T>(params: {
  path: string;
  method: "GET" | "POST";
  body?: unknown;
}): Promise<T> {
  if (!isStableFxEnabled()) {
    throw new StableFxError("StableFX is not enabled for this environment.", 503);
  }

  const response = await fetch(`${getStableFxApiBaseUrl()}${params.path}`, {
    method: params.method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${getStableFxApiKey()}`,
      ...(params.body ? { "Content-Type": "application/json" } : {}),
      "X-Request-Id": randomUUID(),
    },
    ...(params.body ? { body: JSON.stringify(params.body) } : {}),
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await getCircleError(response);
    console.error("Circle StableFX request failed", {
      path: params.path,
      status: response.status,
      requestId: response.headers.get("x-request-id"),
      message,
    });
    const status = response.status === 401 || response.status === 403 ? 503 : response.status;
    throw new StableFxError(
      status === 503
        ? "StableFX service authentication is unavailable. Please contact Tower support."
        : response.status >= 500
          ? "Circle StableFX is temporarily unavailable. Please try again."
          : message,
      status,
    );
  }

  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => undefined)) as unknown;
  const message = getCirclePayloadError(payload);
  if (message) {
    console.error("Circle StableFX returned an API error payload", {
      path: params.path,
      status: response.status,
      requestId: response.headers.get("x-request-id"),
      message,
    });
    throw new StableFxError(message, response.status);
  }
  return payload as T;
}

function validateQuoteRequest(request: StableFxQuoteRequest) {
  if (!isStableFxPair(request.fromCurrency, request.toCurrency)) {
    throw new StableFxError("This StableFX currency pair is not enabled.", 400);
  }
  if (!isStableFxAmount(request.amount)) {
    throw new StableFxError(
      "amount must be a positive decimal with no more than 6 decimal places.",
      400,
    );
  }
}

function quoteAmounts(request: StableFxQuoteRequest) {
  const from = { currency: request.fromCurrency } as {
    currency: StableFxCurrency;
    amount?: string;
  };
  const to = { currency: request.toCurrency } as {
    currency: StableFxCurrency;
    amount?: string;
  };
  if (request.amountSide === "from") from.amount = request.amount;
  else to.amount = request.amount;
  return { from, to };
}

/** Safe-to-display, non-executable StableFX quote. */
export async function createStableFxReferenceQuote(
  request: StableFxQuoteRequest,
): Promise<StableFxReferenceQuote> {
  validateQuoteRequest(request);
  const { from, to } = quoteAmounts(request);
  const payload = await requestStableFx<unknown>({
    path: STABLEFX_QUOTES_PATH,
    method: "POST",
    body: { from, to, tenor: STABLEFX_QUOTE_TENOR, type: "reference" },
  });
  return normalizeQuote(payload, request);
}

/** Create the short-lived executable quote only after an exact deposit is verified. */
export async function createStableFxTradableQuote(
  request: StableFxQuoteRequest & { recipientAddress: string },
): Promise<StableFxTradableQuote> {
  validateQuoteRequest(request);
  const { from, to } = quoteAmounts(request);
  const payload = await requestStableFx<unknown>({
    path: STABLEFX_QUOTES_PATH,
    method: "POST",
    body: {
      from,
      to,
      tenor: STABLEFX_QUOTE_TENOR,
      type: "tradable",
      recipientAddress: request.recipientAddress,
    },
  });
  const quote = normalizeQuote(payload, request);
  const raw = unwrapData(payload);
  if (!quote.id || !raw) {
    throw new StableFxError("Circle returned an executable quote without an ID.", 502);
  }
  return { ...quote, typedData: readTypedData(raw.typedData) };
}

export async function createStableFxTrade(params: {
  quoteId: string;
  address: string;
  message: Record<string, unknown>;
  signature: string;
  idempotencyKey: string;
  fromCurrency: StableFxCurrency;
  toCurrency: StableFxCurrency;
}) {
  try {
    const payload = await requestStableFx<unknown>({
      path: STABLEFX_TRADES_PATH,
      method: "POST",
      body: {
        idempotencyKey: params.idempotencyKey,
        quoteId: params.quoteId,
        address: params.address,
        message: params.message,
        signature: params.signature,
      },
    });
    return normalizeTrade(payload, params);
  } catch (error) {
    // A 4xx response is a definite rejection. A transport failure or Circle
    // 5xx can occur after the request reaches Circle, so retain the same
    // idempotency key and reconcile instead of treating the deposit as safely
    // refundable.
    if (
      !(error instanceof StableFxError) ||
      error.outcomeUnknown ||
      error.status >= 500
    ) {
      throw new StableFxError(
        "StableFX trade creation has an unknown outcome and requires reconciliation before any refund.",
        502,
        { outcomeUnknown: true },
      );
    }
    throw error;
  }
}

export async function getStableFxTrade(params: {
  tradeId: string;
  fromCurrency: StableFxCurrency;
  toCurrency: StableFxCurrency;
}) {
  const payload = await requestStableFx<unknown>({
    path: `${STABLEFX_TRADES_PATH}/${encodeURIComponent(params.tradeId)}`,
    method: "GET",
  });
  return normalizeTrade(payload, params);
}

/**
 * Resolve a create-trade request whose HTTP response was lost or malformed.
 * Quote IDs are immutable UUIDs, so an exact match is safe to associate with
 * the order that submitted that quote. This intentionally searches only very
 * recent taker trades: it is a recovery path immediately after submission,
 * not the normal reconciliation mechanism.
 */
export async function findRecentStableFxTradeByQuoteId(params: {
  quoteId: string;
  fromCurrency: StableFxCurrency;
  toCurrency: StableFxCurrency;
}): Promise<StableFxTrade | null> {
  const updatedFrom = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const query = new URLSearchParams({
    type: "taker",
    pageSize: "200",
    updatedFrom,
  });
  const payload = await requestStableFx<unknown>({
    path: `${STABLEFX_TRADES_PATH}?${query.toString()}`,
    method: "GET",
  });
  const root = asRecord(payload);
  const trades = Array.isArray(root?.data) ? root.data : null;
  if (!trades) {
    console.error("Circle returned an invalid StableFX trade-list response", {
      rootKeys: root ? Object.keys(root) : null,
    });
    return null;
  }

  const candidate = trades.find((item) => {
    const trade = asRecord(item);
    return trade?.quoteId === params.quoteId;
  });
  return candidate ? normalizeTrade(candidate, params) : null;
}

export async function createStableFxFundingPresign(params: {
  contractTradeId: string;
}): Promise<StableFxFundingPresign> {
  const payload = await requestStableFx<unknown>({
    path: "/v1/exchange/stablefx/signatures/funding/presign",
    method: "POST",
    body: { contractTradeIds: [params.contractTradeId], type: "taker" },
  });
  const result = unwrapData(payload);
  if (!result) throw new StableFxError("Circle returned invalid StableFX funding data.", 502);
  return {
    typedData: readTypedData(result.typedData),
    deliverables: result.deliverables ?? null,
    receivables: result.receivables ?? null,
  };
}

export async function fundStableFxTrade(params: {
  signature: string;
  permit2: Record<string, unknown>;
}) {
  await requestStableFx<void>({
    path: "/v1/exchange/stablefx/fund",
    method: "POST",
    // The Tower EOA is the Circle-approved taker and owns the source-token
    // funds, so this is direct gross funding. Delegate fields are only for a
    // distinct funder acting on the trader's behalf.
    body: {
      type: "taker",
      fundingMode: "gross",
      signature: params.signature,
      permit2: params.permit2,
    },
  });
}
