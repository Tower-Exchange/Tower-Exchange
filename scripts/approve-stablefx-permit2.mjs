#!/usr/bin/env node

import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Circle's tradable quote remains authoritative. This is the Permit2 contract
// returned by the current Arc StableFX quote payloads and is verified again by
// the StableFX order service before every trade.
const CIRCLE_PERMIT2_ADDRESS = getAddress(
  "0x000000000022D473030F116dDEE9F6B43aC78BA3",
);

// Target the token/proxy address, never an implementation/logic contract.
// The contracts expose the standard ERC-20 selector through their proxy
// fallback even when an explorer only shows proxy administration functions.
const STABLEFX_TOKENS = {
  USDC: {
    address: getAddress("0x3600000000000000000000000000000000000000"),
    decimals: 6,
  },
  EURC: {
    address: getAddress("0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1"),
    decimals: 6,
  },
  GBPA: {
    address: getAddress("0xbBe6aAB0Ed76e90AeA0d1cd978EC231c8AdCDF8b"),
    decimals: 6,
  },
  MXNB: {
    address: getAddress("0xF197FFC28c23E0309B5559e7a166f2c6164C80aA"),
    decimals: 6,
  },
  AUDF: {
    address: getAddress("0xd2a530170D71a9Cfe1651Fb468E2B98F7Ed7456b"),
    decimals: 6,
  },
};

const ARC_MAINNET = {
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
};

function printUsage() {
  console.log(`
Approve one StableFX input token for Circle Permit2 on Arc mainnet.

Usage:
  npm run approve:stablefx -- --token USDC --amount 3
  npm run approve:stablefx -- --token USDC --amount 3 --execute

Arguments:
  --token   One of: ${Object.keys(STABLEFX_TOKENS).join(", ")}
  --amount  Human token amount, e.g. 3 or 1000.25 (all supported tokens use 6 decimals)
  --execute Broadcast the approval. Omit for a safe dry run.

The script loads .env.local locally when the variables are not already present.
It uses CIRCLE_STABLEFX_TAKER_ADDRESS and CIRCLE_STABLEFX_TAKER_PRIVATE_KEY.
`);
}

function parseArguments(args) {
  const values = { execute: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--execute") {
      values.execute = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      values.help = true;
      continue;
    }
    if (argument === "--token" || argument === "--amount") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      values[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return values;
}

function loadLocalEnvironment() {
  if (process.env.CIRCLE_STABLEFX_TAKER_PRIVATE_KEY) return;
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Railway injects variables directly; a local file is optional there.
  }
}

function requiredAddress(value, label) {
  if (!value || !isAddress(value)) throw new Error(`Missing or invalid ${label}.`);
  return getAddress(value);
}

function requiredPrivateKey(value) {
  const normalized = value?.startsWith("0x") ? value : `0x${value ?? ""}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error("Missing or invalid CIRCLE_STABLEFX_TAKER_PRIVATE_KEY.");
  }
  return normalized;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (!options.token || !options.amount) {
    printUsage();
    throw new Error("Both --token and --amount are required.");
  }

  const tokenSymbol = options.token.toUpperCase();
  const token = STABLEFX_TOKENS[tokenSymbol];
  if (!token) {
    throw new Error(`Unsupported StableFX token: ${options.token}.`);
  }
  if (!/^\d+(?:\.\d{1,6})?$/.test(options.amount) || Number(options.amount) <= 0) {
    throw new Error("--amount must be a positive number with no more than 6 decimal places.");
  }

  loadLocalEnvironment();
  const configuredAddress = requiredAddress(
    process.env.CIRCLE_STABLEFX_TAKER_ADDRESS,
    "CIRCLE_STABLEFX_TAKER_ADDRESS",
  );
  const account = privateKeyToAccount(requiredPrivateKey(process.env.CIRCLE_STABLEFX_TAKER_PRIVATE_KEY));
  if (account.address.toLowerCase() !== configuredAddress.toLowerCase()) {
    throw new Error(
      "CIRCLE_STABLEFX_TAKER_PRIVATE_KEY does not match CIRCLE_STABLEFX_TAKER_ADDRESS.",
    );
  }

  const rpcUrl =
    process.env.ARC_MAINNET_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL?.trim() ||
    process.env.ARC_MAINNET_ALCHEMY_RPC_URL?.trim() ||
    "https://rpc.mainnet.arc.io";
  const publicClient = createPublicClient({
    chain: ARC_MAINNET,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: ARC_MAINNET,
    transport: http(rpcUrl),
  });
  const requestedAmount = parseUnits(options.amount, token.decimals);
  const [currentAllowance, balance] = await Promise.all([
    publicClient.readContract({
      address: token.address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, CIRCLE_PERMIT2_ADDRESS],
    }),
    publicClient.readContract({
      address: token.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    }),
  ]);

  console.log(`Token: ${tokenSymbol} (${token.address})`);
  console.log(`Owner: ${account.address}`);
  console.log(`Permit2 spender: ${CIRCLE_PERMIT2_ADDRESS}`);
  console.log(`Current allowance: ${formatUnits(currentAllowance, token.decimals)} ${tokenSymbol}`);
  console.log(`Requested allowance: ${formatUnits(requestedAmount, token.decimals)} ${tokenSymbol}`);
  console.log(`Current balance: ${formatUnits(balance, token.decimals)} ${tokenSymbol}`);

  if (currentAllowance >= requestedAmount) {
    console.log("No transaction sent: the existing allowance already meets this amount.");
    return;
  }
  if (!options.execute) {
    console.log("Dry run only. Re-run with --execute to broadcast this approval.");
    return;
  }

  const { request } = await publicClient.simulateContract({
    account,
    address: token.address,
    abi: erc20Abi,
    functionName: "approve",
    args: [CIRCLE_PERMIT2_ADDRESS, requestedAmount],
  });
  const hash = await walletClient.writeContract(request);
  console.log(`Approval submitted: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Approval transaction reverted: ${hash}`);
  }
  const updatedAllowance = await publicClient.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, CIRCLE_PERMIT2_ADDRESS],
  });
  console.log(`Approval confirmed. Updated allowance: ${formatUnits(updatedAllowance, token.decimals)} ${tokenSymbol}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
