"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useRainbowKitAuth } from "@/lib/use-rainbowkit-auth";
import { isUnifiedDepositEnabled } from "@/lib/bridgeEnabled";
import { isPositiveDecimalAmount } from "@/lib/positiveAmount";
import { registerBridgeActivity, registerBridgeFee } from "@/lib/supabase";
import {
  UNIFIED_DESTINATION,
  estimateFastDeposit,
  estimateSpendToArc,
  fastDeposit,
  getFastDepositSources,
  getSpendFee,
  getUnifiedBalances,
  getUnifiedErrorMessage,
  spendToArc,
  sumUsdcFees,
  type DepositEstimate,
  type FastDepositSourceKey,
  type SpendEstimate,
  type UnifiedBalances,
} from "@/lib/unifiedDeposit";

const BALANCE_REFRESH_MS = 15000;
const AMOUNT_PATTERN = /^\d*\.?\d{0,6}$/;
const SOURCES = getFastDepositSources();

type Notice = { tone: "info" | "error" | "success"; text: string; url?: string };

const noticeStyle: Record<Notice["tone"], string> = {
  info: "border-border/70 text-muted-foreground",
  error: "border-red-500/40 text-red-400",
  success: "border-emerald-500/40 text-emerald-400",
};

const formatUsdc = (value: number | string | undefined) =>
  (Number(value) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });

