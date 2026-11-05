import { createClient } from "@supabase/supabase-js";
// @ts-expect-error Deno Edge Functions resolve npm: specifiers at deploy/runtime.
import { ethers } from "npm:ethers@6.15.0";

type DenoRuntime = {
  env: {
    get: (key: string) => string | undefined;
  };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

type QueryError = {
  message?: string;
};

type QueryResult<T = unknown> = {
  data: T | null;
  error: QueryError | null;
};

type SupabaseTableQuery<T = unknown> = PromiseLike<QueryResult<T>> & {
  select: <TNext = unknown>(columns?: string) => SupabaseTableQuery<TNext>;
  eq: (column: string, value: unknown) => SupabaseTableQuery<T>;
  lte: (column: string, value: unknown) => SupabaseTableQuery<T>;
  order: (
    column: string,
    options?: { ascending?: boolean }
  ) => SupabaseTableQuery<T>;
  limit: (count: number) => SupabaseTableQuery<T>;
  update: (values: Record<string, unknown>) => SupabaseTableQuery<T>;
  insert: (
    values: Record<string, unknown> | Array<Record<string, unknown>>
  ) => SupabaseTableQuery<T>;
  maybeSingle: <TSingle = unknown>() => Promise<QueryResult<TSingle>>;
};

type SupabaseClientInstance = {
  from: (table: string) => SupabaseTableQuery;
};

type ExecutionAmounts = {
  sourceAmountUsd?: number | null;
  targetAmount?: string | null;
  targetAmountUsd?: number | null;
};

const denoRuntime = (globalThis as unknown as { Deno: DenoRuntime }).Deno;

const supabaseUrl = denoRuntime.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = denoRuntime.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const swapBackendUrl =
  denoRuntime.env.get("TOWER_BACKEND_URL") ||
  denoRuntime.env.get("NEXT_PUBLIC_BACKEND_URL") ||
  "https://tower-backend.up.railway.app";
const swapBackendApiKey =
  denoRuntime.env.get("TOWER_BACKEND_API_KEY") ||
  denoRuntime.env.get("BACKEND_API_KEY") ||
  "";
const swapBackendAuthHeader =
  denoRuntime.env.get("TOWER_BACKEND_AUTH_HEADER") || "Authorization";
const swapBackendMaxAttempts = Math.max(
  1,
  Number(denoRuntime.env.get("TOWER_BACKEND_MAX_ATTEMPTS") ?? "3")
);
const swapBackendMaxRetryDelayMs = Math.max(
  1000,
  Number(denoRuntime.env.get("TOWER_BACKEND_MAX_RETRY_DELAY_MS") ?? "15000")
);
const arcRpcUrl =
  denoRuntime.env.get("ARC_TESTNET_RPC_URL") ?? "https://rpc.testnet.arc.network";
const recurringOrderExecutorAddress =
  denoRuntime.env.get("RECURRING_ORDER_EXECUTOR_ADDRESS") ?? "";
const recurringOrderRelayerPrivateKey =
  denoRuntime.env.get("RECURRING_ORDER_RELAYER_PRIVATE_KEY") ?? "";
const minOutputBps = Number(
  denoRuntime.env.get("RECURRING_ORDER_MIN_OUTPUT_BPS") ?? "9900"
);
const maxOrdersPerRun = Math.max(
  1,
  Number(denoRuntime.env.get("RECURRING_ORDER_MAX_ORDERS_PER_RUN") ?? "100")
);
const orderDelayMs = Math.max(
  0,
  Number(denoRuntime.env.get("RECURRING_ORDER_DELAY_MS") ?? "0")
);
const recurringOrderRouteTargets = splitConfiguredAddresses(
  denoRuntime.env.get("RECURRING_ORDER_ROUTE_TARGETS")
);
const recurringOrderApprovalSpenders = splitConfiguredAddresses(
  denoRuntime.env.get("RECURRING_ORDER_APPROVAL_SPENDERS")
);
const recurringOrderDexId = normalizeDexId(
  denoRuntime.env.get("RECURRING_ORDER_DEX_ID") || "xylonet-adapter"
);
const feeCollectorAddress = denoRuntime.env.get("FEE_COLLECTOR_ADDRESS") ?? "";

function recurringOrdersAreDisabled(): boolean {
  // AUDIT NOTE: Hard-disabled while recurring orders are redesigned and
  // re-audited. This must not be made environment-configurable again.
  return true;
}

const tokenDecimalsBySymbol: Record<string, number> = {
  USDC: 6,
  WUSDC: 18,
  QTM: 18,
  EURC: 6,
  USYC: 6,
  USDT: 18,
  cirBTC: 8,
  cNGN: 6,
  QCAD: 6,
  SWPRC: 6,
  SYN: 18,
};

const tokenAddressBySymbol: Record<string, string> = {
  USDC: "0x3600000000000000000000000000000000000000",
  WUSDC: "0xD40fCAa5d2cE963c5dABC2bf59E268489ad7BcE4",
  QTM: "0xCD304d2A421BFEd31d45f0054AF8E8a6a4cF3EaE",
  EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  USYC: "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C",
  USDT: "0x175CdB1D338945f0D851A741ccF787D343E57952",
  cirBTC: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
  cNGN: "0x9a9c18A371d98200FE910f62c45875f1abb68d20",
  QCAD: "0x23d7CFFd0876f3ABb6B074287ba2aeefBc83825d",
  SWPRC: "0xBE7477BF91526FC9988C8f33e91B6db687119D45",
  SYN: "0xC5124C846c6e6307986988dFb7e743327aA05F19",
};

const tokenUsdPriceBySymbol: Record<string, number> = {
  USDC: 1,
  WUSDC: 1,
  EURC: 1.08,
  USYC: 1,
  USDT: 1,
  cirBTC: 404000,
  cNGN: 1,
  QCAD: 0.73,
};

const recurringOrderExecutorAbi = [
  "function executeOrder(bytes32 orderId,uint256 amountIn,uint256 minAmountOut,address routeTarget,address approvalSpender,bytes routeCalldata) returns (uint256 amountOut)",
];
const routeInterface = new ethers.Interface([
  "function swapExactTokensForTokens(uint256 amountIn,uint256 minAmountOut,address[] path,address to,uint256 deadline,address router)",
  "function swapWithSplit(tuple(address[] path,uint256 amountIn,uint256 minAmountOut,address router)[] splits,address tokenOut,uint256 minAmountOut,address to,uint256 deadline)",
  "function swap(address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,address recipient,uint256 deadline)",
]);

function splitConfiguredAddresses(value?: string): string[] {
  return (value || "")
    .split(",")
    .map((address) => address.trim())
    .filter((address) => isHexAddress(address))
    .map((address) => address.toLowerCase());
}

function normalizeDexId(value?: string): string {
  const normalized = String(value || "").toLowerCase();

  if (!normalized) {
    return "";
  }

  if (normalized.includes("xylonet")) {
    return "xylonet-adapter";
  }

  if (normalized.includes("unitflow")) {
    return "unitflow";
  }

  if (normalized.includes("synthra")) {
    return "synthra";
  }

  return normalized;
}

function normalizeHttpUrl(rawUrl: string): string {
  const trimmedUrl = rawUrl.trim().replace(/\/+$/, "");

  if (!trimmedUrl) {
    return "";
  }

  const urlWithProtocol = /^https?:\/\//i.test(trimmedUrl)
    ? trimmedUrl
    : `https://${trimmedUrl}`;

  return new URL(urlWithProtocol).toString().replace(/\/+$/, "");
}

function getSwapBackendUrl(): string {
  const normalizedUrl = normalizeHttpUrl(swapBackendUrl);

  if (/tower-exchange-ai/i.test(normalizedUrl)) {
    throw new Error(
      "TOWER_BACKEND_URL points to the Tower-Exchange-AI service. Recurring orders require the swap backend URL, for example https://tower-backend.up.railway.app."
    );
  }

  return normalizedUrl;
}
function buildBackendHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (!swapBackendApiKey) {
    return headers;
  }

  headers[swapBackendAuthHeader] =
    swapBackendAuthHeader.toLowerCase() === "authorization"
      ? `Bearer ${swapBackendApiKey}`
      : swapBackendApiKey;

  return headers;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getRetryDelayMs(response: Response, attempt: number): Promise<number> {
  const retryAfterHeader = response.headers.get("retry-after");

  if (retryAfterHeader) {
    const retryAfterSeconds = Number(retryAfterHeader);

    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return Math.min(retryAfterSeconds * 1000, swapBackendMaxRetryDelayMs);
    }

    const retryAfterDate = Date.parse(retryAfterHeader);

    if (!Number.isNaN(retryAfterDate)) {
      return Math.min(
        Math.max(retryAfterDate - Date.now(), 1000),
        swapBackendMaxRetryDelayMs
      );
    }
  }

  try {
    const errorText = await response.clone().text();
    const errorBody = JSON.parse(errorText) as { retryAfter?: unknown };
    const retryAfterSeconds = Number(errorBody.retryAfter);

    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return Math.min(retryAfterSeconds * 1000, swapBackendMaxRetryDelayMs);
    }
  } catch {
    // Fall back to exponential delay below.
  }

  return Math.min(1000 * 2 ** (attempt - 1), swapBackendMaxRetryDelayMs);
}

