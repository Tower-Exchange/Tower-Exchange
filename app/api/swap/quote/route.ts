import { NextRequest, NextResponse } from "next/server";
import { resolveSwapBackendUrl } from "@/lib/resolveSwapBackendUrl";
import { ARC_NETWORK_CHAIN_ID, TOKEN_CONTRACTS } from "@/lib/arcNetwork";
import { getDefaultBridgeNetworkMode } from "@/lib/bridgeNetworks";
import { withFrontendOriginGate } from "@/lib/server/frontendRequestGuard";
import { isPositiveDecimalAmount } from "@/lib/positiveAmount";
import {
  enrichPublicSwapQuote,
  resolveSlippageBps,
} from "@/lib/swapApiContract";
import {
  getTowerDexQuote,
  isTowerDexEnabled,
  isTowerDexSupportedPair,
  normalizeTowerDexId,
  TOWER_DEX_ID,
  TOWER_DEX_NAME,
  type TowerDexQuote,
} from "@/lib/towerDex";
import {
  getAeroQuote,
  getAeroMainnetTokenAddress,
  normalizeAeroDexId,
  AERO_CHAIN_ID,
  AERO_DEX_ID,
  AERO_DEX_NAME,
  type AeroQuote,
} from "@/lib/aeroDex";
import {
  getDzapQuote,
  isDzapEnabled,
  type DzapQuote,
} from "@/lib/dzapDex";
import {
  getKyberQuote,
  isKyberEnabled,
  KYBER_DEX_ID,
  KYBER_DEX_NAME,
  normalizeKyberDexId,
  type KyberQuote,
} from "@/lib/kyberDex";
import {
  getUniswapQuote,
  isUniswapEnabled,
  UNISWAP_DEX_ID,
  UNISWAP_DEX_NAME,
  normalizeUniswapDexId,
  type UniswapQuote,
} from "@/lib/uniswapDex";

export const runtime = "nodejs";
export const maxDuration = 30;

type BackendQuote = {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  swapInputAmount?: string;
  outputAmount: string;
  minOut: string;
  priceImpact: string | number;
  gasEstimate?: string;
  slippage?: number;
  exec_price?: number;
  feeBps?: number;
  feeMode?: "tower-swap-executor" | "none";
  platformFeeAmount?: string;
  platformFeeAmountNative?: string;
  feeRecipient?: string;
  inputAmountNative?: string;
  swapInputAmountNative?: string;
  outputAmountNative?: string;
  minOutNative?: string;
  route: {
    type: "single" | "multi" | "split";
    rawPath?: string;
    totalFee?: number;
    estimatedOutput?: string;
    hops: Array<{
      dexId: string;
      dex?: string;
      dexName?: string;
      dexRouter?: string;
      path: string[];
      feeTier?: number;
      feeTiers?: number[];
      amountIn: string;
      amountOut: string;
      priceImpact: string | number;
      liquidity?: string;
    }>;
  };
  routeOptions?: RouteOption[];
  dzap?: DzapQuote["dzap"];
  kyber?: KyberQuote["kyber"];
  uniswap?: UniswapQuote["uniswap"];
};

type RouteOption = {
  dexId: string;
  dexName: string;
  outputAmount: string;
  routeType: "single" | "multi" | "split";
  gasEstimate?: string;
  quote: QuoteLike;
  isFallback?: boolean;
};

type QuoteLike = BackendQuote;

const BACKEND_URL = resolveSwapBackendUrl();
const SWAPS_DISABLED = process.env.SWAPS_DISABLED !== "false";
const SWAPS_DISABLED_RESPONSE = {
  error: "Swaps are temporarily disabled",
  details:
    "Tower swaps are paused while the TowerSwapExecutor migration is being verified.",
};
const BACKEND_DEX_IDS = ["synthra", "unitflow", "tower-dex"] as const;
type BackendDexId = (typeof BACKEND_DEX_IDS)[number];
const PRIMARY_BACKEND_QUOTE_TIMEOUT_MS = 5_000;
const BACKEND_DEX_FALLBACK_TIMEOUT_MS = 5_000;
const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const USDC_ADDRESS = TOKEN_CONTRACTS.USDC.toLowerCase();

class BackendQuoteError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "BackendQuoteError";
    this.status = status;
    this.details = details;
  }
}

const readBackendQuoteError = async (response: Response) => {
  try {
    const payload = (await response.json()) as {
      error?: unknown;
      message?: unknown;
      details?: unknown;
    };
    const message =
      typeof payload.error === "string"
        ? payload.error
        : typeof payload.message === "string"
          ? payload.message
          : `Swap backend quote failed with status ${response.status}`;

    return {
      message,
      details: payload.details,
    };
  } catch {
    return {
      message: `Swap backend quote failed with status ${response.status}`,
      details: undefined,
    };
  }
};

