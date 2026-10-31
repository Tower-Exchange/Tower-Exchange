"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type BridgeNetworkMode,
  getDefaultBridgeNetworkMode,
  storeBridgeNetworkMode,
} from "@/lib/bridgeNetworks";

// Production builds are always mainnet. Testnet is only available in
// development, with NEXT_PUBLIC_DEFAULT_NETWORK_MODE=testnet.
const getNetworkMode = (): BridgeNetworkMode =>
  process.env.NODE_ENV === "production"
    ? "mainnet"
    : getDefaultBridgeNetworkMode();

export function useTowerNetworkMode() {
  const [mode] = useState<BridgeNetworkMode>(getNetworkMode);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    storeBridgeNetworkMode(mode);
    setIsReady(true);
  }, [mode]);

  const setNetworkMode = useCallback(
    (next: BridgeNetworkMode) => {
      void next;
      storeBridgeNetworkMode(mode);
    },
    [mode],
  );

  return { mode, setNetworkMode, isReady };
}
