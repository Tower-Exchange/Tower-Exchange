"use client";

import { useEffect, useRef } from "react";
import Image, { type StaticImageData } from "next/image";
import { motion } from "framer-motion";
import { ChevronDown, Info } from "lucide-react";
import { formatUnits } from "viem";

import { formatUsdAmount } from "@/lib/formatUsdAmount";
import quotesIcon from "@/public/assets/quotes icon.svg";
import synthraLogo from "@/public/assets/synthralogo.svg";
import towerLogo from "@/public/assets/Tower Logo.svg";
import unitflowLogo from "@/public/assets/unitflow.svg";
import aeroLogo from "@/public/assets/aero-icon 1.svg";
import kyberLogo from "@/public/assets/kyber-logo-knc 1.svg";
import uniswapLogo from "@/public/assets/Uniswap_icon_pink 1.svg";
import routeIcon from "@/public/assets/route icon.svg";

interface RouteOption {
  dexId: string;
  dexName: string;
  outputAmount: string;
  routeType: string;
  isFallback?: boolean;
  quote?: {
    outputAmount?: string;
    outputAmountRaw?: string;
    outputAmountNative?: string;
    outputTokenDecimals?: number;
  };
}

interface RouterDisplayProps {
  selectedRouterId?: string;
  routeOptions?: RouteOption[];
  inputUsdValue?: number;
  outputTokenUsdPrice?: number;
  outputTokenSymbol?: string;
  availableRouterIds?: string[];
  isQuoteSearchPending?: boolean;
}

type SupportedRouter = {
  id: "synthra" | "unitflow" | "tower-dex" | "aero" | "kyberswap" | "uniswap";
  aliases: string[];
  name: string;
  logo: StaticImageData | string;
};

const SUPPORTED_ROUTERS: SupportedRouter[] = [
  {
    id: "synthra",
    aliases: ["synthra", "synthra-v3"],
    name: "Synthra",
    logo: synthraLogo,
  },
  {
    id: "unitflow",
    aliases: ["unitflow", "unitflow-v3", "unitflow-finance"],
    name: "UnitFlow",
    logo: unitflowLogo,
  },
  {
    id: "tower-dex",
    aliases: ["tower-dex", "tower-amm", "tower"],
    name: "Tower",
    logo: towerLogo,
  },
  {
    id: "aero",
    aliases: ["aero", "aerodrome", "aero-cl", "aero-slipstream", "slipstream"],
    name: "Aero",
    logo: aeroLogo,
  },
  {
    id: "kyberswap",
    aliases: ["kyberswap", "kyber", "kyber-swap", "knc"],
    name: "KyberSwap",
    logo: kyberLogo,
  },
  {
    id: "uniswap",
    aliases: ["uniswap", "uni", "uniswap-v4", "uniswap-v3"],
    name: "Uniswap",
    logo: uniswapLogo,
  },
];

const ROUTE_OUTPUT_DISPLAY_DECIMALS: Record<string, number> = {
  USDC: 2,
  EURC: 2,
  USDT: 2,
  cirBTC: 8,
  cNGN: 2,
  QCAD: 2,
};

const ROUTE_TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  EURC: 6,
  USDT: 18,
  cirBTC: 8,
  cNGN: 6,
  QCAD: 6,
};

const MAX_DISPLAYED_ROUTES = 3;

const getRouteOutputDisplayDecimals = (symbol?: string) =>
  symbol ? (ROUTE_OUTPUT_DISPLAY_DECIMALS[symbol] ?? 6) : 6;

const getRouteTokenDecimals = (symbol?: string, quoteDecimals?: number) => {
  if (typeof quoteDecimals === "number" && quoteDecimals > 0) {
    return quoteDecimals;
  }

  return symbol ? (ROUTE_TOKEN_DECIMALS[symbol] ?? 18) : 18;
};

