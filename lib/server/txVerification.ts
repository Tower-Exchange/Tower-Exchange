import {
  createPublicClient,
  fallback,
  http,
  isHash,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import {
  arbitrum,
  arbitrumSepolia,
  avalanche,
  avalancheFuji,
  base,
  baseSepolia,
  linea,
  lineaSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  sepolia,
  sonic,
  sonicTestnet,
  unichain,
  unichainSepolia,
} from "viem/chains";
import {
  ARC_MAINNET_CONFIG,
  ARC_TESTNET_CONFIG,
} from "@/lib/arcNetwork";
import { getArcMainnetRpcUrls, getArcRpcUrls } from "@/lib/arcRpc";
import { BRIDGE_EURC_ADDRESSES, BRIDGE_USDC_ADDRESSES } from "@/lib/bridgeNetworks";

/**
 * Server-side proof that a logged activity really happened on-chain.
 *
 * activities rows are written by the client, so a row alone proves nothing.
 * A transaction counts only if its receipt succeeded and it was sent by the
 * wallet that claims it. Solana (non-EVM) activity cannot be checked here and is
 * reported as "unsupported".
 */

export type NetworkMode = "mainnet" | "testnet";

export type TxCheck =
  | { outcome: "verified"; chainId: number; blockTime: string }
  | { outcome: "rejected"; reason: string }
  | { outcome: "unavailable"; reason: string }
  | { outcome: "unsupported"; reason: string };

const arcMainnet: Chain = {
  id: ARC_MAINNET_CONFIG.chainId,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: getArcMainnetRpcUrls() } },
};

const arcTestnet: Chain = {
  id: ARC_TESTNET_CONFIG.chainId,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: getArcRpcUrls() } },
};

/** Tower/bridge chain ids (see lib/bridgeNetworks.ts) -> EVM chain. */
const MAINNET_CHAINS: Record<string, Chain> = {
  arc: arcMainnet,
  base,
  optimism,
  avalanche,
  arbitrum,
  ethereum: mainnet,
  linea,
  polygon,
  sonic,
  unichain,
};

const TESTNET_CHAINS: Record<string, Chain> = {
  "arc-testnet": arcTestnet,
  "base-sepolia": baseSepolia,
  "optimism-sepolia": optimismSepolia,
  "avalanche-fuji": avalancheFuji,
  "arbitrum-sepolia": arbitrumSepolia,
  "ethereum-sepolia": sepolia,
  "linea-sepolia": lineaSepolia,
  "polygon-amoy": polygonAmoy,
  "sonic-testnet": sonicTestnet,
  "unichain-sepolia": unichainSepolia,
};

const TESTNET_HINT = /test|sepolia|fuji|amoy|devnet|holesky/i;

/** "avalanche-mainnet" -> mainnet, "arc-testnet" -> testnet. */
export function modeFromNetwork(network: string | null | undefined): NetworkMode {
  return network && TESTNET_HINT.test(network) ? "testnet" : "mainnet";
}

/**
 * Map the network name stored on an activity to an EVM chain for a campaign
 * mode. Swaps log the bare name "Arc" (no mainnet/testnet marker), so it
 * resolves to Arc of the campaign's mode. Activity on the other mode's chains
 * never counts.
 */
