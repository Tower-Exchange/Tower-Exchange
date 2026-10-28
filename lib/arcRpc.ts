import { ARC_MAINNET_RPC_URLS } from "@/lib/arcNetwork";

const ARC_ALCHEMY_RPC_URL =
  process.env.ARC_ALCHEMY_RPC_URL ||
  process.env.NEXT_PUBLIC_ARC_ALCHEMY_RPC_URL ||
  null;

const ARC_MAINNET_ALCHEMY_RPC_URL =
  process.env.ARC_MAINNET_ALCHEMY_RPC_URL ||
  process.env.NEXT_PUBLIC_ARC_MAINNET_ALCHEMY_RPC_URL ||
  null;

export const ARC_RPC_ENDPOINTS = [
  ARC_ALCHEMY_RPC_URL,
  "https://rpc.drpc.testnet.arc.io",
  "https://rpc.quicknode.testnet.arc.io",
  "https://rpc.blockdaemon.testnet.arc.io",
  "https://rpc.testnet.arc.io",
].filter((rpcUrl): rpcUrl is string => Boolean(rpcUrl));

export const ARC_MAINNET_RPC_ENDPOINTS = [
  process.env.ARC_MAINNET_RPC_URL,
  process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL,
  ARC_MAINNET_ALCHEMY_RPC_URL,
  ...ARC_MAINNET_RPC_URLS,
].filter((rpcUrl): rpcUrl is string => Boolean(rpcUrl && rpcUrl.trim()));

export const ARC_RPC_PROXY_PATH = "/api/rpc/5042002";
export const ARC_MAINNET_RPC_PROXY_PATH = "/api/rpc/5042";

export const getArcRpcProxyPath = (mode: "testnet" | "mainnet") =>
  mode === "mainnet" ? ARC_MAINNET_RPC_PROXY_PATH : ARC_RPC_PROXY_PATH;

export const getArcRpcUrls = (preferredRpcUrl?: string | null) =>
  Array.from(
    new Set(
      [preferredRpcUrl, ...ARC_RPC_ENDPOINTS].filter(
        (rpcUrl): rpcUrl is string => Boolean(rpcUrl),
      ),
    ),
  );

export const getArcMainnetRpcUrls = (preferredRpcUrl?: string | null) =>
  Array.from(
    new Set(
      [preferredRpcUrl, ...ARC_MAINNET_RPC_ENDPOINTS].filter(
        (rpcUrl): rpcUrl is string => Boolean(rpcUrl),
      ),
    ),
  );