function NoticeBox({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <div
      className={`mt-3 rounded-xl border px-3 py-2 text-xs break-words ${noticeStyle[notice.tone]}`}
    >
      {notice.text}
      {notice.url && (
        <a
          href={notice.url}
          target="_blank"
          rel="noreferrer"
          className="ml-2 inline-flex items-center gap-1 underline"
        >
          View <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

export default function UnifiedDeposit() {
  const { user, authenticated, login } = useRainbowKitAuth();
  const address = user?.wallet?.address;
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const ctx = useMemo(
    () => ({ publicClient: publicClient as never, walletClient }),
    [publicClient, walletClient],
  );

  const [balances, setBalances] = useState<UnifiedBalances | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [sourceKey, setSourceKey] = useState<FastDepositSourceKey>(
    SOURCES[0].key,
  );
  const [depositAmount, setDepositAmount] = useState("");
  const [depositEstimate, setDepositEstimate] = useState<DepositEstimate | null>(
    null,
  );
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositNotice, setDepositNotice] = useState<Notice | null>(null);

  const [spendAmount, setSpendAmount] = useState("");
  const [spendEstimate, setSpendEstimate] = useState<SpendEstimate | null>(null);
  const [spendBusy, setSpendBusy] = useState(false);
  const [spendNotice, setSpendNotice] = useState<Notice | null>(null);

  const confirmed = Number(balances?.totalConfirmedBalance) || 0;
  const pending = Number(balances?.totalPendingBalance) || 0;
  const spendFee = getSpendFee();

  const refreshBalances = useCallback(async () => {
    if (!address) return;
    try {
      setBalances(await getUnifiedBalances(address));
      setBalanceError(null);
    } catch (error) {
      setBalanceError(getUnifiedErrorMessage(error));
    }
  }, [address]);

  useEffect(() => {
    if (!address) {
      setBalances(null);
      return;
    }
    void refreshBalances();
    const timer = window.setInterval(refreshBalances, BALANCE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [address, refreshBalances]);

  // Fee preview for the deposit.
  useEffect(() => {
    setDepositEstimate(null);
    if (!walletClient || !isPositiveDecimalAmount(depositAmount)) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const { estimate } = await estimateFastDeposit(
          ctx,
          sourceKey,
          depositAmount,
        );
        if (!cancelled) setDepositEstimate(estimate);
      } catch {
        if (!cancelled) setDepositEstimate(null);
      }
    }, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ctx, walletClient, sourceKey, depositAmount]);

  // Fee preview for the spend.
  useEffect(() => {
    setSpendEstimate(null);
    if (
      !walletClient ||
      !address ||
      !isPositiveDecimalAmount(spendAmount) ||
      Number(spendAmount) > confirmed
    ) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const estimate = await estimateSpendToArc(ctx, address, spendAmount);
        if (!cancelled) setSpendEstimate(estimate);
      } catch {
        if (!cancelled) setSpendEstimate(null);
      }
    }, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ctx, walletClient, address, spendAmount, confirmed]);

  const handleDeposit = useCallback(async () => {
    if (!address || !walletClient) return;
    const source = SOURCES.find((item) => item.key === sourceKey);
    if (!source) return;

    setDepositBusy(true);
    setDepositNotice({ tone: "info", text: "Confirm the deposit in your wallet…" });
    try {
      const { result } = await fastDeposit(ctx, sourceKey, depositAmount);
      const status = result.progress?.status;

      if (status === "FAILED") {
        setDepositNotice({
          tone: "error",
          text: `Relay failed. Contact support with source transaction ${result.txHash}.`,
          url: result.explorerUrl,
        });
      } else if (status === "PENDING") {
        // Not a failure: check the source receipt, never resubmit.
        setDepositNotice({
          tone: "info",
          text: "Deposit sent and still settling. Do not deposit again; your balance will update shortly.",
          url: result.explorerUrl,
        });
      } else {
        setDepositNotice({
          tone: "success",
          text: "Deposit credited to your Unified Balance.",
          url: result.explorerUrl,
        });
      }

      if (status !== "FAILED") {
        await registerBridgeActivity({
          walletAddress: address,
          fromChain: source.name,
          toChain: UNIFIED_DESTINATION.name,
          amount: depositAmount,
          token: "USDC",
          transactionHash: result.txHash,
          status: status === "PENDING" ? "Pending" : "Successful",
        });
        setDepositAmount("");
      }
      void refreshBalances();
    } catch (error) {
      setDepositNotice({ tone: "error", text: getUnifiedErrorMessage(error) });
    } finally {
      setDepositBusy(false);
    }
  }, [address, walletClient, ctx, sourceKey, depositAmount, refreshBalances]);

  const handleSpend = useCallback(async () => {
    if (!address || !walletClient) return;

    setSpendBusy(true);
    setSpendNotice({ tone: "info", text: "Preparing your spend…" });
    try {
      const result = await spendToArc(ctx, address, spendAmount, (step) =>
        setSpendNotice({
          tone: "info",
          text:
            step === "prepared"
              ? "Sign the request in your wallet. If no pop-up appears, click the wallet icon in your browser toolbar."
              : "Signed. Sending USDC to your Arc wallet…",
        }),
      );
      const spendFeeUsdc = spendFee ? Number(spendFee.value) : 0;
      const protocolFeeUsdc = Math.max(
        sumUsdcFees(result.fees) - spendFeeUsdc,
        0,
      );

      const activity = await registerBridgeActivity({
        walletAddress: address,
        fromChain: "Unified Balance",
        toChain: UNIFIED_DESTINATION.name,
        amount: spendAmount,
        token: "USDC",
        transactionHash: result.txHash,
        fee: String(spendFeeUsdc + protocolFeeUsdc),
        status: "Successful",
        destinationAddress: address,
      });
      await registerBridgeFee({
        walletAddress: address,
        fromChain: "Unified Balance",
        toChain: UNIFIED_DESTINATION.name,
        tokenSymbol: "USDC",
        bridgeAmount: spendAmount,
        platformFeeAmount: String(spendFeeUsdc),
        protocolFeeAmount: String(protocolFeeUsdc),
        totalFeeAmount: String(spendFeeUsdc + protocolFeeUsdc),
        feeType: "Flat",
        feeRecipientAddress: spendFee?.recipientAddress ?? null,
        protocolProvider: "Circle",
        transactionHash: result.txHash,
        status: "Recorded",
        activityId: activity.id ?? null,
      });

      setSpendNotice({
        tone: "success",
        text: "USDC sent to your Arc wallet.",
        url: result.explorerUrl,
      });
      setSpendAmount("");
      void refreshBalances();
    } catch (error) {
      setSpendNotice({ tone: "error", text: getUnifiedErrorMessage(error) });
    } finally {
      setSpendBusy(false);
    }
  }, [address, walletClient, ctx, spendAmount, spendFee, refreshBalances]);

  if (!isUnifiedDepositEnabled()) {
    return (
      <div className="rounded-2xl border border-border/70 bg-[#101113] p-6 text-center">
        <h1 className="text-lg font-semibold text-foreground">
          Unified Deposit is not available yet
        </h1>
      </div>
    );
  }

  const depositReady =
    isPositiveDecimalAmount(depositAmount) && Boolean(walletClient);
  const spendTooHigh = Number(spendAmount) > confirmed;
  const spendReady =
    isPositiveDecimalAmount(spendAmount) &&
    !spendTooHigh &&
    Boolean(walletClient);
  const depositFees = depositEstimate?.fees ?? [];
  const spendFees = spendEstimate?.fees ?? [];

  const primaryButton =
    "w-full h-11 rounded-full bg-primary px-4 text-sm font-semibold text-[#0C0C0D] transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
  const inputClass =
    "w-full rounded-xl border border-border/70 bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-primary";

  return (
    <div className="bg-[#191A1C] border border-border rounded-2xl px-6 pt-6 pb-6 space-y-6">
      <section>
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-foreground">
            Unified Balance
          </h1>
          <button
            type="button"
            onClick={() => void refreshBalances()}
            aria-label="Refresh balance"
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Deposit USDC from another chain, then move it to your Arc wallet.
        </p>
        <div className="mt-3 rounded-xl border border-border/70 p-3">
          <div className="text-2xl font-semibold text-foreground">
            {formatUsdc(confirmed)} USDC
          </div>
          <div className="text-xs text-muted-foreground">
            Available{pending > 0 ? ` · ${formatUsdc(pending)} pending` : ""}
          </div>
        </div>
        {balanceError && (
          <p className="mt-2 text-xs text-red-400">{balanceError}</p>
        )}
      </section>

      {!authenticated ? (
        <button type="button" onClick={login} className={primaryButton}>
          Connect wallet
        </button>
      ) : (
        <>
          <section>
            <h2 className="text-sm font-semibold text-foreground">Deposit</h2>
            <div className="mt-2 space-y-2">
              <select
                value={sourceKey}
                onChange={(event) =>
                  setSourceKey(event.target.value as FastDepositSourceKey)
                }
                disabled={depositBusy}
                className={inputClass}
              >
                {SOURCES.map((source) => (
                  <option key={source.key} value={source.key}>
                    From {source.name}
                  </option>
                ))}
              </select>
              <input
                inputMode="decimal"
                placeholder="Amount (USDC)"
                value={depositAmount}
                disabled={depositBusy}
                onChange={(event) =>
                  AMOUNT_PATTERN.test(event.target.value) &&
                  setDepositAmount(event.target.value)
                }
                className={inputClass}
              />
            </div>
            {depositFees.length > 0 && (
              <ul className="mt-2 text-xs text-muted-foreground">
                {depositFees.map((fee) => (
                  <li key={fee.type} className="flex justify-between">
                    <span>{fee.type === "gasFee" ? "Network gas" : "Forwarder fee"}</span>
                    <span>
                      {fee.amount} {fee.token}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => void handleDeposit()}
              disabled={!depositReady || depositBusy}
              className={`${primaryButton} mt-3`}
            >
              {depositBusy ? "Depositing…" : "Fast deposit"}
            </button>
            <NoticeBox notice={depositNotice} />
          </section>

          <section>
            <h2 className="text-sm font-semibold text-foreground">
              Move to {UNIFIED_DESTINATION.name}
            </h2>
            <input
              inputMode="decimal"
              placeholder="Amount (USDC)"
              value={spendAmount}
              disabled={spendBusy}
              onChange={(event) =>
                AMOUNT_PATTERN.test(event.target.value) &&
                setSpendAmount(event.target.value)
              }
              className={`${inputClass} mt-2`}
            />
            {spendTooHigh && (
              <p className="mt-1 text-xs text-red-400">
                Amount is higher than your available balance.
              </p>
            )}
            {(spendFees.length > 0 || spendFee) && isPositiveDecimalAmount(spendAmount) && (
              <ul className="mt-2 text-xs text-muted-foreground">
                {spendFee && (
                  <li className="flex justify-between">
                    <span>Tower fee</span>
                    <span>{spendFee.value} USDC</span>
                  </li>
                )}
                {spendFees
                  .filter((fee) => fee.type !== "kit")
                  .map((fee) => (
                    <li key={fee.type} className="flex justify-between">
                      <span>{fee.type === "gasFee" ? "Network gas" : `${fee.type} fee`}</span>
                      <span>
                        {fee.amount} {fee.token}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => void handleSpend()}
              disabled={!spendReady || spendBusy}
              className={`${primaryButton} mt-3`}
            >
              {spendBusy ? "Sending…" : `Send to ${UNIFIED_DESTINATION.name}`}
            </button>
            <NoticeBox notice={spendNotice} />
          </section>
        </>
      )}
    </div>
  );
}
