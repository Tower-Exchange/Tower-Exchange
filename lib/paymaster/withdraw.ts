import {
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type WalletClient,
} from "viem";
import {
  GasAccountError,
  createGasAccountContext,
  sendGasAccountUserOperation,
  type SendUserOperationResult,
} from "./gasAccount";
import { getPaymasterChain } from "./config";

// Sends USDC from the Gas Account back to the owner wallet.
export const withdrawUsdcFromGasAccount = async (params: {
  chainKey: string;
  walletClient: WalletClient;
  amount: bigint;
}): Promise<SendUserOperationResult> => {
  const chain = getPaymasterChain(params.chainKey);
  if (!chain) {
    throw new GasAccountError(
      "unsupported-chain",
      "Gas in USDC isn't available on this network.",
    );
  }

  const owner = params.walletClient.account?.address;
  if (!owner) {
    throw new GasAccountError(
      "wallet-unavailable",
      "Connect your wallet first.",
    );
  }

  if (params.amount <= 0n) {
    throw new Error("Enter an amount greater than zero.");
  }

  const context = await createGasAccountContext({
    chainKey: params.chainKey,
    walletClient: params.walletClient,
  });

  return sendGasAccountUserOperation(context, [
    {
      to: chain.usdc,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [getAddress(owner), params.amount],
      }),
    },
  ]);
};
