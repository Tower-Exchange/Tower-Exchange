"use client";

import {
  ArrowDown,
  ChevronDown,
  ExternalLink,
  LoaderCircle,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { encodeFunctionData, formatUnits, type Address } from "viem";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import Image, { type StaticImageData } from "next/image";

import TokenModal from "@/components/TokenModal";
import { Button } from "@/components/ui/button";
import { getArcExplorerTxUrl } from "@/lib/arcNetwork";
import { ensureWalletOnArcNetwork } from "@/lib/arcWalletNetwork";
import { getBrowserWalletProvider, type BrowserWalletProvider } from "@/lib/browser-wallet";
import {
  STABLEFX_ARC_MAINNET_TOKENS,
  isStableFxCustomerVisibleCurrency,
  isStableFxPair,
  type StableFxCurrency,
} from "@/lib/stableFx";
import { ensureWalletSession } from "@/lib/walletSessionClient";
import usdcLogo from "@/public/assets/usdc.svg";
import eurcLogo from "@/public/assets/eurc.svg";
import gbpaLogo from "@/public/assets/gbpa.svg";
import mxnbLogo from "@/public/assets/mxnb.svg";
import audfLogo from "@/public/assets/audf.svg";

type StableFxQuote = {
  id: string | null;
  rate: string | number | null;
  from: { currency: StableFxCurrency; amount: string | null };
  to: { currency: StableFxCurrency; amount: string | null };
  fee: unknown;
  collateral: string | null;
  towerFee: {
    currency: StableFxCurrency;
    amount: string;
    basisPoints: number;
    tradeAmount: string;
  };
  expiresAt: string | null;
};

type StableFxOrder = {
  id: string;
  status: StableFxOrderStatus;
  fromCurrency: StableFxCurrency;
  toCurrency: StableFxCurrency;
  sourceAmount: string;
  customerAmount: string;
  towerFee: { amount: string; amountRaw: string; basisPoints: number };
  recipientAddress: string;
  deposit: { transactionHash: string | null; blockNumber: string | null };
  trade: {
    id: string | null;
    contractTradeId: string | null;
    status: string | null;
    quoteId: string | null;
    settlementTransactionHash: string | null;
  };
  payout: { transactionHash: string | null; amountRaw: string | null };
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type StableFxOrderStatus =
  | "awaiting_deposit"
  | "deposit_verified"
  | "executing"
  | "funding_submitting"
  | "funding_submitted"
  | "funding_submission_unknown"
  | "settlement_completed"
  | "payout_submitting"
  | "payout_broadcast"
  | "completed"
  | "refund_required"
  | "needs_review";

export type StableFxTransactionPhase =
  | "deposit"
  | "confirm"
  | "settlement"
  | "payout"
  | "success"
  | "failed";

export type StableFxTransactionProgress = {
  phase: StableFxTransactionPhase;
  orderId?: string | null;
  transactionHash?: string | null;
  /** The locally-recorded start time used for the instant-tenor countdown. */
  initiatedAt?: string | null;
  error?: string | null;
  /**
   * Snapshotted when the customer starts their deposit. Do not derive these
   * from the parent swap form during wallet confirmation: React state updates
   * for the reference quote may not have reached that parent yet.
   */
  details?: {
    sellAmount: string;
    sellTokenSymbol: StableFxCurrency;
    receiveAmount: string;
    receiveTokenSymbol: StableFxCurrency;
  };
};

type DepositInstruction = {
  chainId: number;
  tokenAddress: string;
  tokenDecimals: number;
  amount: string;
  amountRaw: string;
  to: string;
  functionName: "transfer";
  args: [string, string];
};

type StableFxPanelProps = {
  walletAddress: string | null;
  isWalletConnected: boolean;
  onConnectWallet: () => Promise<void>;
  registerRefreshHandler?: (handler: (() => void) | null) => void;
  /** Render only the StableFX execution portion beneath SwapCard's selectors. */
  embedded?: boolean;
  /** Keep an active order mounted for background tracking while the user uses DEX swaps. */
  isEmbeddedVisible?: boolean;
  selectedFromCurrency?: StableFxCurrency | null;
  selectedToCurrency?: StableFxCurrency | null;
  selectedAmount?: string;
  onReceiveAmountChange?: (amount: string) => void;
  onOrderActiveChange?: (active: boolean) => void;
  onReset?: () => void;
  onTransactionProgress?: (progress: StableFxTransactionProgress) => void;
};

type StableFxToken = {
  symbol: StableFxCurrency;
  name: string;
  icon: StaticImageData;
};

const ALL_STABLEFX_TOKENS: readonly StableFxToken[] = [
  { symbol: "USDC", name: "USD Coin", icon: usdcLogo },
  { symbol: "EURC", name: "Euro Coin", icon: eurcLogo },
  { symbol: "GBPA", name: "Agant British Pound", icon: gbpaLogo },
  { symbol: "MXNB", name: "Mexican Peso", icon: mxnbLogo },
  { symbol: "AUDF", name: "Australian Dollar", icon: audfLogo },
];

const STABLEFX_TOKENS = ALL_STABLEFX_TOKENS.filter((token) =>
  isStableFxCustomerVisibleCurrency(token.symbol),
);

const TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const PENDING_ORDER_STATUSES = new Set<StableFxOrderStatus>([
  "deposit_verified",
  "executing",
  "funding_submitting",
  "funding_submitted",
  "funding_submission_unknown",
  "settlement_completed",
  "payout_submitting",
  "payout_broadcast",
]);

const STATUS_LABELS: Record<StableFxOrderStatus, string> = {
  awaiting_deposit: "Awaiting your Arc deposit",
  deposit_verified: "Deposit verified",
  executing: "Creating your Circle trade",
  funding_submitting: "Funding your Circle trade",
  funding_submitted: "Waiting for Circle settlement",
  funding_submission_unknown: "Checking Circle funding status",
  settlement_completed: "Settlement verified — sending payout",
  payout_submitting: "Sending payout",
  payout_broadcast: "Payout sent — awaiting Arc confirmation",
  completed: "Completed",
  refund_required: "Trade could not be completed",
  needs_review: "Trade could not be completed",
};

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

const isValidTransactionHash = (value: unknown): value is string =>
  typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);

const isActiveOrder = (order: StableFxOrder | null) =>
  Boolean(order && PENDING_ORDER_STATUSES.has(order.status));

const isTerminalOrder = (order: StableFxOrder | null) =>
  Boolean(
    order &&
      (order.status === "completed" ||
        order.status === "refund_required" ||
        order.status === "needs_review"),
  );

const isReviewOrder = (order: StableFxOrder | null) =>
  Boolean(
    order &&
      (order.status === "refund_required" || order.status === "needs_review"),
  );

function getOrderTransactionProgress(
  order: StableFxOrder,
): StableFxTransactionProgress {
  const base = {
    orderId: order.id,
    transactionHash: order.payout.transactionHash ?? order.deposit.transactionHash,
    initiatedAt: order.createdAt,
  };

  if (order.status === "completed") {
    return { ...base, phase: "success" };
  }

  if (order.status === "refund_required" || order.status === "needs_review") {
    return {
      ...base,
      phase: "failed",
      error: order.failureReason ?? STATUS_LABELS[order.status],
    };
  }

  if (
    order.status === "settlement_completed" ||
    order.status === "payout_submitting" ||
    order.status === "payout_broadcast"
  ) {
    return { ...base, phase: "payout" };
  }

  if (order.status === "awaiting_deposit") {
    return {
      ...base,
      phase: order.deposit.transactionHash ? "confirm" : "deposit",
    };
  }

  return { ...base, phase: "settlement" };
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return fallback;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, "Stable FX request failed."));
  }
  return payload as T;
}

