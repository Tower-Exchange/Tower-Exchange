import {
  createPublicClient,
  erc20Abi,
  hexToBigInt,
  http,
  parseAbi,
  parseErc6492Signature,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { toAccount } from "viem/accounts";
import {
  createBundlerClient,
  entryPoint07Address,
  type SmartAccount,
  type UserOperation,
} from "viem/account-abstraction";
import { arbitrum, arbitrumSepolia, base, baseSepolia } from "viem/chains";
import { toSafeSmartAccount } from "permissionless/accounts";
import { getRequiredPrefund } from "permissionless/utils";
import {
  PAYMASTER_PERMIT_ALLOWANCE,
  PAYMASTER_POST_OP_GAS_LIMIT,
  PAYMASTER_VERIFICATION_GAS_LIMIT,
  USER_OPERATION_TIMEOUT_MS,
  getPaymasterChain,
  type PaymasterChainConfig,
  type PaymasterChainKey,
} from "./config";
import {
  buildPermitTypedData,
  calculateTokenPrefund,
  encodePaymasterData,
  encodePaymasterDataWithoutPermit,
  needsNewPermit,
} from "./permit";

// Safe smart account (ERC-4337 v0.7) owned by the connected wallet. It pays gas
// to Circle Paymaster in USDC, so it has to hold the USDC it spends.

const VIEM_CHAINS: Record<PaymasterChainKey, Chain> = {
  base,
  arbitrum,
  "base-sepolia": baseSepolia,
  "arbitrum-sepolia": arbitrumSepolia,
};

const SAFE_VERSION = "1.4.1" as const;
const ENTRY_POINT = { address: entryPoint07Address, version: "0.7" } as const;
const MIN_USDC_FOR_OPERATION = 50_000n; // 0.05 USDC, just to fail fast

const usdcPermitAbi = [
  ...erc20Abi,
  ...parseAbi([
    "function nonces(address owner) view returns (uint256)",
    "function version() view returns (string)",
  ]),
] as const;

const paymasterAbi = parseAbi([
  "function fetchPrice() view returns (uint256)",
  "function additionalGasCharge() view returns (uint32)",
  "function feeSpread() view returns (uint32)",
]);

const NOT_ENOUGH_USDC =
  "Not enough USDC in your Gas Account for the amount and the gas fee.";

export type GasAccountCall = {
  to: Address;
  data?: Hex;
  value?: bigint;
};

export type GasAccountErrorCode =
  | "unsupported-chain"
  | "wallet-unavailable"
  | "insufficient-usdc"
  | "insufficient-allowance"
  | "bundler-unavailable"
  | "operation-reverted"
  | "timeout";

export class GasAccountError extends Error {
  code: GasAccountErrorCode;

  constructor(code: GasAccountErrorCode, message: string) {
    super(message);
    this.name = "GasAccountError";
    this.code = code;
  }
}

export type GasAccountContext = {
  chain: PaymasterChainConfig;
  publicClient: PublicClient;
  account: SmartAccount;
  address: Address;
};

export type SendUserOperationResult = {
  userOpHash: Hex;
  transactionHash: Hex;
};

const requireChain = (chainKey: string): PaymasterChainConfig => {
  const chain = getPaymasterChain(chainKey);
  if (!chain) {
    throw new GasAccountError(
      "unsupported-chain",
      "Gas in USDC isn't available on this network.",
    );
  }

  return chain;
};

const publicClients = new Map<number, PublicClient>();

export const getGasAccountPublicClient = (
  chain: PaymasterChainConfig,
): PublicClient => {
  const cached = publicClients.get(chain.chainId);
  if (cached) {
    return cached;
  }

  const client = createPublicClient({
    chain: VIEM_CHAINS[chain.key],
    transport: http(`/api/rpc/${chain.chainId}`, {
      retryCount: 3,
      timeout: 60_000,
    }),
    pollingInterval: 2_000,
  }) as PublicClient;
  publicClients.set(chain.chainId, client);
  return client;
};

// Passing the wallet client straight to permissionless makes it ask the wallet
// for its accounts again, so wrap it as a signer for the connected address.
const walletClientToOwner = (walletClient: WalletClient, account: Account) =>
  toAccount({
    address: account.address,
    async signMessage({ message }) {
      return walletClient.signMessage({ account, message });
    },
    async signTypedData(typedData) {
      return walletClient.signTypedData({
        ...(typedData as object),
        account,
      } as never);
    },
    async signTransaction() {
      throw new Error("The Gas Account owner never signs transactions.");
    },
  });

export const createGasAccountContext = async (params: {
  chainKey: string;
  walletClient: WalletClient | null | undefined;
}): Promise<GasAccountContext> => {
  const chain = requireChain(params.chainKey);
  const walletClient = params.walletClient;

  if (!walletClient?.account) {
    throw new GasAccountError(
      "wallet-unavailable",
      "Connect your wallet first.",
    );
  }

  const publicClient = getGasAccountPublicClient(chain);
  const account = await toSafeSmartAccount({
    client: publicClient,
    owners: [walletClientToOwner(walletClient, walletClient.account)],
    version: SAFE_VERSION,
    entryPoint: ENTRY_POINT,
  });

  return {
    chain,
    publicClient,
    account: account as unknown as SmartAccount,
    address: account.address,
  };
};

const addressCache = new Map<string, Address>();

const readOnlyOwner = (address: Address) => {
  const fail = async () => {
    throw new Error("Read-only owner cannot sign.");
  };

  return toAccount({
    address,
    signMessage: fail,
    signTransaction: fail,
    signTypedData: fail,
  });
};

// The address only depends on the owner, so no wallet signature is needed.
export const getGasAccountAddress = async (params: {
  chainKey: string;
  ownerAddress: Address;
}): Promise<Address> => {
  const chain = requireChain(params.chainKey);
  const cacheKey = `${chain.chainId}:${params.ownerAddress.toLowerCase()}`;
  const cached = addressCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const account = await toSafeSmartAccount({
    client: getGasAccountPublicClient(chain),
    owners: [readOnlyOwner(params.ownerAddress)],
    version: SAFE_VERSION,
    entryPoint: ENTRY_POINT,
  });
  addressCache.set(cacheKey, account.address);
  return account.address;
};

export const getGasAccountUsdcBalance = async (params: {
  chainKey: string;
  address: Address;
}): Promise<bigint> => {
  const chain = requireChain(params.chainKey);
  return getGasAccountPublicClient(chain).readContract({
    address: chain.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [params.address],
  });
};

const signPermit = async (context: GasAccountContext): Promise<Hex> => {
  const { chain, publicClient, account, address } = context;
  const [nonce, tokenName, tokenVersion] = await Promise.all([
    publicClient.readContract({
      address: chain.usdc,
      abi: usdcPermitAbi,
      functionName: "nonces",
      args: [address],
    }),
    publicClient.readContract({
      address: chain.usdc,
      abi: usdcPermitAbi,
      functionName: "name",
    }),
    publicClient
      .readContract({
        address: chain.usdc,
        abi: usdcPermitAbi,
        functionName: "version",
      })
      .catch(() => "2"),
  ]);

  const typedData = buildPermitTypedData({
    tokenName,
    tokenVersion,
    chainId: chain.chainId,
    token: chain.usdc,
    owner: address,
    spender: chain.paymaster,
    value: PAYMASTER_PERMIT_ALLOWANCE,
    nonce,
  });

  // The paymaster wants the inner signature; the 6492 wrapper only appears
  // while the account isn't deployed yet.
  const wrapped = await account.signTypedData(typedData);
  return parseErc6492Signature(wrapped).signature;
};

const bundlerUrl = (chain: PaymasterChainConfig) =>
  `/api/bundler/${chain.chainId}`;

const estimateFeesPerGas = async (context: GasAccountContext) => {
  try {
    const response = await fetch(bundlerUrl(context.chain), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "pimlico_getUserOperationGasPrice",
        params: [],
      }),
    });
    const json = (await response.json()) as {
      result?: {
        standard?: { maxFeePerGas?: Hex; maxPriorityFeePerGas?: Hex };
      };
    };
    const standard = json.result?.standard;
    if (standard?.maxFeePerGas && standard.maxPriorityFeePerGas) {
      return {
        maxFeePerGas: hexToBigInt(standard.maxFeePerGas),
        maxPriorityFeePerGas: hexToBigInt(standard.maxPriorityFeePerGas),
      };
    }
  } catch {
    // Not a Pimlico bundler, use the chain's own estimate.
  }

  const fees = await context.publicClient.estimateFeesPerGas();
  return {
    maxFeePerGas: (fees.maxFeePerGas * 12n) / 10n,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n,
  };
};