const normalizeRouterId = (id = "") => {
  const normalizedId = id.toLowerCase();

  return (
    SUPPORTED_ROUTERS.find((router) => router.aliases.includes(normalizedId))
      ?.id || normalizedId
  );
};

const outputAmountToBigInt = (amount?: string) => {
  try {
    return BigInt(amount || "0");
  } catch {
    return 0n;
  }
};

const parsePositiveTokenAmount = (amount?: string, decimals = 18) => {
  if (!amount || !amount.trim()) {
    return null;
  }

  const trimmed = amount.trim();
  if (trimmed.includes(".")) {
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  try {
    const rawAmount = BigInt(trimmed);
    if (rawAmount <= 0n) {
      return null;
    }

    const tokenAmount = Number.parseFloat(formatUnits(rawAmount, decimals));
    return Number.isFinite(tokenAmount) && tokenAmount > 0 ? tokenAmount : null;
  } catch {
    return null;
  }
};

const getResolvedRouteOutputAmount = (option?: RouteOption | null) =>
  option?.quote?.outputAmount ||
  option?.outputAmount ||
  option?.quote?.outputAmountNative ||
  option?.quote?.outputAmountRaw ||
  "";

const routeTokenAmountFromOption = (
  option?: RouteOption | null,
  outputTokenSymbol?: string,
) => {
  const fromNormalized = parsePositiveTokenAmount(
    option?.quote?.outputAmount || option?.outputAmount,
    18,
  );
  if (fromNormalized != null && fromNormalized >= 1e-8) {
    return fromNormalized;
  }

  const nativeDecimals = getRouteTokenDecimals(
    outputTokenSymbol,
    option?.quote?.outputTokenDecimals,
  );
  const fromNative = parsePositiveTokenAmount(
    option?.quote?.outputAmountRaw ||
      option?.quote?.outputAmountNative ||
      option?.outputAmount,
    nativeDecimals,
  );

  return fromNative ?? fromNormalized;
};

const formatRouteTokenAmount = (
  option?: RouteOption | null,
  outputTokenSymbol?: string,
) => {
  const tokenAmount = routeTokenAmountFromOption(option, outputTokenSymbol);

  if (tokenAmount === null) {
    return "-";
  }

  return tokenAmount.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: getRouteOutputDisplayDecimals(outputTokenSymbol),
  });
};

const getRouteUsdValue = (
  option?: RouteOption | null,
  outputTokenUsdPrice?: number,
  outputTokenSymbol?: string,
) => {
  const tokenAmount = routeTokenAmountFromOption(option, outputTokenSymbol);

  if (tokenAmount === null) {
    return null;
  }

  if (typeof outputTokenUsdPrice !== "number" || outputTokenUsdPrice <= 0) {
    return null;
  }

  const usdValue = tokenAmount * outputTokenUsdPrice;
  return Number.isFinite(usdValue) && usdValue > 0 ? usdValue : null;
};

const formatRouteUsdValue = (usdValue: number | null) =>
  usdValue === null ? null : formatUsdAmount(usdValue, 1);

const roundUsdToCents = (usdValue: number) => Math.round(usdValue * 100);

const formatRouteAddedValue = (
  routeUsdValue: number | null,
  inputUsdValue?: number,
) => {
  if (
    routeUsdValue === null ||
    typeof inputUsdValue !== "number" ||
    !Number.isFinite(inputUsdValue) ||
    inputUsdValue <= 0
  ) {
    return null;
  }

  const extraCents = roundUsdToCents(routeUsdValue) - roundUsdToCents(inputUsdValue);

  if (extraCents <= 0) {
    return null;
  }

  return `+${formatUsdAmount(extraCents / 100, 1)}`;
};