async function readStableFxWalletBalance(
  walletAddress: string,
  currency: StableFxCurrency,
) {
  const token = STABLEFX_ARC_MAINNET_TOKENS[currency];
  const data = encodeFunctionData({
    abi: BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [walletAddress as Address],
  });
  const response = await fetch("/api/rpc/5042", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "stablefx-wallet-balance",
      method: "eth_call",
      params: [{ to: token.address, data }, "latest"],
    }),
  });
  const payload = (await response.json().catch(() => null)) as {
    result?: unknown;
    error?: { message?: unknown };
  } | null;
  if (!response.ok || typeof payload?.result !== "string") {
    throw new Error(
      typeof payload?.error?.message === "string"
        ? payload.error.message
        : "Unable to retrieve the Arc wallet balance.",
    );
  }
  return formatUnits(BigInt(payload.result), token.decimals);
}

function formatStableFxBalance(balance: string) {
  const value = Number(balance);
  if (!Number.isFinite(value)) return "0.00";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

function getStableFxAmountFromBalance(
  balance: string,
  percentage: 50 | 100,
) {
  const [whole = "", fractional = ""] = balance.split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fractional)) return "";

  const scale = 1_000_000n;
  const balanceInSmallestUnits =
    BigInt(whole) * scale +
    BigInt(`${fractional.slice(0, 6).padEnd(6, "0")}`);
  const selectedAmount =
    percentage === 50 ? balanceInSmallestUnits / 2n : balanceInSmallestUnits;

  if (selectedAmount <= 0n) return "";

  const amountWhole = selectedAmount / scale;
  const amountFraction = String(selectedAmount % scale)
    .padStart(6, "0")
    .replace(/0+$/, "");

  return amountFraction
    ? `${amountWhole.toString()}.${amountFraction}`
    : amountWhole.toString();
}

async function waitForArcConfirmation(
  provider: BrowserWalletProvider,
  transactionHash: string,
) {
  const attempts = 40;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const receipt = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [transactionHash],
    });
    if (receipt && typeof receipt === "object") {
      const status = (receipt as { status?: unknown }).status;
      if (status === "0x1") return;
      if (status === "0x0") {
        throw new Error("The Arc deposit transaction reverted in your wallet.");
      }
    }
    await sleep(3_000);
  }
  throw new Error(
    "The deposit is still pending on Arc. Keep this page open and try again once it confirms.",
  );
}