const towerDexQuoteToBackendQuote = (quote: TowerDexQuote): BackendQuote => ({
  inputToken: quote.inputToken,
  outputToken: quote.outputToken,
  inputAmount: quote.inputAmount,
  swapInputAmount: quote.swapInputAmount,
  outputAmount: quote.outputAmount,
  minOut: quote.minOut,
  inputAmountNative: quote.inputAmountNative,
  swapInputAmountNative: quote.swapInputAmountNative,
  outputAmountNative: quote.outputAmountNative,
  minOutNative: quote.minOutNative,
  priceImpact: quote.priceImpact,
  gasEstimate: quote.gasEstimate,
  slippage: quote.slippage,
  feeBps: quote.feeBps,
  feeMode: quote.feeMode,
  feeRecipient: quote.feeRecipient,
  platformFeeAmount: quote.platformFeeAmount,
  platformFeeAmountNative: quote.platformFeeAmountNative,
  route: quote.route,
});

async function fetchLocalTowerDexQuote(params: {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  slippageTolerance: number;
}): Promise<BackendQuote | null> {
  if (!isTowerDexEnabled()) {
    return null;
  }

  if (!isTowerDexSupportedPair(params.inputToken, params.outputToken)) {
    return null;
  }

  const quote = await getTowerDexQuote({
    inputToken: params.inputToken,
    outputToken: params.outputToken,
    inputAmount: params.inputAmount,
    slippageBps: params.slippageTolerance,
  });

  return quote ? towerDexQuoteToBackendQuote(quote) : null;
}

const aeroQuoteToBackendQuote = (quote: AeroQuote): BackendQuote => ({
  inputToken: quote.inputToken,
  outputToken: quote.outputToken,
  inputAmount: quote.inputAmount,
  swapInputAmount: quote.swapInputAmount,
  outputAmount: quote.outputAmount,
  minOut: quote.minOut,
  inputAmountNative: quote.inputAmountNative,
  swapInputAmountNative: quote.swapInputAmountNative,
  outputAmountNative: quote.outputAmountNative,
  minOutNative: quote.minOutNative,
  priceImpact: quote.priceImpact,
  gasEstimate: quote.gasEstimate,
  slippage: quote.slippage,
  feeMode: quote.feeMode,
  feeBps: quote.feeBps,
  feeRecipient: quote.feeRecipient,
  platformFeeAmount: quote.platformFeeAmount,
  platformFeeAmountNative: quote.platformFeeAmountNative,
  route: quote.route,
});

const dzapQuoteToBackendQuote = (quote: DzapQuote): BackendQuote => ({
  inputToken: quote.inputToken,
  outputToken: quote.outputToken,
  inputAmount: quote.inputAmount,
  swapInputAmount: quote.swapInputAmount,
  outputAmount: quote.outputAmount,
  minOut: quote.minOut,
  inputAmountNative: quote.inputAmountNative,
  swapInputAmountNative: quote.swapInputAmountNative,
  outputAmountNative: quote.outputAmountNative,
  minOutNative: quote.minOutNative,
  priceImpact: quote.priceImpact,
  gasEstimate: quote.gasEstimate,
  slippage: quote.slippage,
  feeMode: quote.feeMode,
  feeBps: quote.feeBps,
  feeRecipient: quote.feeRecipient,
  platformFeeAmount: quote.platformFeeAmount,
  platformFeeAmountNative: quote.platformFeeAmountNative,
  dzap: quote.dzap,
  route: quote.route,
});

const kyberQuoteToBackendQuote = (quote: KyberQuote): BackendQuote => ({
  inputToken: quote.inputToken,
  outputToken: quote.outputToken,
  inputAmount: quote.inputAmount,
  swapInputAmount: quote.swapInputAmount,
  outputAmount: quote.outputAmount,
  minOut: quote.minOut,
  inputAmountNative: quote.inputAmountNative,
  swapInputAmountNative: quote.swapInputAmountNative,
  outputAmountNative: quote.outputAmountNative,
  minOutNative: quote.minOutNative,
  priceImpact: quote.priceImpact,
  gasEstimate: quote.gasEstimate,
  slippage: quote.slippage,
  feeMode: quote.feeMode,
  feeBps: quote.feeBps,
  feeRecipient: quote.feeRecipient,
  platformFeeAmount: quote.platformFeeAmount,
  platformFeeAmountNative: quote.platformFeeAmountNative,
  kyber: quote.kyber,
  route: quote.route,
});

