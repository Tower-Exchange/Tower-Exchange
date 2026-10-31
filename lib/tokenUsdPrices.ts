import { getAeroUsdSpotPrices } from "@/lib/aeroDex";

export const DEFAULT_TOKEN_USD_PRICES = {
  USDC: 1,
  EURC: 1.08,
  USDT: 1,
  cirBTC: 77000,
  cNGN: 1,
  QCAD: 0.73,
  GBPA: 1.3,
  MXNB: 0.055,
  AUDF: 0.65,
} as const;

export type StableTokenSymbol = keyof typeof DEFAULT_TOKEN_USD_PRICES;
export type TokenUsdPriceMap = Record<StableTokenSymbol, number>;

const PRICE_FETCH_COOLDOWN_MS = 15_000;
const MIN_REASONABLE_EURC_USD_PRICE = 0.2;
const MAX_REASONABLE_EURC_USD_PRICE = 5;
const MIN_REASONABLE_CIRBTC_USD_PRICE = 1_000;
const MAX_REASONABLE_CIRBTC_USD_PRICE = 5_000_000;

let lastPriceFetchAt = 0;
let cachedPriceMap: TokenUsdPriceMap = {
  ...DEFAULT_TOKEN_USD_PRICES,
};
let pendingPriceFetch: Promise<TokenUsdPriceMap> | null = null;

const isReasonableEurcUsdPrice = (usdPrice: number) =>
  Number.isFinite(usdPrice) &&
  usdPrice >= MIN_REASONABLE_EURC_USD_PRICE &&
  usdPrice <= MAX_REASONABLE_EURC_USD_PRICE;

const isReasonableCirBtcUsdPrice = (usdPrice: number) =>
  Number.isFinite(usdPrice) &&
  usdPrice >= MIN_REASONABLE_CIRBTC_USD_PRICE &&
  usdPrice <= MAX_REASONABLE_CIRBTC_USD_PRICE;

const applyAeroPrices = (
  priceMap: TokenUsdPriceMap,
  aeroPrices: { USDC: number; EURC: number | null; cirBTC: number | null },
) => {
  priceMap.USDC = aeroPrices.USDC;

  if (aeroPrices.EURC && isReasonableEurcUsdPrice(aeroPrices.EURC)) {
    priceMap.EURC = aeroPrices.EURC;
  }

  if (aeroPrices.cirBTC && isReasonableCirBtcUsdPrice(aeroPrices.cirBTC)) {
    priceMap.cirBTC = aeroPrices.cirBTC;
  }

  return priceMap;
};

const readNumericPrice = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

async function fetchAeroUsdPricesFromApi(): Promise<{
  USDC: number;
  EURC: number | null;
  cirBTC: number | null;
} | null> {
  const response = await fetch("/api/prices", { cache: "no-store" });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return {
    USDC: 1,
    EURC: readNumericPrice(payload.EURC),
    cirBTC: readNumericPrice(payload.cirBTC),
  };
}

export async function deriveCirBtcUsdPrice() {
  try {
    const aeroPrices =
      typeof window === "undefined"
        ? await getAeroUsdSpotPrices()
        : (await fetchAeroUsdPricesFromApi()) ?? (await getAeroUsdSpotPrices());
    return aeroPrices.cirBTC && isReasonableCirBtcUsdPrice(aeroPrices.cirBTC)
      ? aeroPrices.cirBTC
      : null;
  } catch (error) {
    console.warn("Failed to derive cirBTC USD price from Aero", error);
    return null;
  }
}

export async function fetchArcTokenUsdPrices(): Promise<TokenUsdPriceMap> {
  const now = Date.now();

  if (pendingPriceFetch) {
    return pendingPriceFetch;
  }

  if (now - lastPriceFetchAt < PRICE_FETCH_COOLDOWN_MS) {
    return {
      ...cachedPriceMap,
    };
  }

  pendingPriceFetch = (async () => {
    const priceMap: TokenUsdPriceMap = {
      ...cachedPriceMap,
    };

    try {
      const aeroPrices =
        typeof window === "undefined"
          ? await getAeroUsdSpotPrices()
          : (await fetchAeroUsdPricesFromApi()) ??
            (await getAeroUsdSpotPrices());

      applyAeroPrices(priceMap, aeroPrices);
    } catch (error) {
      console.warn(
        "Failed to fetch Aero DEX USD prices, using cached prices",
        error,
      );
    }

    priceMap.cNGN = DEFAULT_TOKEN_USD_PRICES.cNGN;

    cachedPriceMap = priceMap;
    lastPriceFetchAt = Date.now();
    return {
      ...cachedPriceMap,
    };
  })();

  try {
    return await pendingPriceFetch;
  } finally {
    pendingPriceFetch = null;
  }
}