function formatFee(fee: unknown) {
  if (fee === null || fee === undefined) return "Included in quote";
  if (typeof fee === "string" || typeof fee === "number") return String(fee);
  if (typeof fee === "object") {
    const value = fee as { amount?: unknown; currency?: unknown };
    if (typeof value.amount === "string" || typeof value.amount === "number") {
      return `${value.amount}${typeof value.currency === "string" ? ` ${value.currency}` : ""}`;
    }
  }
  return "Included in quote";
}

function formatTowerFee(quote: StableFxQuote) {
  const { amount, currency, basisPoints } = quote.towerFee;
  const percent = (basisPoints / 100).toLocaleString("en-US", {
    minimumFractionDigits: basisPoints % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${amount} ${currency} (${percent}%)`;
}

function formatQuoteConversion(quote: StableFxQuote) {
  const fromAmount = Number.parseFloat(quote.from.amount ?? "");
  const toAmount = Number.parseFloat(quote.to.amount ?? "");
  const rate = toAmount / fromAmount;

  if (Number.isFinite(rate) && rate > 0) {
    const formattedRate = new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 6,
    }).format(rate);
    return `1 ${quote.from.currency} → ${formattedRate} ${quote.to.currency}`;
  }

  if (quote.rate !== null && quote.rate !== undefined) {
    return `1 ${quote.from.currency} → ${quote.rate} ${quote.to.currency}`;
  }

  return `1 ${quote.from.currency} → — ${quote.to.currency}`;
}

function getExpiryLabel(expiresAt: string | null) {
  if (!expiresAt) return "Reference quote";
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return "Reference quote";
  return `Expires ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function OrderTransactionLink({
  label,
  transactionHash,
}: {
  label: string;
  transactionHash: string | null;
}) {
  if (!transactionHash) return null;
  return (
    <a
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      href={getArcExplorerTxUrl(transactionHash, "mainnet")}
      target="_blank"
      rel="noreferrer"
    >
      {label}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function StableFxTokenSelector({
  selected,
  onOpenModal,
  disabled = false,
}: {
  selected: StableFxToken | null;
  onOpenModal: () => void;
  disabled?: boolean;
}) {
  if (!selected) {
    return (
      <motion.button
        type="button"
        onClick={onOpenModal}
        disabled={disabled}
        className="flex shrink-0 items-center gap-2 rounded-lg bg-secondary px-3 py-2 transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-70"
        whileHover={disabled ? undefined : { scale: 1.02 }}
        whileTap={disabled ? undefined : { scale: 0.98 }}
      >
        <span className="font-medium text-muted-foreground">Select Token</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </motion.button>
    );
  }

  return (
    <motion.button
      type="button"
      onClick={onOpenModal}
      disabled={disabled}
      className="flex shrink-0 items-center gap-2 rounded-lg bg-secondary px-3 py-2 transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-70"
      whileHover={disabled ? undefined : { scale: 1.02 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
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
}

export default function StableFxPanel({
  walletAddress,
  isWalletConnected,
  onConnectWallet,
  registerRefreshHandler,
  embedded = false,
  isEmbeddedVisible = true,
  selectedFromCurrency,
  selectedToCurrency,
  selectedAmount,
  onReceiveAmountChange,
  onOrderActiveChange,
  onReset,
  onTransactionProgress,
}: StableFxPanelProps) {
  const [fromCurrency, setFromCurrency] = useState<StableFxCurrency>("USDC");
  const [toCurrency, setToCurrency] = useState<StableFxCurrency | null>(null);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<StableFxQuote | null>(null);
  const [order, setOrder] = useState<StableFxOrder | null>(null);
  const [depositInstruction, setDepositInstruction] =
    useState<DepositInstruction | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFromTokenModalOpen, setIsFromTokenModalOpen] = useState(false);
  const [isToTokenModalOpen, setIsToTokenModalOpen] = useState(false);
  const [sourceBalance, setSourceBalance] = useState("0.00");
  const [isLoadingSourceBalance, setIsLoadingSourceBalance] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const balanceRequestIdRef = useRef(0);
  const quoteRequestIdRef = useRef(0);
  const autoQuoteKeyRef = useRef<string | null>(null);
  const activeOrderLookupWalletRef = useRef<string | null>(null);
  const initialReconciledOrderIdRef = useRef<string | null>(null);

  const resolvedFromCurrency =
    embedded && selectedFromCurrency ? selectedFromCurrency : fromCurrency;
  const resolvedToCurrency =
    embedded ? (selectedToCurrency ?? null) : toCurrency;
  const resolvedAmount = embedded ? (selectedAmount ?? "") : amount;

  const hasValidAmount = /^\d+(?:\.\d{1,6})?$/.test(resolvedAmount) && Number(resolvedAmount) > 0;
  const orderIsActive = isActiveOrder(order);
  const sourceBalanceAvailable =
    getStableFxAmountFromBalance(sourceBalance, 100) !== "";
  const sourceAmountShortcutDisabled =
    orderIsActive || isLoadingSourceBalance || !sourceBalanceAvailable;
  const canRequestQuote =
    isEmbeddedVisible &&
    isWalletConnected &&
    Boolean(walletAddress) &&
    Boolean(resolvedToCurrency) &&
    hasValidAmount &&
    !orderIsActive;

  const destinationTokens = useMemo(
    () =>
      STABLEFX_TOKENS.filter((token) =>
        isStableFxPair(resolvedFromCurrency, token.symbol),
      ),
    [resolvedFromCurrency],
  );
  const fromToken =
    STABLEFX_TOKENS.find((token) => token.symbol === resolvedFromCurrency) ??
    STABLEFX_TOKENS[0];
  const toToken =
    STABLEFX_TOKENS.find((token) => token.symbol === resolvedToCurrency) ?? null;

  const updatePair = (
    nextFrom: StableFxCurrency,
    nextTo: StableFxCurrency | null,
  ) => {
    quoteRequestIdRef.current += 1;
    if (nextFrom !== fromCurrency) {
      // Do not let a shortcut use the prior currency's balance while the new
      // token balance is loading.
      setSourceBalance("0");
      setIsLoadingSourceBalance(true);
    }
    setFromCurrency(nextFrom);
    setToCurrency(nextTo);
    setQuote(null);
    setError(null);
    setMessage(null);
  };

  const handleAmountChange = (value: string) => {
    if (value === "" || /^\d*(?:\.\d{0,6})?$/.test(value)) {
      quoteRequestIdRef.current += 1;
      if (isReviewOrder(order)) {
        setOrder(null);
        setDepositInstruction(null);
      }
      setAmount(value);
      setQuote(null);
      setError(null);
      setMessage(null);
    }
  };

  const handleBalanceShortcut = (percentage: 50 | 100) => {
    if (sourceAmountShortcutDisabled) return;

    const nextAmount = getStableFxAmountFromBalance(sourceBalance, percentage);
    if (nextAmount) {
      handleAmountChange(nextAmount);
    }
  };

  const handleFromTokenSelect = (token: StableFxToken) => {
    const nextFrom = token.symbol;
    const nextTo =
      resolvedToCurrency && isStableFxPair(nextFrom, resolvedToCurrency)
        ? resolvedToCurrency
        : null;
    updatePair(nextFrom, nextTo);
  };

  const handleSwapCurrencies = () => {
    if (!orderIsActive && resolvedToCurrency) {
      updatePair(resolvedToCurrency, resolvedFromCurrency);
    }
  };

  const refreshSourceBalance = useCallback(async () => {
    const requestId = ++balanceRequestIdRef.current;
    if (!isWalletConnected || !walletAddress) {
      setSourceBalance("0.00");
      setIsLoadingSourceBalance(false);
      return;
    }

    setIsLoadingSourceBalance(true);
    try {
      const balance = await readStableFxWalletBalance(walletAddress, resolvedFromCurrency);
      if (requestId === balanceRequestIdRef.current) {
        setSourceBalance(balance);
      }
    } catch {
      if (requestId === balanceRequestIdRef.current) {
        setSourceBalance("0.00");
      }
    } finally {
      if (requestId === balanceRequestIdRef.current) {
        setIsLoadingSourceBalance(false);
      }
    }
  }, [isWalletConnected, resolvedFromCurrency, walletAddress]);

  useEffect(() => {
    if (embedded) {
      setSourceBalance("0.00");
      setIsLoadingSourceBalance(false);
      return;
    }
    void refreshSourceBalance();
  }, [embedded, refreshSourceBalance]);

  const fetchOrder = useCallback(async (orderId: string) => {
    const result = await requestJson<{ success: true; order: StableFxOrder }>(
      `/api/stablefx/orders/${encodeURIComponent(orderId)}`,
    );
    setOrder(result.order);
    return result.order;
  }, []);

  useEffect(() => {
    if (!embedded || !isWalletConnected || !walletAddress) {
      activeOrderLookupWalletRef.current = null;
      return;
    }

    const normalizedWallet = walletAddress.toLowerCase();
    if (activeOrderLookupWalletRef.current === normalizedWallet) return;
    activeOrderLookupWalletRef.current = normalizedWallet;

    let isMounted = true;
    void requestJson<{ success: true; order: StableFxOrder | null }>(
      "/api/stablefx/orders",
    )
      .then((result) => {
        if (!isMounted || !result.order) return;
        // Do not overwrite an order that was created in this browser session.
        setOrder((current) => {
          if (current) return current;
          return result.order;
        });
      })
      .catch(() => {
        // A missing session or transient request issue should not block the
        // swap card or surface a background lookup error to the customer.
      });

    return () => {
      isMounted = false;
    };
  }, [embedded, isWalletConnected, walletAddress]);

  const handleRefresh = useCallback(() => {
    // The card refresh is a form reset, not a balance refresh. Never discard an
    // in-progress order, because its exact deposit and settlement must remain
    // visible until it is completed or reviewed.
    if (orderIsActive) return;

    quoteRequestIdRef.current += 1;
    autoQuoteKeyRef.current = null;
    if (isTerminalOrder(order)) {
      setOrder(null);
      setDepositInstruction(null);
    }
    setAmount("");
    setQuote(null);
    setMessage(null);
    setError(null);
    if (embedded) {
      onReceiveAmountChange?.("0.00");
      onReset?.();
    }
  }, [embedded, onReceiveAmountChange, onReset, order, orderIsActive]);

  useEffect(() => {
    registerRefreshHandler?.(handleRefresh);
    return () => registerRefreshHandler?.(null);
  }, [handleRefresh, registerRefreshHandler]);

  useEffect(() => {
    if (!order || !PENDING_ORDER_STATUSES.has(order.status)) return;

    // Reconcile once immediately when a persisted order is restored, then keep
    // it fresh while the card remains open. The server validates any already
    // broadcast payout before it could ever submit another one.
    if (initialReconciledOrderIdRef.current !== order.id) {
      initialReconciledOrderIdRef.current = order.id;
      void fetchOrder(order.id).catch(() => {
        // A transient network failure should not erase the order or stop polling.
      });
    }

    const interval = window.setInterval(() => {
      void fetchOrder(order.id).catch(() => {
        // A transient network failure should not erase the order or stop polling.
      });
    }, 10_000);

    return () => window.clearInterval(interval);
  }, [fetchOrder, order]);

  useEffect(() => {
    onOrderActiveChange?.(orderIsActive);
    return () => onOrderActiveChange?.(false);
  }, [onOrderActiveChange, orderIsActive]);

  useEffect(() => {
    if (!order) return;
    onTransactionProgress?.(getOrderTransactionProgress(order));
  }, [onTransactionProgress, order]);

  useEffect(() => {
    if (!embedded || !isEmbeddedVisible || orderIsActive) return;

    quoteRequestIdRef.current += 1;
    if (isReviewOrder(order)) {
      setOrder(null);
      setDepositInstruction(null);
    }
    setQuote(null);
    setMessage(null);
    setError(null);
    onReceiveAmountChange?.("0.00");
  }, [
    embedded,
    isEmbeddedVisible,
    onReceiveAmountChange,
    order,
    orderIsActive,
    resolvedAmount,
    resolvedFromCurrency,
    resolvedToCurrency,
  ]);

  const handleGetQuote = useCallback(async () => {
    if (!isWalletConnected || !walletAddress) {
      await onConnectWallet();
      return;
    }
    if (!hasValidAmount) {
      setError("Enter a positive amount with up to six decimal places.");
      return;
    }
    if (!resolvedToCurrency) {
      setError("Select the currency you want to receive.");
      return;
    }

    setIsQuoting(true);
    setError(null);
    setMessage(null);
    const requestId = ++quoteRequestIdRef.current;
    try {
      await ensureWalletSession(walletAddress);
      const result = await requestJson<{ success: true; quote: StableFxQuote }>(
        "/api/stablefx/quote",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromCurrency: resolvedFromCurrency,
            toCurrency: resolvedToCurrency,
            amount: resolvedAmount,
            amountSide: "from",
          }),
        },
      );
      if (requestId !== quoteRequestIdRef.current) {
        return;
      }
      setQuote(result.quote);
      onReceiveAmountChange?.(result.quote.to.amount ?? "0.00");
      setMessage("Reference quote ready. The executable Circle quote is created after your exact deposit confirms.");
    } catch (requestError) {
      if (requestId !== quoteRequestIdRef.current) {
        return;
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to obtain a Stable FX quote.",
      );
    } finally {
      if (requestId === quoteRequestIdRef.current) {
        setIsQuoting(false);
      }
    }
  }, [
    hasValidAmount,
    isWalletConnected,
    onConnectWallet,
    onReceiveAmountChange,
    resolvedAmount,
    resolvedFromCurrency,
    resolvedToCurrency,
    walletAddress,
  ]);

  useEffect(() => {
    if (!canRequestQuote || orderIsActive) {
      autoQuoteKeyRef.current = null;
      return;
    }

    const quoteKey = [
      walletAddress?.toLowerCase(),
      resolvedFromCurrency,
      resolvedToCurrency,
      resolvedAmount,
    ].join(":");

    if (autoQuoteKeyRef.current === quoteKey) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (autoQuoteKeyRef.current === quoteKey) {
        return;
      }

      autoQuoteKeyRef.current = quoteKey;
      void handleGetQuote();
    }, 500);

    return () => window.clearTimeout(timer);
  }, [
    canRequestQuote,
    handleGetQuote,
    orderIsActive,
    resolvedAmount,
    resolvedFromCurrency,
    resolvedToCurrency,
    walletAddress,
  ]);

  const handleDepositAndExchange = async () => {
    if (!isWalletConnected || !walletAddress) {
      await onConnectWallet();
      return;
    }
    if (!quote || !hasValidAmount || !resolvedToCurrency) {
      setError("Get a reference quote before creating a Stable FX order.");
      return;
    }

    let progressPhase: Exclude<StableFxTransactionPhase, "success" | "failed"> =
      "deposit";
    let depositTransactionHash: string | null = null;
    const transactionDetails = {
      sellAmount: resolvedAmount,
      sellTokenSymbol: resolvedFromCurrency,
      receiveAmount: quote.to.amount ?? "0.00",
      receiveTokenSymbol: resolvedToCurrency,
    };
    const reportProgress = (progress: StableFxTransactionProgress) => {
      onTransactionProgress?.({ ...progress, details: transactionDetails });
    };
    setIsSubmitting(true);
    setError(null);
    reportProgress({ phase: progressPhase });
    try {
      await ensureWalletSession(walletAddress);
      await ensureWalletOnArcNetwork("mainnet");

      // Reviewed orders are not resumable from the customer card. A later
      // customer attempt creates a separate exact-deposit order.
      let activeOrder =
        order?.status === "awaiting_deposit" ? order : null;
      let instruction = activeOrder ? depositInstruction : null;
      if (!activeOrder) {
        setOrder(null);
        setDepositInstruction(null);
        setMessage("Creating your exact-deposit order…");
        const created = await requestJson<{
          success: true;
          order: StableFxOrder;
          depositInstruction: DepositInstruction;
        }>("/api/stablefx/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromCurrency: resolvedFromCurrency,
            toCurrency: resolvedToCurrency,
            amount: resolvedAmount,
            amountSide: "from",
            expectedTowerFeeBps: quote.towerFee.basisPoints,
          }),
        });
        activeOrder = created.order;
        instruction = created.depositInstruction;
        setOrder(activeOrder);
        setDepositInstruction(instruction);
      }

      if (!instruction || activeOrder.status !== "awaiting_deposit") {
        setMessage(STATUS_LABELS[activeOrder.status]);
        return;
      }

      const provider = getBrowserWalletProvider();
      const accounts = await provider.request({ method: "eth_accounts" });
      if (
        !Array.isArray(accounts) ||
        typeof accounts[0] !== "string" ||
        accounts[0].toLowerCase() !== walletAddress.toLowerCase()
      ) {
        throw new Error("Switch your wallet to the signed-in Tower address before depositing.");
      }

      setMessage(`Approve the exact ${instruction.amount} ${activeOrder.fromCurrency} transfer in your wallet…`);
      const data = encodeFunctionData({
        abi: TRANSFER_ABI,
        functionName: "transfer",
        args: [instruction.to as Address, BigInt(instruction.amountRaw)],
      });
      const transactionHash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: walletAddress,
            to: instruction.tokenAddress,
            data,
            value: "0x0",
          },
        ],
      });
      if (!isValidTransactionHash(transactionHash)) {
        throw new Error("Your wallet did not return a valid Arc deposit transaction hash.");
      }
      depositTransactionHash = transactionHash;
      progressPhase = "confirm";
      reportProgress({
        phase: progressPhase,
        orderId: activeOrder.id,
        transactionHash,
      });

      setOrder((current) =>
        current
          ? {
              ...current,
              deposit: { ...current.deposit, transactionHash },
            }
          : current,
      );
      setMessage("Waiting for the Arc deposit confirmation…");
      await waitForArcConfirmation(provider, transactionHash);

      progressPhase = "settlement";
      reportProgress({
        phase: progressPhase,
        orderId: activeOrder.id,
        transactionHash,
      });
      setMessage("Deposit confirmed. Creating and funding your Circle trade…");
      const submitted = await requestJson<{ success: true; order: StableFxOrder }>(
        `/api/stablefx/orders/${encodeURIComponent(activeOrder.id)}/deposit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactionHash }),
        },
      );
      setOrder(submitted.order);
      setMessage(
        isReviewOrder(submitted.order)
          ? null
          : STATUS_LABELS[submitted.order.status],
      );
      void refreshSourceBalance();
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Unable to submit the Stable FX deposit.";
      if (/Tower StableFX fee changed/i.test(message)) {
        // Fee configuration is intentionally server-controlled. Discard the
        // stale reference quote so the primary action obtains one reflecting
        // the current Railway value before a customer can deposit.
        setQuote(null);
      }
      setError(message);
      reportProgress({
        phase: "failed",
        transactionHash: depositTransactionHash,
        error: message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const startAnotherTrade = () => {
    setOrder(null);
    setDepositInstruction(null);
    setQuote(null);
    setAmount("");
    setMessage(null);
    setError(null);
    onReceiveAmountChange?.("0.00");
  };

  const actionLabel = !isWalletConnected
    ? "Connect wallet"
    : !resolvedToCurrency
      ? "Select a receive token"
      : !hasValidAmount
        ? "Enter an amount"
    : !quote
        ? error
          ? "Retry Stable FX quote"
          : "Fetching Stable FX quote..."
      : order?.status === "awaiting_deposit"
        ? "Deposit and exchange"
        : orderIsActive && order
          ? STATUS_LABELS[order.status]
          : "Deposit and exchange";

  const actionDisabled =
    isQuoting ||
    isSubmitting ||
    (isWalletConnected &&
      (!resolvedToCurrency ||
        !hasValidAmount ||
        (!quote
          ? error
            ? !canRequestQuote
            : true
          : orderIsActive)));

  const handlePrimaryAction = quote
    ? handleDepositAndExchange
    : !isWalletConnected || Boolean(error)
      ? handleGetQuote
      : undefined;

  if (embedded) {
    return (
      <div
        className={isEmbeddedVisible ? "mt-4 space-y-3" : "hidden"}
        aria-hidden={!isEmbeddedVisible}
      >
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
          <div className="flex items-center gap-2 text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span className="font-medium">Circle StableFX · instant settlement (~30 min) on Arc</span>
          </div>
          <p className="mt-1">
            This pair settles through Circle StableFX. Tower receives your exact deposit,
            completes the trade, then pays the purchased currency back to this wallet.
          </p>
        </div>

        {quote && !order && (
          <div className="rounded-xl border border-border bg-[#121211] px-3 py-2.5 text-xs text-muted-foreground">
            <div className="flex justify-between gap-4">
              <span>Exchange rate</span>
              <span className="text-right text-foreground">{formatQuoteConversion(quote)}</span>
            </div>
            <div className="mt-1 flex justify-between gap-4">
              <span>Tower fee</span>
              <span className="text-foreground">{formatTowerFee(quote)}</span>
            </div>
            <div className="mt-1 flex justify-between gap-4">
              <span>Circle fee</span>
              <span className="text-foreground">{formatFee(quote.fee)}</span>
            </div>
            <div className="mt-1 flex justify-between gap-4">
              <span>Amount exchanged</span>
              <span className="text-foreground">
                {quote.from.amount ?? "—"} {quote.from.currency}
              </span>
            </div>
            <div className="mt-1 flex justify-between gap-4">
              <span>Quote status</span>
              <span className="text-foreground">{getExpiryLabel(quote.expiresAt)}</span>
            </div>
          </div>
        )}

        {order && !isReviewOrder(order) && (
          <div
            className={`rounded-xl border px-3 py-3 text-xs ${
              order.status === "completed"
                ? "border-primary/30 bg-primary/10"
                : order.status === "needs_review" || order.status === "refund_required"
                  ? "border-destructive/40 bg-destructive/10"
                  : "border-border bg-[#121211]"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-foreground">{STATUS_LABELS[order.status]}</span>
              {PENDING_ORDER_STATUSES.has(order.status) && (
                <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
              )}
            </div>
            <p className="mt-1.5 text-muted-foreground">
              {order.status === "completed"
                ? `${order.sourceAmount} ${order.fromCurrency} exchanged for ${order.toCurrency} and paid to your wallet.`
                : order.failureReason ||
                  `Order ${order.id.slice(0, 8)} is being tracked until settlement and payout are confirmed.`}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
              <OrderTransactionLink label="View deposit" transactionHash={order.deposit.transactionHash} />
              <OrderTransactionLink
                label="View Circle settlement"
                transactionHash={order.trade.settlementTransactionHash}
              />
              <OrderTransactionLink label="View payout" transactionHash={order.payout.transactionHash} />
            </div>
            {order.status === "completed" && (
              <button
                type="button"
                onClick={startAnotherTrade}
                className="mt-3 text-xs font-medium text-primary hover:underline"
              >
                Start another StableFX trade
              </button>
            )}
          </div>
        )}

        {(message || error) && (
          <p className={`px-1 text-xs leading-5 ${error ? "text-destructive" : "text-muted-foreground"}`}>
            {error ?? message}
          </p>
        )}

        <Button
          onClick={handlePrimaryAction}
          disabled={actionDisabled}
          className="h-12 w-full rounded-xl bg-primary text-sm font-medium text-black hover:bg-primary/90"
        >
          {isQuoting || isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
          {actionLabel}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
        <div className="flex items-center gap-2 text-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="font-medium">Circle Stable FX · instant settlement (~30 min) on Arc</span>
        </div>
        <p className="mt-1">
          This is a managed FX settlement. Tower receives your exact deposit,
          completes the Circle trade, then sends the purchased currency to this connected wallet.
        </p>
      </div>

      <div className="rounded-xl bg-[#151617] p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">You deposit</span>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Wallet className="h-3.5 w-3.5" />
              {isLoadingSourceBalance
                ? "Loading..."
                : `${formatStableFxBalance(sourceBalance)} ${fromCurrency}`}
            </span>
            <button
              type="button"
              onClick={() => handleBalanceShortcut(50)}
              disabled={sourceAmountShortcutDisabled}
              className="text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              50%
            </button>
            <button
              type="button"
              onClick={() => handleBalanceShortcut(100)}
              disabled={sourceAmountShortcutDisabled}
              className="text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              Max
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <StableFxTokenSelector
            selected={fromToken}
            onOpenModal={() => setIsFromTokenModalOpen(true)}
            disabled={orderIsActive}
          />
          <input
            aria-label="Stable FX source amount"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(event) => handleAmountChange(event.target.value)}
            disabled={orderIsActive}
            className="min-w-0 flex-1 bg-transparent text-right text-2xl font-medium text-white outline-none placeholder:text-white disabled:cursor-not-allowed disabled:opacity-70"
          />
        </div>
      </div>

      <div className="relative z-10 -my-6 flex justify-center">
        <motion.button
          type="button"
          onClick={handleSwapCurrencies}
          disabled={orderIsActive}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-secondary transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-70"
          whileHover={orderIsActive ? undefined : { scale: 1.1, rotate: 180 }}
          whileTap={orderIsActive ? undefined : { scale: 0.9 }}
          transition={{ duration: 0.2 }}
        >
          <ArrowDown className="h-5 w-5 text-muted-foreground" />
        </motion.button>
      </div>

      <div className="rounded-xl bg-[#151617] p-4">
        <div className="mb-2 text-sm text-muted-foreground">You receive</div>
        <div className="flex items-center justify-between gap-2">
          <StableFxTokenSelector
            selected={toToken}
            onOpenModal={() => setIsToTokenModalOpen(true)}
            disabled={orderIsActive}
          />
          <div className="min-w-0 flex-1 text-right text-2xl font-medium text-white">
            {quote?.to.amount ? quote.to.amount : "0.00"}
          </div>
        </div>
      </div>

      {quote && !order && (
        <div className="rounded-xl border border-border bg-[#121211] px-3 py-2.5 text-xs text-muted-foreground">
          <div className="flex justify-between gap-4">
            <span>Exchange rate</span>
            <span className="text-right text-foreground">{formatQuoteConversion(quote)}</span>
          </div>
          <div className="mt-1 flex justify-between gap-4">
            <span>Tower fee</span>
            <span className="text-foreground">{formatTowerFee(quote)}</span>
          </div>
          <div className="mt-1 flex justify-between gap-4">
            <span>Circle fee</span>
            <span className="text-foreground">{formatFee(quote.fee)}</span>
          </div>
          <div className="mt-1 flex justify-between gap-4">
            <span>Amount exchanged</span>
            <span className="text-foreground">
              {quote.from.amount ?? "—"} {quote.from.currency}
            </span>
          </div>
          <div className="mt-1 flex justify-between gap-4">
            <span>Quote status</span>
            <span className="text-foreground">{getExpiryLabel(quote.expiresAt)}</span>
          </div>
        </div>
      )}

      {order && !isReviewOrder(order) && (
        <div
          className={`rounded-xl border px-3 py-3 text-xs ${
            order.status === "completed"
              ? "border-primary/30 bg-primary/10"
              : order.status === "needs_review" || order.status === "refund_required"
                ? "border-destructive/40 bg-destructive/10"
                : "border-border bg-[#121211]"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-foreground">{STATUS_LABELS[order.status]}</span>
            {PENDING_ORDER_STATUSES.has(order.status) && (
              <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
            )}
          </div>
          <p className="mt-1.5 text-muted-foreground">
            {order.status === "completed"
              ? `${order.sourceAmount} ${order.fromCurrency} exchanged for ${order.toCurrency} and paid to your wallet.`
              : order.failureReason ||
                `Order ${order.id.slice(0, 8)} is being tracked until settlement and payout are confirmed.`}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
            <OrderTransactionLink label="View deposit" transactionHash={order.deposit.transactionHash} />
            <OrderTransactionLink
              label="View Circle settlement"
              transactionHash={order.trade.settlementTransactionHash}
            />
            <OrderTransactionLink label="View payout" transactionHash={order.payout.transactionHash} />
          </div>
          {order.status === "completed" && (
            <button
              type="button"
              onClick={startAnotherTrade}
              className="mt-3 text-xs font-medium text-primary hover:underline"
            >
              Start another Stable FX trade
            </button>
          )}
        </div>
      )}

      {(message || error) && (
        <p className={`px-1 text-xs leading-5 ${error ? "text-destructive" : "text-muted-foreground"}`}>
          {error ?? message}
        </p>
      )}

      <Button
        onClick={handlePrimaryAction}
        disabled={actionDisabled}
        className="h-12 w-full rounded-xl bg-primary text-sm font-medium text-black hover:bg-primary/90"
      >
        {isQuoting || isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
        {actionLabel}
      </Button>

      <TokenModal
        isOpen={isFromTokenModalOpen}
        onClose={() => setIsFromTokenModalOpen(false)}
        selected={fromToken}
        onSelect={handleFromTokenSelect}
        excludeSymbol={toCurrency ?? undefined}
        availableTokens={STABLEFX_TOKENS}
      />
      <TokenModal
        isOpen={isToTokenModalOpen}
        onClose={() => setIsToTokenModalOpen(false)}
        selected={toToken ?? destinationTokens[0] ?? fromToken}
        onSelect={(token) => updatePair(fromCurrency, token.symbol)}
        excludeSymbol={fromCurrency}
        availableTokens={destinationTokens}
      />
    </div>
  );
}