const uniswapQuoteToBackendQuote = (quote: UniswapQuote): BackendQuote => ({
  inputToken: quote.inputToken,
  outputToken: quote.outputToken,
  inputAmount: quote.inputAmount,
  swapInputAmount: quote.swapInputAmount,
  outputAmount: quote.outputAmount,
  minOut: quote.minOut,
  inputAmountNative: quote.inputAmountNative,
  swapInputAmountNative: quote.swapInputAmountNative,
  outputAmountNative: quote.outputAmountNative,
  minOutNative: quote.minOutNative,
  priceImpact: quote.priceImpact,
  gasEstimate: quote.gasEstimate,
  slippage: quote.slippage,
  feeMode: quote.feeMode,
  feeBps: quote.feeBps,
  feeRecipient: quote.feeRecipient,
  platformFeeAmount: quote.platformFeeAmount,
  platformFeeAmountNative: quote.platformFeeAmountNative,
  uniswap: quote.uniswap,
  route: quote.route,
});

async function fetchLocalAeroQuote(params: {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  slippageTolerance: number;
}): Promise<BackendQuote | null> {
  const quote = await getAeroQuote({
    inputToken: params.inputToken,
    outputToken: params.outputToken,
    inputAmount: params.inputAmount,
    slippageBps: params.slippageTolerance,
  });

  return quote ? aeroQuoteToBackendQuote(quote) : null;
}

async function supplementWithLocalTowerDexQuote(params: {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  slippageTolerance: number;
  backendDexIds: readonly BackendDexId[];
  quotes: BackendQuote[];
  routeOptions: RouteOption[];
}) {
  if (!params.backendDexIds.includes(TOWER_DEX_ID)) {
    return {
      quotes: params.quotes,
      routeOptions: params.routeOptions,
    };
  }

  const hasTowerDexQuote = params.routeOptions.some(
    (option) => normalizeDexId(option.dexId || option.dexName) === TOWER_DEX_ID,
  );

  if (hasTowerDexQuote) {
    return {
      quotes: params.quotes,
      routeOptions: params.routeOptions,
    };
  }

  const localQuote = await fetchLocalTowerDexQuote(params);
  if (!localQuote) {
    return {
      quotes: params.quotes,
      routeOptions: params.routeOptions,
    };
  }

  const localRouteOption = routeOptionFromQuote(localQuote);

  return {
    quotes: dedupeQuotesByDex([...params.quotes, localQuote]),
    routeOptions: dedupeRouteOptions([...params.routeOptions, localRouteOption]),
  };
}

async function fetchDzapAggregatorQuote(params: {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  slippageTolerance: number;
  chainId: number;
}): Promise<BackendQuote | null> {
  if (!isDzapEnabled()) {
    return null;
  }

  const quote = await getDzapQuote({
    inputToken: params.inputToken,
    outputToken: params.outputToken,
    inputAmount: params.inputAmount,
    slippageBps: params.slippageTolerance,
    chainId: params.chainId,
  });

  return quote ? dzapQuoteToBackendQuote(quote) : null;
}

async function supplementWithDzapQuote(params: {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  slippageTolerance: number;
  chainId: number;
  requestedDexId?: string;
  quotes: BackendQuote[];
  routeOptions: RouteOption[];
}) {
  if (params.requestedDexId && params.requestedDexId !== TOWER_DEX_ID) {
    return {
      quotes: params.quotes,
      routeOptions: params.routeOptions,
    };
  }

  const dzapQuote = await fetchDzapAggregatorQuote(params);
  if (!dzapQuote) {
    return {
      quotes: params.quotes,
      routeOptions: params.routeOptions,
    };
  }

  const dzapRouteOption = routeOptionFromQuote(dzapQuote);

  return {
    quotes: dedupeQuotesByDex([...params.quotes, dzapQuote]),
    routeOptions: dedupeRouteOptions([...params.routeOptions, dzapRouteOption]),
  };
}

async function fetchKyberAggregatorQuote(params: {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  slippageTolerance: number;
  chainId: number;
}): Promise<BackendQuote | null> {
  if (!isKyberEnabled()) {
    return null;
  }

  const quote = await getKyberQuote({
    inputToken: params.inputToken,
    outputToken: params.outputToken,
    inputAmount: params.inputAmount,
    slippageBps: params.slippageTolerance,
    chainId: params.chainId,
  });

  return quote ? kyberQuoteToBackendQuote(quote) : null;
}

