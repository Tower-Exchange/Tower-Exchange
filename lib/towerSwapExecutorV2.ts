import {
  encodeFunctionData,
  getAddress,
  isAddress,
  type Address,
  type Hex,
} from "viem";

export type TowerSwapExecutionParams = {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  recipient: Address;
  routeTarget: Address;
  approvalSpender: Address;
  routeCalldata: Hex;
};

const resolveV2Address = (): Address | null => {
  const candidate =
    process.env.NEXT_PUBLIC_TOWER_SWAP_EXECUTOR_V2_ADDRESS ||
    process.env.TOWER_SWAP_EXECUTOR_V2_ADDRESS;

  return candidate && isAddress(candidate) ? getAddress(candidate) : null;
};

/**
 * A V2 address is opt-in so a deployed frontend keeps using the legacy
 * executor until the new contract has been deployed and configured.
 */
export const getTowerSwapExecutorV2Address = resolveV2Address;
export const isTowerSwapExecutorV2Enabled = () => Boolean(resolveV2Address());

export const TOWER_SWAP_EXECUTOR_READ_ABI = [
  {
    type: "function",
    name: "routeTargets",
    stateMutability: "view",
    inputs: [{ name: "target", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "approvalSpenders",
    stateMutability: "view",
    inputs: [{ name: "spender", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "platformFeeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "treasury",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const EXECUTE_SWAP_V1_ABI = [
  {
    type: "function",
    name: "executeSwap",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "minAmountOut", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "routeTarget", type: "address" },
          { name: "approvalSpender", type: "address" },
          { name: "routeCalldata", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "feeAmount", type: "uint256" },
      { name: "inputRefund", type: "uint256" },
    ],
  },
] as const;

const EXECUTE_SWAP_V2_ABI = [
  {
    type: "function",
    name: "executeSwap",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "minAmountOut", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "routeTarget", type: "address" },
          { name: "approvalSpender", type: "address" },
          { name: "routeCalldata", type: "bytes" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "feeAmount", type: "uint256" },
      { name: "inputRefund", type: "uint256" },
    ],
  },
] as const;

/** Encodes the legacy or V2 ABI without breaking the active legacy deployment. */
export const encodeTowerSwapExecution = (
  params: TowerSwapExecutionParams,
  deadline: bigint,
): Hex => {
  if (isTowerSwapExecutorV2Enabled()) {
    return encodeFunctionData({
      abi: EXECUTE_SWAP_V2_ABI,
      functionName: "executeSwap",
      args: [{ ...params, deadline }],
    });
  }

  return encodeFunctionData({
    abi: EXECUTE_SWAP_V1_ABI,
    functionName: "executeSwap",
    args: [params],
  });
};
