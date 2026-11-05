const { deployV2Adapter } = require("./lib/deployV2Adapter.cjs");

const DZAP_ROUTER = "0xb3926deF2e0989B0700a57034C9A211bfBcF858B";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

deployV2Adapter({
  contractName: "DZapAdapterV2",
  contractPath: "contracts/adapters/DZapAdapterV2.sol:DZapAdapterV2",
  label: "DZapAdapterV2",
  envName: "NEXT_PUBLIC_DZAP_ADAPTER_V2_MAINNET_ADDRESS",
  deploymentName: "dzap-adapter-v2",
  constructorArguments: (owner) => [DZAP_ROUTER, PERMIT2, owner],
  metadata: { dzapRouter: DZAP_ROUTER, permit2: PERMIT2 },
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