async function supplementWithKyberQuote(params: {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  slippageTolerance: number;
  chainId: number;
  requestedDexId?: string;
  quotes: BackendQuote[];
  routeOptions: RouteOption[];
}) {
  if (params.requestedDexId && params.requestedDexId !== KYBER_DEX_ID) {
    return {
      quotes: params.quotes,
      routeOptions: params.routeOptions,
    };
  }

  const hasKyberQuote = params.routeOptions.some(
    (option) => normalizeDexId(option.dexId || option.dexName) === KYBER_DEX_ID,
  );
  if (hasKyberQuote) {
    return {
      quotes: params.quotes,
      routeOptions: params.routeOptions,
    };
  }

  const kyberQuote = await fetchKyberAggregatorQuote(params);
  if (!kyberQuote) {
    return {
      quotes: params.quotes,
      routeOptions: params.routeOptions,
    };
  }

  const kyberRouteOption = routeOptionFromQuote(kyberQuote);

  return {
    quotes: dedupeQuotesByDex([...params.quotes, kyberQuote]),
    routeOptions: dedupeRouteOptions([...params.routeOptions, kyberRouteOption]),
  };
}

async function fetchUniswapQuote(params: {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  slippageTolerance: number;
  chainId: number;
}): Promise<BackendQuote | null> {
  if (!isUniswapEnabled()) {
    return null;
  }

  const quote = await getUniswapQuote({
    inputToken: params.inputToken,
    outputToken: params.outputToken,
    inputAmount: params.inputAmount,
    slippageBps: params.slippageTolerance,
    chainId: params.chainId,
  });

  return quote ? uniswapQuoteToBackendQuote(quote) : null;
}

async function supplementWithUniswapQuote(params: {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  slippageTolerance: number;
  chainId: number;
  requestedDexId?: string;
  quotes: BackendQuote[];
  routeOptions: RouteOption[];
}) {
  if (params.requestedDexId && params.requestedDexId !== UNISWAP_DEX_ID) {
    return {
      quotes: params.quotes,
      routeOptions: params.routeOptions,
    };
  }

  const hasUniswapQuote = params.routeOptions.some(
    (option) => normalizeDexId(option.dexId || option.dexName) === UNISWAP_DEX_ID,
  );
  if (hasUniswapQuote) {
    return {
      quotes: params.quotes,
      routeOptions: params.routeOptions,
    };
  }

  const uniswapQuote = await fetchUniswapQuote(params);
  if (!uniswapQuote) {
    return {
      quotes: params.quotes,
      routeOptions: params.routeOptions,
    };
  }

  const uniswapRouteOption = routeOptionFromQuote(uniswapQuote);

  return {
    quotes: dedupeQuotesByDex([...params.quotes, uniswapQuote]),
    routeOptions: dedupeRouteOptions([...params.routeOptions, uniswapRouteOption]),
  };
}

async function supplementWithLocalAeroQuote(params: {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  slippageTolerance: number;
  requestedDexId?: string;
  quotes: BackendQuote[];
  routeOptions: RouteOption[];
}) {
  if (params.requestedDexId && params.requestedDexId !== AERO_DEX_ID) {
    return {
      quotes: params.quotes,
      routeOptions: params.routeOptions,
    };
  }

  const hasAeroQuote = params.routeOptions.some(
    (option) => normalizeDexId(option.dexId || option.dexName) === AERO_DEX_ID,
  );

  if (hasAeroQuote) {
    return {
      quotes: params.quotes,
      routeOptions: params.routeOptions,
    };
  }

  const localQuote = await fetchLocalAeroQuote(params);
  if (!localQuote) {
    return {
      quotes: params.quotes,
      routeOptions: params.routeOptions,
    };
  }

  const localRouteOption = routeOptionFromQuote(localQuote);

  return {
    quotes: dedupeQuotesByDex([...params.quotes, localQuote]),
    routeOptions: dedupeRouteOptions([...params.routeOptions, localRouteOption]),
  };
}

const resolveTokenAddress = (token?: string, chainId?: number) => {
  const normalizedToken = token?.trim();

  if (!normalizedToken) {
    return undefined;
  }

  if (chainId === AERO_CHAIN_ID) {
    const mainnetAddress = getAeroMainnetTokenAddress(normalizedToken);
    if (mainnetAddress) {
      return mainnetAddress;
    }
  }

  const symbolAddress = TOKEN_CONTRACTS[normalizedToken.toUpperCase()];

  if (symbolAddress) {
    return symbolAddress;
  }

  return EVM_ADDRESS_PATTERN.test(normalizedToken)
    ? normalizedToken
    : undefined;
};