export const isUserRejection = (error: unknown) => {
  const record = error as { code?: unknown; name?: unknown; message?: unknown };
  const message = typeof record?.message === "string" ? record.message : "";
  return (
    record?.code === 4001 ||
    record?.name === "UserRejectedRequestError" ||
    /user (rejected|denied)/i.test(message)
  );
};

const mapOperationError = (error: unknown): unknown => {
  if (isUserRejection(error) || error instanceof GasAccountError) {
    return error;
  }

  const message = [
    (error as { shortMessage?: string })?.shortMessage,
    (error as { details?: string })?.details,
    (error as Error)?.message,
  ]
    .filter(Boolean)
    .join(" ");

  if (/transfer amount exceeds balance|insufficient (funds|balance)/i.test(message)) {
    return new GasAccountError("insufficient-usdc", NOT_ENOUGH_USDC);
  }

  if (/exceeds allowance|insufficient allowance/i.test(message)) {
    return new GasAccountError(
      "insufficient-allowance",
      "The gas allowance ran out. Try again to sign a new one.",
    );
  }

  if (/timed out|timeout/i.test(message)) {
    return new GasAccountError(
      "timeout",
      "This is taking longer than expected and may still confirm. Check your Gas Account balance before retrying.",
    );
  }

  if (/failed to fetch|network|bundler|fetch failed/i.test(message)) {
    return new GasAccountError(
      "bundler-unavailable",
      "Couldn't reach the bundler. Try again in a moment.",
    );
  }

  return error;
};

