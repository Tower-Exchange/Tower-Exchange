import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  fallback,
  getAddress,
  http,
  isAddress,
  parseAbiItem,
  parseUnits,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ARC_MAINNET_RPC_ENDPOINTS } from "@/lib/arcRpc";
import {
  STABLEFX_ARC_MAINNET_TOKENS,
  type StableFxCurrency,
} from "@/lib/stableFx";
import {
  StableFxError,
  type StableFxTypedData,
} from "@/lib/server/circleStableFx";

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const MAX_TOKEN_DECIMALS = 36;
// Manual recovery is intentionally bounded to recent blocks after the
// settlement. It is a safety net for a payout that was sent but whose hash was
// not persisted, not a chain-wide payment indexer.
const PAYOUT_LOG_SCAN_MAX_BLOCKS = 25_000n;
const PAYOUT_LOG_SCAN_CHUNK_BLOCKS = 5_000n;
const ERC20_TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const ARC_STABLEFX_CHAIN: Chain = {
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [...ARC_MAINNET_RPC_ENDPOINTS] } },
};

export type StableFxTokenConfig = {
  currency: StableFxCurrency;
  address: Address;
  decimals: number;
};

export type StableFxTakerConfig = {
  address: Address;
  account: ReturnType<typeof privateKeyToAccount>;
  chain: Chain;
  tokens: Record<StableFxCurrency, StableFxTokenConfig>;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function configuredTakerAddresses() {
  return (process.env.CIRCLE_STABLEFX_TAKER_WALLETS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function requiredAddress(value: string | undefined, label: string): Address {
  const address = value?.trim();
  if (!address || !isAddress(address)) {
    throw new StableFxError(`Missing or invalid ${label}.`, 503);
  }
  return getAddress(address);
}

function readTokenConfig(currency: StableFxCurrency): StableFxTokenConfig {
  const { address, decimals } = STABLEFX_ARC_MAINNET_TOKENS[currency];
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_TOKEN_DECIMALS) {
    throw new StableFxError(
      `StableFX ${currency} decimals must be an integer between 0 and ${MAX_TOKEN_DECIMALS}.`,
      503,
    );
  }
  return { currency, address: getAddress(address), decimals };
}

/**
 * The private key is intentionally server-only. In production it should be
 * injected by the deployment secret manager/HSM boundary, never committed to
 * .env.local or exposed with NEXT_PUBLIC_. The configured address and key must
 * identify the same Circle-approved Arc EOA.
 */
export function getStableFxTakerConfig(): StableFxTakerConfig {
  const configuredAddress = requiredAddress(
    process.env.CIRCLE_STABLEFX_TAKER_ADDRESS,
    "CIRCLE_STABLEFX_TAKER_ADDRESS",
  );
  const approved = configuredTakerAddresses();
  if (approved.length > 0 && !approved.includes(configuredAddress.toLowerCase())) {
    throw new StableFxError(
      "CIRCLE_STABLEFX_TAKER_ADDRESS is not present in CIRCLE_STABLEFX_TAKER_WALLETS.",
      503,
    );
  }

  const configuredPrivateKey =
    process.env.CIRCLE_STABLEFX_TAKER_PRIVATE_KEY?.trim();
  const privateKey = configuredPrivateKey
    ? configuredPrivateKey.startsWith("0x")
      ? configuredPrivateKey
      : `0x${configuredPrivateKey}`
    : "";
  if (!privateKey || !/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
    throw new StableFxError(
      "Missing or invalid CIRCLE_STABLEFX_TAKER_PRIVATE_KEY for the Tower taker signer.",
      503,
    );
  }

  const account = privateKeyToAccount(privateKey as Hex);
  if (account.address.toLowerCase() !== configuredAddress.toLowerCase()) {
    throw new StableFxError(
      "The configured StableFX taker private key does not match CIRCLE_STABLEFX_TAKER_ADDRESS.",
      503,
    );
  }

  return {
    address: configuredAddress,
    account,
    chain: ARC_STABLEFX_CHAIN,
    tokens: {
      USDC: readTokenConfig("USDC"),
      EURC: readTokenConfig("EURC"),
      GBPA: readTokenConfig("GBPA"),
      MXNB: readTokenConfig("MXNB"),
      AUDF: readTokenConfig("AUDF"),
    },
  };
}

function rpcUrls() {
  const urls = [...ARC_MAINNET_RPC_ENDPOINTS].filter(
    (url): url is string => Boolean(url && url.trim()),
  );
  if (!urls.length) {
    throw new StableFxError("No Arc RPC URL is configured for StableFX.", 503);
  }
  return Array.from(new Set(urls));
}

export function getStableFxPublicClient() {
  const urls = rpcUrls();
  return createPublicClient({
    chain: ARC_STABLEFX_CHAIN,
    transport:
      urls.length === 1
        ? http(urls[0], { timeout: 12_000, retryCount: 1 })
        : fallback(
            urls.map((url) => http(url, { timeout: 12_000, retryCount: 1 })),
          ),
  });
}

function topicForAddress(address: Address) {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

export function parseStableFxAmount(
  amount: string,
  token: StableFxTokenConfig,
) {
  try {
    return parseUnits(amount, token.decimals);
  } catch {
    throw new StableFxError(
      `${token.currency} amount has more than ${token.decimals} decimal places.`,
      400,
    );
  }
}

export async function verifyExactStableFxDeposit(params: {
  transactionHash: Hex;
  from: Address;
  to: Address;
  token: StableFxTokenConfig;
  amount: bigint;
}) {
  const client = getStableFxPublicClient();
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: params.transactionHash });
  } catch {
    const pending =
      error instanceof Error && error.name === "TransactionReceiptNotFoundError";
    throw new StableFxError(
      pending
        ? "Deposit transaction is not confirmed on Arc yet. Try again after confirmation."
        : "Unable to verify the deposit transaction on Arc right now.",
      pending ? 409 : 502,
    );
  }
  if (receipt.status !== "success") {
    throw new StableFxError("The deposit transaction reverted on Arc.", 400);
  }

  const transaction = await client.getTransaction({ hash: params.transactionHash });
  if (transaction.from.toLowerCase() !== params.from.toLowerCase()) {
    throw new StableFxError("Deposit transaction was not sent by the signed-in wallet.", 403);
  }

  const transferAmount = receipt.logs.reduce((total, log) => {
    if (
      log.address.toLowerCase() !== params.token.address.toLowerCase() ||
      log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC ||
      log.topics[1]?.toLowerCase() !== topicForAddress(params.from) ||
      log.topics[2]?.toLowerCase() !== topicForAddress(params.to)
    ) {
      return total;
    }
    try {
      return total + BigInt(log.data);
    } catch {
      return total;
    }
  }, 0n);

  if (transferAmount !== params.amount) {
    throw new StableFxError(
      `Deposit amount does not match this order. Send exactly ${params.amount.toString()} raw ${params.token.currency} units to the Tower taker wallet.`,
      400,
    );
  }

  return {
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
  };
}

