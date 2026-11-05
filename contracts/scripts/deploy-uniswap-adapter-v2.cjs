const { deployV2Adapter } = require("./lib/deployV2Adapter.cjs");

const UNISWAP_UNIVERSAL_ROUTER = "0x8702463e73f74d0b6765aBceb314Ef07aCb92650";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

deployV2Adapter({
  contractName: "UniswapAdapterV2",
  contractPath: "contracts/adapters/UniswapAdapterV2.sol:UniswapAdapterV2",
  label: "UniswapAdapterV2",
  envName: "NEXT_PUBLIC_UNISWAP_ADAPTER_V2_MAINNET_ADDRESS",
  deploymentName: "uniswap-adapter-v2",
  constructorArguments: (owner) => [UNISWAP_UNIVERSAL_ROUTER, PERMIT2, owner],
  metadata: { universalRouter: UNISWAP_UNIVERSAL_ROUTER, permit2: PERMIT2 },
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
