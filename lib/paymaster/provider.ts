import {
  getAddress,
  isAddress,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { getPaymasterChainById } from "./config";
import {
  GasAccountError,
  createGasAccountContext,
  isUserRejection,
  sendGasAccountUserOperation,
  type GasAccountContext,
} from "./gasAccount";

// EIP-1193 provider that stands in for the wallet in Circle's Bridge Kit
// adapter, so the kit's transactions go out from the Gas Account instead.

type RequestArguments = { method: string; params?: unknown };

export type RealWalletProvider = {
  request(args: RequestArguments): Promise<unknown>;
};

export type GasAccountProvider = {
  request(args: RequestArguments): Promise<unknown>;
  on(): void;
  removeListener(): void;
};

// The real wallet still has to be on the source chain to sign.
const DELEGATED_METHODS = new Set([
  "eth_chainId",
  "net_version",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
]);

type TransactionRequest = {
  from?: string;
  to?: string;
  data?: string;
  value?: string | number | bigint;
};

export const createGasAccountProvider = (options: {
  walletProvider: RealWalletProvider;
  walletClient: WalletClient;
  accountAddress: Address;
  // The kit turns provider errors into a generic "RPC endpoint" message, so the
  // real reason is passed out here.
  onError?: (error: Error) => void;
}): GasAccountProvider => {
  const { walletProvider, walletClient, accountAddress } = options;
  const contexts = new Map<number, Promise<GasAccountContext>>();

  const getContext = async () => {
    const chainIdHex = (await walletProvider.request({
      method: "eth_chainId",
    })) as string;
    const chain = getPaymasterChainById(Number(chainIdHex));
    if (!chain) {
      throw new GasAccountError(
        "unsupported-chain",
        "Gas in USDC isn't available on the connected network.",
      );
    }

    let pending = contexts.get(chain.chainId);
    if (!pending) {
      pending = createGasAccountContext({
        chainKey: chain.key,
        walletClient,
      }).then((context) => {
        if (context.address.toLowerCase() !== accountAddress.toLowerCase()) {
          throw new GasAccountError(
            "wallet-unavailable",
            "The connected wallet doesn't match this Gas Account. Reconnect and try again.",
          );
        }

        return context;
      });
      pending.catch(() => contexts.delete(chain.chainId));
      contexts.set(chain.chainId, pending);
    }

    return pending;
  };

  const sendTransaction = async (transaction: TransactionRequest) => {
    try {
      if (!transaction?.to || !isAddress(transaction.to)) {
        throw new Error("The Gas Account needs a recipient to send to.");
      }

      if (
        transaction.from &&
        (!isAddress(transaction.from) ||
          getAddress(transaction.from) !== getAddress(accountAddress))
      ) {
        throw new Error("Transaction sender doesn't match the Gas Account.");
      }

      const context = await getContext();
      const { transactionHash } = await sendGasAccountUserOperation(context, [
        {
          to: getAddress(transaction.to),
          data: transaction.data as Hex | undefined,
          value: transaction.value ? BigInt(transaction.value) : undefined,
        },
      ]);

      return transactionHash;
    } catch (error) {
      const message = isUserRejection(error)
        ? "Transaction rejected by wallet. Please check your wallet and try again."
        : ((error as { shortMessage?: string })?.shortMessage ??
          (error as Error)?.message);
      if (message) {
        options.onError?.(new Error(message));
      }

      throw error;
    }
  };

  const request = async ({ method, params }: RequestArguments) => {
    if (DELEGATED_METHODS.has(method)) {
      return walletProvider.request({ method, params });
    }

    switch (method) {
      case "eth_accounts":
      case "eth_requestAccounts":
        return [accountAddress];

      case "eth_sendTransaction": {
        const [transaction] = (params ?? []) as TransactionRequest[];
        return sendTransaction(transaction);
      }

      default:
        // 4200 is the standard "unsupported method" code.
        throw Object.assign(
          new Error(`The Gas Account doesn't support ${method}.`),
          { code: 4200 },
        );
    }
  };

  return {
    request,
    on: () => undefined,
    removeListener: () => undefined,
  };
};
