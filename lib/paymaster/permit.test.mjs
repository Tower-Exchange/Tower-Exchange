import test from "node:test";
import assert from "node:assert/strict";
import { getAddress, hexToBigInt, maxUint256, size, slice } from "viem";

import {
  PAYMASTER_MIN_REUSABLE_ALLOWANCE,
  buildPermitTypedData,
  calculateTokenPrefund,
  encodePaymasterData,
  encodePaymasterDataWithoutPermit,
  needsNewPermit,
} from "./permit.ts";
import {
  PAYMASTER_CHAINS,
  getPaymasterChain,
  getPaymasterChainById,
  isPaymasterChain,
} from "./config.ts";

const TOKEN = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const PAYMASTER = "0x31BE08D380A21fc740883c0BC434FcFc88740b58";
const SIGNATURE = `0x${"ab".repeat(65)}`;

// Offsets from Circle's BaseTokenPaymaster.sol
const TOKEN_OFFSET = 53;
const AMOUNT_OFFSET = TOKEN_OFFSET + 20;
const SIGNATURE_OFFSET = AMOUNT_OFFSET + 32;

const asPaymasterAndData = (paymasterData) =>
  `0x${PAYMASTER.slice(2)}${"00".repeat(32)}${paymasterData.slice(2)}`;

test("paymaster data with a permit matches the contract's parse offsets", () => {
  const data = asPaymasterAndData(
    encodePaymasterData({
      token: TOKEN,
      permitAmount: 10_000_000n,
      permitSignature: SIGNATURE,
    }),
  );

  assert.ok(size(data) > TOKEN_OFFSET);
  assert.equal(slice(data, TOKEN_OFFSET - 1, TOKEN_OFFSET), "0x00");
  assert.equal(
    getAddress(slice(data, TOKEN_OFFSET, AMOUNT_OFFSET)),
    getAddress(TOKEN),
  );
  assert.equal(
    hexToBigInt(slice(data, AMOUNT_OFFSET, SIGNATURE_OFFSET)),
    10_000_000n,
  );
  assert.equal(slice(data, SIGNATURE_OFFSET), SIGNATURE);
});

test("paymaster data without a permit is just the mode byte", () => {
  assert.equal(encodePaymasterDataWithoutPermit(), "0x00");
  assert.ok(
    size(asPaymasterAndData(encodePaymasterDataWithoutPermit())) <=
      TOKEN_OFFSET,
  );
});

test("permit typed data uses the maximum deadline the paymaster expects", () => {
  const typedData = buildPermitTypedData({
    tokenName: "USDC",
    tokenVersion: "2",
    chainId: 84532,
    token: TOKEN,
    owner: "0x1111111111111111111111111111111111111111",
    spender: PAYMASTER,
    value: 10_000_000n,
    nonce: 3n,
  });

  assert.equal(typedData.primaryType, "Permit");
  assert.equal(typedData.message.deadline, maxUint256);
  assert.equal(typedData.message.spender, PAYMASTER);
  assert.equal(typedData.message.nonce, 3n);
  assert.equal(typedData.domain.verifyingContract, TOKEN);
  assert.equal(typedData.domain.chainId, 84532);
});

test("token prefund mirrors the paymaster's fee calculation", () => {
  // base = (35,000 * 1 gwei + 5e14) * 2000e6 / 1e18 + 1 = 1,070,001
  // fee at 1000 bips = 107,000
  assert.equal(
    calculateTokenPrefund({
      nativeTokenPrice: 2_000_000_000n,
      additionalGasCharge: 35_000n,
      feeSpreadBips: 1_000n,
      maxFeePerGas: 1_000_000_000n,
      maxCost: 500_000_000_000_000n,
    }),
    1_177_001n,
  );

  assert.equal(
    calculateTokenPrefund({
      nativeTokenPrice: 2_000_000_000n,
      additionalGasCharge: 35_000n,
      feeSpreadBips: 0n,
      maxFeePerGas: 1_000_000_000n,
      maxCost: 500_000_000_000_000n,
    }),
    1_070_001n,
  );
});

test("a new permit is requested only when the allowance is below the reuse floor", () => {
  assert.equal(needsNewPermit(0n), true);
  assert.equal(needsNewPermit(PAYMASTER_MIN_REUSABLE_ALLOWANCE - 1n), true);
  assert.equal(needsNewPermit(PAYMASTER_MIN_REUSABLE_ALLOWANCE), false);
  assert.equal(needsNewPermit(10_000_000n), false);
});

test("every configured chain has checksummed, distinct addresses and ids", () => {
  const chains = Object.values(PAYMASTER_CHAINS);
  const ids = new Set(chains.map((chain) => chain.chainId));
  assert.equal(ids.size, chains.length);

  for (const chain of chains) {
    assert.equal(getAddress(chain.usdc), chain.usdc);
    assert.equal(getAddress(chain.paymaster), chain.paymaster);
    assert.equal(getPaymasterChainById(chain.chainId)?.key, chain.key);
    assert.equal(getPaymasterChain(chain.key)?.chainId, chain.chainId);
  }
});

test("only the supported source chains are paymaster chains", () => {
  for (const key of ["base", "arbitrum", "base-sepolia", "arbitrum-sepolia"]) {
    assert.equal(isPaymasterChain(key), true, key);
  }

  for (const key of ["arc", "arc-testnet", "ethereum", "solana", "linea", "", null]) {
    assert.equal(isPaymasterChain(key), false, String(key));
  }
});