function typedDataDomainChainId(typedData: StableFxTypedData) {
  const value = typedData.domain.chainId;
  try {
    return typeof value === "bigint" ? Number(value) : Number(value);
  } catch {
    return Number.NaN;
  }
}

export function validateStableFxPermitTypedData(params: {
  typedData: StableFxTypedData;
  expectedToken: StableFxTokenConfig;
  expectedAmount?: bigint;
  expectedRecipient?: Address;
}) {
  if (typedDataDomainChainId(params.typedData) !== ARC_STABLEFX_CHAIN.id) {
    throw new StableFxError("Circle returned typed data for the wrong chain.", 502);
  }
  const permit2 = requiredAddress(
    typeof params.typedData.domain.verifyingContract === "string"
      ? params.typedData.domain.verifyingContract
      : undefined,
    "StableFX Permit2 verifying contract",
  );
  const permitted = asRecord(params.typedData.message.permitted);
  const permittedToken =
    typeof permitted?.token === "string" && isAddress(permitted.token)
      ? getAddress(permitted.token)
      : null;
  let permittedAmount: bigint;
  try {
    permittedAmount = BigInt(String(permitted?.amount));
  } catch {
    throw new StableFxError("Circle returned an invalid Permit2 token amount.", 502);
  }
  if (
    !permittedToken ||
    permittedToken.toLowerCase() !== params.expectedToken.address.toLowerCase() ||
    (params.expectedAmount !== undefined &&
      permittedAmount !== params.expectedAmount)
  ) {
    throw new StableFxError(
      "Circle's Permit2 payload does not match this order's deposited token and amount.",
      502,
    );
  }

  if (params.expectedRecipient) {
    const witness = asRecord(params.typedData.message.witness);
    const recipient =
      typeof witness?.recipient === "string" && isAddress(witness.recipient)
        ? getAddress(witness.recipient)
        : null;
    if (
      !recipient ||
      recipient.toLowerCase() !== params.expectedRecipient.toLowerCase()
    ) {
      throw new StableFxError(
        "Circle's trade payload does not return the purchased asset to the Tower taker wallet.",
        502,
      );
    }
  }

  return { permit2, permittedAmount };
}

function typedDataAmount(value: unknown, label: string) {
  try {
    const amount = BigInt(String(value));
    if (amount < 0n) throw new Error("negative");
    return amount;
  } catch {
    throw new StableFxError(`Circle returned an invalid ${label}.`, 502);
  }
}

