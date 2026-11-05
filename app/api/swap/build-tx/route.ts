import { NextRequest, NextResponse } from "next/server";
import { resolveSwapBackendUrl } from "@/lib/resolveSwapBackendUrl";
import {
  buildTowerDexSwapTransaction,
  isTowerDexQuote,
} from "@/lib/towerDex";
import {
  buildAeroSwapTransaction,
  isAeroQuote,
} from "@/lib/aeroDex";
import {
  buildDzapSwapTransaction,
  isDzapQuote,
} from "@/lib/dzapDex";
import {
  buildKyberSwapTransaction,
  isKyberQuote,
} from "@/lib/kyberDex";
import {
  buildUniswapSwapTransaction,
  isUniswapQuote,
} from "@/lib/uniswapDex";
import { withFrontendOriginGate } from "@/lib/server/frontendRequestGuard";
import { isPositiveDecimalAmount } from "@/lib/positiveAmount";
import {
  SWAP_API_ERROR_CODES,
  boundBuildTxApprovals,
  getExpiredQuoteError,
  resolveSlippageBps,
} from "@/lib/swapApiContract";
import { handleSwapQuotePost } from "@/app/api/swap/quote/route";

const BACKEND_URL = resolveSwapBackendUrl();
const SWAPS_DISABLED = process.env.SWAPS_DISABLED !== "false";
const SWAPS_DISABLED_RESPONSE = {
  error: "Swaps are temporarily disabled",
  details:
    "Tower swaps are paused while the TowerSwapExecutor migration is being verified.",
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const getQuoteDexId = (quote: Record<string, unknown>) => {
  const route = asRecord(quote.route);
  const hops = Array.isArray(route?.hops) ? route.hops : [];
  const hop = asRecord(hops[0]);
  return (
    asString(hop?.dexId) ||
    asString(hop?.dex) ||
    asString(hop?.dexName) ||
    asString(quote.dexId)
  );
};

const getQuoteInputAmount = (quote: Record<string, unknown>) =>
  asString(quote.inputAmountNative) ||
  asString(quote.inputAmountRaw) ||
  asString(quote.inputAmount);

const refreshSwapQuote = async (
  request: NextRequest,
  quote: Record<string, unknown>,
  requestedSlippage: unknown,
): Promise<
  | { ok: true; quote: Record<string, unknown> }
  | { ok: false; error: NextResponse }
> => {
  const inputToken = asString(quote.inputToken);
  const outputToken = asString(quote.outputToken);
  const inputAmount = getQuoteInputAmount(quote);
  if (!inputToken || !outputToken || !inputAmount) {
    return {
      ok: false,
      error: NextResponse.json(
        {
          success: false,
          error: "Quote is missing inputToken, outputToken, or inputAmount",
          code: SWAP_API_ERROR_CODES.INVALID_REQUEST,
        },
        { status: 400 },
      ),
    };
  }

  if (!isPositiveDecimalAmount(inputAmount)) {
    return {
      ok: false,
      error: NextResponse.json(
        {
          success: false,
          error: "Quote inputAmount must be a positive number",
          code: SWAP_API_ERROR_CODES.INVALID_REQUEST,
        },
        { status: 400 },
      ),
    };
  }

  const quoteUrl = new URL("/api/swap/quote", request.url);
  const quoteResponse = await handleSwapQuotePost(
    new NextRequest(quoteUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputToken,
        outputToken,
        inputAmount,
        slippageTolerance: resolveSlippageBps(
          requestedSlippage ?? quote.slippage,
        ),
        dexId: getQuoteDexId(quote),
        chainId: isAeroQuote(quote)
          ? 5042
          : isDzapQuote(quote)
            ? quote.dzap.fromChain
            : isKyberQuote(quote)
                ? quote.kyber.fromChain
              : (typeof quote.chainId === "number" && quote.chainId > 0 ? quote.chainId : 5042),
      }),
    }),
  );

  const payload = (await quoteResponse.json()) as Record<string, unknown>;
  if (payload.success !== true || !asRecord(payload.data)) {
    return {
      ok: false,
      error: NextResponse.json(
        {
          success: false,
          error:
            typeof payload.error === "string"
              ? payload.error
              : "Failed to refresh quote before building the transaction",
          code:
            typeof payload.code === "string"
              ? payload.code
              : SWAP_API_ERROR_CODES.QUOTE_STALE,
        },
        { status: quoteResponse.status || 400 },
      ),
    };
  }

  return { ok: true, quote: payload.data as Record<string, unknown> };
};

