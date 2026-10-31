import type { StaticImageData } from "next/image";

import eurcLogo from "@/public/assets/eurc.svg";
import usdcLogo from "@/public/assets/usdc.svg";
import usdtLogo from "@/public/assets/usdt.svg";
import cirbtcLogo from "@/public/assets/cirbtc.svg";
import cngnLogo from "@/public/assets/cNGN.svg";
import qcadLogo from "@/public/assets/QCAD.svg";
import mxnbLogo from "@/public/assets/mxnb.svg";
import audfLogo from "@/public/assets/audf.svg";
import gbpaLogo from "@/public/assets/gbpa.svg";
import { DEFAULT_TOKEN_USD_PRICES } from "@/lib/tokenUsdPrices";
import {
  isStableFxCustomerVisibleCurrency,
  isStableFxPair,
  normalizeStableFxCurrency,
} from "@/lib/stableFx";

export const QCAD_SWAP_PAIRS_ENABLED = true;

export interface SwapToken {
  /** Unique UI identity; symbols can occur in both DEX and StableFX variants. */
  id: string;
  symbol:
    | "USDC"
    | "EURC"
    | "USDT"
    | "cirBTC"
    | "cNGN"
    | "QCAD"
    | "GBPA"
    | "MXNB"
    | "AUDF";
  icon: StaticImageData;
  name: string;
  balance: number;
  usdPrice: number;
  stableFx?: boolean;
}

export type SwapTokenSymbol = SwapToken["symbol"];

export const SWAP_TOKENS: readonly SwapToken[] = [
  {
    id: "dex-usdc",
    symbol: "USDC",
    icon: usdcLogo,
    name: "USD Coin",
    balance: 1000,
    usdPrice: DEFAULT_TOKEN_USD_PRICES.USDC,
  },
  {
    id: "dex-eurc",
    symbol: "EURC",
    icon: eurcLogo,
    name: "Euro Coin",
    balance: 750,
    usdPrice: DEFAULT_TOKEN_USD_PRICES.EURC,
  },
  // {
  //   symbol: "USDT",
  //   icon: usdtLogo,
  //   name: "Tether USD",
  //   balance: 500,
  //   usdPrice: DEFAULT_TOKEN_USD_PRICES.USDT,
  // },
  {
    id: "dex-cirbtc",
    symbol: "cirBTC",
    icon: cirbtcLogo,
    name: "Circle Bitcoin",
    balance: 0,
    usdPrice: DEFAULT_TOKEN_USD_PRICES.cirBTC,
  },
  // {
  //   symbol: "cNGN",
  //   icon: cngnLogo,
  //   name: "Compliant Naira",
  //   balance: 0,
  //   usdPrice: DEFAULT_TOKEN_USD_PRICES.cNGN,
  // },
  // {
  //   symbol: "QCAD",
  //   icon: qcadLogo,
  //   name: "Canadian Dollar",
  //   balance: 0,
  //   usdPrice: DEFAULT_TOKEN_USD_PRICES.QCAD,
  // },
] as const;

/**
 * These are deliberately separate entries, even where the ERC-20 symbol is
 * the same. Selecting a StableFX variant chooses Circle's managed settlement;
 * selecting the unlabelled variant keeps the trade on Tower's DEX routes.
 */
const ALL_STABLEFX_SELECTOR_TOKENS: readonly SwapToken[] = [
  {
    id: "stablefx-usdc",
    symbol: "USDC",
    icon: usdcLogo,
    name: "USD Coin",
    balance: 0,
    usdPrice: DEFAULT_TOKEN_USD_PRICES.USDC,
    stableFx: true,
  },
  {
    id: "stablefx-eurc",
    symbol: "EURC",
    icon: eurcLogo,
    name: "Euro Coin",
    balance: 0,
    usdPrice: DEFAULT_TOKEN_USD_PRICES.EURC,
    stableFx: true,
  },
  {
    id: "stablefx-gbpa",
    symbol: "GBPA",
    icon: gbpaLogo,
    name: "Agant British Pound",
    balance: 0,
    usdPrice: DEFAULT_TOKEN_USD_PRICES.GBPA,
    stableFx: true,
  },
  {
    id: "stablefx-mxnb",
    symbol: "MXNB",
    icon: mxnbLogo,
    name: "Mexican Peso",
    balance: 0,
    usdPrice: DEFAULT_TOKEN_USD_PRICES.MXNB,
    stableFx: true,
  },
  {
    id: "stablefx-audf",
    symbol: "AUDF",
    icon: audfLogo,
    name: "Australian Dollar",
    balance: 0,
    usdPrice: DEFAULT_TOKEN_USD_PRICES.AUDF,
    stableFx: true,
  },
];

/**
 * Keep every configured StableFX token above, but publish only currencies
 * approved for the customer experience. This prevents GBPA/AUDF appearing in
 * the selector before their individual launch while retaining their metadata.
 */
export const STABLEFX_SELECTOR_TOKENS: readonly SwapToken[] =
  ALL_STABLEFX_SELECTOR_TOKENS.filter((token) =>
    isStableFxCustomerVisibleCurrency(token.symbol),
  );

/** The expanded list is for the Swap card only; pools continue to use DEX tokens. */
export const SWAP_SELECTOR_TOKENS: readonly SwapToken[] = [
  ...SWAP_TOKENS,
  ...STABLEFX_SELECTOR_TOKENS,
];