async function fetchSwapBackend(
  url: string,
  init: RequestInit,
  label: string
): Promise<Response> {
  for (let attempt = 1; attempt <= swapBackendMaxAttempts; attempt++) {
    const response = await fetch(url, init);
    const shouldRetry =
      response.status === 429 || response.status === 502 || response.status === 503;

    if (!shouldRetry || attempt === swapBackendMaxAttempts) {
      return response;
    }

    const delayMs = await getRetryDelayMs(response, attempt);
    console.warn(
      `[${label}] Swap backend returned ${response.status}; retrying in ${Math.round(
        delayMs / 1000
      )}s (${attempt}/${swapBackendMaxAttempts})`
    );
    await sleep(delayMs);
  }

  throw new Error("Swap backend request failed before receiving a response.");
}

interface RecurringOrder {
  id: string;
  wallet_address: string;
  order_type: "buy" | "sell";
  source_token: string;
  target_token: string;
  amount: number;
  frequency: string;
  next_execution_date: string;
  end_date?: string | null;
  is_active: boolean;
  execution_count?: number;
  onchain_order_key?: string | null;
  onchain_authorized?: boolean;
}

function hasOrderExpired(order: Pick<RecurringOrder, "end_date">, now = new Date()): boolean {
  return Boolean(order.end_date) && now > new Date(order.end_date as string);
}