const normalizeDexId = (dexId?: string) => {
  const normalized = String(dexId || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");

  if (!normalized) {
    return undefined;
  }

  if (normalized === "synthra-v3" || normalized.includes("synthra")) {
    return "synthra";
  }

  if (
    normalized === "unitflow-v3" ||
    normalized.includes("unitflow") ||
    normalized.includes("unit-flow")
  ) {
    return "unitflow";
  }

  if (normalizeTowerDexId(normalized) === TOWER_DEX_ID) {
    return TOWER_DEX_ID;
  }

  if (normalizeAeroDexId(normalized) === AERO_DEX_ID) {
    return AERO_DEX_ID;
  }

  if (normalizeKyberDexId(normalized) === KYBER_DEX_ID) {
    return KYBER_DEX_ID;
  }

  if (normalizeUniswapDexId(normalized) === UNISWAP_DEX_ID) {
    return UNISWAP_DEX_ID;
  }

  return normalized;
};

const getBackendDexIds = (
  inputToken: string,
  outputToken: string,
): readonly BackendDexId[] => {
  void inputToken;

  return BACKEND_DEX_IDS.filter((backendDexId) => {
    if (backendDexId !== "unitflow") {
      return true;
    }

    return outputToken.toLowerCase() !== USDC_ADDRESS;
  }) as BackendDexId[];
};

const buildBackendQuoteBody = (body: Record<string, unknown>) => body;

const routeOptionFromQuote = (quote: QuoteLike): RouteOption => {
  const hop = quote.route?.hops?.[0];
  const dexId = hop?.dexId || hop?.dex || hop?.dexName || "unknown";
  const normalizedDexId = normalizeDexId(dexId) || "unknown";

  return {
    dexId: normalizedDexId,
    dexName:
      normalizedDexId === "synthra"
        ? "Synthra"
        : normalizedDexId === "unitflow"
          ? "UnitFlow"
          : normalizedDexId === TOWER_DEX_ID
              ? TOWER_DEX_NAME
              : normalizedDexId === AERO_DEX_ID
                ? AERO_DEX_NAME
              : normalizedDexId === KYBER_DEX_ID
                ? KYBER_DEX_NAME
              : normalizedDexId === UNISWAP_DEX_ID
                ? UNISWAP_DEX_NAME
              : hop?.dexName || hop?.dexId || "Unknown Router",
    outputAmount: quote.outputAmount,
    routeType: quote.route?.type || "single",
    quote,
  };
};

const dedupeRouteOptions = (options: RouteOption[]) =>
  Array.from(
    options
      .map((option) => ({
        ...option,
        dexId: normalizeDexId(option.dexId) || option.dexId,
      }))
      .reduce((optionsByDexId, option) => {
        const existingOption = optionsByDexId.get(option.dexId);

        if (!existingOption) {
          optionsByDexId.set(option.dexId, option);
          return optionsByDexId;
        }

        const existingIsFallback = existingOption.isFallback === true;
        const optionIsFallback = option.isFallback === true;

        if (existingIsFallback && !optionIsFallback) {
          optionsByDexId.set(option.dexId, option);
          return optionsByDexId;
        }

        if (!existingIsFallback && optionIsFallback) {
          return optionsByDexId;
        }

        if (
          BigInt(option.outputAmount || "0") >
            BigInt(existingOption.outputAmount || "0")
        ) {
          optionsByDexId.set(option.dexId, option);
        }

        return optionsByDexId;
      }, new Map<string, RouteOption>())
      .values(),
  );

const dedupeQuotesByDex = (quotes: BackendQuote[]) =>
  Array.from(
    quotes.reduce((quotesByDexId, quote) => {
      const dexId = normalizeDexId(
        quote.route?.hops?.[0]?.dexId ||
          quote.route?.hops?.[0]?.dex ||
          quote.route?.hops?.[0]?.dexName,
      );

      if (!dexId) {
        return quotesByDexId;
      }

      const existingQuote = quotesByDexId.get(dexId);

      if (
        !existingQuote ||
        BigInt(quote.outputAmount || "0") > BigInt(existingQuote.outputAmount || "0")
      ) {
        quotesByDexId.set(dexId, quote);
      }

      return quotesByDexId;
    }, new Map<string, BackendQuote>()).values(),
  );

const buildBackendRouteOptions = (
  quote: BackendQuote,
  backendDexIds: readonly BackendDexId[],
) => {
  const fallbackOption = routeOptionFromQuote(quote);
  const sourceOptions = quote.routeOptions?.length
    ? quote.routeOptions
    : [fallbackOption];
  const filteredOptions = sourceOptions.filter((option) => {
    const normalizedOptionDexId = normalizeDexId(option.dexId || option.dexName);

    return normalizedOptionDexId
      ? backendDexIds.includes(normalizedOptionDexId as BackendDexId)
      : false;
  });

  return dedupeRouteOptions(
    filteredOptions.length > 0 ? filteredOptions : [fallbackOption],
  );
};

const getMissingBackendDexIds = (
  routeOptions: RouteOption[],
  backendDexIds: readonly BackendDexId[],
): BackendDexId[] => {
  const coveredDexIds = new Set(
    routeOptions.flatMap((option) => {
      const normalizedDexId = normalizeDexId(option.dexId || option.dexName);

      return normalizedDexId &&
        backendDexIds.includes(normalizedDexId as BackendDexId)
        ? [normalizedDexId as BackendDexId]
        : [];
    }),
  );

  return backendDexIds.filter((backendDexId) => !coveredDexIds.has(backendDexId));
};

async function fetchBackendQuote(
  body: Record<string, unknown>,
  timeoutMs = PRIMARY_BACKEND_QUOTE_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const requestBody = buildBackendQuoteBody(body);
    const response = await fetch(`${BACKEND_URL}/api/swap/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      cache: "no-store",
      signal: controller.signal,
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const backendError = await readBackendQuoteError(response);
      throw new BackendQuoteError(
        backendError.message,
        response.status,
        backendError.details,
      );
    }

    const responseData = await response.json();
    return (responseData.data || responseData) as BackendQuote;
  } catch (error) {
    if (error instanceof BackendQuoteError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new BackendQuoteError(
        `Swap backend quote timed out after ${Math.round(timeoutMs / 1000)}s`,
        504,
      );
    }

    console.warn("[swap/quote] Backend quote unavailable:", error);
    throw new BackendQuoteError(
      "Swap backend unavailable",
      502,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchBackendQuotesByDex(params: {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  slippageTolerance: number;
  backendDexIds: readonly BackendDexId[];
}) {
  const { backendDexIds, ...baseBody } = params;

  const results = await Promise.all(
    backendDexIds.map(async (backendDexId) => {
      try {
        const quote = await fetchBackendQuote(
          {
            ...baseBody,
            dexId: backendDexId,
          },
          BACKEND_DEX_FALLBACK_TIMEOUT_MS,
        );

        return {
          quote,
          error: null as BackendQuoteError | null,
        };
      } catch (error) {
        const backendError =
          error instanceof BackendQuoteError
            ? error
            : new BackendQuoteError(
                "Swap backend unavailable",
                502,
                error instanceof Error ? error.message : String(error),
              );

        console.warn(`[swap/quote] ${backendDexId} quote unavailable:`, {
          status: backendError.status,
          message: backendError.message,
        });

        return {
          quote: null,
          error: backendError,
        };
      }
    }),
  );

  const quotes = results.flatMap((result) =>
    result.quote ? [result.quote] : [],
  );

  if (quotes.length === 0) {
    const firstError = results.find((result) => result.error)?.error;
    if (firstError) {
      throw firstError;
    }

    return {
      quotes: [],
      routeOptions: [],
    };
  }

  return {
    quotes,
    routeOptions: dedupeRouteOptions(quotes.map(routeOptionFromQuote)),
  };
}

async function fetchBackendQuotes(params: {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  slippageTolerance: number;
  dexId?: string;
  backendDexIds?: readonly BackendDexId[];
}): Promise<{
  quotes: BackendQuote[];
  routeOptions: RouteOption[];
}> {
  const { dexId, backendDexIds = BACKEND_DEX_IDS, ...baseBody } = params;

  const normalizedDexId = normalizeDexId(dexId);

  if (dexId) {
    if (
      !normalizedDexId ||
      !backendDexIds.includes(normalizedDexId as BackendDexId)
    ) {
      return {
        quotes: [],
        routeOptions: [],
      };
    }

    const quote = await fetchBackendQuote({
      ...baseBody,
      dexId: normalizedDexId,
    });

    if (!quote) {
      return {
        quotes: [],
        routeOptions: [],
      };
    }

    const routeOptions = buildBackendRouteOptions(quote, backendDexIds);

    return {
      quotes: [quote],
      routeOptions,
    };
  }

  const aggregatePromise = fetchBackendQuote(
    baseBody,
    PRIMARY_BACKEND_QUOTE_TIMEOUT_MS,
  ).catch((error) => {
    console.warn(
      "[swap/quote] aggregate quote unavailable, using per-DEX quotes:",
      error instanceof Error ? error.message : String(error),
    );

    return null;
  });

  const fanoutPromise = fetchBackendQuotesByDex({
    ...baseBody,
    backendDexIds,
  }).catch((error) => {
    console.warn(
      "[swap/quote] per-DEX fan-out failed:",
      error instanceof Error ? error.message : String(error),
    );

    return {
      quotes: [] as BackendQuote[],
      routeOptions: [] as RouteOption[],
    };
  });

  const aggregateQuote = await aggregatePromise;

  if (aggregateQuote) {
    const routeOptions = buildBackendRouteOptions(aggregateQuote, backendDexIds);
    const quotesFromRouteOptions = routeOptions.flatMap((option) =>
      option.quote ? [option.quote as BackendQuote] : [],
    );
    const quotes = dedupeQuotesByDex([
      aggregateQuote,
      ...quotesFromRouteOptions,
    ]);

    return {
      quotes: quotes.length > 0 ? quotes : [aggregateQuote],
      routeOptions,
    };
  }

  return fanoutPromise;
}

export async function handleSwapQuotePost(request: NextRequest) {
  try {
    if (SWAPS_DISABLED) {
      return NextResponse.json(SWAPS_DISABLED_RESPONSE, { status: 503 });
    }

    const body = await request.json();
    const {
      inputToken,
      outputToken,
      inputAmount,
      slippageTolerance,
      slippage,
      dexId,
      chainId,
    } = body as {
      inputToken?: string;
      outputToken?: string;
      inputAmount?: string;
      slippageTolerance?: number;
      slippage?: number;
      dexId?: string;
      chainId?: number;
    };
    const normalizedRequestedDexId = normalizeDexId(dexId);
    const parsedChainId = Number(chainId);
    const defaultChainId =
      getDefaultBridgeNetworkMode() === "mainnet"
        ? ARC_NETWORK_CHAIN_ID.mainnet
        : ARC_NETWORK_CHAIN_ID.testnet;
    const resolvedChainId =
      Number.isFinite(parsedChainId) && parsedChainId > 0
        ? parsedChainId
        : defaultChainId;
    const isArcMainnet = resolvedChainId === AERO_CHAIN_ID;

    if (!inputToken || !outputToken || !inputAmount) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing inputToken, outputToken, or inputAmount",
        },
        { status: 400 },
      );
    }

    if (!isPositiveDecimalAmount(inputAmount)) {
      return NextResponse.json(
        {
          success: false,
          error: "inputAmount must be a positive number",
        },
        { status: 400 },
      );
    }

    const resolvedSlippageBps = resolveSlippageBps(
      slippageTolerance ?? slippage,
    );

    const resolvedInputToken = resolveTokenAddress(inputToken, resolvedChainId);
    const resolvedOutputToken = resolveTokenAddress(outputToken, resolvedChainId);

    if (!resolvedInputToken || !resolvedOutputToken) {
      return NextResponse.json(
        {
          success: false,
          error: "Unsupported or invalid inputToken/outputToken",
        },
        { status: 400 },
      );
    }

    const backendDexIds = isArcMainnet
      ? []
      : getBackendDexIds(resolvedInputToken, resolvedOutputToken);
    const backendDexRequest = normalizedRequestedDexId || undefined;

    console.info("[swap/quote] quote request received", {
      inputToken: resolvedInputToken,
      outputToken: resolvedOutputToken,
      inputAmount,
      chainId: resolvedChainId,
      dexId: backendDexRequest,
      backendDexIds,
      backendUrl: BACKEND_URL,
    });

    let backendResult: { quotes: BackendQuote[]; routeOptions: RouteOption[] };

    if (isArcMainnet) {
      backendResult = {
        quotes: [],
        routeOptions: [],
      };
    } else {
      try {
        backendResult = await fetchBackendQuotes({
          inputToken: resolvedInputToken,
          outputToken: resolvedOutputToken,
          inputAmount,
          slippageTolerance: resolvedSlippageBps,
          backendDexIds,
          dexId: backendDexRequest,
        });
      } catch (error) {
        if (!(error instanceof BackendQuoteError)) {
          throw error;
        }

        console.warn("[swap/quote] backend quote failed, trying local Tower DEX:", {
          status: error.status,
          message: error.message,
        });

        backendResult = {
          quotes: [],
          routeOptions: [],
        };
      }

      backendResult = await supplementWithLocalTowerDexQuote({
        inputToken: resolvedInputToken,
        outputToken: resolvedOutputToken,
        inputAmount,
        slippageTolerance: resolvedSlippageBps,
        backendDexIds,
        quotes: backendResult.quotes,
        routeOptions: backendResult.routeOptions,
      });
    }

    if (isArcMainnet) {
      const [aeroResult, dzapResult, kyberResult, uniswapResult] =
        await Promise.all([
        supplementWithLocalAeroQuote({
          inputToken: resolvedInputToken,
          outputToken: resolvedOutputToken,
          inputAmount,
          slippageTolerance: resolvedSlippageBps,
          requestedDexId: backendDexRequest,
          quotes: backendResult.quotes,
          routeOptions: backendResult.routeOptions,
        }),
        supplementWithDzapQuote({
          inputToken: resolvedInputToken,
          outputToken: resolvedOutputToken,
          inputAmount,
          slippageTolerance: resolvedSlippageBps,
          chainId: resolvedChainId,
          requestedDexId: backendDexRequest,
          quotes: backendResult.quotes,
          routeOptions: backendResult.routeOptions,
        }),
        supplementWithKyberQuote({
          inputToken: resolvedInputToken,
          outputToken: resolvedOutputToken,
          inputAmount,
          slippageTolerance: resolvedSlippageBps,
          chainId: resolvedChainId,
          requestedDexId: backendDexRequest,
          quotes: backendResult.quotes,
          routeOptions: backendResult.routeOptions,
        }),
        supplementWithUniswapQuote({
          inputToken: resolvedInputToken,
          outputToken: resolvedOutputToken,
          inputAmount,
          slippageTolerance: resolvedSlippageBps,
          chainId: resolvedChainId,
          requestedDexId: backendDexRequest,
          quotes: backendResult.quotes,
          routeOptions: backendResult.routeOptions,
        }),
      ]);

      backendResult = {
        quotes: dedupeQuotesByDex([
          ...aeroResult.quotes,
          ...dzapResult.quotes,
          ...kyberResult.quotes,
          ...uniswapResult.quotes,
        ]),
        routeOptions: dedupeRouteOptions([
          ...aeroResult.routeOptions,
          ...dzapResult.routeOptions,
          ...kyberResult.routeOptions,
          ...uniswapResult.routeOptions,
        ]),
      };
    } else {
      backendResult = await supplementWithDzapQuote({
        inputToken: resolvedInputToken,
        outputToken: resolvedOutputToken,
        inputAmount,
        slippageTolerance: resolvedSlippageBps,
        chainId: resolvedChainId,
        requestedDexId: backendDexRequest,
        quotes: backendResult.quotes,
        routeOptions: backendResult.routeOptions,
      });
    }

    let candidateQuotes = backendResult.quotes;

    if (candidateQuotes.length === 0 && !isArcMainnet) {
      const localQuote = await fetchLocalTowerDexQuote({
        inputToken: resolvedInputToken,
        outputToken: resolvedOutputToken,
        inputAmount,
        slippageTolerance: resolvedSlippageBps,
      });

      if (localQuote) {
        candidateQuotes = [localQuote];
        backendResult = {
          quotes: candidateQuotes,
          routeOptions: [routeOptionFromQuote(localQuote)],
        };
      }
    }

    if (candidateQuotes.length === 0) {
      return NextResponse.json({
        success: false,
        error: "No valid route found",
        data: { routeOptions: [] },
      });
    }

    const routeOptions = dedupeRouteOptions(backendResult.routeOptions);
    const requestedRouteOption = normalizedRequestedDexId
      ? routeOptions.find(
          (option) =>
            (normalizeDexId(option.dexId) || option.dexId) ===
            normalizedRequestedDexId,
        )
      : null;

    const requestedQuote = normalizedRequestedDexId
      ? candidateQuotes.find(
          (quote) => routeOptionFromQuote(quote).dexId === normalizedRequestedDexId,
        ) ||
        (requestedRouteOption?.quote as BackendQuote | undefined) ||
        null
      : null;

    const bestQuoteCandidate =
      requestedQuote ||
      candidateQuotes.reduce((best, quote) =>
        BigInt(quote.outputAmount || "0") > BigInt(best.outputAmount || "0")
          ? quote
          : best,
      );

    console.info("[swap/quote] backend quote summary", {
      quotesFound: candidateQuotes.length,
      routeOptionsFound: routeOptions.length,
      requestedDex: normalizedRequestedDexId,
      bestOutputAmount: bestQuoteCandidate?.outputAmount,
    });

    if (normalizedRequestedDexId && !requestedQuote) {
      const requestedOutputAmount = requestedRouteOption?.outputAmount;
      if (requestedRouteOption && requestedOutputAmount && requestedOutputAmount !== "0") {
        return NextResponse.json({
          success: true,
          data: enrichPublicSwapQuote({
            ...(requestedRouteOption.quote || bestQuoteCandidate),
            outputAmount: requestedOutputAmount,
            routeOptions,
          }),
        });
      }

      return NextResponse.json({
        success: false,
        error:
          normalizedRequestedDexId === TOWER_DEX_ID
            ? "Tower route is temporarily unavailable. Wait a few seconds and try again."
            : `No valid ${normalizedRequestedDexId} route found for this swap`,
        data: { routeOptions },
      });
    }

    const bestRouteOption = routeOptions.reduce<RouteOption | null>(
      (bestOption, option) => {
        if (!bestOption) {
          return option;
        }

        return BigInt(option.outputAmount || "0") >
          BigInt(bestOption.outputAmount || "0")
          ? option
          : bestOption;
      },
      null,
    );
    const bestQuote = requestedQuote || bestRouteOption?.quote || bestQuoteCandidate;

    return NextResponse.json({
      success: true,
      data: enrichPublicSwapQuote({
        ...bestQuote,
        routeOptions,
      }),
    });
  } catch (error) {
    if (error instanceof BackendQuoteError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          details: error.details,
        },
        { status: error.status },
      );
    }

    console.error("[swap/quote] Failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get quote",
      },
      { status: 500 },
    );
  }
}

export const POST = withFrontendOriginGate(handleSwapQuotePost);