const QCAD_SWAP_PAIR_KEYS = QCAD_SWAP_PAIRS_ENABLED
  ? ([
      "USDC:QCAD",
      "QCAD:USDC",
      "USDT:QCAD",
      "QCAD:USDT",
      "EURC:QCAD",
      "QCAD:EURC",
      "CIRBTC:QCAD",
      "QCAD:CIRBTC",
      "CNGN:QCAD",
      "QCAD:CNGN",
    ] as const)
  : ([] as const);

const SUPPORTED_SWAP_PAIR_KEYS = new Set<string>([
  "USDC:EURC",
  "EURC:USDC",
  "USDC:USDT",
  "USDT:USDC",
  "USDT:EURC",
  "EURC:USDT",
  "USDC:CIRBTC",
  "CIRBTC:USDC",
  "USDT:CIRBTC",
  "CIRBTC:USDT",
  "EURC:CIRBTC",
  "CIRBTC:EURC",
  // "USDC:CNGN",
  // "CNGN:USDC",
  // "USDT:CNGN",
  // "CNGN:USDT",
  // "EURC:CNGN",
  // "CNGN:EURC",
  // "CIRBTC:CNGN",
  // "CNGN:CIRBTC",
  ...QCAD_SWAP_PAIR_KEYS,
]);

export function isSupportedSwapPair(
  tokenInSymbol?: string | null,
  tokenOutSymbol?: string | null,
) {
  if (!tokenInSymbol || !tokenOutSymbol) {
    return false;
  }

  return SUPPORTED_SWAP_PAIR_KEYS.has(
    `${tokenInSymbol.toUpperCase()}:${tokenOutSymbol.toUpperCase()}`,
  );
}

/** Circle StableFX uses a managed settlement rather than a DEX route. */
export function isStableFxSwapPair(
  tokenInSymbol?: string | null,
  tokenOutSymbol?: string | null,
) {
  const fromCurrency = normalizeStableFxCurrency(tokenInSymbol);
  const toCurrency = normalizeStableFxCurrency(tokenOutSymbol);

  return Boolean(
    fromCurrency && toCurrency && isStableFxPair(fromCurrency, toCurrency),
  );
}

export function isAvailableSwapPair(
  tokenInSymbol?: string | null,
  tokenOutSymbol?: string | null,
) {
  return (
    isSupportedSwapPair(tokenInSymbol, tokenOutSymbol) ||
    isStableFxSwapPair(tokenInSymbol, tokenOutSymbol)
  );
}

export function isStableFxTokenPair(
  tokenIn?: SwapToken | null,
  tokenOut?: SwapToken | null,
) {
  return Boolean(
    tokenIn?.stableFx &&
      tokenOut?.stableFx &&
      isStableFxSwapPair(tokenIn.symbol, tokenOut.symbol),
  );
}

export function isSelectableSwapTokenPair(
  tokenIn?: SwapToken | null,
  tokenOut?: SwapToken | null,
) {
  if (!tokenIn || !tokenOut || tokenIn.id === tokenOut.id) {
    return false;
  }

  if (tokenIn.stableFx || tokenOut.stableFx) {
    return isStableFxTokenPair(tokenIn, tokenOut);
  }

  return isSupportedSwapPair(tokenIn.symbol, tokenOut.symbol);
}

/**
 * Returns every route the swap-card receive selector can offer for a source
 * currency. A currency may have both a normal DEX token and a StableFX token
 * entry, so this intentionally does not require the source entry to already
 * have the same route variant as the destination entry. The card switches the
 * source entry to the matching variant after the user makes their choice.
 */
export function getSwapSelectorCounterpartyTokens(
  tokenIn: SwapToken,
  availableTokens: readonly SwapToken[] = SWAP_SELECTOR_TOKENS,
): SwapToken[] {
  return availableTokens.filter((tokenOut) => {
    if (tokenOut.id === tokenIn.id) {
      return false;
    }

    if (tokenOut.stableFx) {
      return isStableFxSwapPair(tokenIn.symbol, tokenOut.symbol);
    }

    return isSupportedSwapPair(tokenIn.symbol, tokenOut.symbol);
  });
}

export function getSupportedCounterpartyTokens(
  tokenOrSymbol?: SwapToken | string | null,
  availableTokens: readonly SwapToken[] = SWAP_TOKENS,
): SwapToken[] {
  if (!tokenOrSymbol) {
    return [...availableTokens];
  }

  if (typeof tokenOrSymbol !== "string") {
    return availableTokens.filter((token) =>
      isSelectableSwapTokenPair(tokenOrSymbol, token),
    );
  }

  return availableTokens.filter(
    (token) =>
      token.symbol !== tokenOrSymbol &&
      isSupportedSwapPair(tokenOrSymbol, token.symbol),
  );
}

export function getSwapTokenBySymbol(
  symbol?: string | null,
  availableTokens: readonly SwapToken[] = SWAP_TOKENS,
): SwapToken | undefined {
  if (!symbol) {
    return undefined;
  }

  return availableTokens.find(
    (token) => token.symbol.toUpperCase() === symbol.toUpperCase(),
  );
}

export function buildSwapPath(params: {
  from?: string | null;
  to?: string | null;
}): string {
  const search = new URLSearchParams();
  const fromToken = getSwapTokenBySymbol(params.from);
  const toToken = getSwapTokenBySymbol(params.to);

  if (fromToken) {
    search.set("from", fromToken.symbol);
  }
  if (toToken) {
    search.set("to", toToken.symbol);
  }

  const query = search.toString();
  return query ? `/?${query}` : "/";
}