async function deactivateExpiredOrders(
  supabase: SupabaseClientInstance,
  nowIso: string
): Promise<number> {
  const { data, error } = await supabase
    .from("recurring_orders")
    .update({ is_active: false })
    .eq("is_active", true)
    .lte("end_date", nowIso)
    .select<{ id: string }[]>("id");

  if (error) {
    console.error("[Expiration] Failed to deactivate expired orders:", error);
    return 0;
  }

  return data?.length ?? 0;
}

/**
 * Main handler for executing recurring orders
 */
denoRuntime.serve(async (req: Request) => {
  try {
    if (recurringOrdersAreDisabled()) {
      console.warn(`[${new Date().toISOString()}] Recurring orders are paused by RECURRING_ORDERS_DISABLED`);
      return new Response(
        JSON.stringify({
          message: "Recurring orders are temporarily disabled",
          processed: 0,
          disabled: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Log the incoming request for debugging
    console.log(`[${new Date().toISOString()}] Received request:`, {
      method: req.method,
      url: req.url,
      swapBackendHost: new URL(getSwapBackendUrl()).host,
      swapBackendAuthHeader: swapBackendApiKey ? swapBackendAuthHeader : "none",
      headers: {
        authorization: req.headers.get("authorization") ? "present" : "missing",
        contentType: req.headers.get("content-type"),
      },
    });

    // Verify the request is from Supabase cron or authorized source
    // Accept requests with valid Bearer token OR from Supabase cron without strict validation
    const authHeader = req.headers.get("authorization");
    
    // For cron jobs, we need to be lenient as the auth header format may vary
    // Check if this is a valid request from cron or has proper authorization
    const isAuthorized = 
      !authHeader || // Allow requests without header (for cron compatibility)
      authHeader.startsWith("Bearer "); // Or with Bearer token
    
    if (!isAuthorized) {
      console.error("Invalid authorization header format");
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid token format" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      supabaseUrl,
      supabaseServiceKey
    ) as unknown as SupabaseClientInstance;

    // Get all active recurring orders that are due for execution
    const now = new Date().toISOString();
    console.log(`[${new Date().toISOString()}] Querying orders due before:`, now);

    const expiredOrdersDeactivated = await deactivateExpiredOrders(supabase, now);
    if (expiredOrdersDeactivated > 0) {
      console.log(`[${new Date().toISOString()}] Deactivated expired recurring orders:`, expiredOrdersDeactivated);
    }
    
    const { data: ordersToExecute, error: fetchError } = await supabase
      .from("recurring_orders")
      .select<RecurringOrder[]>("*")
      .eq("is_active", true)
      .eq("onchain_authorized", true)
      .lte("next_execution_date", now)
      .order("next_execution_date", { ascending: true })
      .limit(maxOrdersPerRun);

    if (fetchError) {
      console.error(`[${new Date().toISOString()}] Error fetching recurring orders:`, fetchError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch orders", details: fetchError }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!ordersToExecute || ordersToExecute.length === 0) {
      console.log(`[${new Date().toISOString()}] No orders to execute`);
      return new Response(
        JSON.stringify({ message: "No orders to execute", processed: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`[${new Date().toISOString()}] Processing ${ordersToExecute.length} recurring orders`, {
      maxOrdersPerRun,
      orderDelayMs,
    });

    // Execute each order and track results
    const results = [];
    let claimedCount = 0;
    let successCount = 0;
    let failureCount = 0;

    for (const order of ordersToExecute) {
      try {
        if (hasOrderExpired(order)) {
          console.log(`[${new Date().toISOString()}] Skipping expired order and deactivating:`, order.id);
          await supabase
            .from("recurring_orders")
            .update({ is_active: false })
            .eq("id", order.id)
            .eq("is_active", true);
          continue;
        }

        const claimed = await claimOrderForExecution(supabase, order);

        if (!claimed) {
          console.log(`[${new Date().toISOString()}] Skipping order already claimed or no longer due:`, order.id);
          continue;
        }

        claimedCount++;
        console.log(`[${new Date().toISOString()}] Executing order:`, {
          id: order.id,
          wallet: order.wallet_address?.substring(0, 6) + "...",
          swap: `${order.source_token} → ${order.target_token}`,
          amount: order.amount,
        });

        const executionResult = await executeOrder(supabase, order);
        results.push(executionResult);

        if (executionResult.status === "Successful") {
          successCount++;
          console.log(`[${new Date().toISOString()}] ✅ Order ${order.id} executed successfully`);
        } else {
          failureCount++;
          console.warn(`[${new Date().toISOString()}] ❌ Order ${order.id} failed:`, executionResult.error);
        }
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Error executing order ${order.id}:`, error);
        failureCount++;

        // Log failed execution
        await logOrderExecution(
          supabase,
          order,
          "Failed",
          undefined,
          String(error),
          buildExecutionAmounts(order)
        );
      }

      if (orderDelayMs > 0) {
        await sleep(orderDelayMs);
      }
    }

    const summary = {
      message: "Execution batch completed",
      timestamp: new Date().toISOString(),
      processed: ordersToExecute.length,
      claimed: claimedCount,
      successful: successCount,
      failed: failureCount,
      results,
    };

    console.log(`[${new Date().toISOString()}] Batch summary:`, summary);

    return new Response(
      JSON.stringify(summary),
      {
        status: failureCount > 0 && successCount === 0 ? 500 : 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Unexpected error in execute-recurring-orders:`, error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

/**
 * Execute a single recurring order
 */
async function executeOrder(
  supabase: SupabaseClientInstance,
  order: RecurringOrder
): Promise<{ orderId: string; status: string; transactionHash?: string; error?: string }> {
  let executionAmounts: ExecutionAmounts = buildExecutionAmounts(order);

  try {
    console.log(`Executing order ${order.id}: ${order.source_token} -> ${order.target_token}`);

    // Get the same backend-selected route used by normal swaps.
    const quoteResult = await getSwapQuote(order);
    if (!quoteResult.success) {
      throw new Error(`Failed to get quote: ${quoteResult.error}`);
    }

    executionAmounts = buildExecutionAmounts(order, quoteResult.data);

    const txResult = await executeOrderOnchain(order, quoteResult.data);

    if (!txResult.success) {
      throw new Error(`Failed to execute on-chain order: ${txResult.error}`);
    }

    // Log successful execution
    await logOrderExecution(
      supabase,
      order,
      "Successful",
      txResult.transactionHash,
      undefined,
      executionAmounts
    );

    // Update next execution date
    const nextDate = calculateNextExecutionDate(order.frequency, order.next_execution_date);
    const currentCount = order.execution_count ?? 0;
    const shouldDeactivate =
      Boolean(order.end_date) && new Date(nextDate) > new Date(order.end_date as string);
    await supabase
      .from("recurring_orders")
      .update({
        next_execution_date: nextDate,
        execution_count: currentCount + 1,
        execution_transaction_hash: txResult.transactionHash,
        is_active: !shouldDeactivate,
      })
      .eq("id", order.id);

    return {
      orderId: order.id,
      status: "Successful",
      transactionHash: txResult.transactionHash,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await logOrderExecution(
      supabase,
      order,
      "Failed",
      undefined,
      errorMsg,
      executionAmounts
    );
    await releaseFailedOrder(supabase, order);
    return {
      orderId: order.id,
      status: "Failed",
      error: errorMsg,
    };
  }
}

async function claimOrderForExecution(
  supabase: SupabaseClientInstance,
  order: RecurringOrder
): Promise<boolean> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("recurring_orders")
    .update({ next_execution_date: calculateRetryExecutionDate() })
    .eq("id", order.id)
    .eq("is_active", true)
    .lte("next_execution_date", now)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    console.error(`[Claim Error] Unable to claim order ${order.id}:`, error);
    return false;
  }

  return Boolean(data?.id);
}

async function releaseFailedOrder(
  supabase: SupabaseClientInstance,
  order: RecurringOrder
): Promise<void> {
  if (hasOrderExpired(order)) {
    await supabase
      .from("recurring_orders")
      .update({ is_active: false })
      .eq("id", order.id)
      .eq("is_active", true);
    return;
  }

  const nextRetryDate = calculateRetryExecutionDate();

  await supabase
    .from("recurring_orders")
    .update({ next_execution_date: nextRetryDate })
    .eq("id", order.id)
    .eq("is_active", true);
}

/**
 * Get swap quote from the backend route optimizer.
 */
async function getSwapQuote(
  order: RecurringOrder
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  try {
    const sourceDecimals = tokenDecimalsBySymbol[order.source_token];
    const sourceAddress = tokenAddressBySymbol[order.source_token];
    const targetAddress = tokenAddressBySymbol[order.target_token];

    if (sourceDecimals == null || !sourceAddress || !targetAddress) {
      return {
        success: false,
        error: `Unsupported token pair for recurring execution: ${order.source_token}/${order.target_token}`,
      };
    }

    const amountIn = ethers.parseUnits(order.amount.toString(), sourceDecimals).toString();
    console.log("[Quote] Requesting backend route quote:", {
      sourceToken: order.source_token,
      targetToken: order.target_token,
      sourceAddress,
      targetAddress,
      amountIn,
      dexId: recurringOrderDexId,
    });

    const backendUrl = getSwapBackendUrl();
    const quoteResponse = await fetchSwapBackend(
      `${backendUrl}/api/swap/quote`,
      {
        method: "POST",
        headers: buildBackendHeaders(),
        body: JSON.stringify({
          inputToken: sourceAddress,
          outputToken: targetAddress,
          inputAmount: amountIn,
          slippageTolerance: 10000 - Math.min(Math.max(minOutputBps, 1), 10000),
          dexId: recurringOrderDexId,
        }),
      },
      "Quote"
    );

    if (!quoteResponse.ok) {
      const errorText = await quoteResponse.text();
      return {
        success: false,
        error: `Swap backend returned status ${quoteResponse.status}: ${errorText}`,
      };
    }

    const quoteData = await quoteResponse.json();
    const quote = unwrapData(quoteData);

    if (!quote) {
      return {
        success: false,
        error: "No quote data in route optimizer response",
      };
    }

    const quoteDexId = extractQuoteDexId(quote);
    const requestedDexId = normalizeDexId(recurringOrderDexId);

    if (quoteDexId && requestedDexId && quoteDexId !== requestedDexId) {
      return {
        success: false,
        error: `Recurring orders require a ${requestedDexId} route, but the route optimizer returned ${quoteDexId}.`,
      };
    }

    return { success: true, data: quote };
  } catch (error) {
    console.error("[Quote Error]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute the recurring order through the allowance-based executor contract.
 */
async function executeOrderOnchain(
  order: RecurringOrder,
  quoteData: unknown
): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
  try {
    if (!recurringOrderExecutorAddress || !recurringOrderRelayerPrivateKey) {
      return {
        success: false,
        error:
          "RECURRING_ORDER_EXECUTOR_ADDRESS or RECURRING_ORDER_RELAYER_PRIVATE_KEY is not configured.",
      };
    }

    const sourceDecimals = tokenDecimalsBySymbol[order.source_token];
    if (sourceDecimals == null) {
      return {
        success: false,
        error: `Unsupported source token for recurring execution: ${order.source_token}`,
      };
    }

    const orderKey =
      order.onchain_order_key || ethers.keccak256(ethers.toUtf8Bytes(order.id));
    const amountIn = ethers.parseUnits(order.amount.toString(), sourceDecimals);
    const route = await buildRecurringRoute(order, quoteData);

    if (!route.success || !route.swap) {
      return {
        success: false,
        error: route.error || "Backend did not return a swap route.",
      };
    }

    const approvalSpender =
      route.approvalSpender || route.swap.to;
    const routeValidationError = validateRecurringRoute({
      routeTarget: route.swap.to,
      approvalSpender,
      routeCalldata: route.swap.data,
      recipient: order.wallet_address,
      amountIn,
      sourceAddress: tokenAddressBySymbol[order.source_token],
      targetAddress: tokenAddressBySymbol[order.target_token],
    });

    if (routeValidationError) {
      return {
        success: false,
        error: routeValidationError,
      };
    }

    const routeMinAmountOut = extractRouteMinAmountOut(route.swap.data, {
      amountIn,
      sourceAddress: tokenAddressBySymbol[order.source_token],
      targetAddress: tokenAddressBySymbol[order.target_token],
    });
    const expectedAmountOut = extractQuoteAmountOut(
      quoteData,
      tokenDecimalsBySymbol[order.target_token]
    );
    const boundedMinOutputBps = BigInt(Math.min(Math.max(minOutputBps, 1), 10000));
    const minAmountOut =
      routeMinAmountOut ??
      (expectedAmountOut > 0n ? (expectedAmountOut * boundedMinOutputBps) / 10000n : 1n);

    console.log("[Executor] Sending recurring order transaction:", {
      orderId: order.id,
      orderKey,
      amountIn: amountIn.toString(),
      minAmountOut: minAmountOut.toString(),
      routeMinAmountOut: routeMinAmountOut?.toString() ?? null,
      quoteExpectedAmountOut: expectedAmountOut.toString(),
      executor: recurringOrderExecutorAddress,
      routeTarget: route.swap.to,
      approvalSpender,
      routeRecipient: extractRouteRecipient(route.swap.data),
    });

    const provider = new ethers.JsonRpcProvider(arcRpcUrl);
    const wallet = new ethers.Wallet(recurringOrderRelayerPrivateKey, provider);
    const executor = new ethers.Contract(
      recurringOrderExecutorAddress,
      recurringOrderExecutorAbi,
      wallet
    );

    const tx = await executor.executeOrder(
      orderKey,
      amountIn,
      minAmountOut,
      route.swap.to,
      approvalSpender,
      route.swap.data
    );
    const receipt = await tx.wait();

    return {
      success: receipt?.status === 1,
      transactionHash: tx.hash,
      error: receipt?.status === 1 ? undefined : "Executor transaction reverted.",
    };
  } catch (error) {
    console.error("[Executor Error]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

type BuiltSwapTransaction = {
  to: string;
  data: string;
  value?: string;
  gasLimit?: string | number;
};

type BuiltApprovalTransaction = {
  to?: string;
  data?: string;
  spender?: string;
  approvalAddress?: string;
};

async function buildRecurringRoute(
  order: RecurringOrder,
  quoteData: unknown
): Promise<{
  success: boolean;
  swap?: BuiltSwapTransaction;
  approvalSpender?: string;
  error?: string;
}> {
  try {
    const backendUrl = getSwapBackendUrl();
    const response = await fetchSwapBackend(
      `${backendUrl}/api/swap/build-tx`,
      {
        method: "POST",
        headers: buildBackendHeaders(),
        body: JSON.stringify({
          quote: quoteData,
          userAddress: recurringOrderExecutorAddress,
          recipient: order.wallet_address,
          executionMode: "recurring_order_executor",
        }),
      },
      "Build Route"
    );

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Transaction builder returned status ${response.status}: ${errorText}`,
      };
    }

    const buildData = unwrapData(await response.json()) as Record<string, unknown>;
    const swap = (buildData.swap || buildData) as BuiltSwapTransaction;
    const approval = (buildData.approval || buildData.approvalTx || null) as
      | BuiltApprovalTransaction
      | null;

    if (!isHexAddress(swap?.to) || !isHexData(swap?.data)) {
      return {
        success: false,
        error: "Transaction builder response did not include a valid swap target/data.",
      };
    }

    if (swap.value && BigInt(normalizeHexQuantity(swap.value)) > 0n) {
      return {
        success: false,
        error: "Recurring order executor only supports ERC20 routes with zero native value.",
      };
    }

    const approvalSpender =
      firstValidAddress([
        approval?.spender,
        approval?.approvalAddress,
        extractApprovalSpender(approval?.data),
        extractApprovalSpender((buildData as { approvalData?: string }).approvalData),
        (buildData as { approvalAddress?: string }).approvalAddress,
      ]) || swap.to;

    return {
      success: true,
      swap,
      approvalSpender,
    };
  } catch (error) {
    console.error("[Build Route Error]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function unwrapData(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  return record.data ?? value;
}

function isHexAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isHexData(value: unknown): value is string {
  return typeof value === "string" && /^0x([a-fA-F0-9]{2})*$/.test(value);
}

function firstValidAddress(values: unknown[]): string | null {
  for (const value of values) {
    if (isHexAddress(value)) {
      return value;
    }
  }

  return null;
}

function extractQuoteDexId(quoteData: unknown): string | null {
  if (!quoteData || typeof quoteData !== "object") {
    return null;
  }

  const quote = quoteData as Record<string, unknown>;
  const route = quote.route as Record<string, unknown> | undefined;
  const hops = Array.isArray(route?.hops) ? route.hops : [];
  const firstHop = hops[0] as Record<string, unknown> | undefined;
  const dexId =
    firstHop?.dexId ||
    firstHop?.dex ||
    firstHop?.dexName ||
    (quote as { dexId?: unknown }).dexId;

  return typeof dexId === "string" ? normalizeDexId(dexId) || null : null;
}

function normalizeHexQuantity(value: string): string {
  if (value.startsWith("0x")) {
    return value;
  }

  return `0x${BigInt(value).toString(16)}`;
}

function extractApprovalSpender(data?: string): string | null {
  if (!data || !data.startsWith("0x095ea7b3") || data.length < 74) {
    return null;
  }

  const spender = `0x${data.slice(34, 74)}`;
  return isHexAddress(spender) ? spender : null;
}

function isConfiguredAddressAllowed(
  configuredAddresses: string[],
  address: string
): boolean {
  return configuredAddresses.length === 0 || configuredAddresses.includes(address.toLowerCase());
}

function extractRouteRecipient(routeCalldata: string): string | null {
  const xyloRecipient = extractXyloRouteRecipient(routeCalldata);

  if (xyloRecipient) {
    return xyloRecipient;
  }

  try {
    const parsed = routeInterface.parseTransaction({ data: routeCalldata });

    if (!parsed) {
      return null;
    }

    if (parsed.name === "swapExactTokensForTokens") {
      return parsed.args.to as string;
    }

    if (parsed.name === "swapWithSplit") {
      return parsed.args.to as string;
    }

    if (parsed.name === "swap") {
      return parsed.args.recipient as string;
    }
  } catch {
    // Fall through to selector-agnostic layouts below.
  }

  return readCalldataAddress(routeCalldata, 4);
}

function isLikelyXyloRoute(routeCalldata: string): boolean {
  return (
    sameAddress(readCalldataAddress(routeCalldata, 0), tokenAddressBySymbol.USDC) ||
    sameAddress(readCalldataAddress(routeCalldata, 0), tokenAddressBySymbol.EURC) ||
    sameAddress(readCalldataAddress(routeCalldata, 0), tokenAddressBySymbol.USYC) ||
    sameAddress(readCalldataAddress(routeCalldata, 0), tokenAddressBySymbol.WUSDC)
  );
}

function extractXyloRouteRecipient(routeCalldata: string): string | null {
  if (!isLikelyXyloRoute(routeCalldata)) {
    return null;
  }

  return readCalldataAddress(routeCalldata, 4);
}

function extractXyloRouteMinAmountOut(
  routeCalldata: string,
  context: {
    amountIn: bigint;
    sourceAddress?: string;
    targetAddress?: string;
  }
): bigint | null {
  const tokenIn = readCalldataAddress(routeCalldata, 0);
  const tokenOut = readCalldataAddress(routeCalldata, 1);
  const amountIn = readCalldataWord(routeCalldata, 2);
  const minAmountOut = readCalldataWord(routeCalldata, 3);

  if (
    sameAddress(tokenIn, context.sourceAddress) &&
    sameAddress(tokenOut, context.targetAddress) &&
    amountIn === context.amountIn &&
    minAmountOut != null &&
    minAmountOut > 0n
  ) {
    return minAmountOut;
  }

  return null;
}

function validateRecurringRoute(input: {
  routeTarget: string;
  approvalSpender: string;
  routeCalldata: string;
  recipient: string;
  amountIn: bigint;
  sourceAddress?: string;
  targetAddress?: string;
}): string | null {
  if (!isConfiguredAddressAllowed(recurringOrderRouteTargets, input.routeTarget)) {
    return `Recurring route target ${input.routeTarget} is not in RECURRING_ORDER_ROUTE_TARGETS. Configure this to the XyloNet router/adapter address, not TowerRouter.`;
  }

  if (!isConfiguredAddressAllowed(recurringOrderApprovalSpenders, input.approvalSpender)) {
    return `Recurring approval spender ${input.approvalSpender} is not in RECURRING_ORDER_APPROVAL_SPENDERS. Configure this to the token spender used by XyloNet.`;
  }

  if (feeCollectorAddress && sameAddress(input.routeTarget, feeCollectorAddress)) {
    return "Recurring route target resolved to FeeCollector. The route target must be XyloNet/XyloNetAdapter; FeeCollector can only be the output recipient in a fee-aware executor flow.";
  }

  const routeRecipient = extractRouteRecipient(input.routeCalldata);

  if (routeRecipient && feeCollectorAddress && sameAddress(routeRecipient, feeCollectorAddress)) {
    return "Backend built a browser-style route that sends output to FeeCollector. Current RecurringOrderExecutor requires output to reach the user inside executeOrder. Use a direct user-recipient recurring route or deploy a fee-aware executor.";
  }

  if (routeRecipient && !sameAddress(routeRecipient, input.recipient)) {
    return `Backend built recurring route for recipient ${routeRecipient}, but order recipient is ${input.recipient}.`;
  }

  const inferredMinimum =
    extractXyloRouteMinAmountOut(input.routeCalldata, {
      amountIn: input.amountIn,
      sourceAddress: input.sourceAddress,
      targetAddress: input.targetAddress,
    }) ??
    inferRouteMinAmountOut(input.routeCalldata, {
      amountIn: input.amountIn,
      sourceAddress: input.sourceAddress,
      targetAddress: input.targetAddress,
    });

  if (!inferredMinimum) {
    return "Unable to validate recurring route calldata as a XyloNet-compatible route. Refusing to execute ambiguous route.";
  }

  return null;
}

function extractRouteMinAmountOut(
  routeCalldata: string,
  context: {
    amountIn: bigint;
    sourceAddress?: string;
    targetAddress?: string;
  }
): bigint | null {
  const xyloMinAmountOut = extractXyloRouteMinAmountOut(routeCalldata, context);

  if (xyloMinAmountOut != null) {
    console.log("[Route Decode] Extracted XyloNet route minimum output:", {
      routeMinAmountOut: xyloMinAmountOut.toString(),
    });
    return xyloMinAmountOut;
  }

  try {
    const parsed = routeInterface.parseTransaction({ data: routeCalldata });

    if (!parsed) {
      return null;
    }

    if (parsed.name === "swapExactTokensForTokens") {
      return BigInt(parsed.args.minAmountOut.toString());
    }

    if (parsed.name === "swapWithSplit") {
      return BigInt(parsed.args.minAmountOut.toString());
    }

    if (parsed.name === "swap") {
      return BigInt(parsed.args.minAmountOut.toString());
    }
  } catch (error) {
    console.warn("[Route Decode] Unable to decode route minimum output:", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return inferRouteMinAmountOut(routeCalldata, context);
}

function readCalldataWord(routeCalldata: string, wordIndex: number): bigint | null {
  const data = routeCalldata.startsWith("0x") ? routeCalldata.slice(2) : routeCalldata;
  const start = 8 + wordIndex * 64;
  const word = data.slice(start, start + 64);

  if (word.length !== 64 || !/^[a-fA-F0-9]+$/.test(word)) {
    return null;
  }

  return BigInt(`0x${word}`);
}

function readCalldataAddress(routeCalldata: string, wordIndex: number): string | null {
  const word = readCalldataWord(routeCalldata, wordIndex);

  if (word == null || word > BigInt("0xffffffffffffffffffffffffffffffffffffffff")) {
    return null;
  }

  return ethers.getAddress(`0x${word.toString(16).padStart(40, "0")}`);
}

function sameAddress(left?: string | null, right?: string | null): boolean {
  if (!left || !right || !isHexAddress(left) || !isHexAddress(right)) {
    return false;
  }

  return left.toLowerCase() === right.toLowerCase();
}

function inferRouteMinAmountOut(
  routeCalldata: string,
  context: {
    amountIn: bigint;
    sourceAddress?: string;
    targetAddress?: string;
  }
): bigint | null {
  const word0Address = readCalldataAddress(routeCalldata, 0);
  const word1Address = readCalldataAddress(routeCalldata, 1);
  const word2 = readCalldataWord(routeCalldata, 2);
  const word3 = readCalldataWord(routeCalldata, 3);

  if (
    sameAddress(word0Address, context.sourceAddress) &&
    sameAddress(word1Address, context.targetAddress) &&
    word2 === context.amountIn &&
    word3 != null &&
    word3 > 0n
  ) {
    console.log("[Route Decode] Inferred route minimum from token-token-amount-min layout:", {
      routeMinAmountOut: word3.toString(),
    });
    return word3;
  }

  const word0 = readCalldataWord(routeCalldata, 0);
  const word1 = readCalldataWord(routeCalldata, 1);

  if (word0 === context.amountIn && word1 != null && word1 > 0n) {
    console.log("[Route Decode] Inferred route minimum from amount-min layout:", {
      routeMinAmountOut: word1.toString(),
    });
    return word1;
  }

  return null;
}

function convertNormalizedAmountToNative(
  value: bigint,
  outputDecimals?: number
): bigint {
  if (outputDecimals == null || outputDecimals >= 18 || value <= 0n) {
    return value;
  }

  const scale = 10n ** BigInt(18 - outputDecimals);
  return value / scale;
}

function parseQuoteAmountCandidate(value: unknown): bigint | null {
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return BigInt(Math.floor(value));
  }

  return null;
}

function collectQuoteAmountCandidates(
  value: unknown,
  candidates: Array<{ key: string; value: unknown }> = []
): Array<{ key: string; value: unknown }> {
  if (!value || typeof value !== "object") {
    return candidates;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectQuoteAmountCandidates(item, candidates);
    }
    return candidates;
  }

  const record = value as Record<string, unknown>;

  for (const [key, nestedValue] of Object.entries(record)) {
    if (
      [
        "outputAmountNative",
        "minOutNative",
        "minimumReceivedNative",
        "toAmountNative",
        "outputAmount",
        "minOut",
        "amountOut",
        "minimumReceived",
        "toAmount",
      ].includes(key)
    ) {
      candidates.push({ key, value: nestedValue });
    }

    collectQuoteAmountCandidates(nestedValue, candidates);
  }

  return candidates;
}

function extractQuoteAmountOut(
  quoteData: unknown,
  outputDecimals?: number
): bigint {
  const candidates = collectQuoteAmountCandidates(quoteData);

  const findCandidate = (keys: string[]) => {
    for (const key of keys) {
      const match = candidates.find((candidate) => candidate.key === key);
      if (!match) {
        continue;
      }

      const parsed = parseQuoteAmountCandidate(match.value);
      if (parsed != null) {
        return parsed;
      }
    }

    return null;
  };

  const nativeAmount = findCandidate([
    "outputAmountNative",
    "minOutNative",
    "minimumReceivedNative",
    "toAmountNative",
  ]);

  if (nativeAmount != null) {
    return nativeAmount;
  }

  const normalizedAmount = findCandidate(["outputAmount", "minOut"]);
  if (normalizedAmount != null) {
    return convertNormalizedAmountToNative(normalizedAmount, outputDecimals);
  }

  const nativeFallback = findCandidate(["amountOut", "minimumReceived", "toAmount"]);
  if (nativeFallback != null) {
    return nativeFallback;
  }

  return 0n;
}

function roundUsdAmount(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

function buildExecutionAmounts(
  order: RecurringOrder,
  quoteData?: unknown
): ExecutionAmounts {
  const sourceTokenUsdPrice = tokenUsdPriceBySymbol[order.source_token];
  const targetTokenUsdPrice = tokenUsdPriceBySymbol[order.target_token];
  const targetDecimals = tokenDecimalsBySymbol[order.target_token];
  const quotedTargetAmountRaw =
    quoteData && targetDecimals != null
      ? extractQuoteAmountOut(quoteData, targetDecimals)
      : 0n;
  const targetAmount =
    quotedTargetAmountRaw > 0n && targetDecimals != null
      ? ethers.formatUnits(quotedTargetAmountRaw, targetDecimals)
      : null;
  const parsedTargetAmount =
    targetAmount == null ? null : Number.parseFloat(targetAmount);

  return {
    sourceAmountUsd:
      sourceTokenUsdPrice == null
        ? null
        : roundUsdAmount(order.amount * sourceTokenUsdPrice),
    targetAmount,
    targetAmountUsd:
      targetTokenUsdPrice == null ||
      parsedTargetAmount == null ||
      !Number.isFinite(parsedTargetAmount)
        ? null
        : roundUsdAmount(parsedTargetAmount * targetTokenUsdPrice),
  };
}

/**
 * Log order execution in database
 */
async function logOrderExecution(
  supabase: SupabaseClientInstance,
  order: RecurringOrder,
  status: "Successful" | "Failed" | "Pending",
  transactionHash?: string,
  errorMessage?: string,
  executionAmounts: ExecutionAmounts = {}
): Promise<void> {
  try {
    const { error } = await supabase.from("recurring_order_executions").insert({
      recurring_order_id: order.id,
      wallet_address: order.wallet_address,
      amount: order.amount,
      source_amount_usd: executionAmounts.sourceAmountUsd ?? null,
      target_amount: executionAmounts.targetAmount ?? null,
      target_amount_usd: executionAmounts.targetAmountUsd ?? null,
      source_token: order.source_token,
      target_token: order.target_token,
      status,
      transaction_hash: transactionHash || null,
      error_message: errorMessage || null,
      execution_date: new Date().toISOString(),
    });

    if (error) {
      console.error("Error logging execution:", error);
    }
  } catch (error) {
    console.error("Error logging execution:", error);
    // Don't throw, as this is secondary to the actual execution
  }
}

/**
 * Calculate next execution date based on frequency
 */
function calculateNextExecutionDate(frequency: string, fromDate?: string | null): string {
  const now = new Date();
  const next = fromDate ? new Date(fromDate) : new Date(now);

  if (Number.isNaN(next.getTime())) {
    next.setTime(now.getTime());
  }

  const advanceOneInterval = () => {
    switch (frequency.toLowerCase()) {
      case "hourly":
        next.setMinutes(0, 0, 0);
        next.setHours(next.getHours() + 1);
        break;
      case "daily":
        next.setSeconds(0, 0);
        next.setDate(next.getDate() + 1);
        break;
      case "weekly":
        next.setSeconds(0, 0);
        next.setDate(next.getDate() + 7);
        break;
      case "bi-weekly":
        next.setSeconds(0, 0);
        next.setDate(next.getDate() + 14);
        break;
      case "monthly":
      case "month":
        next.setSeconds(0, 0);
        next.setMonth(next.getMonth() + 1);
        break;
      default:
        next.setSeconds(0, 0);
        next.setDate(next.getDate() + 7);
    }
  };

  // Preserve the user's original cadence. If an order runs late, keep
  // advancing from its scheduled execution time until the next slot is in
  // the future instead of drifting the schedule to "now + interval".
  do {
    advanceOneInterval();
  } while (next <= now);

  return next.toISOString();
}

function calculateRetryExecutionDate(): string {
  const retryDate = new Date();
  retryDate.setMinutes(retryDate.getMinutes() + 15);
  return retryDate.toISOString();
}
