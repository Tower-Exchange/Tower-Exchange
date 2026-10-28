"use client";

import { useState } from "react";
import { Check, CircleHelp, Copy } from "lucide-react";
import { formatUnits, parseUnits, type WalletClient } from "viem";
import GasAccountInfoModal from "@/components/bridge/GasAccountInfoModal";
import { ensureWalletOnBridgeChain } from "@/lib/bridgeService";
import {
  GAS_ACCOUNT_WITHDRAW_RESERVE as WITHDRAW_RESERVE,
  USDC_DECIMALS,
} from "@/lib/paymaster/config";

const formatUsdc = (value: bigint | null) => {
  if (value === null) {
    return "—";
  }

  const [whole, fraction = ""] = formatUnits(value, USDC_DECIMALS).split(".");
  return fraction ? `${whole}.${fraction.slice(0, 4)}` : whole;
};

const AMOUNT_REGEX = new RegExp(`^\\d*(\\.\\d{0,${USDC_DECIMALS}})?$`);

type GasAccountPanelProps = {
  chainKey: string;
  chainName: string;
  walletConnected: boolean;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  address: string | null;
  balance: bigint | null;
  balanceStatus: "idle" | "loading" | "ready" | "error";
  walletClient: WalletClient | null | undefined;
  disabled?: boolean;
  onRefresh: () => void;
};

export default function GasAccountPanel({
  chainKey,
  chainName,
  walletConnected,
  enabled,
  onToggle,
  address,
  balance,
  balanceStatus,
  walletClient,
  disabled = false,
  onRefresh,
}: GasAccountPanelProps) {
  const [copied, setCopied] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const handleAmountChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value.replace(/,/g, ".");
    if (raw === "") {
      setWithdrawAmount("");
      return;
    }
    if (raw === ".") {
      setWithdrawAmount("0.");
      return;
    }
    if (AMOUNT_REGEX.test(raw)) {
      setWithdrawAmount(raw);
    }
  };

  const maxWithdrawable =
    balance !== null && balance > WITHDRAW_RESERVE
      ? balance - WITHDRAW_RESERVE
      : 0n;

  const copyAddress = async () => {
    if (!address) {
      return;
    }

    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked
    }
  };

  const handleWithdraw = async () => {
    setWithdrawError(null);

    let amount: bigint;
    try {
      amount = parseUnits(withdrawAmount.trim(), USDC_DECIMALS);
    } catch {
      setWithdrawError("Enter a valid amount.");
      return;
    }

    if (amount <= 0n || amount > maxWithdrawable) {
      setWithdrawError(`Enter up to ${formatUsdc(maxWithdrawable)} USDC.`);
      return;
    }

    if (!walletClient) {
      setWithdrawError("Connect your wallet first.");
      return;
    }

    setWithdrawing(true);
    try {
      await ensureWalletOnBridgeChain(chainKey, walletClient);
      const { withdrawUsdcFromGasAccount } = await import(
        "@/lib/paymaster/withdraw"
      );
      await withdrawUsdcFromGasAccount({ chainKey, walletClient, amount });
      setWithdrawAmount("");
      setWithdrawOpen(false);
      onRefresh();
    } catch (error) {
      setWithdrawError(
        error instanceof Error ? error.message : "Withdrawal failed.",
      );
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-[#151617] px-3.5 py-3 text-sm mb-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <p className="font-medium text-foreground">Pay gas in USDC</p>
            <button
              type="button"
              onClick={() => setInfoOpen(true)}
              aria-label="How paying gas in USDC works"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <CircleHelp className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {walletConnected
              ? "Bridge from a Gas Account on this network."
              : "Connect your wallet to use this."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Pay gas in USDC"
          disabled={disabled || !walletConnected}
          onClick={() => onToggle(!enabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            enabled ? "bg-primary" : "bg-zinc-700"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2 rounded-lg bg-[#0f1011] px-3 py-2">
            <span className="break-all font-sora text-xs text-foreground">
              {address ?? "Loading…"}
            </span>
            <button
              type="button"
              onClick={copyAddress}
              disabled={!address}
              aria-label="Copy Gas Account address"
              className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>

          <p className="px-1 text-xs font-medium text-amber-400">
            Send USDC on {chainName} only. Funds sent on another network
            won&apos;t show here.
          </p>

          <div className="flex items-center justify-between px-1 text-xs">
            <span className="text-muted-foreground">
              Balance · deposit USDC on {chainName}
            </span>
            <span className="font-medium text-foreground">
              {balanceStatus === "error"
                ? "Unavailable"
                : `${formatUsdc(balance)} USDC`}
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              setWithdrawOpen((open) => !open);
              setWithdrawError(null);
            }}
            disabled={!address || maxWithdrawable === 0n}
            className="px-1 text-xs font-medium text-primary hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {withdrawOpen ? "Cancel" : "Withdraw to my wallet"}
          </button>

          {withdrawOpen && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                value={withdrawAmount}
                onChange={handleAmountChange}
                placeholder="0.00"
                aria-label="Amount of USDC to withdraw"
                className="min-w-0 flex-1 rounded-lg bg-[#0f1011] px-3 py-2 text-sm text-foreground outline-none"
              />
              <button
                type="button"
                onClick={() =>
                  setWithdrawAmount(formatUnits(maxWithdrawable, USDC_DECIMALS))
                }
                className="rounded-lg bg-zinc-800 px-2.5 py-2 text-xs font-medium text-foreground hover:bg-zinc-700"
              >
                Max
              </button>
              <button
                type="button"
                onClick={handleWithdraw}
                disabled={withdrawing}
                className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-black hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {withdrawing ? "Sending…" : "Withdraw"}
              </button>
            </div>
          )}

          {withdrawError && (
            <p role="alert" className="px-1 text-xs font-medium text-red-400">
              {withdrawError}
            </p>
          )}
        </div>
      )}

      <GasAccountInfoModal
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        chainName={chainName}
      />
    </div>
  );
}