export default function RouterDisplay({
  routeOptions = [],
  inputUsdValue,
  outputTokenUsdPrice,
  outputTokenSymbol,
  availableRouterIds = [],
  isQuoteSearchPending = false,
}: RouterDisplayProps) {
  const routesDetailsRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: PointerEvent) => {
      if (
        routesDetailsRef.current &&
        routesDetailsRef.current.hasAttribute("open") &&
        !routesDetailsRef.current.contains(event.target as Node)
      ) {
        routesDetailsRef.current.removeAttribute("open");
      }
    };

    document.addEventListener("pointerdown", handleClickOutside);
    return () => {
      document.removeEventListener("pointerdown", handleClickOutside);
    };
  }, []);

  const routeOptionByDexId = routeOptions.reduce((optionsByDexId, option) => {
    const dexId = normalizeRouterId(option.dexId);
    const existingOption = optionsByDexId.get(dexId);

    if (
      !existingOption ||
      outputAmountToBigInt(getResolvedRouteOutputAmount(option)) >
        outputAmountToBigInt(getResolvedRouteOutputAmount(existingOption))
    ) {
      optionsByDexId.set(dexId, option);
    }

    return optionsByDexId;
  }, new Map<string, RouteOption>());

  const normalizedAvailableRouterIds = Array.from(
    new Set(availableRouterIds.map((routerId) => normalizeRouterId(routerId))),
  );
  const availableRouterIdSet = new Set(normalizedAvailableRouterIds);
  const priorityIndexByDexId = new Map(
    normalizedAvailableRouterIds.map((routerId, index) => [routerId, index]),
  );
  const routeIdsFromOptions = Array.from(routeOptionByDexId.keys());
  const routerCandidates = [
    ...SUPPORTED_ROUTERS.filter((router) =>
      availableRouterIdSet.size === 0
        ? routeIdsFromOptions.includes(router.id)
        : availableRouterIdSet.has(router.id),
    ),
    ...routeIdsFromOptions
      .filter((routeId) => !SUPPORTED_ROUTERS.some((router) => router.id === routeId))
      .map((routeId) => ({
        id: routeId,
        aliases: [routeId],
        name: routeId,
        logo: towerLogo,
      })),
  ];
  const routersToDisplay = routerCandidates.map((router, index) => ({ router, index }));

  const unsortedQuotedRoutes = routersToDisplay
    .map(({ router, index }) => {
      const option = routeOptionByDexId.get(router.id) ?? null;
      const outputAmount = outputAmountToBigInt(
        getResolvedRouteOutputAmount(option),
      );
      const tokenAmount = routeTokenAmountFromOption(option, outputTokenSymbol);

      return {
        router: {
          ...router,
          id: router.id,
          name: router.name,
          logo: router.logo,
        },
        option,
        outputAmount,
        hasQuote: outputAmount > 0n || tokenAmount != null,
        index,
      };
    })
    .filter((route) => {
      if (availableRouterIdSet.size > 0) {
        return availableRouterIdSet.has(route.router.id);
      }

      return route.option !== null && route.hasQuote;
    });
  const allQuotedRoutes = [...unsortedQuotedRoutes].sort(
    (leftRoute, rightRoute) => {
      if (leftRoute.hasQuote !== rightRoute.hasQuote) {
        return leftRoute.hasQuote ? -1 : 1;
      }

      if (leftRoute.outputAmount !== rightRoute.outputAmount) {
        return leftRoute.outputAmount > rightRoute.outputAmount ? -1 : 1;
      }

      const leftFallback = leftRoute.option?.isFallback === true;
      const rightFallback = rightRoute.option?.isFallback === true;
      if (leftFallback !== rightFallback) {
        return leftFallback ? 1 : -1;
      }

      const leftPriority =
        priorityIndexByDexId.get(leftRoute.router.id) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority =
        priorityIndexByDexId.get(rightRoute.router.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return leftRoute.index - rightRoute.index;
    },
  );

  if (allQuotedRoutes.length === 0) {
    return null;
  }

  // Routes are sorted by the best quote above, so keep the three most competitive.
  const displayedRoutes = allQuotedRoutes.slice(0, MAX_DISPLAYED_ROUTES);
  const bestQuotedRoute =
    allQuotedRoutes.find((route) => route.hasQuote) ?? null;
  const bestPriceRouterId = bestQuotedRoute?.router.id;
  const dexCount = allQuotedRoutes.length;
  const primaryDexName = allQuotedRoutes[0]?.router.name || "Router";
  const otherDexNames = allQuotedRoutes.slice(1).map(({ router }) => router.name);
  const dexNamesLabel = otherDexNames.length
    ? `${primaryDexName} and ${otherDexNames.length} other${
        otherDexNames.length === 1 ? "" : "s"
      }`
    : primaryDexName;

  return (
    <section className="relative w-full overflow-visible rounded-2xl border border-border bg-card shadow-[0_18px_40px_rgba(0,0,0,0.25)]">
      <div className="flex flex-nowrap items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Image
            src={quotesIcon}
            alt=""
            width={16}
            height={16}
            aria-hidden
            className="h-4 w-4 shrink-0 object-contain"
          />
          <span className="text-sm font-semibold text-foreground">Quotes</span>
        </div>
        <div className="flex min-w-0 flex-nowrap items-center gap-1.5">
          <div className="flex min-w-0 flex-nowrap items-center gap-1.5">
            <span
              className="inline-flex h-[18px] min-w-6 shrink-0 items-center justify-center rounded-full border border-white/20 bg-muted px-1 text-foreground"
              aria-label={`${dexCount} DEX routes available`}
            >
              <span className="flex items-center justify-center gap-0.5 text-[9px] font-bold leading-none">
                <span>{dexCount}</span>
                <Image
                  src={routeIcon}
                  alt=""
                  width={7}
                  height={7}
                  className="h-[7px] w-[7px] shrink-0 object-contain"
                />
              </span>
            </span>
            {otherDexNames.length > 0 ? (
              <details ref={routesDetailsRef} className="group/routes relative min-w-0">
                <summary className="flex min-w-0 cursor-pointer list-none items-center gap-1 whitespace-nowrap text-[11px] font-medium leading-none text-muted-foreground outline-none [&::-webkit-details-marker]:hidden">
                  <span className="text-[9px] font-normal leading-none text-muted-foreground/80">
                    Via
                  </span>
                  <span className="truncate text-white">{dexNamesLabel}</span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground transition-transform group-open/routes:rotate-180" />
                </summary>
                <div className="absolute right-0 top-full z-50 mt-2 min-w-36 rounded-lg border border-border bg-popover px-2 py-1.5 text-[11px] text-muted-foreground shadow-[0_16px_32px_rgba(0,0,0,0.45)]">
                  {otherDexNames.map((name) => (
                    <div key={name} className="whitespace-nowrap px-2 py-1">
                      {name}
                    </div>
                  ))}
                </div>
              </details>
            ) : (
              <span className="flex min-w-0 items-center gap-1 whitespace-nowrap text-[11px] font-medium leading-none text-muted-foreground">
                <span className="text-[9px] font-normal leading-none text-muted-foreground/80">
                  Via
                </span>
                <span className="truncate">{dexNamesLabel}</span>
              </span>
            )}
          </div>
          <span className="group relative flex h-4 w-4 shrink-0 items-center justify-center">
            <Info
              className="h-3.5 w-3.5 text-muted-foreground outline-none"
              tabIndex={0}
              aria-describedby="router-quotes-info"
            />
            <span
              id="router-quotes-info"
              role="tooltip"
              className="pointer-events-none absolute bottom-full right-0 z-50 mb-2 w-64 rounded-lg border border-border bg-popover px-3 py-2 text-left text-[11px] font-normal leading-4 text-muted-foreground opacity-0 shadow-[0_16px_32px_rgba(0,0,0,0.45)] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              Quotes from major routers on Tower are simulated on the same block
              to find the best executable prices.
            </span>
          </span>
        </div>
      </div>

      <div className="space-y-1 p-1.5">
        {displayedRoutes.map(({ router, option, hasQuote }) => {
          const isBestPrice = Boolean(bestPriceRouterId) && router.id === bestPriceRouterId;
          const isSelected = isBestPrice;
          const isPendingQuote = !hasQuote && isQuoteSearchPending;
          const routeUsdAmount = hasQuote
            ? getRouteUsdValue(option, outputTokenUsdPrice, outputTokenSymbol)
            : null;
          const routeUsdValue = formatRouteUsdValue(routeUsdAmount);
          const routeAddedValue = isBestPrice
            ? formatRouteAddedValue(routeUsdAmount, inputUsdValue)
            : null;

          return (
            <motion.div
              key={router.id}
              role="listitem"
              className={`relative flex min-h-[52px] w-full items-center justify-between gap-2 rounded-sm px-2.5 py-2 text-left transition-colors sm:gap-3 sm:px-3 ${
                isSelected
                  ? "overflow-hidden shadow-[0_2px_6px_rgba(0,0,0,.35)]"
                  : "border border-transparent"
              }`}
            >
              {/* Deep-glass backdrop — extends 2× the row height so backdrop-filter blur()
                  picks up elements below the row (Josh W. Comeau technique).
                  A mask trims the visual back to just the row area. */}
              {isSelected && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[200%] rounded-sm bg-accent/50"
                  style={{
                    backdropFilter: "blur(14px)",
                    WebkitBackdropFilter: "blur(14px)",
                    maskImage:
                      "linear-gradient(to bottom, black 0% 50%, transparent 50% 100%)",
                    WebkitMaskImage:
                      "linear-gradient(to bottom, black 0% 50%, transparent 50% 100%)",
                  }}
                />
              )}
              {/* Border overlay — rendered at z-20 (above backdrop z-0 and content z-10)
                  so the complete border is always visible on all 4 sides. */}
              {isSelected && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 z-20 rounded-sm"
                  style={{
                    boxShadow:
                      "inset 0 0 0 1px rgba(123,184,255,0.45), inset 0 1px 0 rgba(255,255,255,.09), inset 0 -1px 0 rgba(0,0,0,.35)",
                  }}
                />
              )}
              <span className="relative z-10 flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
                <Image
                  src={router.logo}
                  alt={`${router.name} logo`}
                  width={18}
                  height={18}
                  className="h-[18px] w-[18px] shrink-0 object-contain"
                />
                <span className="min-w-[3.4rem] truncate text-sm font-medium text-foreground sm:min-w-0">
                  {router.name}
                </span>
                {isBestPrice && (
                  <span className="shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium leading-none text-primary">
                    Best Price
                  </span>
                )}
              </span>
              <span className="relative z-10 flex min-w-[7.4rem] shrink-0 flex-col items-end text-right leading-tight sm:min-w-[168px]">
                <span className="flex w-full min-w-0 items-center justify-end gap-1.5 sm:gap-2">
                  {isBestPrice && routeAddedValue ? (
                    <span className="whitespace-nowrap text-[10px] font-normal tabular-nums leading-none text-[#07D54F]">
                      {routeAddedValue}
                    </span>
                  ) : null}
                  <span
                    className={`tabular-nums ${
                      hasQuote
                        ? "text-foreground"
                        : "text-muted-foreground/80"
                    } ${isPendingQuote ? "animate-pulse" : ""} ${
                      isPendingQuote ? "text-xl leading-none" : "text-sm"
                    }`}
                    aria-label={isPendingQuote ? "Loading quote" : undefined}
                  >
                    {isPendingQuote
                      ? "···"
                      : formatRouteTokenAmount(option, outputTokenSymbol)}
                  </span>
                </span>
                {routeUsdValue ? (
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    ~ {routeUsdValue}
                  </span>
                ) : null}
              </span>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