function typedDataAddress(value: unknown, label: string) {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new StableFxError(`Circle returned an invalid ${label}.`, 502);
  }
  return getAddress(value);
}

function quoteIdAsBytes32(quoteId: string) {
  const compact = quoteId.replace(/-/g, "");
  if (!/^[a-fA-F0-9]{32}$/.test(compact)) return null;
  return `0x${compact.padStart(64, "0")}`.toLowerCase();
}

/**
 * Validate the first Permit2 signature returned with a tradable quote.
 *
 * `message.permitted.amount` is Circle's required collateral, not necessarily
 * the quote notional. The notional is instead committed in the witness
 * consideration. Treating those two values as equal rejects valid quotes that
 * require collateral (for example, 2 USDC notional + 1 USDC collateral).
 */
export function validateStableFxTradeIntentTypedData(params: {
  typedData: StableFxTypedData;
  expectedSourceToken: StableFxTokenConfig;
  expectedSourceAmount: bigint;
  expectedDestinationToken: StableFxTokenConfig;
  expectedDestinationAmount?: bigint;
  expectedQuoteId: string;
  expectedCollateralAmount?: bigint;
  expectedRecipient: Address;
}) {
  const { permit2, permittedAmount: collateralAmount } =
    validateStableFxPermitTypedData({
      typedData: params.typedData,
      expectedToken: params.expectedSourceToken,
      // The collateral is validated independently because it is not the
      // source-trade amount. On a resumed order it is recovered from the
      // already-stored Circle typed-data message.
      expectedAmount: params.expectedCollateralAmount,
      expectedRecipient: params.expectedRecipient,
    });

  const expectedQuoteId = quoteIdAsBytes32(params.expectedQuoteId);
  if (!expectedQuoteId) {
    throw new StableFxError("StableFX quote ID is invalid.", 502);
  }

  const witness = asRecord(params.typedData.message.witness);
  const consideration = asRecord(witness?.consideration);
  if (!consideration) {
    throw new StableFxError(
      "Circle's trade payload is missing its signed consideration.",
      502,
    );
  }

  const quoteId =
    typeof consideration.quoteId === "string"
      ? consideration.quoteId.toLowerCase()
      : null;
  const base = typedDataAddress(consideration.base, "trade base token");
  const quote = typedDataAddress(consideration.quote, "trade quote token");
  const baseAmount = typedDataAmount(consideration.baseAmount, "trade base amount");
  const quoteAmount = typedDataAmount(consideration.quoteAmount, "trade quote amount");

  if (quoteId !== expectedQuoteId) {
    throw new StableFxError(
      "Circle's signed trade consideration does not match this quote.",
      502,
    );
  }

  // StableFX represents a currency pair as base/quote. Accept either
  // orientation but require the signed consideration to contain this order's
  // exact source amount and destination token.
  const sourceIsQuote =
    quote.toLowerCase() === params.expectedSourceToken.address.toLowerCase() &&
    base.toLowerCase() === params.expectedDestinationToken.address.toLowerCase();
  const sourceIsBase =
    base.toLowerCase() === params.expectedSourceToken.address.toLowerCase() &&
    quote.toLowerCase() === params.expectedDestinationToken.address.toLowerCase();
  const signedSourceAmount = sourceIsQuote
    ? quoteAmount
    : sourceIsBase
      ? baseAmount
      : null;
  const signedDestinationAmount = sourceIsQuote
    ? baseAmount
    : sourceIsBase
      ? quoteAmount
      : null;

  if (signedSourceAmount !== params.expectedSourceAmount) {
    throw new StableFxError(
      "Circle's signed trade consideration does not match this order's deposited amount.",
      502,
    );
  }
  if (
    params.expectedDestinationAmount !== undefined &&
    signedDestinationAmount !== params.expectedDestinationAmount
  ) {
    throw new StableFxError(
      "Circle's signed trade consideration does not match its quoted destination amount.",
      502,
    );
  }

  return { permit2, collateralAmount };
}

export async function getStableFxPermit2Allowance(params: {
  token: StableFxTokenConfig;
  owner: Address;
  permit2: Address;
}) {
  const client = getStableFxPublicClient();
  return client.readContract({
    address: params.token.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [params.owner, params.permit2],
  });
}

export async function getStableFxTokenBalance(params: {
  token: StableFxTokenConfig;
  owner: Address;
}) {
  const client = getStableFxPublicClient();
  return client.readContract({
    address: params.token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [params.owner],
  });
}