export function resolveChainEntry(
  networkName: string | null | undefined,
  mode: NetworkMode,
): { key: string; chain: Chain } | null {
  // Bridge activity stores display names ("Base Sepolia"); chain ids use hyphens.
  const name = (networkName ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  if (!name) return null;
  if (name === "arc") {
    return mode === "mainnet"
      ? { key: "arc", chain: arcMainnet }
      : { key: "arc-testnet", chain: arcTestnet };
  }
  const chain = (mode === "mainnet" ? MAINNET_CHAINS : TESTNET_CHAINS)[name];
  return chain ? { key: name, chain } : null;
}

export function resolveChain(
  networkName: string | null | undefined,
  mode: NetworkMode,
): Chain | null {
  return resolveChainEntry(networkName, mode)?.chain ?? null;
}

const clients = new Map<number, PublicClient>();

function getClient(chain: Chain): PublicClient {
  const cached = clients.get(chain.id);
  if (cached) return cached;

  const override = process.env[`LEGION_RPC_URL_${chain.id}`]?.trim();
  const urls = override ? [override] : [...chain.rpcUrls.default.http];
  const client = createPublicClient({
    chain,
    transport:
      urls.length > 1
        ? fallback(urls.map((url) => http(url, { timeout: 4_000, retryCount: 0 })))
        : http(urls[0], { timeout: 4_000, retryCount: 0 }),
  }) as PublicClient;
  clients.set(chain.id, client);
  return client;
}

/** Contracts a swap must be sent to (comma-separated). Empty => not enforced. */
function trustedContracts(): Set<string> {
  return new Set(
    (process.env.LEGION_TRUSTED_CONTRACTS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function normalizeTxHash(value: unknown): Hex | null {
  if (typeof value !== "string") return null;
  const hash = value.trim().toLowerCase();
  return isHash(hash) ? (hash as Hex) : null;
}

/**
 * @param enforceTarget  require tx.to to be in LEGION_TRUSTED_CONTRACTS (swaps)
 * @param ageMs          age of the activity row; a hash still missing on-chain
 *                       after a grace period is treated as fabricated
 */
export async function verifyActivityTransaction(params: {
  hash: string;
  wallet: string;
  networkName: string | null | undefined;
  mode: NetworkMode;
  enforceTarget: boolean;
  ageMs: number;
}): Promise<TxCheck> {
  const hash = normalizeTxHash(params.hash);
  if (!hash) return { outcome: "rejected", reason: "malformed transaction hash" };

  const chain = resolveChain(params.networkName, params.mode);
  if (!chain) {
    return {
      outcome: "unsupported",
      reason: `network '${params.networkName ?? ""}' is not verifiable for ${params.mode}`,
    };
  }

  const client = getClient(chain);

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash });
  } catch (error) {
    const notFound =
      error instanceof Error && error.name === "TransactionReceiptNotFoundError";
    if (notFound) {
      // Not indexed yet is normal for a fresh tx; an old row with no tx is fake.
      return params.ageMs > 15 * 60_000
        ? { outcome: "rejected", reason: "transaction not found on-chain" }
        : { outcome: "unavailable", reason: "transaction not indexed yet" };
    }
    return {
      outcome: "unavailable",
      reason: error instanceof Error ? error.message : "RPC error",
    };
  }

  if (receipt.status !== "success") {
    return { outcome: "rejected", reason: "transaction reverted" };
  }

  let transaction;
  try {
    transaction = await client.getTransaction({ hash });
  } catch (error) {
    return {
      outcome: "unavailable",
      reason: error instanceof Error ? error.message : "RPC error",
    };
  }

  if (transaction.from.toLowerCase() !== params.wallet.toLowerCase()) {
    return { outcome: "rejected", reason: "transaction was sent by another wallet" };
  }

  if (params.enforceTarget) {
    const allowed = trustedContracts();
    if (allowed.size > 0 && !(transaction.to && allowed.has(transaction.to.toLowerCase()))) {
      return { outcome: "rejected", reason: "transaction target is not a Tower contract" };
    }
  }

  let blockTime = new Date().toISOString();
  try {
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    blockTime = new Date(Number(block.timestamp) * 1000).toISOString();
  } catch {
    // Block lookup is only for a precise occurredAt; the tx itself is proven.
  }

  return { outcome: "verified", chainId: chain.id, blockTime };
}

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_TOPIC = `0x${"0".repeat(64)}`;

/**
 * Prove a bridge from its DESTINATION transaction.
 *
 * Tower logs a bridge's mint hash (the destination-chain transaction), and that
 * transaction is sent by Circle's relayer, not by the user, so the "sent by the
 * wallet" test cannot apply. Instead we require a real mint: a USDC/EURC
 * Transfer from the zero address to this wallet, emitted by Circle's token
 * contract on that chain. Only a genuine CCTP mint can produce that, so a user
 * can only claim a mint into their own wallet.
 */
export async function verifyBridgeMint(params: {
  hash: string;
  wallet: string;
  networkName: string | null | undefined;
  mode: NetworkMode;
  ageMs: number;
}): Promise<TxCheck> {
  const hash = normalizeTxHash(params.hash);
  if (!hash) return { outcome: "rejected", reason: "malformed transaction hash" };

  const entry = resolveChainEntry(params.networkName, params.mode);
  if (!entry) {
    return {
      outcome: "unsupported",
      reason: `network '${params.networkName ?? ""}' is not verifiable for ${params.mode}`,
    };
  }

  const client = getClient(entry.chain);

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash });
  } catch (error) {
    const notFound =
      error instanceof Error && error.name === "TransactionReceiptNotFoundError";
    if (notFound) {
      return params.ageMs > 15 * 60_000
        ? { outcome: "rejected", reason: "transaction not found on-chain" }
        : { outcome: "unavailable", reason: "transaction not indexed yet" };
    }
    return {
      outcome: "unavailable",
      reason: error instanceof Error ? error.message : "RPC error",
    };
  }

  if (receipt.status !== "success") {
    return { outcome: "rejected", reason: "transaction reverted" };
  }

  const tokens = new Set(
    [BRIDGE_USDC_ADDRESSES[entry.key], BRIDGE_EURC_ADDRESSES[entry.key]]
      .filter((address): address is string => Boolean(address))
      .map((address) => address.toLowerCase()),
  );
  const walletTopic = `0x${params.wallet.slice(2).toLowerCase().padStart(64, "0")}`;

  const minted = receipt.logs.some(
    (log) =>
      tokens.has(log.address.toLowerCase()) &&
      log.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
      log.topics[1]?.toLowerCase() === ZERO_TOPIC &&
      log.topics[2]?.toLowerCase() === walletTopic,
  );
  if (!minted) {
    return { outcome: "rejected", reason: "no bridge mint to this wallet in this transaction" };
  }

  let blockTime = new Date().toISOString();
  try {
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    blockTime = new Date(Number(block.timestamp) * 1000).toISOString();
  } catch {
    // Only for a precise occurredAt; the mint itself is proven.
  }

  return { outcome: "verified", chainId: entry.chain.id, blockTime };
}

