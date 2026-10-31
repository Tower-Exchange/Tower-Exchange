import { type StaticImageData } from "next/image";
import { type ActivityRow } from "@/lib/supabase";
import {
  ARC_MAINNET_EXPLORER_URL,
  ARC_TESTNET_EXPLORER_URL,
} from "@/lib/arcNetwork";
import { getTokenIcon } from "@/lib/tokenIcons";
import { getChainLogoByName } from "@/lib/chains";
import { SUPPORTED_CHAINS } from "@/lib/bridgeService";
import arcLogo from "@/public/assets/Arc Testnet logo.svg";

export type ActivityDetailsImage = StaticImageData | string | null | undefined;

export type TransactionInfoDetails = {
  id: string;
  kind: "swap" | "bridge";
  title: string;
  subtitle: string;
  sourceNetworkName: string;
  destinationNetworkName: string;
  sourceToken: string;
  destinationToken: string;
  sourceAmount: string;
  destinationAmount: string;
  routeLabel: string;
  transactionHash: string | null;
  transactionUrl: string | null;
  sourceAddress?: string | null;
  destinationAddress?: string | null;
  sourceTokenIcon?: ActivityDetailsImage;
  destinationTokenIcon?: ActivityDetailsImage;
  sourceChainIcon?: ActivityDetailsImage;
  destinationChainIcon?: ActivityDetailsImage;
  destinationChainId?: string | null;
  destinationUsdcAddress?: string | null;
  destinationNativeTokenSymbol?: string | null;
  destinationRpcUrl?: string | null;
};

export const EXPLORER_URL_BY_NETWORK_NAME: Record<string, string> = {
  Arc: `${ARC_MAINNET_EXPLORER_URL}/tx/`,
  "Arc Mainnet": `${ARC_MAINNET_EXPLORER_URL}/tx/`,
  "Arc Testnet": `${ARC_TESTNET_EXPLORER_URL}/tx/`,
  Base: "https://basescan.org/tx/",
  "Base Sepolia": "https://sepolia.basescan.org/tx/",
  Optimism: "https://optimistic.etherscan.io/tx/",
  "Optimism Sepolia": "https://sepolia-optimism.etherscan.io/tx/",
  Avalanche: "https://snowtrace.io/tx/",
  "Avalanche Fuji": "https://testnet.snowtrace.io/tx/",
  Arbitrum: "https://arbiscan.io/tx/",
  "Arbitrum Sepolia": "https://sepolia.arbiscan.io/tx/",
  Ethereum: "https://etherscan.io/tx/",
  "Ethereum Sepolia": "https://sepolia.etherscan.io/tx/",
  Linea: "https://lineascan.build/tx/",
  "Linea Sepolia": "https://sepolia.lineascan.build/tx/",
  Polygon: "https://polygonscan.com/tx/",
  "Polygon Amoy": "https://amoy.polygonscan.com/tx/",
  Sonic: "https://sonicscan.org/tx/",
  "Sonic Testnet": "https://testnet.sonicscan.org/tx/",
  Unichain: "https://uniscan.xyz/tx/",
  "Unichain Sepolia": "https://unichain-sepolia.blockscout.com/tx/",
  Solana: "https://explorer.solana.com/tx/",
  "Solana Devnet": "https://explorer.solana.com/tx/",
};

export const getActivityExplorerUrl = (row: ActivityRow) => {
  if (!row.transaction_hash || !/swap|bridge/i.test(row.type)) {
    return null;
  }

  if (row.type.toLowerCase().includes("swap")) {
    const explorerBaseUrl =
      EXPLORER_URL_BY_NETWORK_NAME[row.source_network_name] ||
      `${ARC_MAINNET_EXPLORER_URL}/tx/`;
    return `${explorerBaseUrl}${row.transaction_hash}`;
  }

  const preferredNetwork = row.destination_network_name || row.source_network_name;
  const explorerNetwork = EXPLORER_URL_BY_NETWORK_NAME[preferredNetwork]
    ? preferredNetwork
    : row.source_network_name;
  const explorerBaseUrl = EXPLORER_URL_BY_NETWORK_NAME[explorerNetwork];

  if (!explorerBaseUrl) {
    return null;
  }

  return explorerNetwork === "Solana Devnet"
    ? `${explorerBaseUrl}${row.transaction_hash}?cluster=devnet`
    : `${explorerBaseUrl}${row.transaction_hash}`;
};

