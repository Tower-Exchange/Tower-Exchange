const { deployV2Adapter } = require("./lib/deployV2Adapter.cjs");

const KYBER_ROUTER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";
const KYBER_EXECUTOR = "0x8F10B468b06c6FD214B65F87778827F7D113f996";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

deployV2Adapter({
  contractName: "KyberSwapAdapterV2",
  contractPath: "contracts/adapters/KyberSwapAdapterV2.sol:KyberSwapAdapterV2",
  label: "KyberSwapAdapterV2",
  envName: "NEXT_PUBLIC_KYBERSWAP_ADAPTER_V2_MAINNET_ADDRESS",
  deploymentName: "kyberswap-adapter-v2",
  constructorArguments: (owner) => [KYBER_ROUTER, KYBER_EXECUTOR, PERMIT2, owner],
  metadata: {
    kyberRouter: KYBER_ROUTER,
    aggregationExecutor: KYBER_EXECUTOR,
    permit2: PERMIT2,
  },
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