/**
 * Bridge proof from either side: the user's burn on the source chain (sent by
 * the wallet) or the mint on the destination chain (received by the wallet).
 * Existing rows hold a mix, depending on whether the bridge had finished when
 * it was logged.
 */
export async function verifyBridgeActivity(params: {
  hash: string;
  wallet: string;
  sourceNetwork: string | null | undefined;
  destinationNetwork: string | null | undefined;
  mode: NetworkMode;
  ageMs: number;
}): Promise<TxCheck> {
  const source = await verifyActivityTransaction({
    hash: params.hash,
    wallet: params.wallet,
    networkName: params.sourceNetwork,
    mode: params.mode,
    enforceTarget: false,
    ageMs: params.ageMs,
  });
  if (source.outcome === "verified") return source;

  const destination = await verifyBridgeMint({
    hash: params.hash,
    wallet: params.wallet,
    networkName: params.destinationNetwork,
    mode: params.mode,
    ageMs: params.ageMs,
  });
  if (destination.outcome === "verified") return destination;

  // Could not prove it either way: only say "rejected" when both sides are final.
  if (source.outcome === "unavailable") return source;
  if (destination.outcome === "unavailable") return destination;
  if (source.outcome === "unsupported" && destination.outcome === "unsupported") {
    return source;
  }
  return destination.outcome === "rejected" ? destination : source;
}
