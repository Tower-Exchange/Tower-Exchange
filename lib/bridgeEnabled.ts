import { isSolanaBridgeChain } from "@/lib/bridgeNetworks";

const parseBooleanEnv = (value?: string) => {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "false" || normalized === "0" || normalized === "off") {
    return false;
  }
  if (normalized === "true" || normalized === "1" || normalized === "on") {
    return true;
  }

  return null;
};

export const isSolanaBridgeEnabled = () =>
  parseBooleanEnv(process.env.NEXT_PUBLIC_SOLANA_BRIDGE_ENABLED) ?? false;

export const isEvmBridgeEnabled = () =>
  parseBooleanEnv(process.env.NEXT_PUBLIC_EVM_BRIDGE_ENABLED) ?? false;

export const isBridgeChainEnabled = (chainId?: string | null) =>
  isSolanaBridgeChain(chainId) ? isSolanaBridgeEnabled() : isEvmBridgeEnabled();

export const isBridgeRouteEnabled = (
  fromChainId?: string | null,
  toChainId?: string | null,
) =>
  Boolean(
    fromChainId &&
      toChainId &&
      isBridgeChainEnabled(fromChainId) &&
      isBridgeChainEnabled(toChainId),
  );
