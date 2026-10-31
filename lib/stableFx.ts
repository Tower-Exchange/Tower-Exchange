/**
 * StableFX is Circle's permissioned RFQ FX product on Arc. Tower initially
 * knows about the complete configured currency set. This is deliberately
 * distinct from what Tower exposes to customers: GBPA and AUDF remain ready
 * for a later launch, but must not be selectable or executable until then.
 * Do not add a token here merely because it is present in Tower's bridge or
 * swap registries: Circle must enable the currency and requested corridor for
 * Tower's account.
 */
export const STABLEFX_CURRENCIES = ["USDC", "EURC", "GBPA", "MXNB", "AUDF"] as const;

export type StableFxCurrency = (typeof STABLEFX_CURRENCIES)[number];
export type StableFxAmountSide = "from" | "to";

/**
 * Currencies currently visible in the customer Swap selector. USDC and EURC
 * remain available for the existing EURC corridor; MXNB is the only newly
 * launched FX currency. Keep GBPA and AUDF out of this list until their
 * customer launch is approved.
 */
export const STABLEFX_CUSTOMER_VISIBLE_CURRENCIES = [
  "USDC",
  "EURC",
  "MXNB",
] as const satisfies readonly StableFxCurrency[];

export type StableFxCustomerVisibleCurrency =
  (typeof STABLEFX_CUSTOMER_VISIBLE_CURRENCIES)[number];

export const isStableFxCustomerVisibleCurrency = (
  value: unknown,
): value is StableFxCustomerVisibleCurrency =>
  typeof value === "string" &&
  (STABLEFX_CUSTOMER_VISIBLE_CURRENCIES as readonly string[]).includes(value);

// Public Arc mainnet currency metadata used by both the StableFX order flow
// and the Stable FX card's read-only wallet-balance display. Keep this list
// deliberately separate from the general DEX token registry.
export const STABLEFX_ARC_MAINNET_TOKENS = {
  USDC: {
    address: "0x3600000000000000000000000000000000000000",
    decimals: 6,
  },
  EURC: {
    address: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
    decimals: 6,
  },
  GBPA: {
    address: "0xbBe6aAB0Ed76e90AeA0d1cd978EC231c8AdCDF8b",
    decimals: 6,
  },
  MXNB: {
    address: "0xF197FFC28c23E0309B5559e7a166f2c6164C80aA",
    decimals: 6,
  },
  AUDF: {
    address: "0xd2a530170D71a9Cfe1651Fb468E2B98F7Ed7456b",
    decimals: 6,
  },
} as const satisfies Record<
  StableFxCurrency,
  { address: `0x${string}`; decimals: number }
>;

const STABLEFX_AMOUNT_PATTERN = /^\d+(?:\.\d{1,6})?$/;

export const isStableFxCurrency = (
  value: unknown,
): value is StableFxCurrency =>
  typeof value === "string" &&
  STABLEFX_CURRENCIES.includes(value.toUpperCase() as StableFxCurrency);

export const normalizeStableFxCurrency = (
  value: unknown,
): StableFxCurrency | null => {
  if (!isStableFxCurrency(value)) {
    return null;
  }

  return value.toUpperCase() as StableFxCurrency;
};

export const isStableFxAmount = (value: unknown): value is string => {
  if (typeof value !== "string") {
    return false;
  }

  const amount = value.trim();
  if (!STABLEFX_AMOUNT_PATTERN.test(amount)) {
    return false;
  }

  const [whole, fraction = ""] = amount.split(".");
  return BigInt(`${whole}${fraction.padEnd(6, "0")}`) > 0n;
};

/**
 * StableFX routes Tower currently permits. MXNB is deliberately restricted to
 * USDC. GBPA and AUDF are configured currencies but have no enabled routes,
 * so a crafted API request cannot create a customer trade before launch.
 * Circle's live RFQ response remains the authority for liquidity.
 */
export const STABLEFX_ALLOWED_DESTINATIONS: Readonly<
  Record<StableFxCurrency, readonly StableFxCurrency[]>
> = {
  USDC: ["EURC", "MXNB"],
  EURC: ["USDC"],
  GBPA: [],
  MXNB: ["USDC"],
  AUDF: [],
};

export const isStableFxPair = (
  fromCurrency: StableFxCurrency,
  toCurrency: StableFxCurrency,
) => STABLEFX_ALLOWED_DESTINATIONS[fromCurrency].includes(toCurrency);