export async function handleSwapBuildTxPost(
  request: NextRequest,
): Promise<NextResponse> {
  try {
    if (SWAPS_DISABLED) {
      return NextResponse.json(SWAPS_DISABLED_RESPONSE, { status: 503 });
    }

    const body = await request.json();
    const quote = asRecord(body?.quote);
    const expiredQuote = getExpiredQuoteError(quote);
    if (expiredQuote) {
      return NextResponse.json(expiredQuote, { status: 400 });
    }

    if (!quote) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing quote",
          code: SWAP_API_ERROR_CODES.INVALID_REQUEST,
        },
        { status: 400 },
      );
    }

    const submittedQuote = quote;
    const refreshed = await refreshSwapQuote(
      request,
      submittedQuote,
      body?.slippageTolerance ?? body?.slippage,
    );
    const canReuseSubmittedDzapQuote =
      isDzapQuote(submittedQuote) && !getExpiredQuoteError(submittedQuote);
    const canReuseSubmittedKyberQuote =
      isKyberQuote(submittedQuote) && !getExpiredQuoteError(submittedQuote);
    const canReuseSubmittedUniswapQuote =
      isUniswapQuote(submittedQuote) && !getExpiredQuoteError(submittedQuote);
    if (
      !refreshed.ok &&
      !canReuseSubmittedDzapQuote &&
      !canReuseSubmittedKyberQuote &&
      !canReuseSubmittedUniswapQuote
    ) {
      return refreshed.error;
    }
    if (!refreshed.ok) {
      console.warn(
        "[swap/build-tx] quote refresh failed, using the submitted route quote",
      );
    }

    const freshQuote = (
      refreshed.ok ? refreshed.quote : submittedQuote
    ) as Record<string, unknown>;
    const userAddress =
      typeof body?.userAddress === "string" ? body.userAddress : undefined;
    const exactApprovalAmount =
      asString(freshQuote.inputAmountNative) ||
      asString(freshQuote.inputAmountRaw) ||
      asString(freshQuote.swapInputAmountNative);

    if (isDzapQuote(freshQuote)) {
      if (!userAddress) {
        return NextResponse.json(
          {
            success: false,
            error: "Missing userAddress for DZap swap",
            code: SWAP_API_ERROR_CODES.INVALID_REQUEST,
          },
          { status: 400 },
        );
      }

      const transactions = await buildDzapSwapTransaction({
        quote: freshQuote,
        userAddress,
      });

      return NextResponse.json({
        success: true,
        data: boundBuildTxApprovals(transactions, exactApprovalAmount),
      });
    }

    if (isKyberQuote(freshQuote)) {
      if (!userAddress) {
        return NextResponse.json(
          {
            success: false,
            error: "Missing userAddress for KyberSwap swap",
            code: SWAP_API_ERROR_CODES.INVALID_REQUEST,
          },
          { status: 400 },
        );
      }

      const transactions = await buildKyberSwapTransaction({
        quote: freshQuote,
        userAddress,
      });

      return NextResponse.json({
        success: true,
        data: boundBuildTxApprovals(transactions, exactApprovalAmount),
      });
    }

    if (isUniswapQuote(freshQuote)) {
      if (!userAddress) {
        return NextResponse.json(
          {
            success: false,
            error: "Missing userAddress for Uniswap swap",
            code: SWAP_API_ERROR_CODES.INVALID_REQUEST,
          },
          { status: 400 },
        );
      }

      const transactions = await buildUniswapSwapTransaction({
        quote: freshQuote,
        userAddress,
      });

      return NextResponse.json({
        success: true,
        data: boundBuildTxApprovals(transactions, exactApprovalAmount),
      });
    }

    if (isAeroQuote(freshQuote)) {
      if (!userAddress) {
        return NextResponse.json(
          {
            success: false,
            error: "Missing userAddress for Aero swap",
            code: SWAP_API_ERROR_CODES.INVALID_REQUEST,
          },
          { status: 400 },
        );
      }

      const transactions = await buildAeroSwapTransaction({
        quote: freshQuote,
        userAddress,
      });

      return NextResponse.json({
        success: true,
        data: boundBuildTxApprovals(transactions, exactApprovalAmount),
      });
    }

    if (isTowerDexQuote(freshQuote)) {
      if (!userAddress) {
        return NextResponse.json(
          {
            success: false,
            error: "Missing userAddress for Tower DEX swap",
            code: SWAP_API_ERROR_CODES.INVALID_REQUEST,
          },
          { status: 400 },
        );
      }

      const transactions = await buildTowerDexSwapTransaction({
        quote: freshQuote,
        userAddress,
      });

      return NextResponse.json({
        success: true,
        data: boundBuildTxApprovals(transactions, exactApprovalAmount),
      });
    }

    const response = await fetch(`${BACKEND_URL}/api/swap/build-tx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quote: freshQuote,
        userAddress,
      }),
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : { success: false, error: await response.text() };

    if (asRecord(data)?.success === true) {
      return NextResponse.json(
        {
          ...data,
          data: boundBuildTxApprovals(
            asRecord(data)?.data ?? data,
            exactApprovalAmount,
          ),
        },
        { status: response.status },
      );
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("[swap/build-tx] Backend build failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to build swap transaction",
        code: SWAP_API_ERROR_CODES.BUILD_TX_FAILED,
      },
      { status: 500 },
    );
  }
}

export const POST = withFrontendOriginGate(handleSwapBuildTxPost);
