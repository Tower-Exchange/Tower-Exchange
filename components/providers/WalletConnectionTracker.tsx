"use client";

import { useRef } from "react";
import { useAccountEffect } from "wagmi";
import { ensureAiWalletProof } from "@/lib/aiWalletProof";
import { trackWalletConnection } from "@/lib/walletConnectionTracking";
import {
  ensureWalletSession,
  logoutWalletSession,
} from "@/lib/walletSessionClient";

export const WalletConnectionTracker = () => {
  const trackedAddressRef = useRef<string | null>(null);

  useAccountEffect({
    onConnect(data) {
      const normalizedAddress = data.address.toLowerCase();

      // Session cookie first, then the AI authorization signature (cached ~24h).
      void ensureWalletSession(normalizedAddress)
        .then(() => ensureAiWalletProof(normalizedAddress))
        .catch((error) => {
          console.warn(
            "Wallet session or AI authorization sign-in failed:",
            error,
          );
        });

      if (data.isReconnected) {
        trackedAddressRef.current = normalizedAddress;
        return;
      }

      if (trackedAddressRef.current === normalizedAddress) {
        return;
      }

      trackedAddressRef.current = normalizedAddress;

      void trackWalletConnection({
        walletAddress: normalizedAddress,
        walletType: data.connector?.name ?? null,
        chainId: data.chainId ?? null,
        connectedAt: new Date().toISOString(),
      });
    },
    onDisconnect() {
      trackedAddressRef.current = null;
      void logoutWalletSession();
    },
  });

  return null;
};
