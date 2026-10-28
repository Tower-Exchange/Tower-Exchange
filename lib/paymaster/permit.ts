import { encodePacked, type Address, type Hex, maxUint256 } from "viem";

export const PAYMASTER_MODE = 0;

// An existing allowance is reused (one less wallet prompt) while at least this
// much is left. The permit is decided before gas is estimated, so it's a fixed
// floor rather than a per-operation figure.
export const PAYMASTER_MIN_REUSABLE_ALLOWANCE = 5_000_000n; // 5 USDC

const BIPS_DENOMINATOR = 10_000n;
const ONE_ETHER = 10n ** 18n;

// The paymaster always calls permit() with the max deadline.
export const PERMIT_DEADLINE = maxUint256;

export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const buildPermitTypedData = (params: {
  tokenName: string;
  tokenVersion: string;
  chainId: number;
  token: Address;
  owner: Address;
  spender: Address;
  value: bigint;
  nonce: bigint;
}) => ({
  domain: {
    name: params.tokenName,
    version: params.tokenVersion,
    chainId: params.chainId,
    verifyingContract: params.token,
  },
  types: PERMIT_TYPES,
  primaryType: "Permit" as const,
  message: {
    owner: params.owner,
    spender: params.spender,
    value: params.value,
    nonce: params.nonce,
    deadline: PERMIT_DEADLINE,
  },
});

// paymasterData: mode (1 byte) | token (20) | permit amount (32) | signature.
// The contract only tries a permit when there is more than the mode byte.
export const encodePaymasterData = (params: {
  token: Address;
  permitAmount: bigint;
  permitSignature: Hex;
}): Hex =>
  encodePacked(
    ["uint8", "address", "uint256", "bytes"],
    [PAYMASTER_MODE, params.token, params.permitAmount, params.permitSignature],
  );

export const encodePaymasterDataWithoutPermit = (): Hex =>
  encodePacked(["uint8"], [PAYMASTER_MODE]);

// Same math as the paymaster's FeeLib. This much USDC is taken from the account
// before the operation runs and the unused part is refunded after.
export const calculateTokenPrefund = (params: {
  nativeTokenPrice: bigint;
  additionalGasCharge: bigint;
  feeSpreadBips: bigint;
  maxFeePerGas: bigint;
  maxCost: bigint;
}): bigint => {
  const finalGasCost =
    params.additionalGasCharge * params.maxFeePerGas + params.maxCost;
  const baseTokenAmount =
    (finalGasCost * params.nativeTokenPrice) / ONE_ETHER + 1n;
  const feeTokenAmount =
    (baseTokenAmount * params.feeSpreadBips) / BIPS_DENOMINATOR;

  return baseTokenAmount + feeTokenAmount;
};

export const needsNewPermit = (allowance: bigint): boolean =>
  allowance < PAYMASTER_MIN_REUSABLE_ALLOWANCE;