// Sends one user operation from the Gas Account and waits until it is mined.
export const sendGasAccountUserOperation = async (
  context: GasAccountContext,
  calls: GasAccountCall[],
): Promise<SendUserOperationResult> => {
  const { chain, publicClient, account, address } = context;

  if (calls.length === 0) {
    throw new Error("No calls to send from the Gas Account.");
  }

  try {
    const [balance, allowance] = await Promise.all([
      getGasAccountUsdcBalance({ chainKey: chain.key, address }),
      publicClient.readContract({
        address: chain.usdc,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, chain.paymaster],
      }),
    ]);

    if (balance < MIN_USDC_FOR_OPERATION) {
      throw new GasAccountError(
        "insufficient-usdc",
        "Your Gas Account has no USDC to pay gas with. Deposit USDC first.",
      );
    }

    const permitRequired = needsNewPermit(allowance);

    const paymaster = {
      async getPaymasterData() {
        const common = {
          paymaster: chain.paymaster,
          paymasterVerificationGasLimit: PAYMASTER_VERIFICATION_GAS_LIMIT,
          paymasterPostOpGasLimit: PAYMASTER_POST_OP_GAS_LIMIT,
          isFinal: true,
        };

        if (!permitRequired) {
          return {
            ...common,
            paymasterData: encodePaymasterDataWithoutPermit(),
          };
        }

        return {
          ...common,
          paymasterData: encodePaymasterData({
            token: chain.usdc,
            permitAmount: PAYMASTER_PERMIT_ALLOWANCE,
            permitSignature: await signPermit(context),
          }),
        };
      },
    };

    const bundlerClient = createBundlerClient({
      account,
      client: publicClient,
      paymaster,
      transport: http(bundlerUrl(chain), { retryCount: 1, timeout: 60_000 }),
      userOperation: {
        estimateFeesPerGas: () => estimateFeesPerGas(context),
      },
    });

    const userOperation = (await bundlerClient.prepareUserOperation({
      calls: calls.map((call) => ({
        to: call.to,
        data: call.data,
        value: call.value ?? 0n,
      })),
    })) as unknown as UserOperation<"0.7">;

    // Check the balance covers the USDC prefund before asking for the
    // second signature.
    try {
      const [price, additionalGasCharge, feeSpread] = await Promise.all([
        publicClient.readContract({
          address: chain.paymaster,
          abi: paymasterAbi,
          functionName: "fetchPrice",
        }),
        publicClient.readContract({
          address: chain.paymaster,
          abi: paymasterAbi,
          functionName: "additionalGasCharge",
        }),
        publicClient.readContract({
          address: chain.paymaster,
          abi: paymasterAbi,
          functionName: "feeSpread",
        }),
      ]);

      const prefund = calculateTokenPrefund({
        nativeTokenPrice: price,
        additionalGasCharge: BigInt(additionalGasCharge),
        feeSpreadBips: BigInt(feeSpread),
        maxFeePerGas: userOperation.maxFeePerGas,
        maxCost: getRequiredPrefund({
          userOperation,
          entryPointVersion: "0.7",
        }),
      });

      if (balance < prefund) {
        throw new GasAccountError("insufficient-usdc", NOT_ENOUGH_USDC);
      }
    } catch (error) {
      if (error instanceof GasAccountError) {
        throw error;
      }
    }

    const signature = await account.signUserOperation(userOperation);
    const userOpHash = await bundlerClient.sendUserOperation({
      ...userOperation,
      signature,
    } as Parameters<typeof bundlerClient.sendUserOperation>[0]);

    const receipt = await bundlerClient.waitForUserOperationReceipt({
      hash: userOpHash,
      timeout: USER_OPERATION_TIMEOUT_MS,
    });

    if (!receipt.success) {
      throw new GasAccountError(
        "operation-reverted",
        receipt.reason
          ? `The Gas Account transaction reverted: ${receipt.reason}`
          : "The Gas Account transaction reverted.",
      );
    }

    return { userOpHash, transactionHash: receipt.receipt.transactionHash };
  } catch (error) {
    throw mapOperationError(error);
  }
};