export const getExplorerHomeUrl = (networkName?: string | null) => {
  if (!networkName) {
    return null;
  }

  const txBaseUrl = EXPLORER_URL_BY_NETWORK_NAME[networkName];
  return txBaseUrl ? txBaseUrl.replace(/\/tx\/?$/i, "") : null;
};

export const getActivityRouteLabel = (row: ActivityRow) => {
  if (/stable\s*fx/i.test(row.type)) {
    return "Circle StableFX";
  }

  if (row.type.toLowerCase().includes("bridge")) {
    return "CCTP (Fast)";
  }

  const routeFromType =
    row.type.match(/(?:via|route)\s+(.+)$/i)?.[1] ||
    row.type.match(/swap\s*[-:]\s*(.+)$/i)?.[1];

  return routeFromType?.trim() || "Swap";
};

export const formatActivityAmount = (amount: number | null) => {
  if (amount === null || !Number.isFinite(amount)) {
    return "";
  }

  return amount.toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
};

export const getSupportedChainKeyByName = (networkName?: string | null) => {
  if (!networkName) {
    return null;
  }

  const normalizedNetworkName = networkName.toLowerCase();
  const match = Object.entries(SUPPORTED_CHAINS).find(
    ([, config]) => config.name.toLowerCase() === normalizedNetworkName,
  );

  return match?.[0] ?? null;
};

const getBridgeDestinationConfig = (networkName?: string | null) => {
  const chainKey = getSupportedChainKeyByName(networkName);
  return chainKey
    ? {
        chainKey,
        config: SUPPORTED_CHAINS[chainKey as keyof typeof SUPPORTED_CHAINS],
      }
    : null;
};

const getSwapTitle = (
  sourceAmount: string,
  sourceToken: string,
  destinationAmount: string,
  destinationToken: string,
) => {
  const source = `${sourceAmount ? `${sourceAmount} ` : ""}${sourceToken}`.trim();
  const destination = `${destinationAmount ? `${destinationAmount} ` : ""}${
    destinationToken || "tokens"
  }`.trim();

  return `Swap ${source} to ${destination}`;
};

export const buildTransactionInfoDetails = (
  row: ActivityRow,
): TransactionInfoDetails | null => {
  if (!/swap|bridge/i.test(row.type)) {
    return null;
  }

  const isBridge = row.type.toLowerCase().includes("bridge");
  const isStableFx = /stable\s*fx/i.test(row.type);
  const sourceAmount = formatActivityAmount(row.amount);
  const destinationAmount = isBridge ? sourceAmount : "";
  const destinationToken = row.destination_currency_ticker || "";
  const routeLabel = getActivityRouteLabel(row);
  const destinationNetworkName =
    row.destination_network_name || row.source_network_name;
  const destinationConfig = getBridgeDestinationConfig(destinationNetworkName);

  return {
    id: row.id,
    kind: isBridge ? "bridge" : "swap",
    title: isBridge
      ? `Bridge ${sourceAmount ? `${sourceAmount} ` : ""}${
          row.source_currency_ticker
        }`.trim()
      : isStableFx
        ? `StableFX ${sourceAmount ? `${sourceAmount} ` : ""}${
            row.source_currency_ticker
          } to ${destinationToken || "tokens"}`.trim()
      : getSwapTitle(
          sourceAmount,
          row.source_currency_ticker,
          destinationAmount,
          destinationToken,
        ),
    subtitle: isBridge ? "via CCTP" : `via ${routeLabel}`,
    sourceNetworkName: row.source_network_name,
    destinationNetworkName,
    sourceToken: row.source_currency_ticker,
    destinationToken: destinationToken || row.source_currency_ticker,
    sourceAmount,
    destinationAmount,
    routeLabel,
    transactionHash: row.transaction_hash,
    transactionUrl: getActivityExplorerUrl(row),
    sourceAddress: row.wallet_address,
    destinationAddress: row.destination_address || row.wallet_address,
    sourceTokenIcon: getTokenIcon(row.source_currency_ticker),
    destinationTokenIcon: getTokenIcon(destinationToken || row.source_currency_ticker),
    sourceChainIcon: getChainLogoByName(row.source_network_name) ?? arcLogo,
    destinationChainIcon:
      getChainLogoByName(destinationNetworkName) ?? arcLogo,
    destinationChainId: destinationConfig?.chainKey ?? null,
    destinationUsdcAddress: destinationConfig?.config.usdcAddress ?? null,
    destinationNativeTokenSymbol:
      destinationConfig?.config.nativeTokenSymbol ?? null,
    destinationRpcUrl: destinationConfig?.config.rpcUrl ?? null,
  };
};
