"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { isPaymasterChain } from "@/lib/paymaster/config";
import { isPaymasterEnabled } from "@/lib/paymaster/enabled";

const STORAGE_KEY = "tower-gas-account-enabled";
const BALANCE_POLL_INTERVAL_MS = 20_000;

type BalanceStatus = "idle" | "loading" | "ready" | "error";

const readStoredPreference = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

const writeStoredPreference = (value: boolean) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "true" : "false");
  } catch {
    // storage unavailable, the preference just won't persist
  }
};

export default function useGasAccount({
  ownerAddress,
  chainKey,
}: {
  ownerAddress?: string | null;
  chainKey: string | null;
}) {
  const featureEnabled = isPaymasterEnabled();
  // supported: the option exists on this chain. available: wallet connected too.
  const supported = featureEnabled && isPaymasterChain(chainKey);
  const available = supported && Boolean(ownerAddress);

  const [preference, setPreference] = useState(false);
  const [address, setAddress] = useState<Address | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [balanceStatus, setBalanceStatus] = useState<BalanceStatus>("idle");
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (featureEnabled) {
      setPreference(readStoredPreference());
    }
  }, [featureEnabled]);

  const setEnabled = useCallback((next: boolean) => {
    setPreference(next);
    writeStoredPreference(next);
  }, []);

  const refresh = useCallback(() => {
    setRefreshTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    setAddress(null);
    setBalance(null);
    setBalanceStatus("idle");

    if (!available || !ownerAddress || !chainKey) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const { getGasAccountAddress } = await import(
          "@/lib/paymaster/gasAccount"
        );
        const resolved = await getGasAccountAddress({
          chainKey,
          ownerAddress: ownerAddress as Address,
        });
        if (!cancelled) {
          setAddress(resolved);
        }
      } catch (error) {
        console.error("Failed to resolve Gas Account address:", error);
        if (!cancelled) {
          setBalanceStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [available, ownerAddress, chainKey]);

  useEffect(() => {
    if (!available || !address || !chainKey) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        setBalanceStatus((status) => (status === "ready" ? status : "loading"));
        const { getGasAccountUsdcBalance } = await import(
          "@/lib/paymaster/gasAccount"
        );
        const next = await getGasAccountUsdcBalance({ chainKey, address });
        if (!cancelled) {
          setBalance(next);
          setBalanceStatus("ready");
        }
      } catch (error) {
        console.error("Failed to read Gas Account balance:", error);
        if (!cancelled) {
          setBalanceStatus("error");
        }
      }
    };

    void load();
    const timer = window.setInterval(load, BALANCE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [available, address, chainKey, refreshTick]);

  return {
    supported,
    available,
    enabled: available && preference,
    setEnabled,
    address,
    balance,
    balanceStatus,
    refresh,
  };
}
