import { Buffer } from "node:buffer";

import { NextRequest, NextResponse } from "next/server";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";

import {
  getSolanaUsdcAssociatedTokenAddress,
  getSolanaUsdcMint,
  isValidSolanaAddress,
  normalizeSolanaAddress,
} from "@/lib/solanaUsdcAccounts";
import { isSolanaMainnetChain } from "@/lib/bridgeNetworks";
import { isSolanaBridgeEnabled } from "@/lib/bridgeEnabled";

export const dynamic = "force-dynamic";

const SOLANA_COMMITMENT = "confirmed" as const;
const SOLANA_DEFAULT_RPC_URL = "https://api.devnet.solana.com";
const SOLANA_MAINNET_DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_ALPHABET_MAP = new Map(
  [...BASE58_ALPHABET].map((char, index) => [char, index]),
);

const getSolanaRpcUrl = (chainId: string) => {
  if (isSolanaMainnetChain(chainId)) {
    return (
      process.env.SOLANA_MAINNET_RPC_URL ||
      process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL ||
      SOLANA_MAINNET_DEFAULT_RPC_URL
    );
  }

  return (
    process.env.SOLANA_DEVNET_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    SOLANA_DEFAULT_RPC_URL
  );
};

const decodeBase58 = (value: string) => {
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) {
    throw new Error("Value is not base58 encoded.");
  }

  const bytes = [0];

  for (const char of value) {
    const digit = BASE58_ALPHABET_MAP.get(char);

    if (digit === undefined) {
      throw new Error("Invalid base58 character in Solana ATA sponsor key.");
    }

    let carry = digit;

    for (let index = 0; index < bytes.length; index += 1) {
      const nextValue = bytes[index] * 58 + carry;
      bytes[index] = nextValue & 0xff;
      carry = nextValue >> 8;
    }

    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  for (const char of value) {
    if (char !== "1") {
      break;
    }

    bytes.push(0);
  }

  return Uint8Array.from(bytes.reverse());
};

const parseByteValue = (value: unknown) => {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value).trim(), 10);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
    throw new Error("Invalid Solana ATA sponsor key byte.");
  }

  return parsed;
};

const parseSponsorSecretKey = (rawValue: string) => {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    throw new Error("Solana ATA sponsor key is empty.");
  }

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error("Solana ATA sponsor key JSON must be an array.");
    }

    return Uint8Array.from(parsed.map(parseByteValue));
  }

  if (trimmed.includes(",")) {
    return Uint8Array.from(trimmed.split(",").map(parseByteValue));
  }

  if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed)) {
    const decodedBase58 = decodeBase58(trimmed);

    if (decodedBase58.length === 64) {
      return decodedBase58;
    }
  }

  return Uint8Array.from(Buffer.from(trimmed, "base64"));
};

const getSponsorKeypair = () => {
  const secretKey =
    process.env.SOLANA_ATA_SPONSOR_SECRET_KEY ||
    process.env.SOLANA_DEVNET_ATA_SPONSOR_SECRET_KEY ||
    "";

  if (!secretKey.trim()) {
    return null;
  }

  try {
    const secretKeyBytes = parseSponsorSecretKey(secretKey);

    if (secretKeyBytes.length !== 64) {
      throw new Error(
        `Solana ATA sponsor key must decode to a 64-byte secret key, received ${secretKeyBytes.length} bytes.`,
      );
    }

    return Keypair.fromSecretKey(secretKeyBytes);
  } catch (error) {
    console.error("Invalid Solana ATA sponsor secret key:", error);
    throw new Error(
      "Configured Solana ATA sponsor secret key is invalid. Use a Solana keypair secret key as a JSON array, comma-separated byte list, base58 string, or base64 string. Do not use the public wallet address.",
    );
  }
};

const getConnection = (chainId: string) =>
  new Connection(getSolanaRpcUrl(chainId), {
    commitment: SOLANA_COMMITMENT,
    confirmTransactionInitialTimeout: 120000,
    disableRetryOnRateLimit: false,
  });

const ensureRecipientUsdcAccount = async (
  ownerAddress: string,
  chainId: string,
) => {
  const normalizedOwnerAddress = normalizeSolanaAddress(ownerAddress);
  const ataAddress = getSolanaUsdcAssociatedTokenAddress(
    normalizedOwnerAddress,
    chainId,
  );
  const connection = getConnection(chainId);
  const ataPublicKey = new PublicKey(ataAddress);

  const existingAccount = await connection.getAccountInfo(
    ataPublicKey,
    SOLANA_COMMITMENT,
  );

  if (existingAccount) {
    return {
      ownerAddress: normalizedOwnerAddress,
      ataAddress,
      created: false,
      sponsored: false,
    };
  }

  const sponsor = getSponsorKeypair();

  if (!sponsor) {
    throw new Error(
      "This Solana wallet is not ready to receive bridged USDC yet. Configure SOLANA_ATA_SPONSOR_SECRET_KEY so Tower can initialize the recipient USDC account automatically.",
    );
  }

  const ownerPublicKey = new PublicKey(normalizedOwnerAddress);
  const mintPublicKey = new PublicKey(getSolanaUsdcMint(chainId));

  const transaction = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      sponsor.publicKey,
      ataPublicKey,
      ownerPublicKey,
      mintPublicKey,
    ),
  );

  transaction.feePayer = sponsor.publicKey;

  const latestBlockhash = await connection.getLatestBlockhash(SOLANA_COMMITMENT);
  transaction.recentBlockhash = latestBlockhash.blockhash;
  transaction.sign(sponsor);

  try {
    const signature = await connection.sendRawTransaction(
      transaction.serialize(),
      {
        skipPreflight: false,
        maxRetries: 5,
      },
    );

    await connection.confirmTransaction(
      {
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
      SOLANA_COMMITMENT,
    );
  } catch (error) {
    const postCreateAccount = await connection.getAccountInfo(
      ataPublicKey,
      SOLANA_COMMITMENT,
    );

    if (!postCreateAccount) {
      throw error;
    }
  }

  return {
    ownerAddress: normalizedOwnerAddress,
    ataAddress,
    created: true,
    sponsored: true,
  };
};

export async function POST(request: NextRequest) {
  try {
    if (!isSolanaBridgeEnabled()) {
      return NextResponse.json(
        { success: false, error: "Solana bridging is temporarily disabled." },
        { status: 503 },
      );
    }

    const { walletAddress, chainId: requestedChainId } = (await request
      .json()
      .catch(() => ({}))) as {
      walletAddress?: string;
      chainId?: string;
    };

    const chainId = isSolanaMainnetChain(requestedChainId)
      ? "solana-mainnet"
      : "solana";

    const normalizedWalletAddress =
      typeof walletAddress === "string"
        ? normalizeSolanaAddress(walletAddress)
        : "";

    if (!normalizedWalletAddress || !isValidSolanaAddress(normalizedWalletAddress)) {
      return NextResponse.json(
        { success: false, error: "A valid Solana wallet address is required." },
        { status: 400 },
      );
    }

    const preparedRecipient = await ensureRecipientUsdcAccount(
      normalizedWalletAddress,
      chainId,
    );

    return NextResponse.json({
      success: true,
      ownerAddress: preparedRecipient.ownerAddress,
      ataAddress: preparedRecipient.ataAddress,
      created: preparedRecipient.created,
      sponsored: preparedRecipient.sponsored,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to prepare the Solana receiving wallet right now.";

    console.error("Failed to prepare Solana bridge recipient:", error);

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 },
    );
  }
}