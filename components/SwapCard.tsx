"use client";
import {
  ArrowDown,
  // BarChart3,
  Clock,
  RefreshCw,
  Settings,
  ChevronDown,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import {
  encodeFunctionData,
  formatUnits,
  parseUnits,
  type Address,
} from "viem";
import {
  formatBalance,
  getRevertReasonViaPublicRpc,
  TOKEN_DECIMALS,
  NATIVE_TOKENS,
  ARC_NETWORK_CHAIN_ID,
  getArcNetworkHex,
  getArcNetworkLabel,
  normalizeArcChainHex,
} from "@/lib/arcNetwork";
import { getArcSwapTokenAddress } from "@/lib/aeroDex";
import { getArcRpcProxyPath } from "@/lib/arcRpc";
import { isXylonetEnabled } from "@/lib/xylonetEnabled";
import { isKyberEnabled } from "@/lib/kyberEnabled";
import { isUniswapEnabled } from "@/lib/uniswapEnabled";
import { isDe1Enabled } from "@/lib/de1Enabled";
import { ensureWalletOnArcNetwork } from "@/lib/arcWalletNetwork";
import {
  useTowerSwap,
  type SwapQuote,
  type SwapRouteOption,
} from "@/lib/hooks/useTowerSwap";
import { useTowerNetworkMode } from "@/lib/hooks/useTowerNetworkMode";
import {
  getSwapSelectorCounterpartyTokens,
  isSelectableSwapTokenPair,
  isStableFxTokenPair,
  isSupportedSwapPair,
  SWAP_SELECTOR_TOKENS,
  type SwapToken,
  type SwapTokenSymbol,
} from "@/lib/swapTokens";
import {
  isStableFxCurrency,
  STABLEFX_ARC_MAINNET_TOKENS,
} from "@/lib/stableFx";
import TokenModal from "./TokenModal";
import SettingsModal from "./SettingsModal";
// import ChartModal from "./ChartModal";
import TokenInput from "./reusable/TokenInput";
import SwapNotification from "./SwapNotification";
import RouterDisplay from "./RouterDisplay";
import StableFxPanel, {
  type StableFxTransactionProgress,
} from "./StableFxPanel";
import ActivityTabModal, { type ActivityTabLiveItem } from "./ActivityTabModal";
import TransactionStepsModal, {
  type TransactionStep,
} from "./TransactionStepsModal";
import { insertActivity } from "@/lib/supabase";
import { recordExecutorSwapFee } from "@/lib/swapFeeTracking";
import {
  formatTokenUnitUsdPrice,
  formatUsdAmount,
} from "@/lib/formatUsdAmount";
import {
  DEFAULT_TOKEN_USD_PRICES,
  fetchArcTokenUsdPrices,
} from "@/lib/tokenUsdPrices";
import { useRainbowKitAuth } from "@/lib/use-rainbowkit-auth";
import {
  getBrowserWalletChainId,
  getBrowserWalletProvider,
  type BrowserWalletTransactionReceipt,
} from "@/lib/browser-wallet";
import arcTestnetLogo from "@/public/assets/ARCSvg.svg";
const NATIVE_USDC_GAS_RESERVE = 0.05;
const QUOTE_REFRESH_INTERVAL_MS = 10000;
const QUOTE_INPUT_DEBOUNCE_MS = 500;
const QUOTE_REVEAL_WAIT_MS = 12_000;
const TOKEN_PRICE_REFRESH_INTERVAL_MS = 60_000;
const SWAP_SUCCESS_NOTIFICATION_DURATION_MS = 10000;
const SWAP_SUCCESS_RESET_DELAY_MS = SWAP_SUCCESS_NOTIFICATION_DURATION_MS + 500;
const STABLEFX_INSTANT_TENOR_MS = 30 * 60 * 1000;
const ARC_NATIVE_USDC_DECIMALS = 18;
const RECEIPT_REQUEST_TIMEOUT_MS = 12000;
const RECEIPT_WALLET_LOOKUP_TIMEOUT_MS = 4000;
const RECEIPT_POLL_INTERVAL_MS = 1000;
const APPROVAL_RECEIPT_WAIT_MS = 180000;
const APPROVAL_EXTENDED_WAIT_MS = 900000;
const SWAPS_DISABLED = process.env.NEXT_PUBLIC_SWAPS_DISABLED !== "false";
const SWAPS_DISABLED_MESSAGE = "Swaps are temporarily paused for maintenance.";
const OUTPUT_DISPLAY_DECIMALS: Partial<Record<SwapTokenSymbol, number>> = {
  USDC: 6,
  EURC: 6,
  USDT: 6,
  cirBTC: 8,
  cNGN: 6,
  QCAD: 6,
};

const getOutputDisplayDecimals = (symbol?: SwapTokenSymbol | null) =>
  symbol ? (OUTPUT_DISPLAY_DECIMALS[symbol] ?? 6) : 6;

const formatStableFxCountdown = (remainingMs: number) => {
  const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

type StableFxStepsPhase = StableFxTransactionProgress["phase"];
type StableFxFailedStep = "deposit" | "confirm" | "settlement" | "payout";

type JsonRpcResponse<T> = {
  result?: T;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

type RpcTransaction = {
  blockNumber?: string | null;
  hash?: string;
  nonce?: string;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const callArcRpc = async <T,>(
  method: string,
  params: unknown[],
  timeoutMs: number,
  label: string,
  rpcUrl: string,
): Promise<T> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
        id: Date.now(),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `${label} failed (${response.status}): ${errorText.slice(0, 240)}`,
      );
    }

    const data = (await response.json()) as JsonRpcResponse<T>;
    if (data.error) {
      throw new Error(data.error.message || `${label} returned an RPC error`);
    }

    return data.result as T;
  } catch (error: unknown) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    if (errorObj.name === "AbortError") {
      throw new Error(
        `${label} timed out after ${Math.round(timeoutMs / 1000)} seconds`,
      );
    }
    throw errorObj;
  } finally {
    clearTimeout(timeoutId);
  }
};

const waitForArcTransactionReceipt = async (
  txHash: string,
  {
    label,
    maxWaitMs,
    requestTimeoutMs = RECEIPT_REQUEST_TIMEOUT_MS,
    pollIntervalMs = RECEIPT_POLL_INTERVAL_MS,
    walletReceiptLookup,
    rpcUrl,
  }: {
    label: string;
    maxWaitMs: number;
    requestTimeoutMs?: number;
    pollIntervalMs?: number;
    rpcUrl: string;
    walletReceiptLookup?: (
      txHash: string,
      label: string,
    ) => Promise<BrowserWalletTransactionReceipt | null>;
  },
): Promise<BrowserWalletTransactionReceipt | null> => {
  const startedAt = Date.now();
  let attempt = 0;
  let lastErrorMessage: string | null = null;

  while (Date.now() - startedAt < maxWaitMs) {
    attempt += 1;

    const lookups = [
      callArcRpc<BrowserWalletTransactionReceipt | null>(
        "eth_getTransactionReceipt",
        [txHash],
        requestTimeoutMs,
        `${label} via Arc RPC`,
        rpcUrl,
      ).then((receipt) => ({ source: "Arc RPC", receipt })),
    ];

    if (walletReceiptLookup) {
      lookups.push(
        walletReceiptLookup(txHash, `${label} via wallet`).then((receipt) => ({
          source: "wallet",
          receipt,
        })),
      );
    }

    const receiptResult = await new Promise<{
      source: string;
      receipt: BrowserWalletTransactionReceipt;
    } | null>((resolve) => {
      let pending = lookups.length;
      let settled = false;

      lookups.forEach((lookup) => {
        lookup
          .then((result) => {
            if (settled) {
              return;
            }

            if (result.receipt) {
              settled = true;
              resolve({
                source: result.source,
                receipt: result.receipt,
              });
              return;
            }

            pending -= 1;
            if (pending === 0) {
              resolve(null);
            }
          })
          .catch((error: unknown) => {
            lastErrorMessage =
              error instanceof Error ? error.message : String(error);
            pending -= 1;
            if (!settled && pending === 0) {
              resolve(null);
            }
          });
      });
    });

    if (receiptResult) {
      console.log(`${label} found through ${receiptResult.source}`, {
        txHash,
        attempt,
      });
      return receiptResult.receipt;
    }

    if (lastErrorMessage && (attempt === 1 || attempt % 10 === 0)) {
      console.warn(`${label} still pending`, {
        txHash,
        attempt,
        message: lastErrorMessage,
      });
    }

    if (Date.now() - startedAt + pollIntervalMs < maxWaitMs) {
      await sleep(pollIntervalMs);
    }
  }

  if (lastErrorMessage) {
    console.warn(`${label} did not return a receipt before timeout`, {
      txHash,
      message: lastErrorMessage,
    });
  }

  return null;
};

const getArcTransactionByHash = (
  txHash: string,
  label: string,
  rpcUrl: string,
) =>
  callArcRpc<RpcTransaction | null>(
    "eth_getTransactionByHash",
    [txHash],
    RECEIPT_REQUEST_TIMEOUT_MS,
    label,
    rpcUrl,
  );

const ERC20_ALLOWANCE_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const readArcErc20Allowance = async (
  token: string,
  owner: string,
  spender: string,
  rpcUrl: string,
) => {
  const result = await callArcRpc<string>(
    "eth_call",
    [
      {
        to: token,
        data: encodeFunctionData({
          abi: ERC20_ALLOWANCE_ABI,
          functionName: "allowance",
          args: [owner as Address, spender as Address],
        }),
      },
      "latest",
    ],
    RECEIPT_REQUEST_TIMEOUT_MS,
    "Allowance lookup",
    rpcUrl,
  );

  return BigInt(result || "0x0");
};