export async function signStableFxTypedData(
  config: StableFxTakerConfig,
  typedData: StableFxTypedData,
) {
  const types = { ...typedData.types };
  delete types.EIP712Domain;
  try {
    // Circle supplies the exact dynamic schema. Runtime validation is performed
    // above; viem's static generic cannot represent arbitrary EIP-712 schemas.
    return await config.account.signTypedData({
      domain: typedData.domain,
      types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    } as never);
  } catch (error) {
    console.error("StableFX EIP-712 signing failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    throw new StableFxError("Tower could not sign the StableFX authorisation.", 502);
  }
}

export async function findStableFxSettlementReceipt(params: {
  transactionHash: Hex;
  token: StableFxTokenConfig;
  recipient: Address;
  expectedAmount: bigint;
}) {
  const client = getStableFxPublicClient();
  const receipt = await client.getTransactionReceipt({ hash: params.transactionHash });
  if (receipt.status !== "success") {
    throw new StableFxError("StableFX settlement transaction reverted on Arc.", 502);
  }
  const matchingAmounts = receipt.logs.flatMap((log) => {
    if (
      log.address.toLowerCase() !== params.token.address.toLowerCase() ||
      log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC ||
      log.topics[2]?.toLowerCase() !== topicForAddress(params.recipient)
    ) {
      return [];
    }
    try {
      return [BigInt(log.data)];
    } catch {
      return [];
    }
  });
  const expectedTransfers = matchingAmounts.filter(
    (amount) => amount === params.expectedAmount,
  );
  if (expectedTransfers.length !== 1) {
    throw new StableFxError(
      "The StableFX settlement receipt does not contain one unambiguous purchased-token transfer for this order.",
      502,
    );
  }
  return params.expectedAmount;
}

/**
 * Finds an already-confirmed Tower payout sent after a StableFX settlement.
 * This lets reconciliation adopt a verified manual/operator payout rather
 * than sending the customer the same token amount a second time.
 */
export async function findExistingStableFxPayout(params: {
  settlementTransactionHash: Hex;
  token: StableFxTokenConfig;
  sender: Address;
  recipient: Address;
  expectedAmount: bigint;
}): Promise<Hex | null> {
  const client = getStableFxPublicClient();
  let settlementReceipt;
  try {
    settlementReceipt = await client.getTransactionReceipt({
      hash: params.settlementTransactionHash,
    });
  } catch {
    throw new StableFxError(
      "Unable to load the StableFX settlement receipt while reconciling a payout.",
      502,
    );
  }

  if (settlementReceipt.status !== "success") {
    throw new StableFxError(
      "The StableFX settlement transaction reverted on Arc.",
      502,
    );
  }

  const latestBlock = await client.getBlockNumber();
  const fromBlock = settlementReceipt.blockNumber;
  const toBlock =
    latestBlock > fromBlock + PAYOUT_LOG_SCAN_MAX_BLOCKS
      ? fromBlock + PAYOUT_LOG_SCAN_MAX_BLOCKS
      : latestBlock;

  for (
    let chunkStart = fromBlock;
    chunkStart <= toBlock;
    chunkStart += PAYOUT_LOG_SCAN_CHUNK_BLOCKS
  ) {
    const chunkEnd =
      chunkStart + PAYOUT_LOG_SCAN_CHUNK_BLOCKS - 1n > toBlock
        ? toBlock
        : chunkStart + PAYOUT_LOG_SCAN_CHUNK_BLOCKS - 1n;
    const logs = await client.getLogs({
      address: params.token.address,
      event: ERC20_TRANSFER_EVENT,
      args: { from: params.sender, to: params.recipient },
      fromBlock: chunkStart,
      toBlock: chunkEnd,
    });

    for (const log of logs) {
      const amount = log.args.value;
      if (amount !== params.expectedAmount || !log.transactionHash) continue;

      const payoutReceipt = await getStableFxPayoutReceipt(log.transactionHash);
      if (payoutReceipt?.status === "success") {
        return log.transactionHash;
      }
    }
  }

  return null;
}

export async function broadcastStableFxPayout(params: {
  config: StableFxTakerConfig;
  token: StableFxTokenConfig;
  recipient: Address;
  amount: bigint;
}) {
  const client = getStableFxPublicClient();
  const wallet = createWalletClient({
    account: params.config.account,
    chain: params.config.chain,
    transport: http(rpcUrls()[0], { timeout: 20_000, retryCount: 0 }),
  });
  const simulation = await client.simulateContract({
    address: params.token.address,
    abi: erc20Abi,
    functionName: "transfer",
    args: [params.recipient, params.amount],
    account: params.config.account,
  });
  return wallet.writeContract(simulation.request);
}

export async function getStableFxPayoutReceipt(transactionHash: Hex) {
  const client = getStableFxPublicClient();
  try {
    return await client.getTransactionReceipt({ hash: transactionHash });
  } catch (error) {
    const pending =
      error instanceof Error && error.name === "TransactionReceiptNotFoundError";
    if (pending) return null;
    throw error;
  }
}