const confirmArcSubmittedTransaction = async (
  txHash: string,
  {
    label,
    rpcUrl,
    walletReceiptLookup,
    initialWaitMs = APPROVAL_RECEIPT_WAIT_MS,
    extendedWaitMs = APPROVAL_EXTENDED_WAIT_MS,
  }: {
    label: string;
    rpcUrl: string;
    walletReceiptLookup?: (
      txHash: string,
      label: string,
    ) => Promise<BrowserWalletTransactionReceipt | null>;
    initialWaitMs?: number;
    extendedWaitMs?: number;
  },
): Promise<BrowserWalletTransactionReceipt> => {
  let receipt = await waitForArcTransactionReceipt(txHash, {
    label: `${label} receipt lookup`,
    maxWaitMs: initialWaitMs,
    walletReceiptLookup,
    rpcUrl,
  });

  if (receipt) {
    return receipt;
  }

  const lookupPendingTx = () =>
    getArcTransactionByHash(txHash, `${label} pending lookup`, rpcUrl).catch(
      (error: unknown) => {
        console.warn(`${label} pending lookup failed`, {
          txHash,
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      },
    );

  const waitWhilePending = async () => {
    const extendedWaitStartedAt = Date.now();
    let missingPendingLookups = 0;

    while (Date.now() - extendedWaitStartedAt < extendedWaitMs) {
      await sleep(5000);
      receipt = await waitForArcTransactionReceipt(txHash, {
        label: `${label} extended receipt lookup`,
        maxWaitMs: 15000,
        pollIntervalMs: 3000,
        walletReceiptLookup,
        rpcUrl,
      });
      if (receipt) {
        return receipt;
      }

      const latestPendingTx = await lookupPendingTx();
      if (!latestPendingTx) {
        missingPendingLookups += 1;
      } else {
        missingPendingLookups = 0;
        if (latestPendingTx.blockNumber) {
          receipt = await waitForArcTransactionReceipt(txHash, {
            label: `${label} mined receipt lookup`,
            maxWaitMs: 30000,
            walletReceiptLookup,
            rpcUrl,
          });
          if (receipt) {
            return receipt;
          }
        }
      }

      if (missingPendingLookups >= 4) {
        throw new Error(
          `${label} was dropped by Arc RPC before confirmation. Check the explorer, then retry.`,
        );
      }
    }

    throw new Error(
      `${label} is still pending. Check the explorer before retrying.`,
    );
  };

  let pendingTx = await lookupPendingTx();

  if (!pendingTx) {
    const invisibleWaitStartedAt = Date.now();
    while (Date.now() - invisibleWaitStartedAt < 120000) {
      await sleep(5000);
      receipt = await waitForArcTransactionReceipt(txHash, {
        label: `${label} delayed receipt lookup`,
        maxWaitMs: 15000,
        pollIntervalMs: 3000,
        walletReceiptLookup,
        rpcUrl,
      });
      if (receipt) {
        return receipt;
      }
      pendingTx = await lookupPendingTx();
      if (pendingTx) {
        break;
      }
    }
  }

  if (pendingTx?.blockNumber) {
    receipt = await waitForArcTransactionReceipt(txHash, {
      label: `${label} mined receipt lookup`,
      maxWaitMs: 30000,
      walletReceiptLookup,
      rpcUrl,
    });
    if (receipt) {
      return receipt;
    }
  }

  if (pendingTx) {
    return waitWhilePending();
  }

  throw new Error(
    `${label} was submitted, but Arc never showed the transaction. Check the explorer and retry.`,
  );
};

const getArcLatestNonce = (address: string, label: string, rpcUrl: string) =>
  callArcRpc<string>(
    "eth_getTransactionCount",
    [address, "latest"],
    RECEIPT_REQUEST_TIMEOUT_MS,
    label,
    rpcUrl,
  );

const getArcFeeParams = async (rpcUrl: string) => {
  const [latestBlock, priorityFee] = await Promise.all([
    callArcRpc<{ baseFeePerGas?: string }>(
      "eth_getBlockByNumber",
      ["latest", false],
      RECEIPT_REQUEST_TIMEOUT_MS,
      "Arc latest block lookup",
      rpcUrl,
    ),
    callArcRpc<string>(
      "eth_maxPriorityFeePerGas",
      [],
      RECEIPT_REQUEST_TIMEOUT_MS,
      "Arc priority fee lookup",
      rpcUrl,
    ).catch(() => "0x59682f00"),
  ]);
  const baseFee = BigInt(latestBlock?.baseFeePerGas || "0x0");
  const priority = BigInt(priorityFee || "0x59682f00");
  const minimumPriority = 1500000000n;
  const maxPriorityFeePerGas =
    priority > minimumPriority ? priority : minimumPriority;
  const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;

  return {
    maxFeePerGas: `0x${maxFeePerGas.toString(16)}`,
    maxPriorityFeePerGas: `0x${maxPriorityFeePerGas.toString(16)}`,
  };
};

const applyGasBuffer = (gasEstimate: unknown) => {
  if (typeof gasEstimate !== "string") {
    return null;
  }

  return `0x${((BigInt(gasEstimate) * 13n) / 10n).toString(16)}`;
};

const isRecoverableGasEstimationError = (message: string) => {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("execution reverted") ||
    normalized.includes("route execution failed") ||
    normalized.includes("insufficient funds") ||
    normalized.includes("transfer amount exceeds") ||
    normalized.includes("allowance")
  ) {
    return false;
  }

  return (
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("out of memory") ||
    normalized.includes("memory limit exceeded") ||
    normalized.includes("memory expansion") ||
    normalized.includes("temporary internal error") ||
    normalized.includes("http request failed") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("fetch failed") ||
    normalized.includes("network error") ||
    normalized.includes("network request failed")
  );
};

interface TokenSelectorProps {
  selected: SwapToken | null;
  onOpenModal: () => void;
  disabled?: boolean;
}

const TokenSelector = ({
  selected,
  onOpenModal,
  disabled = false,
}: TokenSelectorProps) => {
  if (!selected) {
    return (
      <motion.button
        onClick={onOpenModal}
        disabled={disabled}
        className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-70"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <span className="font-medium text-muted-foreground">Select Token</span>
        <ChevronDown className="w-4 h-4 text-muted-foreground" />
      </motion.button>
    );
  }

  return (
    <motion.button
      onClick={onOpenModal}
      disabled={disabled}
      className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-70"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/30">
        <Image
          src={selected.icon}
          alt={`${selected.symbol} logo`}
          width={24}
          height={24}
          className="h-full w-full object-contain"
        />
      </div>
      <span className="font-medium text-foreground">{selected.symbol}</span>
      <ChevronDown className="h-4 w-4 text-muted-foreground" />
    </motion.button>
  );
};

const normalizeSwapRouteDexId = (dexId?: string) => {
  const normalized = String(dexId || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");

  if (!normalized) {
    return "unknown";
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

  if (
    normalized === "xylonet" ||
    normalized === "xylo" ||
    normalized === "xylo-net" ||
    normalized === "xylonet-adapter" ||
    normalized.includes("xylonet")
  ) {
    return "xylonet-adapter";
  }

  if (
    normalized === "tower-dex" ||
    normalized === "tower" ||
    normalized === "tower-amm"
  ) {
    return "tower-dex";
  }

  if (
    normalized === "aero" ||
    normalized === "aerodrome" ||
    normalized === "aero-cl" ||
    normalized.includes("aerodrome") ||
    normalized.includes("slipstream")
  ) {
    return "aero";
  }

  if (
    normalized === "kyberswap" ||
    normalized === "kyber" ||
    normalized === "kyber-swap" ||
    normalized === "knc" ||
    normalized.includes("kyber")
  ) {
    return "kyberswap";
  }

  if (
    normalized === "uniswap" ||
    normalized === "uni" ||
    normalized === "uniswap-v4" ||
    normalized === "uniswap-v3" ||
    normalized.includes("uniswap")
  ) {
    return "uniswap";
  }

  if (
    normalized === "de1" ||
    normalized === "de1-exchange" ||
    normalized === "de1exchange" ||
    normalized === "de¹" ||
    normalized.includes("de1")
  ) {
    return "de1";
  }

  return normalized;
};

const routeOutputAmountToBigInt = (amount?: string) => {
  try {
    return BigInt(amount || "0");
  } catch {
    return 0n;
  }
};

const getResolvedRouteOutputAmount = (
  option?: Pick<SwapRouteOption, "outputAmount" | "quote"> | null,
) =>
  option?.quote?.outputAmount ||
  option?.outputAmount ||
  option?.quote?.outputAmountNative ||
  "0";

const getRouteOptionCandidates = (
  quoteData: SwapQuote,
  selectedDexId: string,
  currentBestRouteOption: SwapRouteOption | null,
): SwapRouteOption[] => {
  const routeOptionEntries = Array.isArray(quoteData.routeOptions)
    ? quoteData.routeOptions
    : [];

  const candidates = routeOptionEntries
    .map((option) => {
      const normalizedDexId = normalizeSwapRouteDexId(option.dexId);
      const fallbackDexId =
        normalizedDexId === "unknown" ? selectedDexId : normalizedDexId;
      const outputAmount =
        option.quote?.outputAmount ||
        option.outputAmount ||
        (fallbackDexId === selectedDexId ? quoteData.outputAmount : undefined);
      const dexName =
        option.dexName ||
        option.quote?.route?.hops?.[0]?.dexName ||
        option.quote?.route?.hops?.[0]?.dexId ||
        quoteData.route?.hops?.[0]?.dexName ||
        quoteData.route?.hops?.[0]?.dexId ||
        fallbackDexId;

      return {
        ...option,
        dexId: fallbackDexId,
        dexName,
        outputAmount,
        quote:
          option.quote ||
          (fallbackDexId === selectedDexId ? quoteData : option.quote),
      } as SwapRouteOption;
    })
    .filter((option) => {
      const normalizedDexId = normalizeSwapRouteDexId(option.dexId);
      if (!normalizedDexId || normalizedDexId === "unknown") {
        return false;
      }

      const outputAmount =
        option.quote?.outputAmount ||
        option.outputAmount ||
        (normalizeSwapRouteDexId(option.dexId) === selectedDexId
          ? quoteData.outputAmount
          : undefined);
      return routeOutputAmountToBigInt(outputAmount) > 0n;
    });

  const hasNonFallbackOptions = candidates.some(
    (option) => option.isFallback !== true,
  );
  const filteredCandidates = hasNonFallbackOptions
    ? candidates.filter((option) => option.isFallback !== true)
    : candidates;

  if (
    currentBestRouteOption &&
    !filteredCandidates.some(
      (candidate) =>
        normalizeSwapRouteDexId(candidate.dexId) ===
        normalizeSwapRouteDexId(currentBestRouteOption.dexId),
    )
  ) {
    filteredCandidates.push(currentBestRouteOption);
  }

  return filteredCandidates;
};

const mergeRouteOptionsByDexId = (
  current: SwapRouteOption[],
  incoming: SwapRouteOption[],
) => {
  const optionsByDexId = new Map<string, SwapRouteOption>();

  for (const option of [...current, ...incoming]) {
    const dexId = normalizeSwapRouteDexId(option.dexId);
    if (!dexId || dexId === "unknown") {
      continue;
    }

    const existingOption = optionsByDexId.get(dexId);
    const optionAmount = routeOutputAmountToBigInt(
      getResolvedRouteOutputAmount(option),
    );
    const existingAmount = routeOutputAmountToBigInt(
      getResolvedRouteOutputAmount(existingOption),
    );
    if (!existingOption || optionAmount > existingAmount) {
      optionsByDexId.set(dexId, {
        ...option,
        dexId,
        outputAmount: getResolvedRouteOutputAmount(option),
      });
    }
  }

  return Array.from(optionsByDexId.values());
};

const hasQuotesForAllRouters = (
  options: SwapRouteOption[],
  routerIds: string[],
) => {
  if (routerIds.length === 0) {
    return options.length > 0;
  }

  const quotedDexIds = new Set(
    options
      .filter(
        (option) =>
          routeOutputAmountToBigInt(getResolvedRouteOutputAmount(option)) > 0n,
      )
      .map((option) => normalizeSwapRouteDexId(option.dexId)),
  );

  return routerIds.every((routerId) =>
    quotedDexIds.has(normalizeSwapRouteDexId(routerId)),
  );
};

const getBestRouteOption = (
  options: SwapRouteOption[],
  routerPriority: string[] = [],
  preferredDexId?: string,
) => {
  if (options.length === 0) {
    return null;
  }

  const normalizedPreferredDexId = normalizeSwapRouteDexId(preferredDexId);
  const priorityIndexByDexId = new Map(
    routerPriority.map((routerId, index) => [
      normalizeSwapRouteDexId(routerId),
      index,
    ]),
  );

  return options.reduce((bestOption, option) => {
    const candidateAmount = routeOutputAmountToBigInt(
      getResolvedRouteOutputAmount(option),
    );
    const bestAmount = routeOutputAmountToBigInt(
      getResolvedRouteOutputAmount(bestOption),
    );
    const candidateIsFallback = option.isFallback === true;
    const bestIsFallback = bestOption.isFallback === true;

    if (candidateAmount > bestAmount) {
      return option;
    }

    if (candidateAmount < bestAmount) {
      return bestOption;
    }

    if (candidateIsFallback !== bestIsFallback) {
      return bestIsFallback ? option : bestOption;
    }

    const optionDexId = normalizeSwapRouteDexId(option.dexId);
    const bestDexId = normalizeSwapRouteDexId(bestOption.dexId);

    if (normalizedPreferredDexId) {
      if (optionDexId === normalizedPreferredDexId) {
        return option;
      }
      if (bestDexId === normalizedPreferredDexId) {
        return bestOption;
      }
    }

    const candidatePriority =
      priorityIndexByDexId.get(optionDexId) ?? Number.MAX_SAFE_INTEGER;
    const bestPriority =
      priorityIndexByDexId.get(bestDexId) ?? Number.MAX_SAFE_INTEGER;

    return candidatePriority < bestPriority ? option : bestOption;
  });
};

const getTokenWithLiveUsdPrice = (
  token: SwapToken | null,
  tokenUsdPrices: Record<SwapTokenSymbol, number>,
): SwapToken | null => {
  if (!token) {
    return null;
  }

  const liveUsdPrice = tokenUsdPrices[token.symbol];

  return typeof liveUsdPrice === "number"
    ? { ...token, usdPrice: liveUsdPrice }
    : token;
};
const formatTokenPillUsdPrice = (unitPrice: number) =>
  formatTokenUnitUsdPrice(unitPrice);
const SwapCard = ({
  onNavigateToBridge,
}: {
  onNavigateToBridge?: () => void;
}) => {
  const router = useRouter();
  const { mode: arcNetworkMode, isReady: isNetworkModeReady } =
    useTowerNetworkMode();
  const arcRpcUrl = getArcRpcProxyPath(arcNetworkMode);
  const { user, login, authenticated } = useRainbowKitAuth();
  const bridgeNavigationStartedRef = useRef(false);
  const swapBalanceRequestIdRef = useRef(0);
  const stableFxRefreshHandlerRef = useRef<(() => void) | null>(null);
  const registerStableFxRefreshHandler = useCallback(
    (handler: (() => void) | null) => {
      stableFxRefreshHandlerRef.current = handler;
    },
    [],
  );

  // Tower Exchange DEX Aggregator hook
  const { getQuote, buildSwapTransaction, error: towerError } = useTowerSwap();

  // Wallet and transaction states
  const isWalletConnected = Boolean(authenticated && user);
  const [, setChainId] = useState<string | null>(null);
  const [selectedRouterId, setSelectedRouterId] = useState<string | undefined>(
    undefined,
  );
  const [routeOptions, setRouteOptions] = useState<SwapRouteOption[]>([]);
  const [swapState, setSwapState] = useState<
    "idle" | "loading" | "pending" | "success" | "failed"
  >("idle");
  const [notification, setNotification] = useState<
    "success" | "pending" | "failed" | null
  >(null);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [notificationSwapDetails, setNotificationSwapDetails] = useState<{
    sellAmount: string;
    sellTokenSymbol: string;
    receiveAmount: string;
    receiveTokenSymbol: string;
  } | null>(null);
  const [swapStepsModalOpen, setSwapStepsModalOpen] = useState(false);
  const [swapStepsPhase, setSwapStepsPhase] = useState<
    "approval" | "confirm" | "wait" | "success" | "failed"
  >("approval");
  const [swapStepsFailedPhase, setSwapStepsFailedPhase] = useState<
    "approval" | "confirm" | "wait"
  >("confirm");
  const [swapStepsFailureMessage, setSwapStepsFailureMessage] = useState<
    string | null
  >(null);
  const [swapStepsDetails, setSwapStepsDetails] = useState<{
    sellAmount: string;
    sellTokenSymbol: string;
    sellTokenIcon: SwapToken["icon"];
    receiveAmount: string;
    receiveTokenSymbol: string;
    receiveTokenIcon?: SwapToken["icon"];
    dexName: string;
  }>({
    sellAmount: "0.00",
    sellTokenSymbol: SWAP_SELECTOR_TOKENS[0].symbol,
    sellTokenIcon: SWAP_SELECTOR_TOKENS[0].icon,
    receiveAmount: "0.00",
    receiveTokenSymbol: "",
    receiveTokenIcon: undefined,
    dexName: "Swap",
  });
  const [swapActivityStartedAt, setSwapActivityStartedAt] = useState<
    number | null
  >(null);
  const [stableFxStepsModalOpen, setStableFxStepsModalOpen] = useState(false);
  const [stableFxStepsPhase, setStableFxStepsPhase] =
    useState<StableFxStepsPhase>("deposit");
  const [stableFxStepsFailedStep, setStableFxStepsFailedStep] =
    useState<StableFxFailedStep>("deposit");
  const [stableFxStepsFailureMessage, setStableFxStepsFailureMessage] =
    useState<string | null>(null);
  const [stableFxStepsDetails, setStableFxStepsDetails] = useState<{
    sellAmount: string;
    sellTokenSymbol: string;
    sellTokenIcon: SwapToken["icon"];
    receiveAmount: string;
    receiveTokenSymbol: string;
    receiveTokenIcon?: SwapToken["icon"];
  }>({
    sellAmount: "0.00",
    sellTokenSymbol: SWAP_SELECTOR_TOKENS[0].symbol,
    sellTokenIcon: SWAP_SELECTOR_TOKENS[0].icon,
    receiveAmount: "0.00",
    receiveTokenSymbol: "",
    receiveTokenIcon: undefined,
  });
  const [stableFxActivityStartedAt, setStableFxActivityStartedAt] = useState<
    number | null
  >(null);
  const [stableFxTransactionHash, setStableFxTransactionHash] = useState<
    string | null
  >(null);
  const [stableFxOrderId, setStableFxOrderId] = useState<string | null>(null);
  const [stableFxSettlementDeadline, setStableFxSettlementDeadline] = useState<
    number | null
  >(null);
  const [stableFxCountdownNow, setStableFxCountdownNow] = useState(() => Date.now());
  const stableFxActiveStepRef = useRef<StableFxFailedStep>("deposit");
  const [revertReason, setRevertReason] = useState<string | null>(null);
  const [slippageTolerance, setSlippageTolerance] = useState(1); // 1% default to reduce "execution reverted" from slippage

  useEffect(() => {
    if (stableFxSettlementDeadline === null) return;

    setStableFxCountdownNow(Date.now());
    const timer = window.setInterval(() => setStableFxCountdownNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [stableFxSettlementDeadline]);

  // Monitor chain ID changes
  useEffect(() => {
    if (!authenticated) {
      setChainId(null);
      return;
    }

    let isMounted = true;

    const checkChainId = async () => {
      try {
        const currentChainId = await getBrowserWalletChainId();

        if (isMounted) {
          setChainId(currentChainId);
        }
      } catch (error) {
        console.error("Error checking chain ID:", error);
      }
    };

    checkChainId();

    // Listen for chain changes
    const handleChainChanged = (newChainId: string) => {
      setChainId(newChainId);
    };

    try {
      const provider = getBrowserWalletProvider();
      provider.on?.("chainChanged", handleChainChanged);

      return () => {
        isMounted = false;
        provider.removeListener?.("chainChanged", handleChainChanged);
      };
    } catch {
      return () => {
        isMounted = false;
      };
    }
  }, [authenticated, user?.wallet?.address]);

  // Switch/add the Arc network currently selected in the header.
  const switchToSelectedArcNetwork = async () => {
    await ensureWalletOnArcNetwork(arcNetworkMode);
  };

  const toHexQuantity = (value: bigint | number | string) => {
    const v = typeof value === "bigint" ? value : BigInt(value);
    return "0x" + v.toString(16);
  };

  const withTimeout = async <T,>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string,
  ): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new Error(
            `${label} timed out after ${Math.round(timeoutMs / 1000)} seconds`,
          ),
        );
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  };

  const extractTransactionHash = (result: unknown, txType: string) => {
    const candidate =
      typeof result === "string"
        ? result
        : result && typeof result === "object"
          ? (result as Record<string, unknown>).hash ||
            (result as Record<string, unknown>).transactionHash ||
            (result as Record<string, unknown>).txHash
          : null;

    if (
      typeof candidate !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(candidate)
    ) {
      throw new Error(
        `${txType} did not return a valid transaction hash. Please check your wallet activity.`,
      );
    }

    return candidate;
  };

  const getActiveWalletAddress = async (
    provider = getBrowserWalletProvider(),
  ) => {
    const accounts = await provider.request({ method: "eth_accounts" });

    if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
      throw new Error(
        "No active wallet account found. Please reconnect your wallet.",
      );
    }

    return accounts[0];
  };

  // Token and amount states
  const [sellAmount, setSellAmount] = useState("0.00");
  const [receiveAmount, setReceiveAmount] = useState("0.00");
  const [isRouteSearchPending, setIsRouteSearchPending] = useState(false);
  const [quoteFailureMessage, setQuoteFailureMessage] = useState<string | null>(
    null,
  );
  const [sellToken, setSellToken] = useState<SwapToken>(
    SWAP_SELECTOR_TOKENS[0],
  );
  const [receiveToken, setReceiveToken] = useState<SwapToken | null>(null);
  const [isStableFxOrderActive, setIsStableFxOrderActive] = useState(false);
  const [tokenUsdPrices, setTokenUsdPrices] = useState<
    Record<SwapTokenSymbol, number>
  >({
    ...DEFAULT_TOKEN_USD_PRICES,
  });
  const pricedSwapTokens = useMemo(
    () =>
      SWAP_SELECTOR_TOKENS.map((token) => ({
        ...token,
        usdPrice: tokenUsdPrices[token.symbol] ?? token.usdPrice,
      })),
    [tokenUsdPrices],
  );
  const findPricedSwapToken = useCallback(
    (symbol: string) =>
      pricedSwapTokens.find(
        (token) => token.symbol.toLowerCase() === symbol.toLowerCase(),
      ) ?? null,
    [pricedSwapTokens],
  );
  const sellTokenWithLivePrice = useMemo(
    () => getTokenWithLiveUsdPrice(sellToken, tokenUsdPrices) ?? sellToken,
    [sellToken, tokenUsdPrices],
  );
  const receiveTokenWithLivePrice = useMemo(
    () => getTokenWithLiveUsdPrice(receiveToken, tokenUsdPrices),
    [receiveToken, tokenUsdPrices],
  );
  const selectedStableFxPair = isStableFxTokenPair(sellToken, receiveToken);
  const stableFxFromCurrency = isStableFxCurrency(sellToken.symbol)
    ? sellToken.symbol
    : null;
  const stableFxToCurrency = isStableFxCurrency(receiveToken?.symbol)
    ? receiveToken.symbol
    : null;

  const quoteRequestIdRef = useRef(0);
  const activeQuoteKeyRef = useRef<string | null>(null);
  const inFlightQuoteKeyRef = useRef<string | null>(null);
  const quoteRefreshKeyRef = useRef<string | null>(null);
  const lastSuccessfulQuoteRef = useRef<{
    sellAmountValue: string;
    sellTokenSymbol: SwapTokenSymbol;
    receiveTokenSymbol: SwapTokenSymbol;
  } | null>(null);
  const lastSuccessfulRouteOptionsRef = useRef<SwapRouteOption[]>([]);
  const routeOptionsMergeRef = useRef<SwapRouteOption[]>([]);
  const pendingRevealQuoteKeyRef = useRef<string | null>(null);
  const quoteRevealTimerRef = useRef<number | null>(null);

  const clearQuoteRevealTimer = useCallback(() => {
    if (quoteRevealTimerRef.current !== null) {
      window.clearTimeout(quoteRevealTimerRef.current);
      quoteRevealTimerRef.current = null;
    }
  }, []);

  const resetSwapQuote = useCallback(() => {
    quoteRequestIdRef.current += 1;
    activeQuoteKeyRef.current = null;
    inFlightQuoteKeyRef.current = null;
    pendingRevealQuoteKeyRef.current = null;
    clearQuoteRevealTimer();
    lastSuccessfulQuoteRef.current = null;
    lastSuccessfulRouteOptionsRef.current = [];
    routeOptionsMergeRef.current = [];
    setReceiveAmount("0.00");
    setIsRouteSearchPending(false);
    setQuoteFailureMessage(null);
    setRouteOptions([]);
    setSelectedRouterId(undefined);
  }, [clearQuoteRevealTimer]);

  useEffect(() => () => clearQuoteRevealTimer(), [clearQuoteRevealTimer]);

  useEffect(() => {
    let isMounted = true;

    const syncTokenUsdPrices = async () => {
      try {
        const nextTokenUsdPrices = await fetchArcTokenUsdPrices();
        if (isMounted) {
          setTokenUsdPrices(nextTokenUsdPrices);
        }
      } catch (error) {
        console.warn("Failed to sync live token USD prices", error);
      }
    };

    syncTokenUsdPrices();
    const intervalId = window.setInterval(
      syncTokenUsdPrices,
      TOKEN_PRICE_REFRESH_INTERVAL_MS,
    );

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  // Prefill sell/receive tokens from URL (?from=&to=) or legacy ?select=cirBTC
  useEffect(() => {
    const applyPairFromParams = (params: URLSearchParams) => {
      const fromSymbol = params.get("from") ?? params.get("select");
      const toSymbol = params.get("to");

      let didApply = false;

      if (fromSymbol) {
        const fromToken = findPricedSwapToken(fromSymbol);
        if (fromToken) {
          setSellToken(fromToken);
          didApply = true;
        }
      }

      if (toSymbol) {
        const toToken = findPricedSwapToken(toSymbol);
        if (toToken) {
          setReceiveToken(toToken);
          didApply = true;
        }
      }

      if (didApply) {
        const url = new URL(window.location.href);
        url.searchParams.delete("from");
        url.searchParams.delete("to");
        url.searchParams.delete("select");
        const cleaned =
          url.pathname +
          (url.searchParams.toString() ? `?${url.searchParams}` : "");
        window.history.replaceState({}, "", cleaned);
      }
    };

    const handleSelectTokenEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{
        symbol?: string;
        from?: string;
        to?: string;
      }>;
      const detail = customEvent.detail;
      if (!detail) {
        return;
      }

      if (detail.from || detail.to) {
        if (detail.from) {
          const fromToken = findPricedSwapToken(detail.from);
          if (fromToken) {
            setSellToken(fromToken);
          }
        }
        if (detail.to) {
          const toToken = findPricedSwapToken(detail.to);
          if (toToken) {
            setReceiveToken(toToken);
          }
        }
        resetSwapQuote();
        return;
      }

      if (detail.symbol) {
        const token = findPricedSwapToken(detail.symbol);
        if (token) {
          setSellToken(token);
          resetSwapQuote();
        }
      }
    };

    window.addEventListener("select-sell-token", handleSelectTokenEvent);
    applyPairFromParams(new URLSearchParams(window.location.search));

    return () => {
      window.removeEventListener("select-sell-token", handleSelectTokenEvent);
    };
  }, [findPricedSwapToken, resetSwapQuote]);

  const resetSwapForm = useCallback(() => {
    setSellAmount("0.00");
    resetSwapQuote();
  }, [resetSwapQuote]);

  const handleStableFxTransactionProgress = useCallback(
    (progress: StableFxTransactionProgress) => {
      const details = progress.details;
      setStableFxStepsDetails((current) => ({
        ...current,
        // StableFX provides the reference quote snapshot with its first
        // progress event. Preserve it rather than briefly rendering the
        // parent form's old 0.00 output while the wallet confirmation opens.
        sellAmount: details?.sellAmount ?? (current.sellAmount || sellAmount),
        sellTokenSymbol:
          details?.sellTokenSymbol ??
          (current.sellTokenSymbol || sellToken.symbol),
        sellTokenIcon: sellToken.icon,
        receiveAmount:
          details?.receiveAmount ??
          (current.receiveAmount || receiveAmount),
        receiveTokenSymbol:
          details?.receiveTokenSymbol ??
          (current.receiveTokenSymbol || receiveToken?.symbol || ""),
        receiveTokenIcon: receiveToken?.icon ?? current.receiveTokenIcon,
      }));

      if (progress.phase === "deposit" && !progress.orderId) {
        stableFxActiveStepRef.current = "deposit";
        setStableFxActivityStartedAt(Date.now());
        setStableFxTransactionHash(null);
        setStableFxOrderId(null);
        setStableFxSettlementDeadline(null);
        // Open the progress modal only for the customer's initial deposit
        // action. Subsequent order polling updates must not re-open a modal
        // that they deliberately dismissed.
        setStableFxStepsModalOpen(true);
      }

      if (progress.orderId) {
        setStableFxOrderId(progress.orderId);
        // Existing orders can report progress after a browser refresh or Fast
        // Refresh, without replaying the original wallet-deposit event. Seed
        // the live-activity state from the persisted order in that case.
        setStableFxActivityStartedAt((currentStartedAt) => {
          if (currentStartedAt !== null) return currentStartedAt;
          const initiatedAt = progress.initiatedAt
            ? Date.parse(progress.initiatedAt)
            : Number.NaN;
          return Number.isFinite(initiatedAt) ? initiatedAt : Date.now();
        });
      }
      if (progress.transactionHash) {
        setStableFxTransactionHash(progress.transactionHash);
      }

      if (progress.phase === "settlement") {
        setStableFxSettlementDeadline((currentDeadline) => {
          if (currentDeadline !== null) return currentDeadline;

          const initiatedAt = progress.initiatedAt
            ? Date.parse(progress.initiatedAt)
            : Number.NaN;
          const startedAt = Number.isFinite(initiatedAt) ? initiatedAt : Date.now();
          return startedAt + STABLEFX_INSTANT_TENOR_MS;
        });
      } else if (
        progress.phase === "payout" ||
        progress.phase === "success" ||
        progress.phase === "failed"
      ) {
        setStableFxSettlementDeadline(null);
      }

      if (progress.phase === "failed") {
        setStableFxStepsFailedStep(stableFxActiveStepRef.current);
        setStableFxStepsFailureMessage(
          progress.error || "StableFX transaction failed.",
        );
      } else {
        if (progress.phase !== "success") {
          stableFxActiveStepRef.current = progress.phase;
        }
        setStableFxStepsFailureMessage(null);
      }

      setStableFxStepsPhase(progress.phase);
    },
    [
      receiveAmount,
      receiveToken?.icon,
      receiveToken?.symbol,
      sellAmount,
      sellToken,
    ],
  );

  const getActiveSwapRouteName = useCallback(() => {
    if (selectedRouterId) {
      return (
        routeOptions.find((option) => option.dexId === selectedRouterId)
          ?.dexName || selectedRouterId
      );
    }

    return routeOptions[0]?.dexName || "Swap";
  }, [routeOptions, selectedRouterId]);

  const openSwapStepsModal = useCallback(() => {
    setSwapStepsDetails({
      sellAmount,
      sellTokenSymbol: sellToken.symbol,
      sellTokenIcon: sellToken.icon,
      receiveAmount,
      receiveTokenSymbol: receiveToken?.symbol || "",
      receiveTokenIcon: receiveToken?.icon,
      dexName: getActiveSwapRouteName(),
    });
    setSwapStepsFailureMessage(null);
    setSwapStepsFailedPhase("confirm");
    setSwapStepsPhase("approval");
    setSwapActivityStartedAt(Date.now());
    setSwapStepsModalOpen(true);
  }, [
    receiveAmount,
    receiveToken?.icon,
    receiveToken?.symbol,
    getActiveSwapRouteName,
    sellAmount,
    sellToken.icon,
    sellToken.symbol,
  ]);

  const updateSwapStepsRoute = useCallback(
    (dexName?: string, outputAmount?: string) => {
      setSwapStepsDetails((current) => ({
        ...current,
        dexName: dexName || current.dexName,
        receiveAmount: outputAmount || current.receiveAmount,
      }));
    },
    [],
  );

  const logSwapActivity = useCallback(
    async (
      status: "Successful" | "Failed",
      txHash?: string | null,
      routeLabel?: string | null,
    ) => {
      try {
        if (!user?.wallet?.address) return null;
        const amountUsd =
          (parseFloat(sellAmount) || 0) * sellTokenWithLivePrice.usdPrice;
        const resolvedRouteLabel = routeLabel || getActiveSwapRouteName();
        const { data, error, success } = await insertActivity({
          wallet_address: user.wallet.address.toLowerCase(),
          type:
            resolvedRouteLabel && resolvedRouteLabel !== "Swap"
              ? `Swap via ${resolvedRouteLabel}`
              : "Swap",
          source_currency_ticker: sellToken.symbol,
          destination_currency_ticker: receiveToken?.symbol || null,
          source_network_name: "Arc",
          destination_network_name: "Arc",
          status,
          amount: parseFloat(sellAmount) || null,
          amount_usd: amountUsd || null,
          transaction_hash: txHash || null,
          timestamp: new Date().toISOString(),
        });

        if (!success || error) {
          throw new Error(error || "Failed to insert activity");
        }

        return data?.id ?? null;
      } catch (e) {
        console.error("Error logging swap activity:", e);
        return null;
      }
    },
    [
      sellToken.symbol,
      receiveToken?.symbol,
      sellAmount,
      user?.wallet?.address,
      sellTokenWithLivePrice.usdPrice,
      getActiveSwapRouteName,
    ],
  );

  const getEmptySwapTokenBalances = () =>
    Object.fromEntries(SWAP_SELECTOR_TOKENS.map((token) => [token.symbol, 0]));

  // Actual wallet balances for tokens currently supported on the swap card
  const [tokenBalances, setTokenBalances] = useState<Record<string, number>>(
    getEmptySwapTokenBalances,
  );
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);

  // Modal states
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // const [isChartOpen, setIsChartOpen] = useState(false);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [isSellTokenModalOpen, setIsSellTokenModalOpen] = useState(false);
  const [isReceiveTokenModalOpen, setIsReceiveTokenModalOpen] = useState(false);
  const sellAmountUsdValue =
    (Number.parseFloat(sellAmount) || 0) * sellTokenWithLivePrice.usdPrice;
  const sellUsdValueLabel = formatUsdAmount(
    sellAmount,
    sellTokenWithLivePrice.usdPrice,
  );
  const hasValidSwapQuoteInput =
    parseFloat(sellAmount) > 0 &&
    sellAmount !== "0.00" &&
    Boolean(receiveToken) &&
    !selectedStableFxPair &&
    isSupportedSwapPair(sellToken.symbol, receiveToken?.symbol);
  const bestDisplayedRouteOption = getBestRouteOption(routeOptions);
  const isReceiveQuoteLoading =
    Boolean(receiveToken) &&
    isRouteSearchPending &&
    !quoteFailureMessage &&
    routeOutputAmountToBigInt(
      getResolvedRouteOutputAmount(bestDisplayedRouteOption),
    ) === 0n;
  const receiveUsdValueLabel = (() => {
    if (!receiveToken) {
      return "$0.00";
    }

    const bestOutputAmount = selectedStableFxPair
      ? null
      : getResolvedRouteOutputAmount(bestDisplayedRouteOption);
    if (bestOutputAmount && routeOutputAmountToBigInt(bestOutputAmount) > 0n) {
      try {
        const bestOutputTokens = Number.parseFloat(
          formatUnits(BigInt(bestOutputAmount), 18),
        );
        return formatUsdAmount(
          bestOutputTokens,
          receiveTokenWithLivePrice?.usdPrice || 0,
        );
      } catch {
        // Fall through to the displayed token amount label.
      }
    }

    return formatUsdAmount(
      receiveAmount,
      receiveTokenWithLivePrice?.usdPrice || 0,
    );
  })();
  const effectiveReceiveUsdValueLabel = selectedStableFxPair
    ? receiveUsdValueLabel
    : quoteFailureMessage
      ? quoteFailureMessage
      : isReceiveQuoteLoading
        ? "Searching for best route"
        : receiveUsdValueLabel;
  const fetchSwapTokenBalance = useCallback(
    async (tokenSymbol: SwapTokenSymbol) => {
      // StableFX deposits always settle on Arc mainnet, even if the surrounding
      // DEX UI is currently set to testnet.
      const balanceRpcUrl = selectedStableFxPair
        ? getArcRpcProxyPath("mainnet")
        : arcRpcUrl;
      const stableFxTokenAddress =
        selectedStableFxPair && isStableFxCurrency(tokenSymbol)
          ? STABLEFX_ARC_MAINNET_TOKENS[tokenSymbol].address
          : undefined;
      const tokenAddress =
        stableFxTokenAddress ??
        getArcSwapTokenAddress(tokenSymbol, arcNetworkMode);

      if (!tokenAddress || !user?.wallet?.address) {
        return 0;
      }

      if (tokenSymbol === "USDC" && !selectedStableFxPair) {
        const nativeBalance = await callArcRpc<string>(
          "eth_getBalance",
          [user.wallet.address, "latest"],
          12000,
          `${tokenSymbol} balance lookup`,
          balanceRpcUrl,
        );

        return Number.parseFloat(
          formatUnits(BigInt(nativeBalance || "0x0"), ARC_NATIVE_USDC_DECIMALS),
        );
      }

      const balanceOfCallData =
        "0x70a08231" + user.wallet.address.slice(2).padStart(64, "0");
      const rawBalance = await callArcRpc<string>(
        "eth_call",
        [
          {
            to: tokenAddress,
            data: balanceOfCallData,
          },
          "latest",
        ],
        12000,
        `${tokenSymbol} balance lookup`,
        balanceRpcUrl,
      );

      if (!rawBalance || rawBalance === "0x") {
        return 0;
      }

      return Number.parseFloat(
        formatUnits(BigInt(rawBalance), TOKEN_DECIMALS[tokenSymbol] ?? 18),
      );
    },
    [arcNetworkMode, arcRpcUrl, selectedStableFxPair, user?.wallet?.address],
  );

  const fetchUserBalances = useCallback(async () => {
    if (!isNetworkModeReady || !user?.wallet?.address) {
      return;
    }

    const requestId = ++swapBalanceRequestIdRef.current;
    setTokenBalances(getEmptySwapTokenBalances());
    setIsLoadingBalances(true);
    try {
      const balanceEntries = await Promise.all(
        Array.from(
          new Set(SWAP_SELECTOR_TOKENS.map((token) => token.symbol)),
        ).map(
          async (symbol) =>
            [symbol, await fetchSwapTokenBalance(symbol)] as const,
        ),
      );
      if (requestId !== swapBalanceRequestIdRef.current) {
        return;
      }
      const nextTokenBalances = Object.fromEntries(balanceEntries);

      setTokenBalances((prev) => ({
        ...prev,
        ...nextTokenBalances,
      }));
    } catch (error) {
      if (requestId !== swapBalanceRequestIdRef.current) {
        return;
      }
      console.error("Failed to fetch wallet balances:", error);
    } finally {
      if (requestId === swapBalanceRequestIdRef.current) {
        setIsLoadingBalances(false);
      }
    }
  }, [fetchSwapTokenBalance, isNetworkModeReady, user?.wallet?.address]);

  useEffect(() => {
    if (!isNetworkModeReady) {
      return;
    }

    if (authenticated && user) {
      void fetchUserBalances();
    } else {
      setTokenBalances(getEmptySwapTokenBalances());
    }
  }, [authenticated, fetchUserBalances, isNetworkModeReady, user]);

  // Get display balance for a token (actual if available, mock otherwise)
  const getTokenBalance = (symbol: string): number => {
    return tokenBalances[symbol] || 0;
  };

  const getFormattedBalance = (symbol: string): string => {
    const balance = getTokenBalance(symbol);
    // Use appropriate decimal places based on token type
    const decimals = symbol === "cirBTC" ? 8 : 2;
    return formatBalance(balance.toString(), decimals);
  };

  const sellTokenBalance = getTokenBalance(sellToken.symbol);
  const maxSwapAmount =
    NATIVE_TOKENS.includes(sellToken.symbol) && !selectedStableFxPair
      ? Math.max(0, sellTokenBalance - NATIVE_USDC_GAS_RESERVE)
      : sellTokenBalance;
  const sellAmountValue = Number.parseFloat(sellAmount);
  const isSwapBalanceInsufficient =
    isWalletConnected &&
    Number.isFinite(sellAmountValue) &&
    sellAmountValue > 0 &&
    sellAmountValue > maxSwapAmount;

  // Check if swap button should be active
  const isSwapActive =
    isWalletConnected &&
    parseFloat(sellAmount) > 0 &&
    sellAmount !== "0.00" &&
    parseFloat(receiveAmount) > 0 &&
    receiveAmount !== "0.00";
  const shouldFetchSwapQuotes = hasValidSwapQuoteInput;

  const availableRouterIds = useMemo(() => {
    if (
      !receiveToken ||
      selectedStableFxPair ||
      !isSupportedSwapPair(sellToken.symbol, receiveToken.symbol)
    ) {
      return [] as string[];
    }

    if (arcNetworkMode === "mainnet") {
      return [
        "aero",
        "tower-dex",
        ...(isKyberEnabled() ? ["kyberswap"] : []),
        ...(isUniswapEnabled() ? ["uniswap"] : []),
        ...(isDe1Enabled() ? ["de1"] : []),
        ...(isXylonetEnabled() ? ["xylonet-adapter"] : []),
      ];
    }

    const routerIds = [
      ...(isXylonetEnabled() ? ["xylonet-adapter"] : []),
      "synthra",
    ];

    if (receiveToken.symbol !== "USDC") {
      routerIds.push("unitflow");
    }

    routerIds.push("tower-dex");

    return routerIds;
  }, [arcNetworkMode, receiveToken, selectedStableFxPair, sellToken.symbol]);
  const shouldRenderRouterDisplay =
    shouldFetchSwapQuotes && availableRouterIds.length > 0;

  const availableSellTokens = useMemo(
    () =>
      receiveToken
        ? pricedSwapTokens.filter(
            (token) =>
              token.symbol !== receiveToken.symbol &&
              isSelectableSwapTokenPair(token, receiveToken),
          )
        : [...pricedSwapTokens],
    [pricedSwapTokens, receiveToken],
  );
  const availableReceiveTokens = useMemo(
    () => getSwapSelectorCounterpartyTokens(sellToken, pricedSwapTokens),
    [pricedSwapTokens, sellToken],
  );

  useEffect(() => {
    if (!receiveToken) {
      return;
    }

    if (!isSelectableSwapTokenPair(sellToken, receiveToken)) {
      setReceiveToken(availableReceiveTokens[0] ?? null);
      resetSwapQuote();
    }
  }, [availableReceiveTokens, receiveToken, resetSwapQuote, sellToken]);

  const handleSwapTokens = () => {
    if (!receiveToken) {
      // If receive token is not selected, just do nothing
      return;
    }
    const tempToken = sellToken;
    setSellToken(receiveToken);
    setReceiveToken(tempToken);
    const tempAmount = sellAmount;
    setSellAmount(receiveAmount);
    setReceiveAmount(tempAmount);
    setRouteOptions([]);
    setSelectedRouterId(undefined);
  };

  const handleSellTokenSelect = (token: SwapToken) => {
    setSellToken(token);
    resetSwapQuote();
  };

  const handleReceiveTokenSelect = (token: SwapToken) => {
    // Choosing a blue StableFX destination (or a regular DEX destination)
    // selects the equivalent source route at the same time. This preserves
    // the distinction between the duplicate USDC/EURC selector entries.
    if (Boolean(token.stableFx) !== Boolean(sellToken.stableFx)) {
      const matchingSourceToken = pricedSwapTokens.find(
        (candidate) =>
          candidate.symbol === sellToken.symbol &&
          Boolean(candidate.stableFx) === Boolean(token.stableFx),
      );

      if (matchingSourceToken) {
        setSellToken(matchingSourceToken);
      }
    }

    setReceiveToken(token);
    resetSwapQuote();
  };

  // Get swap quote from Tower Exchange backend
  const getQuoteForSwap = useCallback(
    async (sellAmountValue: string, routerId?: string) => {
      let quoteKey: string | null = null;

      try {
        if (SWAPS_DISABLED) {
          resetSwapQuote();
          return;
        }

        if (
          !receiveToken ||
          selectedStableFxPair ||
          !isSupportedSwapPair(sellToken.symbol, receiveToken.symbol)
        ) {
          resetSwapQuote();
          return;
        }

        const tokenInAddress =
          getArcSwapTokenAddress(sellToken.symbol, arcNetworkMode) ?? null;
        const tokenOutAddress =
          getArcSwapTokenAddress(receiveToken.symbol, arcNetworkMode) ?? null;

        if (!tokenInAddress || !tokenOutAddress) {
          console.warn(
            `Token address not found for ${sellToken.symbol} or ${receiveToken.symbol}`,
          );
          resetSwapQuote();
          return;
        }

        const shouldPreserveCurrentQuote =
          lastSuccessfulQuoteRef.current?.sellTokenSymbol ===
            sellToken.symbol &&
          lastSuccessfulQuoteRef.current?.receiveTokenSymbol ===
            receiveToken.symbol;

        const sellTokenDecimals = TOKEN_DECIMALS[sellToken.symbol] || 18;
        const amountInWei = parseUnits(
          sellAmountValue,
          sellTokenDecimals,
        ).toString();

        quoteKey = `${sellToken.symbol}:${receiveToken.symbol}:${amountInWei}:all:${slippageTolerance}`;

        if (inFlightQuoteKeyRef.current === quoteKey) {
          return;
        }

        activeQuoteKeyRef.current = quoteKey;
        inFlightQuoteKeyRef.current = quoteKey;
        setQuoteFailureMessage(null);

        const isPendingRevealForKey =
          pendingRevealQuoteKeyRef.current === quoteKey;
        if (!shouldPreserveCurrentQuote && !isPendingRevealForKey) {
          routeOptionsMergeRef.current = [];
          setRouteOptions([]);
          setSelectedRouterId(undefined);
          setIsRouteSearchPending(true);
        } else {
          if (!isPendingRevealForKey) {
            routeOptionsMergeRef.current =
              lastSuccessfulRouteOptionsRef.current;
          }
          setIsRouteSearchPending(true);
        }

        const requestedDexIds =
          routerId &&
          availableRouterIds.includes(normalizeSwapRouteDexId(routerId))
            ? [normalizeSwapRouteDexId(routerId)]
            : availableRouterIds.length > 0
              ? availableRouterIds
              : [undefined];

        console.log("Getting quotes from Tower Exchange:", {
          sellToken: sellToken.symbol,
          receiveToken: receiveToken.symbol,
          tokenInAddress,
          tokenOutAddress,
          amountInWei,
          dexIds: requestedDexIds.filter((dexId): dexId is string =>
            Boolean(dexId),
          ),
        });

        const commitMergedRouteOptions = (
          nextRouteOptions: SwapRouteOption[],
        ) => {
          if (activeQuoteKeyRef.current !== quoteKey) {
            return;
          }

          const bestRouteOption = getBestRouteOption(
            nextRouteOptions,
            availableRouterIds,
          );
          const displayPrecision = getOutputDisplayDecimals(
            receiveToken.symbol,
          );
          const outputAmountForDisplay =
            getResolvedRouteOutputAmount(bestRouteOption) || "0";
          const quoteAmount = Number.parseFloat(
            formatUnits(BigInt(outputAmountForDisplay || "0"), 18),
          );
          const nextReceiveAmount = Number.isFinite(quoteAmount)
            ? quoteAmount.toFixed(displayPrecision)
            : "0.00";

          lastSuccessfulQuoteRef.current = {
            sellAmountValue,
            sellTokenSymbol: sellToken.symbol,
            receiveTokenSymbol: receiveToken.symbol,
          };
          lastSuccessfulRouteOptionsRef.current = nextRouteOptions;
          routeOptionsMergeRef.current = nextRouteOptions;

          setRouteOptions(nextRouteOptions);
          if (bestRouteOption?.dexId) {
            setSelectedRouterId(bestRouteOption.dexId);
          }
          setQuoteFailureMessage(null);
          setReceiveAmount(nextReceiveAmount);
        };

        const revealRouteOptions = (
          nextRouteOptions: SwapRouteOption[],
          force: boolean,
        ) => {
          if (activeQuoteKeyRef.current !== quoteKey) {
            return false;
          }

          const canReveal =
            force ||
            availableRouterIds.length === 0 ||
            hasQuotesForAllRouters(nextRouteOptions, availableRouterIds);
          if (!canReveal) {
            return false;
          }

          clearQuoteRevealTimer();
          pendingRevealQuoteKeyRef.current = null;
          commitMergedRouteOptions(nextRouteOptions);
          setIsRouteSearchPending(false);
          return true;
        };

        if (pendingRevealQuoteKeyRef.current !== quoteKey) {
          pendingRevealQuoteKeyRef.current = quoteKey;
          clearQuoteRevealTimer();
          quoteRevealTimerRef.current = window.setTimeout(() => {
            quoteRevealTimerRef.current = null;
            if (activeQuoteKeyRef.current !== quoteKey) {
              return;
            }

            if (routeOptionsMergeRef.current.length > 0) {
              revealRouteOptions(routeOptionsMergeRef.current, true);
              return;
            }

            setIsRouteSearchPending(false);
            if (!shouldPreserveCurrentQuote) {
              setQuoteFailureMessage("Quote unavailable. Try again.");
            }
          }, QUOTE_REVEAL_WAIT_MS);
        }

        await Promise.allSettled(
          requestedDexIds.map(async (dexId) => {
            const quoteData = await getQuote(
              tokenInAddress,
              tokenOutAddress,
              amountInWei,
              slippageTolerance,
              dexId,
              ARC_NETWORK_CHAIN_ID[arcNetworkMode],
            );

            if (!quoteData || activeQuoteKeyRef.current !== quoteKey) {
              return;
            }

            const selectedDexId = normalizeSwapRouteDexId(
              dexId || quoteData.route?.hops?.[0]?.dexId,
            );
            const currentBestRouteOption: SwapRouteOption | null = {
              dexId: selectedDexId,
              dexName:
                quoteData.route?.hops?.[0]?.dexName ||
                quoteData.route?.hops?.[0]?.dexId ||
                selectedDexId,
              outputAmount: quoteData.outputAmount,
              routeType: quoteData.route.type,
              gasEstimate: quoteData.gasEstimate,
              quote: quoteData,
            };
            const incomingRouteOptions = getRouteOptionCandidates(
              quoteData,
              selectedDexId,
              currentBestRouteOption,
            );

            if (incomingRouteOptions.length === 0) {
              return;
            }

            const nextRouteOptions = mergeRouteOptionsByDexId(
              routeOptionsMergeRef.current,
              incomingRouteOptions,
            );
            routeOptionsMergeRef.current = nextRouteOptions;

            if (hasQuotesForAllRouters(nextRouteOptions, availableRouterIds)) {
              revealRouteOptions(nextRouteOptions, true);
              return;
            }

            commitMergedRouteOptions(nextRouteOptions);
          }),
        );

        if (activeQuoteKeyRef.current !== quoteKey) {
          return;
        }

        if (routeOptionsMergeRef.current.length > 0) {
          revealRouteOptions(routeOptionsMergeRef.current, true);
        }
      } catch (error) {
        console.error("Error getting swap quote:", error);

        const shouldKeepCurrentQuote =
          lastSuccessfulQuoteRef.current?.sellAmountValue === sellAmountValue &&
          lastSuccessfulQuoteRef.current?.sellTokenSymbol ===
            sellToken.symbol &&
          lastSuccessfulQuoteRef.current?.receiveTokenSymbol ===
            receiveToken?.symbol;

        if (
          activeQuoteKeyRef.current === quoteKey &&
          routeOptionsMergeRef.current.length === 0 &&
          !shouldKeepCurrentQuote
        ) {
          clearQuoteRevealTimer();
          pendingRevealQuoteKeyRef.current = null;
          setIsRouteSearchPending(false);
          setQuoteFailureMessage("Quote unavailable. Try again.");
        }
      } finally {
        if (inFlightQuoteKeyRef.current === quoteKey) {
          inFlightQuoteKeyRef.current = null;
        }
      }
    },
    [
      getQuote,
      receiveToken,
      resetSwapQuote,
      sellToken.symbol,
      slippageTolerance,
      availableRouterIds,
      arcNetworkMode,
      clearQuoteRevealTimer,
      selectedStableFxPair,
    ],
  );
  const getQuoteForSwapRef = useRef(getQuoteForSwap);

  useEffect(() => {
    getQuoteForSwapRef.current = getQuoteForSwap;
  }, [getQuoteForSwap]);

  useEffect(() => {
    resetSwapQuote();
  }, [arcNetworkMode, resetSwapQuote]);

  useEffect(() => {
    if (!shouldFetchSwapQuotes || swapState === "loading") {
      quoteRefreshKeyRef.current = null;
      return;
    }

    const refreshKey = `${arcNetworkMode}:${sellToken.symbol}:${receiveToken?.symbol ?? "none"}:${sellAmount}:${slippageTolerance}`;

    if (quoteRefreshKeyRef.current === refreshKey) {
      return;
    }

    quoteRefreshKeyRef.current = refreshKey;

    let intervalId: number | null = null;
    const refreshQuotes = () => {
      getQuoteForSwapRef.current(sellAmount);
    };
    const debounceId = window.setTimeout(() => {
      refreshQuotes();
      intervalId = window.setInterval(refreshQuotes, QUOTE_REFRESH_INTERVAL_MS);
    }, QUOTE_INPUT_DEBOUNCE_MS);

    return () => {
      quoteRefreshKeyRef.current = null;
      window.clearTimeout(debounceId);
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [
    arcNetworkMode,
    sellAmount,
    shouldFetchSwapQuotes,
    swapState,
    sellToken.symbol,
    receiveToken?.symbol,
    slippageTolerance,
  ]);

  // Simulate DEX aggregator calculation
  const handleSellAmountChange = (value: string) => {
    if (
      selectedStableFxPair &&
      value !== "" &&
      !/^\d*(?:\.\d{0,6})?$/.test(value)
    ) {
      return;
    }

    setSellAmount(value);
    const nextAmount = Number.parseFloat(value);
    const shouldSearchRoute =
      Number.isFinite(nextAmount) &&
      nextAmount > 0 &&
      Boolean(receiveToken) &&
      !selectedStableFxPair &&
      isSupportedSwapPair(sellToken.symbol, receiveToken?.symbol);

    if (shouldSearchRoute) {
      quoteRequestIdRef.current += 1;
      try {
        const sellTokenDecimals = TOKEN_DECIMALS[sellToken.symbol] || 18;
        const amountInWei = parseUnits(value, sellTokenDecimals).toString();
        activeQuoteKeyRef.current = `${sellToken.symbol}:${receiveToken?.symbol}:${amountInWei}:all:${slippageTolerance}`;
      } catch {
        activeQuoteKeyRef.current = null;
      }
      setQuoteFailureMessage(null);
      setIsRouteSearchPending(true);
      return;
    }

    if (!value || nextAmount <= 0) {
      resetSwapQuote();
    }
  };

  // Handle 50% button click
  const handle50Percent = () => {
    const balance = getTokenBalance(sellToken.symbol);
    const fiftyPercent = (balance * 0.5).toFixed(2);
    handleSellAmountChange(fiftyPercent);
  };

  // Handle Max button click
  const handleMaxAmount = () => {
    const balance = getTokenBalance(sellToken.symbol);
    const spendableBalance = NATIVE_TOKENS.includes(sellToken.symbol)
      ? Math.max(0, balance - NATIVE_USDC_GAS_RESERVE)
      : balance;
    const maxAmount = spendableBalance.toFixed(2);
    handleSellAmountChange(maxAmount);
  };

  // Handle wallet connection
  const handleConnectWallet = async () => {
    if (authenticated) {
      setSwapState("idle");
      return;
    }

    try {
      setSwapState("loading");
      // Trigger the RainbowKit wallet modal
      await login();
      setSwapState("idle");
    } catch (error) {
      console.error("Wallet connection failed:", error);
      setSwapState("idle");
    }
  };

  const handleNavigateToBridge = useCallback(() => {
    if (bridgeNavigationStartedRef.current) {
      return;
    }

    bridgeNavigationStartedRef.current = true;

    if (onNavigateToBridge) {
      onNavigateToBridge();
      return;
    }

    router.push("/bridge");
  }, [onNavigateToBridge, router]);

  // Handle swap transaction
  const handleSwap = async () => {
    if (SWAPS_DISABLED) {
      setSwapState("failed");
      setRevertReason(SWAPS_DISABLED_MESSAGE);
      return;
    }

    setSwapState("loading");
    setRevertReason(null);
    openSwapStepsModal();
    let successNotificationTimeout: ReturnType<typeof setTimeout> | undefined;
    let successResetTimeout: ReturnType<typeof setTimeout> | undefined;
    let submittedSwapTxHash: string | null = null;

    try {
      if (!user?.wallet?.address) {
        throw new Error("Wallet not connected");
      }

      const eip1193Provider = getBrowserWalletProvider();
      const walletRequest = async <T,>(
        args: Parameters<typeof eip1193Provider.request>[0],
        timeoutMs: number,
        label: string,
      ) =>
        withTimeout(
          eip1193Provider.request(args) as Promise<T>,
          timeoutMs,
          label,
        );
      const walletReceiptLookup = (
        hash: string,
        label: string,
      ): Promise<BrowserWalletTransactionReceipt | null> =>
        walletRequest<BrowserWalletTransactionReceipt | null>(
          {
            method: "eth_getTransactionReceipt",
            params: [hash],
          },
          RECEIPT_WALLET_LOOKUP_TIMEOUT_MS,
          label,
        );
      const markSwapSuccess = (hash: string) => {
        setTransactionHash(hash);
        setRevertReason(null);
        setNotificationSwapDetails({
          sellAmount,
          sellTokenSymbol: sellToken.symbol,
          receiveAmount,
          receiveTokenSymbol: receiveToken?.symbol || "",
        });
        setSwapState("success");
        setNotification("success");
        resetSwapForm();

        window.setTimeout(() => {
          setSwapStepsModalOpen(false);
        }, 700);

        // Auto-dismiss after a longer confirmation window so users can review/open the transaction.
        successNotificationTimeout = setTimeout(() => {
          setNotification(null);
          setNotificationSwapDetails(null);
        }, SWAP_SUCCESS_NOTIFICATION_DURATION_MS);

        // Reset after the success modal has had time to remain visible.
        successResetTimeout = setTimeout(() => {
          setSwapState("idle");
          setTransactionHash(null);
          fetchUserBalances();
        }, SWAP_SUCCESS_RESET_DELAY_MS);
      };

      if (!receiveToken) {
        throw new Error("Please select a receive token");
      }

      if (!isSupportedSwapPair(sellToken.symbol, receiveToken.symbol)) {
        throw new Error(
          "This token pair is not currently supported on Tower Swap.",
        );
      }

      // Refresh the Arc wallet RPC config before swaps. A stale wallet RPC can
      // return a hash for a tx that never propagates to Arc's public RPCs.
      try {
        await switchToSelectedArcNetwork();
        await sleep(1000);
        const currentChainId = await walletRequest<string>(
          { method: "eth_chainId" },
          15000,
          "Arc network check",
        );
        if (
          normalizeArcChainHex(currentChainId) !==
          normalizeArcChainHex(getArcNetworkHex(arcNetworkMode))
        ) {
          throw new Error(
            `Please switch to ${getArcNetworkLabel(arcNetworkMode)} to continue`,
          );
        }
      } catch (networkError: unknown) {
        const networkErrorMessage =
          networkError instanceof Error ? networkError.message : null;
        throw new Error(
          networkErrorMessage ||
            `Please switch to ${getArcNetworkLabel(arcNetworkMode)} to perform swaps`,
        );
      }

      // Use the EIP1193 provider directly to send transactions
      const userAddress = await getActiveWalletAddress(eip1193Provider);
      if (!userAddress) {
        throw new Error("User wallet address not available");
      }

      const sendTransactionViaProvider = async (
        txData: {
          to: string;
          value: string;
          data: string;
          gas?: number | string;
          maxFeePerGas?: string;
          maxPriorityFeePerGas?: string;
          nonce?: string;
        },
        txType: string = "transaction",
      ) => {
        try {
          console.log(`[${txType}] Sending to provider:`, {
            from: userAddress,
            to: txData.to,
            value: txData.value,
            dataLength: txData.data?.length || 0,
            data: txData.data?.substring(0, 100) + "...",
            gas: txData.gas,
            maxFeePerGas: txData.maxFeePerGas,
            maxPriorityFeePerGas: txData.maxPriorityFeePerGas,
            nonce: txData.nonce,
          });

          // Get current chain ID to include in transaction
          const currentChainId = await walletRequest<string>(
            { method: "eth_chainId" },
            15000,
            `${txType} network check`,
          );

          if (
            normalizeArcChainHex(currentChainId) !==
            normalizeArcChainHex(getArcNetworkHex(arcNetworkMode))
          ) {
            throw new Error(
              `Invalid chain ID. Expected ${getArcNetworkHex(arcNetworkMode)} (${getArcNetworkLabel(arcNetworkMode)}), got ${currentChainId}. Please switch to ${getArcNetworkLabel(arcNetworkMode)}.`,
            );
          }

          const result = await walletRequest<unknown>(
            {
              method: "eth_sendTransaction",
              params: [
                {
                  from: userAddress, // Use the validated address
                  to: txData.to,
                  value: txData.value?.startsWith("0x")
                    ? txData.value
                    : toHexQuantity(txData.value || "0"),
                  data: txData.data,
                  // NOTE: Do NOT pass chainId here; wallets derive it from the connected network.
                  ...(txData.nonce
                    ? {
                        nonce: txData.nonce,
                      }
                    : {}),
                  ...(txData.gas
                    ? {
                        gas:
                          typeof txData.gas === "string"
                            ? txData.gas
                            : toHexQuantity(txData.gas),
                      }
                    : {}),
                  ...(txData.maxFeePerGas && txData.maxPriorityFeePerGas
                    ? {
                        maxFeePerGas: txData.maxFeePerGas,
                        maxPriorityFeePerGas: txData.maxPriorityFeePerGas,
                      }
                    : {}),
                },
              ],
            },
            300000,
            `${txType} wallet signing`,
          );
          const txHash = extractTransactionHash(result, txType);

          console.log(`[${txType}] Successfully sent, hash:`, txHash);
          return txHash;
        } catch (error: unknown) {
          // Better error serialization
          let errorDetails: Record<string, unknown> = {
            type: txType,
            timestamp: new Date().toISOString(),
          };

          if (error instanceof Error) {
            errorDetails.message = error.message;
            errorDetails.stack = error.stack;
            errorDetails.name = error.name;
          } else if (typeof error === "string") {
            errorDetails.message = error;
          } else if (error && typeof error === "object") {
            // Handle EIP-1193 errors and other structured errors
            const err = error as Record<string, unknown>;
            errorDetails = {
              ...errorDetails,
              message: err.message || err.reason || String(error),
              code: err.code,
              data: err.data,
              // Common EIP-1193 error properties
              shortMessage: err.shortMessage,
              cause: err.cause,
            };
          } else {
            errorDetails.message = String(error);
          }

          console.error(`[${txType}] Failed with error:`, errorDetails);
          throw error;
        }
      };

      // Get token addresses for the swap
      let tokenInAddress: string | null = null;
      let tokenOutAddress: string | null = null;

      tokenInAddress =
        getArcSwapTokenAddress(sellToken.symbol, arcNetworkMode) ?? null;
      tokenOutAddress =
        getArcSwapTokenAddress(receiveToken.symbol, arcNetworkMode) ?? null;

      if (!tokenInAddress || !tokenOutAddress) {
        throw new Error(
          `Token address not found for ${sellToken.symbol} or ${receiveToken.symbol}`,
        );
      }

      // Step 1: Validate balance before proceeding
      const sellAmountNum = parseFloat(sellAmount);
      const balance = getTokenBalance(sellToken.symbol);

      if (sellAmountNum <= 0) {
        throw new Error("Swap amount must be greater than 0");
      }

      if (sellAmountNum > balance) {
        throw new Error(
          `Insufficient balance. You have ${balance.toFixed(6)} ${sellToken.symbol}, but trying to swap ${sellAmount} ${sellToken.symbol}`,
        );
      }

      if (
        NATIVE_TOKENS.includes(sellToken.symbol) &&
        sellAmountNum + NATIVE_USDC_GAS_RESERVE > balance
      ) {
        throw new Error(
          `Keep at least ${NATIVE_USDC_GAS_RESERVE} ${sellToken.symbol} for Arc gas. You have ${balance.toFixed(6)} ${sellToken.symbol}, so reduce the swap amount.`,
        );
      }

      // Step 2: Convert amounts to wei using correct decimals
      const sellTokenDecimals = TOKEN_DECIMALS[sellToken.symbol] || 18;
      const amountInWei = parseUnits(sellAmount, sellTokenDecimals).toString();

      console.log("Preparing swap via Tower Exchange:", {
        sellToken: sellToken.symbol,
        receiveToken: receiveToken.symbol,
        tokenInAddress,
        tokenOutAddress,
        amountInWei,
        amountInHuman: sellAmount,
        walletAddress: userAddress,
        balanceOfSellToken: balance,
        sellTokenDecimals,
      });

      // Step 3: Get swap quote from Tower Exchange backend
      let quote = await getQuote(
        tokenInAddress,
        tokenOutAddress,
        amountInWei,
        slippageTolerance,
        selectedRouterId,
        ARC_NETWORK_CHAIN_ID[arcNetworkMode],
      );

      if (!quote) {
        throw new Error(
          towerError || "Failed to get swap quote from Tower Exchange",
        );
      }

      console.log("Swap quote received:", {
        inputAmount: quote.inputAmount,
        outputAmount: quote.outputAmount,
        minOut: quote.minOut,
        priceImpact: quote.priceImpact,
        routeType: quote.route.type,
        hopsCount: quote.route.hops.length,
      });
      updateSwapStepsRoute(quote.route.hops[0]?.dexName);

      // Step 4: Get swap transaction (which includes approval if needed)
      console.log(
        "Building swap transaction with automatic approval detection...",
      );
      // Convert wallet balance to token's native decimals format for approval limit
      const tokenDecimals = TOKEN_DECIMALS[sellToken.symbol] ?? 18;
      const walletBalanceForApproval = parseUnits(
        sellTokenBalance.toString(),
        tokenDecimals,
      ).toString();

      const transaction = await buildSwapTransaction(
        quote,
        userAddress,
        undefined,
        walletBalanceForApproval,
      );

      if (!transaction) {
        throw new Error(towerError || "Failed to build swap transaction");
      }

      const { approval: approvalTx, swap: swapTx } = transaction;
      const approvalTxs = approvalTx
        ? Array.isArray(approvalTx)
          ? approvalTx
          : [approvalTx]
        : [];

      // Step 5: If approval is needed, submit approval transaction first
      if (approvalTxs.length > 0) {
        setSwapStepsPhase("approval");
        console.log("Approval required - submitting approval transaction...");
        try {
          for (
            let approvalIndex = 0;
            approvalIndex < approvalTxs.length;
            approvalIndex++
          ) {
            const approvalTx = approvalTxs[approvalIndex];
            const approvalLabelBase = approvalTx.label?.trim() || "APPROVAL";
            const approvalLabel =
              approvalTxs.length > 1
                ? `${approvalLabelBase.toUpperCase()} ${approvalIndex + 1}/${approvalTxs.length}`
                : approvalLabelBase.toUpperCase();
            const approvalFeeParams = await getArcFeeParams(arcRpcUrl).catch(
              (feeError: unknown) => {
                console.warn(
                  `[${approvalLabel}] Could not load Arc EIP-1559 fee params; wallet will choose fees`,
                  feeError,
                );
                return null;
              },
            );
            const approvalNonce = await getArcLatestNonce(
              userAddress,
              `${approvalLabel} nonce lookup`,
              arcRpcUrl,
            );

            console.log(`Sending ${approvalLabel} transaction to MetaMask...`);
            const approveTxHash = await sendTransactionViaProvider(
              {
                to: approvalTx.to,
                data: approvalTx.data,
                value: approvalTx.value ?? "0x0",
                gas: approvalTx.gasLimit,
                nonce: approvalNonce,
                ...(approvalFeeParams || {}),
              },
              approvalLabel,
            );

            console.log(`${approvalLabel} transaction sent:`, approveTxHash);

            let approvalReceipt: BrowserWalletTransactionReceipt | null = null;
            try {
              approvalReceipt = await confirmArcSubmittedTransaction(
                approveTxHash,
                {
                  label: approvalLabel,
                  walletReceiptLookup,
                  rpcUrl: arcRpcUrl,
                },
              );
            } catch (confirmError: unknown) {
              const requiredAllowance =
                approvalTx.spender && approvalTx.amountRaw && approvalTx.token
                  ? BigInt(approvalTx.amountRaw)
                  : null;
              if (requiredAllowance && requiredAllowance > 0n) {
                const allowance = await readArcErc20Allowance(
                  approvalTx.token as string,
                  userAddress,
                  approvalTx.spender as string,
                  arcRpcUrl,
                ).catch(() => 0n);
                if (allowance >= requiredAllowance) {
                  console.warn(
                    `${approvalLabel} receipt wait failed, but on-chain allowance is sufficient. Continuing.`,
                    {
                      txHash: approveTxHash,
                      allowance: allowance.toString(),
                      required: requiredAllowance.toString(),
                      message:
                        confirmError instanceof Error
                          ? confirmError.message
                          : String(confirmError),
                    },
                  );
                  continue;
                }
              }
              throw confirmError;
            }

            if (approvalReceipt.status === "0x0") {
              throw new Error(`${approvalLabel} transaction failed on-chain`);
            }

            console.log(
              `${approvalLabel} transaction confirmed:`,
              approvalReceipt,
            );
          }

          console.log("Approval transaction(s) confirmed successfully!");
          setSwapStepsPhase("confirm");

          // CRITICAL: Rebuild swap transaction after approval to get fresh deadline
          // Using old swap data will cause "execution reverted" due to stale deadline
          console.log(
            "Rebuilding swap transaction with fresh deadline after approval...",
          );
          const freshQuote = await getQuote(
            tokenInAddress,
            tokenOutAddress,
            amountInWei,
            slippageTolerance,
            selectedRouterId,
            ARC_NETWORK_CHAIN_ID[arcNetworkMode],
          );

          if (!freshQuote) {
            throw new Error(
              towerError || "Failed to get fresh quote after approval",
            );
          }

          const freshTransaction = await buildSwapTransaction(
            freshQuote,
            userAddress,
            undefined,
            walletBalanceForApproval,
          );
          if (!freshTransaction) {
            throw new Error(
              towerError ||
                "Failed to build fresh swap transaction after approval",
            );
          }

          // Update swapTx to the fresh one with new deadline
          Object.assign(swapTx, freshTransaction.swap);
          quote = freshQuote;
          updateSwapStepsRoute(freshQuote.route.hops[0]?.dexName);

          console.log("Fresh swap transaction ready:", {
            to: swapTx.to,
            dataLength: swapTx.data?.length,
            gasLimit: swapTx.gasLimit,
          });
        } catch (approvalError: unknown) {
          let approvalErrorDetails: Record<string, unknown> = {
            context: "tokenApproval",
            timestamp: new Date().toISOString(),
            token: sellToken.symbol,
          };

          if (approvalError instanceof Error) {
            approvalErrorDetails.message = approvalError.message;
            approvalErrorDetails.stack = approvalError.stack;
            approvalErrorDetails.name = approvalError.name;
          } else if (typeof approvalError === "string") {
            approvalErrorDetails.message = approvalError;
          } else if (approvalError && typeof approvalError === "object") {
            const err = approvalError as Record<string, unknown>;
            approvalErrorDetails = {
              ...approvalErrorDetails,
              message: err.message || err.reason || String(approvalError),
              code: err.code,
              data: err.data,
            };
          } else {
            approvalErrorDetails.message = String(approvalError);
          }

          console.error(
            "Approval transaction error details:",
            approvalErrorDetails,
          );
          throw new Error(
            `Token approval failed: ${approvalErrorDetails.message || "Unknown error"}. Please try again.`,
          );
        }
      } else {
        console.log("No approval needed - proceeding with swap");
      }
      setSwapStepsPhase("confirm");

      // Step 6: Send swap transaction
      const swapDataToSend = {
        to: swapTx.to,
        value: swapTx.value,
        data: swapTx.data,
        gasLimit: swapTx.gasLimit,
      };

      // Step 7: Send swap transaction via provider
      console.log("Sending swap transaction...");
      console.log("Swap transaction data:", {
        to: swapDataToSend.to,
        value: swapDataToSend.value,
        dataLength: swapDataToSend.data?.length || 0,
        sellToken: sellToken.symbol,
        receiveToken: receiveToken.symbol,
        amountIn: amountInWei,
        slippage: slippageTolerance,
      });

      // Preflight the swap before signing. If this fails, the transaction is
      // likely to be dropped or reverted, so do not broadcast it.
      let bufferedSwapGas: string | null = null;
      let shouldUseWalletGasEstimate = false;
      try {
        console.log("Estimating gas...");
        const gasEstimate = await walletRequest<unknown>(
          {
            method: "eth_estimateGas",
            params: [
              {
                from: userAddress,
                to: swapDataToSend.to,
                value: swapDataToSend.value,
                data: swapDataToSend.data,
              },
            ],
          },
          15000,
          "Swap gas estimation",
        );
        console.log("Gas estimate successful:", gasEstimate);
        bufferedSwapGas = applyGasBuffer(gasEstimate);
      } catch (estimateError: unknown) {
        // Log the error but continue - the wallet will provide its own gas estimation
        let estimateErrorDetails: Record<string, unknown> = {
          context: "gasEstimation",
          timestamp: new Date().toISOString(),
          note: "Continuing with swap - wallet will estimate gas",
        };

        if (estimateError instanceof Error) {
          estimateErrorDetails.message = estimateError.message;
          estimateErrorDetails.stack = estimateError.stack;
          estimateErrorDetails.name = estimateError.name;
        } else if (typeof estimateError === "string") {
          estimateErrorDetails.message = estimateError;
        } else if (estimateError && typeof estimateError === "object") {
          const err = estimateError as Record<string, unknown>;
          estimateErrorDetails = {
            ...estimateErrorDetails,
            message: err.message || err.reason || String(estimateError),
            code: err.code,
            data: err.data,
            shortMessage: err.shortMessage,
            cause: err.cause,
          };
        } else {
          estimateErrorDetails.message = String(estimateError);
        }

        const estimateErrorMessage = String(
          estimateErrorDetails.message || "gas estimation failed",
        );
        const isRecoverableGasEstimationFailure =
          isRecoverableGasEstimationError(estimateErrorMessage);

        if (isRecoverableGasEstimationFailure) {
          bufferedSwapGas =
            typeof swapDataToSend.gasLimit === "string"
              ? swapDataToSend.gasLimit.startsWith("0x")
                ? swapDataToSend.gasLimit
                : toHexQuantity(swapDataToSend.gasLimit)
              : null;
          shouldUseWalletGasEstimate = !bufferedSwapGas;
          estimateErrorDetails.note = bufferedSwapGas
            ? "Continuing with fallback gas limit after Arc RPC estimation failure"
            : "Continuing with swap - letting wallet estimate gas";
          console.warn(
            "Gas estimation failed on Arc RPC; falling back to buffered transaction gas:",
            {
              ...estimateErrorDetails,
              fallbackGas: bufferedSwapGas,
            },
          );
        } else {
          estimateErrorDetails.note = "Stopping swap - gas preflight failed";
          console.error("Gas estimation error details:", estimateErrorDetails);
          throw new Error(`Swap preflight failed: ${estimateErrorMessage}`);
        }
      }

      // Ensure value is properly formatted (should be hex string)
      const swapValue = swapDataToSend.value?.startsWith("0x")
        ? swapDataToSend.value
        : swapDataToSend.value
          ? toHexQuantity(swapDataToSend.value)
          : "0x0";

      // CRITICAL FIX: Only zero out value for pure ERC-20 token swaps (no native tokens)
      // Native tokens (like USDC) REQUIRE non-zero ETH value via payable functions
      // ERC-20 tokens should NEVER have a non-zero value
      const isNativeInputFinal = NATIVE_TOKENS.includes(sellToken.symbol);
      const isNativeOutputFinal = NATIVE_TOKENS.includes(receiveToken.symbol);
      const finalSwapValue =
        !isNativeInputFinal && !isNativeOutputFinal ? "0x0" : swapValue;

      if (finalSwapValue !== swapValue) {
        console.warn("Corrected swap value to 0x0 for pure ERC-20 token swap", {
          originalValue: swapValue,
          correctedValue: finalSwapValue,
          sellToken: sellToken.symbol,
          receiveToken: receiveToken.symbol,
        });
      }

      const swapFeeParams = await getArcFeeParams(arcRpcUrl).catch(
        (feeError: unknown) => {
          console.warn(
            "[SWAP] Could not load Arc EIP-1559 fee params; wallet will choose fees",
            feeError,
          );
          return null;
        },
      );
      const swapNonce = await getArcLatestNonce(
        userAddress,
        "Swap nonce lookup",
        arcRpcUrl,
      );

      console.log("Final swap transaction parameters:", {
        to: swapDataToSend.to,
        value: finalSwapValue,
        dataLength: swapDataToSend.data?.length,
        gasLimit: swapDataToSend.gasLimit,
      });

      const txHash = await sendTransactionViaProvider(
        {
          to: swapDataToSend.to,
          value: finalSwapValue,
          data: swapDataToSend.data,
          gas: shouldUseWalletGasEstimate
            ? undefined
            : (bufferedSwapGas ?? swapDataToSend.gasLimit ?? undefined),
          nonce: swapNonce,
          ...(swapFeeParams || {}),
        },
        "SWAP",
      );

      console.log("Swap transaction executed with hash:", txHash);
      console.log("[SwapCard] Transaction hash captured:", {
        txHash,
        isString: typeof txHash === "string",
        length: typeof txHash === "string" ? txHash.length : "N/A",
      });
      submittedSwapTxHash = txHash;
      setTransactionHash(txHash);
      setRevertReason(null);
      setSwapStepsPhase("wait");

      let receipt = await waitForArcTransactionReceipt(txHash, {
        label: "Swap receipt lookup",
        maxWaitMs: 120000,
        walletReceiptLookup,
        rpcUrl: arcRpcUrl,
      });

      if (!receipt) {
        const pendingTx = await getArcTransactionByHash(
          txHash,
          "Pending swap transaction lookup",
          arcRpcUrl,
        ).catch((error: unknown) => {
          console.warn(
            "[SwapCard] Could not look up pending swap transaction",
            {
              txHash,
              message: error instanceof Error ? error.message : String(error),
            },
          );
          return null;
        });

        if (pendingTx && !pendingTx.blockNumber) {
          console.warn(
            "[SwapCard] Swap transaction is still pending after initial receipt timeout",
            {
              txHash,
              nonce: pendingTx.nonce,
            },
          );
          setSwapState("pending");
          setNotification("pending");
          setSwapStepsPhase("wait");

          const extendedWaitStartedAt = Date.now();
          let missingPendingLookups = 0;

          while (!receipt && Date.now() - extendedWaitStartedAt < 900000) {
            await sleep(5000);
            receipt = await waitForArcTransactionReceipt(txHash, {
              label: "Extended swap receipt lookup",
              maxWaitMs: 15000,
              pollIntervalMs: 3000,
              walletReceiptLookup,
              rpcUrl: arcRpcUrl,
            });

            if (receipt) {
              break;
            }

            const latestPendingTx = await getArcTransactionByHash(
              txHash,
              "Extended pending swap transaction lookup",
              arcRpcUrl,
            ).catch(() => null);

            if (!latestPendingTx) {
              missingPendingLookups += 1;
            } else {
              missingPendingLookups = 0;
            }

            if (missingPendingLookups >= 2) {
              throw new Error(
                "Swap transaction was dropped by Arc RPC before confirmation. Retrying will replace the dropped wallet nonce with the current Arc nonce.",
              );
            }
          }

          if (!receipt) {
            console.warn(
              "[SwapCard] Swap transaction is still pending after extended receipt wait",
              { txHash },
            );
            setSwapState("idle");
            return;
          }
        } else {
          throw new Error(
            "Swap transaction was submitted, but confirmation was not received within 120 seconds and the transaction is not visible as pending on Arc RPC. Please check Arcscan before trying again.",
          );
        }
      }

      console.log("Transaction receipt received:", receipt);

      // Check if transaction was successful (status === '0x1')
      if (receipt.status === "0x0") {
        console.error("Transaction failed! Getting revert reason...");
        let decodedReason: string | null = null;

        try {
          const tx = await walletRequest<{
            from?: string;
            to?: string;
            value?: string;
            input?: string;
          } | null>(
            {
              method: "eth_getTransactionByHash",
              params: [txHash],
            },
            10000,
            "Failed swap transaction lookup",
          );

          if (tx?.from && tx?.to && tx?.input) {
            console.log(
              "Failed transaction data:",
              JSON.stringify(
                {
                  from: tx.from,
                  to: tx.to,
                  value: tx.value,
                  inputLength: tx.input?.length,
                },
                null,
                2,
              ),
            );
            // Use public RPC for eth_call so we get revert data instead of "Internal JSON-RPC error"
            decodedReason = await getRevertReasonViaPublicRpc({
              from: tx.from,
              to: tx.to,
              value: tx.value ?? "0x0",
              data: tx.input,
            });
            if (decodedReason) {
              setRevertReason(decodedReason);
              console.error("Revert reason (decoded):", decodedReason);
            }
          }
        } catch (callError: unknown) {
          const callErrorObj =
            callError instanceof Error
              ? callError
              : new Error(String(callError));
          console.error("Revert reason extraction error:", {
            message: callErrorObj.message,
            error: callError,
          });
        }

        throw new Error(
          decodedReason
            ? `Transaction failed: ${decodedReason}`
            : "Transaction failed on-chain (status: 0x0)",
        );
      }

      console.log("[SwapCard] Fee-aware swap settled:", {
        txHash,
        feeMode: swapTx?.feeMode,
        feeToken: swapTx?.feeToken,
        platformFeeAmount: swapTx?.platformFeeAmount,
        executorAddress: swapTx?.executorAddress,
      });
      await fetchUserBalances();

      const swapActivityId = await logSwapActivity(
        "Successful",
        txHash,
        quote.route.hops[0]?.dexName || getActiveSwapRouteName(),
      );

      if (
        swapTx?.feeMode === "tower-swap-executor" &&
        swapTx?.platformFeeAmount &&
        swapTx?.feeToken
      ) {
        const receiptBlockNumber =
          typeof receipt.blockNumber === "string"
            ? Number.parseInt(receipt.blockNumber, 16)
            : undefined;
        const swapFeeResult = await recordExecutorSwapFee({
          walletAddress: userAddress,
          tokenAddress: swapTx.feeToken,
          tokenSymbol: sellToken.symbol,
          totalAmount: amountInWei,
          feeAmount: swapTx.platformFeeAmount,
          feeBps: swapTx.feeBps ?? quote.feeBps ?? 25,
          transactionHash: txHash,
          blockNumber: receiptBlockNumber,
          activityId: swapActivityId,
          usdPrice: sellTokenWithLivePrice.usdPrice,
        });

        if (!swapFeeResult.success) {
          console.error("[SwapCard] Failed to persist swap fee:", {
            txHash,
            error: swapFeeResult.error,
          });
        }
      }

      setSwapStepsPhase("success");
      markSwapSuccess(txHash);
    } catch (error: unknown) {
      // Better error serialization for swap errors
      let errorDetails: Record<string, unknown> = {
        context: "handleSwap",
        timestamp: new Date().toISOString(),
        sellToken: sellToken.symbol,
        receiveToken: receiveToken?.symbol || "Not Selected",
        sellAmount,
        transactionHash: submittedSwapTxHash ?? undefined,
        revertReason: revertReason ?? undefined,
      };

      if (error instanceof Error) {
        errorDetails.message = error.message;
        errorDetails.stack = error.stack;
        errorDetails.name = error.name;
      } else if (typeof error === "string") {
        errorDetails.message = error;
      } else if (error && typeof error === "object") {
        // Handle EIP-1193 errors and other structured errors
        const err = error as Record<string, unknown>;
        errorDetails = {
          ...errorDetails,
          message: err.message || err.reason || String(error),
          code: err.code,
          data: err.data,
          shortMessage: err.shortMessage,
          cause: err.cause,
        };
      } else {
        errorDetails.message = String(error);
      }

      if (successNotificationTimeout) {
        clearTimeout(successNotificationTimeout);
      }
      if (successResetTimeout) {
        clearTimeout(successResetTimeout);
      }

      // Ensure UI shows decoded revert reason (state may not have updated yet)
      const msg = errorDetails.message as string | undefined;
      const decodedFromMessage = msg?.startsWith("Transaction failed: ")
        ? msg.slice("Transaction failed: ".length)
        : null;
      if (decodedFromMessage) {
        const displayReason =
          decodedFromMessage.toLowerCase() === "execution reverted"
            ? "Execution reverted (check allowance, slippage, or liquidity)"
            : decodedFromMessage;
        setRevertReason(displayReason);
        errorDetails.revertReason = decodedFromMessage;
        if (decodedFromMessage.toLowerCase() === "execution reverted") {
          errorDetails.hint =
            "Try: approve the sell token again, or increase slippage in Settings.";
        }
      }

      console.error(
        "Swap transaction error - Full details:",
        JSON.stringify(errorDetails, null, 2),
      );

      setSwapStepsPhase("failed");
      setSwapStepsFailedPhase(
        submittedSwapTxHash
          ? "wait"
          : typeof errorDetails.message === "string" &&
              errorDetails.message.toLowerCase().includes("approval")
            ? "approval"
            : "confirm",
      );
      setSwapStepsFailureMessage(
        typeof errorDetails.message === "string"
          ? errorDetails.message
          : "Swap failed",
      );
      setSwapState("failed");
      setNotification("failed");
      setNotificationSwapDetails(null);
      if (!submittedSwapTxHash) {
        setTransactionHash(null);
      }

      // Auto-dismiss notification after 5 seconds
      setTimeout(() => {
        setNotification(null);
      }, 5000);

      setTimeout(() => {
        setSwapState("idle");
        setRevertReason(null);
      }, 3000);
    }
  };

  // Get button content based on state
  const getButtonContent = () => {
    if (SWAPS_DISABLED) {
      return "Swaps Paused";
    }

    if (!isWalletConnected) {
      return "Connect Wallet";
    }

    if (swapState === "loading" || swapState === "pending") {
      return "Swap";
    }

    if (isSwapBalanceInsufficient) {
      return "Insufficient Balance";
    }

    if (!isSwapActive) {
      return "Swap";
    }

    return "Swap";
  };

  // Get button styles based on state
  const getButtonStyles = () => {
    const baseStyles =
      "w-full rounded-xl h-14 text-base font-semibold text-black transition-all";

    if (swapState === "loading" || swapState === "pending") {
      return `${baseStyles} bg-muted hover:bg-muted cursor-not-allowed text-gray-500`;
    }

    if (
      SWAPS_DISABLED ||
      (isWalletConnected && (!isSwapActive || isSwapBalanceInsufficient))
    ) {
      return `${baseStyles} bg-muted hover:bg-muted cursor-not-allowed text-gray-500`;
    }

    return `${baseStyles} bg-primary hover:opacity-90`;
  };

  const activeNotificationSwapDetails =
    notificationSwapDetails ??
    (receiveToken
      ? {
          sellAmount,
          sellTokenSymbol: sellToken.symbol,
          receiveAmount,
          receiveTokenSymbol: receiveToken.symbol,
        }
      : null);

  const isSwapStepComplete = (step: "approval" | "confirm" | "wait") => {
    if (swapStepsPhase === "success") {
      return true;
    }

    if (swapStepsPhase === "wait") {
      return step === "approval" || step === "confirm";
    }

    if (swapStepsPhase === "confirm") {
      return step === "approval";
    }

    return false;
  };

  const getSwapStepStatus = (
    step: "approval" | "confirm" | "wait" | "receive",
  ): TransactionStep["status"] => {
    if (swapStepsPhase === "failed") {
      if (step === swapStepsFailedPhase) {
        return "failed";
      }

      if (step === "receive") {
        return "pending";
      }

      return isSwapStepComplete(step) ? "complete" : "pending";
    }

    if (swapStepsPhase === "success") {
      return "complete";
    }

    if (step === "receive") {
      return "pending";
    }

    if (step === swapStepsPhase) {
      return "active";
    }

    return isSwapStepComplete(step) ? "complete" : "pending";
  };

  const swapTransactionSteps: TransactionStep[] = [
    {
      id: "approve",
      label: `Approve ${swapStepsDetails.sellTokenSymbol}`,
      status: getSwapStepStatus("approval"),
      detail:
        swapStepsPhase === "failed" && swapStepsFailedPhase === "approval"
          ? swapStepsFailureMessage || "Approval failed"
          : getSwapStepStatus("approval") === "active"
            ? "Approving in your wallet"
            : undefined,
      kind: "wallet",
    },
    {
      id: "confirm",
      label: "Confirm Swap",
      status: getSwapStepStatus("confirm"),
      detail:
        swapStepsPhase === "failed" && swapStepsFailedPhase === "confirm"
          ? swapStepsFailureMessage || "Swap failed"
          : getSwapStepStatus("confirm") === "active"
            ? "Confirming in your wallet"
            : undefined,
      kind: "wallet",
    },
    {
      id: "wait",
      label: "Wait ~2 sec",
      status: getSwapStepStatus("wait"),
      detail:
        swapStepsPhase === "failed" && swapStepsFailedPhase === "wait"
          ? swapStepsFailureMessage || "Confirmation failed"
          : getSwapStepStatus("wait") === "active"
            ? "Waiting on Arc"
            : undefined,
      kind: "wait",
    },
    {
      id: "receive",
      label: `Got ${swapStepsDetails.receiveAmount || "0.00"} ${
        swapStepsDetails.receiveTokenSymbol || "tokens"
      } on Arc`,
      status: getSwapStepStatus("receive"),
    },
  ];
  const swapActivityProgressByPhase: Record<typeof swapStepsPhase, number> = {
    approval: 18,
    confirm: 44,
    wait: 72,
    success: 100,
    failed: 100,
  };
  const isSwapActivityProcessing =
    swapState === "loading" || swapState === "pending";
  const swapLiveActivityItems: ActivityTabLiveItem[] = isSwapActivityProcessing
    ? [
        {
          id: transactionHash || "active-swap",
          kind: "swap",
          title: `Swap ${swapStepsDetails.sellAmount} ${
            swapStepsDetails.sellTokenSymbol
          } to ${swapStepsDetails.receiveAmount || "0.00"} ${
            swapStepsDetails.receiveTokenSymbol || "tokens"
          }`,
          routeLabel: swapStepsDetails.dexName || getActiveSwapRouteName(),
          status: "processing",
          statusLabel: "Submitting Swap",
          progress: swapActivityProgressByPhase[swapStepsPhase],
          timestamp: swapActivityStartedAt ?? Date.now(),
          sourceIcon: swapStepsDetails.sellTokenIcon,
          targetIcon: swapStepsDetails.receiveTokenIcon,
          sourceChainIcon: arcTestnetLogo,
          targetChainIcon: arcTestnetLogo,
          transactionHash,
          onClick: () => {
            setIsActivityOpen(false);
            setSwapStepsModalOpen(true);
          },
        },
      ]
    : [];

  const stableFxStepOrder: StableFxFailedStep[] = [
    "deposit",
    "confirm",
    "settlement",
    "payout",
  ];
  const getStableFxStepStatus = (
    step: StableFxFailedStep,
  ): TransactionStep["status"] => {
    const stepIndex = stableFxStepOrder.indexOf(step);

    if (stableFxStepsPhase === "success") {
      return "complete";
    }

    if (stableFxStepsPhase === "failed") {
      const failedIndex = stableFxStepOrder.indexOf(stableFxStepsFailedStep);
      if (stepIndex === failedIndex) return "failed";
      return stepIndex < failedIndex ? "complete" : "pending";
    }

    const activeIndex = stableFxStepOrder.indexOf(
      stableFxStepsPhase as StableFxFailedStep,
    );
    if (stepIndex === activeIndex) return "active";
    return stepIndex < activeIndex ? "complete" : "pending";
  };
  const stableFxTenorElapsed =
    stableFxSettlementDeadline !== null &&
    stableFxStepsPhase === "settlement" &&
    stableFxCountdownNow >= stableFxSettlementDeadline;
  const stableFxCountdownLabel =
    stableFxSettlementDeadline !== null &&
    stableFxStepsPhase === "settlement" &&
    !stableFxTenorElapsed
      ? formatStableFxCountdown(stableFxSettlementDeadline - stableFxCountdownNow)
      : null;
  const stableFxTransactionSteps: TransactionStep[] = [
    {
      id: "deposit",
      label: `Deposit ${stableFxStepsDetails.sellAmount || "0.00"} ${
        stableFxStepsDetails.sellTokenSymbol
      }`,
      status: getStableFxStepStatus("deposit"),
      detail:
        stableFxStepsPhase === "failed" && stableFxStepsFailedStep === "deposit"
          ? stableFxStepsFailureMessage || "Deposit failed"
          : getStableFxStepStatus("deposit") === "active"
            ? "Confirm in your wallet"
            : undefined,
      kind: "wallet",
    },
    {
      id: "confirm",
      label: "Confirm deposit on Arc",
      status: getStableFxStepStatus("confirm"),
      detail:
        stableFxStepsPhase === "failed" && stableFxStepsFailedStep === "confirm"
          ? stableFxStepsFailureMessage || "Deposit confirmation failed"
          : getStableFxStepStatus("confirm") === "active"
            ? "Waiting for Arc"
            : undefined,
      kind: "wait",
    },
    {
      id: "settlement",
      label: "Complete Circle StableFX trade (~30 min)",
      status: getStableFxStepStatus("settlement"),
      detail:
        stableFxStepsPhase === "failed" &&
        stableFxStepsFailedStep === "settlement"
          ? stableFxStepsFailureMessage || "Circle settlement failed"
          : getStableFxStepStatus("settlement") === "active"
            ? stableFxTenorElapsed
              ? "Instant tenor window elapsed - confirming final settlement"
              : stableFxCountdownLabel
              ? `Instant tenor settlement · ${stableFxCountdownLabel} remaining`
              : "Instant tenor settlement"
            : undefined,
      kind: "wait",
    },
    {
      id: "payout",
      label: `Receive ${stableFxStepsDetails.receiveAmount || "0.00"} ${
        stableFxStepsDetails.receiveTokenSymbol || "tokens"
      } on Arc`,
      status: getStableFxStepStatus("payout"),
      detail:
        stableFxStepsPhase === "failed" && stableFxStepsFailedStep === "payout"
          ? stableFxStepsFailureMessage || "Payout failed"
          : getStableFxStepStatus("payout") === "active"
            ? "Sending to your wallet"
            : undefined,
      kind: "wait",
    },
  ];
  const stableFxActivityProgressByPhase: Record<StableFxStepsPhase, number> = {
    deposit: 18,
    confirm: 42,
    settlement: 70,
    payout: 88,
    success: 100,
    failed: 100,
  };
  const stableFxActivityStatusLabel: Record<StableFxStepsPhase, string> = {
    deposit: "Awaiting StableFX deposit",
    confirm: "Confirming StableFX deposit",
    settlement: stableFxTenorElapsed
      ? "Circle StableFX - confirming final settlement"
      : stableFxCountdownLabel
      ? `Circle StableFX settlement · ${stableFxCountdownLabel} left`
      : "Circle StableFX settlement (~30 min)",
    payout: "Sending StableFX payout",
    success: "StableFX Successful",
    failed: "StableFX Failed",
  };
  const isStableFxActivityProcessing =
    (stableFxActivityStartedAt !== null || isStableFxOrderActive) &&
    stableFxStepsPhase !== "success" &&
    stableFxStepsPhase !== "failed";
  const isStableFxTradeInProgress =
    isStableFxOrderActive || isStableFxActivityProcessing;
  const shouldShowActivityPendingIndicator =
    (isSwapActivityProcessing && !swapStepsModalOpen) ||
    (isStableFxActivityProcessing && !stableFxStepsModalOpen);
  const stableFxLiveActivityItems: ActivityTabLiveItem[] =
    isStableFxActivityProcessing
      ? [
          {
            id: stableFxOrderId || stableFxTransactionHash || "active-stablefx",
            kind: "swap",
            title: `StableFX ${stableFxStepsDetails.sellAmount} ${
              stableFxStepsDetails.sellTokenSymbol
            } to ${stableFxStepsDetails.receiveAmount || "0.00"} ${
              stableFxStepsDetails.receiveTokenSymbol || "tokens"
            }`,
            routeLabel: "Circle StableFX",
            status: "processing",
            statusLabel: stableFxActivityStatusLabel[stableFxStepsPhase],
            progress: stableFxActivityProgressByPhase[stableFxStepsPhase],
            timestamp: stableFxActivityStartedAt ?? Date.now(),
            sourceIcon: stableFxStepsDetails.sellTokenIcon,
            targetIcon: stableFxStepsDetails.receiveTokenIcon,
            sourceChainIcon: arcTestnetLogo,
            targetChainIcon: arcTestnetLogo,
            transactionHash: stableFxTransactionHash,
          },
        ]
      : [];

  return (
    <div className="flex w-full items-start justify-center gap-6">
      <TransactionStepsModal
        isOpen={swapStepsModalOpen}
        onClose={() => setSwapStepsModalOpen(false)}
        variant="swap"
        title={`Swap ${swapStepsDetails.sellAmount} ${
          swapStepsDetails.sellTokenSymbol
        } to ${swapStepsDetails.receiveAmount || "0.00"} ${
          swapStepsDetails.receiveTokenSymbol || ""
        }`.trim()}
        subtitle={`via ${swapStepsDetails.dexName || getActiveSwapRouteName()}`}
        fromIcon={swapStepsDetails.sellTokenIcon}
        toIcon={swapStepsDetails.receiveTokenIcon}
        fromBadgeIcon={arcTestnetLogo}
        toBadgeIcon={arcTestnetLogo}
        steps={swapTransactionSteps}
      />
      <TransactionStepsModal
        isOpen={stableFxStepsModalOpen}
        onClose={() => setStableFxStepsModalOpen(false)}
        variant="swap"
        title={`StableFX ${stableFxStepsDetails.sellAmount} ${
          stableFxStepsDetails.sellTokenSymbol
        } to ${stableFxStepsDetails.receiveAmount || "0.00"} ${
          stableFxStepsDetails.receiveTokenSymbol || ""
        }`.trim()}
        subtitle="via Circle StableFX"
        fromIcon={stableFxStepsDetails.sellTokenIcon}
        toIcon={stableFxStepsDetails.receiveTokenIcon}
        fromBadgeIcon={arcTestnetLogo}
        toBadgeIcon={arcTestnetLogo}
        steps={stableFxTransactionSteps}
      />
      <ActivityTabModal
        isOpen={isActivityOpen}
        onClose={() => setIsActivityOpen(false)}
        isWalletConnected={isWalletConnected}
        walletAddress={user?.wallet?.address ?? null}
        liveItems={[...stableFxLiveActivityItems, ...swapLiveActivityItems]}
      />

      {/* Swap Notification */}
      <AnimatePresence>
        {notification &&
          activeNotificationSwapDetails &&
          !swapStepsModalOpen && (
            <SwapNotification
              type={notification}
              sellAmount={activeNotificationSwapDetails.sellAmount}
              sellToken={activeNotificationSwapDetails.sellTokenSymbol}
              receiveAmount={activeNotificationSwapDetails.receiveAmount}
              receiveToken={activeNotificationSwapDetails.receiveTokenSymbol}
              onClose={() => {
                setNotification(null);
                setNotificationSwapDetails(null);
                // CRITICAL: Refresh balances when user closes the notification
                // This ensures the displayed balance is up-to-date after successful swap
                if (notification === "success") {
                  console.log(
                    "[SwapCard] Success notification closed - refreshing balances",
                  );
                  fetchUserBalances();
                }
              }}
              transactionHash={transactionHash}
              revertReason={revertReason}
            />
          )}
      </AnimatePresence>

      <div className="w-full max-w-md shrink-0">
        <motion.div
          className="bg-[#191A1C] border border-border rounded-2xl px-6 pt-6 pb-6 flex flex-col"
          whileHover={{ boxShadow: "0 0 30px rgba(59, 130, 246, 0.1)" }}
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="inline-flex items-center gap-1 rounded-full bg-[#121211] p-1">
              <span className="px-3 py-1.5 text-xs font-medium rounded-full bg-accent text-foreground">
                Swap
              </span>
              <button
                type="button"
                onPointerDown={(event) => {
                  event.preventDefault();
                  handleNavigateToBridge();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  handleNavigateToBridge();
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-full text-muted-foreground"
              >
                Bridge
              </button>
            </div>
            <div className="flex items-center gap-2">
              <motion.button
                type="button"
                aria-label="Open activity tab"
                onClick={() => setIsActivityOpen(true)}
                className={`inline-flex items-center gap-1.5 rounded-lg p-2 transition-colors cursor-pointer ml-1 ${shouldShowActivityPendingIndicator ? "bg-secondary hover:bg-secondary" : "hover:bg-secondary"}`}
                variants={{
                  hover: { scale: 1.1 },
                  tap: { scale: 0.9 },
                }}
                whileHover="hover"
                whileTap="tap"
              >
                <motion.span
                  variants={{
                    hover: { rotate: 90 },
                    tap: { scale: 0.9 },
                  }}
                  className="inline-flex"
                >
                  <Clock className="h-5 w-5 text-foreground" />
                </motion.span>
                {shouldShowActivityPendingIndicator ? (
                  <span className="text-xs font-medium text-muted-foreground">
                    Pending
                  </span>
                ) : null}
              </motion.button>
              <motion.button
                type="button"
                aria-label="Reset swap"
                onClick={() => {
                  if (selectedStableFxPair) {
                    stableFxRefreshHandlerRef.current?.();
                    return;
                  }
                  resetSwapForm();
                }}
                className="p-2 rounded-lg hover:bg-secondary transition-colors cursor-pointer"
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
              >
                <RefreshCw className="w-5 h-5 text-foreground" />
              </motion.button>
              {/* Chart icon — uncomment later
              <motion.button
                onClick={() => setIsChartOpen(!isChartOpen)}
                className="p-2 rounded-lg hover:bg-secondary transition-colors cursor-pointer"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <BarChart3 className="w-5 h-5 text-foreground" />
              </motion.button>
              */}
              <motion.button
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 rounded-lg hover:bg-secondary transition-colors cursor-pointer"
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
              >
                <Settings className="w-5 h-5 text-foreground" />
              </motion.button>
            </div>
          </div>

          {!selectedStableFxPair && SWAPS_DISABLED && (
            <div className="mb-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100">
              {SWAPS_DISABLED_MESSAGE}
            </div>
          )}

          {isStableFxTradeInProgress &&
            (stableFxCountdownLabel || stableFxTenorElapsed) && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 text-xs text-foreground">
              <span>
                {stableFxTenorElapsed
                  ? "Circle StableFX tenor window elapsed"
                  : "Circle StableFX settlement in progress"}
              </span>
              <span className="font-semibold tabular-nums text-primary">
                {stableFxTenorElapsed
                  ? "Confirming final settlement"
                  : `${stableFxCountdownLabel} remaining`}
              </span>
            </div>
          )}

          {/* Sell Section */}
          <div className="rounded-xl bg-[#151617] p-4 mb-2">
            <div className="flex items-center justify-between mb-2 ">
              <span className="text-sm text-muted-foreground">Sell</span>
              <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                <Wallet className="w-4 h-4" />
                <span>
                  {isLoadingBalances
                    ? "Loading..."
                    : `${getFormattedBalance(sellToken.symbol)} ${sellToken.symbol}`}
                </span>
                <button
                  onClick={handle50Percent}
                  disabled={selectedStableFxPair && isStableFxOrderActive}
                  className="text-muted-foreground hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  50%
                </button>
                <button
                  onClick={handleMaxAmount}
                  disabled={selectedStableFxPair && isStableFxOrderActive}
                  className="text-muted-foreground hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Max
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <TokenSelector
                selected={sellTokenWithLivePrice}
                onOpenModal={() => setIsSellTokenModalOpen(true)}
              />
              <TokenInput
                value={sellAmount}
                onChange={handleSellAmountChange}
                onClear={resetSwapForm}
                usdValueLabel={sellUsdValueLabel}
                disabled={selectedStableFxPair && isStableFxOrderActive}
              />
            </div>
          </div>

          {/* Swap Arrow Button */}
          <div className="flex justify-center -my-6 relative z-10">
            <motion.button
              onClick={handleSwapTokens}
              className="w-10 h-10 rounded-xl bg-secondary border border-border flex items-center justify-center hover:bg-accent transition-colors"
              whileHover={{ scale: 1.1, rotate: 180 }}
              whileTap={{ scale: 0.9 }}
              transition={{ duration: 0.2 }}
            >
              <ArrowDown className="w-5 h-5 text-muted-foreground" />
            </motion.button>
          </div>

          {/* Receive Section */}
          <div className="rounded-xl bg-[#151617] p-4 mt-2 mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">Receive</span>
              {receiveToken && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Wallet className="w-4 h-4" />
                  <span>
                    {isLoadingBalances
                      ? "Loading..."
                      : `${getFormattedBalance(receiveToken.symbol)} ${receiveToken.symbol}`}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <TokenSelector
                selected={receiveToken}
                onOpenModal={() => setIsReceiveTokenModalOpen(true)}
              />
              <TokenInput
                value={receiveAmount}
                onChange={setReceiveAmount}
                onClear={resetSwapQuote}
                usdValueLabel={effectiveReceiveUsdValueLabel}
                isLoading={isReceiveQuoteLoading}
                loadingLabel="Searching for best route"
                disabled={selectedStableFxPair}
                forceWhiteValue={selectedStableFxPair}
              />
            </div>
          </div>

          <StableFxPanel
            walletAddress={user?.wallet?.address ?? null}
            isWalletConnected={isWalletConnected}
            onConnectWallet={handleConnectWallet}
            registerRefreshHandler={registerStableFxRefreshHandler}
            embedded
            isEmbeddedVisible={Boolean(
              selectedStableFxPair && stableFxFromCurrency && stableFxToCurrency,
            )}
            selectedFromCurrency={stableFxFromCurrency}
            selectedToCurrency={stableFxToCurrency}
            selectedAmount={sellAmount === "0.00" ? "" : sellAmount}
            onReceiveAmountChange={setReceiveAmount}
            onOrderActiveChange={setIsStableFxOrderActive}
            onReset={resetSwapForm}
            onTransactionProgress={handleStableFxTransactionProgress}
          />

          {!selectedStableFxPair && (
            <>
              {/* Action Button */}
              <motion.div
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Button
                  onClick={isWalletConnected ? handleSwap : handleConnectWallet}
                  disabled={
                    SWAPS_DISABLED ||
                    swapState === "loading" ||
                    swapState === "pending" ||
                    (isWalletConnected &&
                      (!isSwapActive || isSwapBalanceInsufficient))
                  }
                  className={getButtonStyles()}
                >
                  {getButtonContent()}
                </Button>
              </motion.div>

              {shouldRenderRouterDisplay && (
                <div className="mt-4">
                  <RouterDisplay
                    selectedRouterId={selectedRouterId}
                    routeOptions={routeOptions}
                    inputUsdValue={sellAmountUsdValue}
                    outputTokenUsdPrice={receiveTokenWithLivePrice?.usdPrice}
                    outputTokenSymbol={receiveToken?.symbol}
                    availableRouterIds={availableRouterIds}
                    isQuoteSearchPending={isRouteSearchPending}
                  />
                </div>
              )}
            </>
          )}
        </motion.div>

        {/* Token Quick Access Buttons */}
        <div
          className={`mx-auto mt-4 grid w-full max-w-[440px] justify-items-center gap-3 ${receiveToken ? "grid-cols-2" : "grid-cols-1"}`}
        >
          <motion.button
            onClick={() => setSellToken(sellToken)}
            className={`flex min-w-0 w-full items-center justify-center gap-1.5 rounded-full bg-[#191A1C] border border-border px-2 py-3 text-xs hover:bg-secondary transition-colors sm:gap-2 sm:px-5 sm:text-sm ${receiveToken ? "" : "max-w-[214px]"}`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <div className="shrink-0 w-6 h-6 rounded-full bg-primary/30 flex items-center justify-center overflow-hidden">
              <Image
                src={sellToken.icon}
                alt={`${sellToken.symbol} logo`}
                width={24}
                height={24}
                className="object-contain w-full h-full"
              />
            </div>
            <span className="font-medium text-foreground whitespace-nowrap">
              {sellToken.symbol}
            </span>
            <span className="text-muted-foreground whitespace-nowrap">
              {formatTokenPillUsdPrice(sellTokenWithLivePrice.usdPrice)}
            </span>
          </motion.button>
          {receiveToken && (
            <motion.button
              onClick={() => setReceiveToken(receiveToken)}
              className="flex min-w-0 w-full items-center justify-center gap-1.5 rounded-full bg-[#191A1C] border border-border px-2 py-3 text-xs hover:bg-secondary transition-colors sm:gap-2 sm:px-5 sm:text-sm"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <div className="shrink-0 w-6 h-6 rounded-full bg-primary/30 flex items-center justify-center overflow-hidden">
                <Image
                  src={receiveToken.icon}
                  alt={`${receiveToken.symbol} logo`}
                  width={24}
                  height={24}
                  className="object-contain w-full h-full"
                />
              </div>
              <span className="font-medium text-foreground whitespace-nowrap">
                {receiveToken.symbol}
              </span>
              <span className="text-muted-foreground whitespace-nowrap">
                {formatTokenPillUsdPrice(
                  receiveTokenWithLivePrice?.usdPrice || 0,
                )}
              </span>
            </motion.button>
          )}
        </div>

        {/* Modals */}
        <TokenModal
          isOpen={isSellTokenModalOpen}
          onClose={() => setIsSellTokenModalOpen(false)}
          selected={sellTokenWithLivePrice}
          onSelect={handleSellTokenSelect}
          excludeTokenId={receiveToken?.id}
          availableTokens={availableSellTokens}
          tokenBalances={tokenBalances}
        />

        <TokenModal
          isOpen={isReceiveTokenModalOpen}
          onClose={() => setIsReceiveTokenModalOpen(false)}
          selected={
            receiveTokenWithLivePrice ||
            availableReceiveTokens[0] ||
            sellTokenWithLivePrice
          }
          onSelect={handleReceiveTokenSelect}
          excludeTokenId={sellToken.id}
          availableTokens={availableReceiveTokens}
          tokenBalances={tokenBalances}
        />
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          slippageTolerance={slippageTolerance}
          onSlippageChange={setSlippageTolerance}
        />
      </div>

      {/* Chart modal — uncomment later with the chart icon
      <AnimatePresence>
        {isChartOpen && (
          <ChartModal
            isOpen={isChartOpen}
            onClose={() => setIsChartOpen(false)}
          />
        )}
      </AnimatePresence>
      */}
    </div>
  );
};

export default SwapCard;
