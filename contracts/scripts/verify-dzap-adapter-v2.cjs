const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;
const { verifyOnArcscan } = require("./lib/verifyOnArcscan.cjs");

const DZAP_ROUTER = "0xb3926deF2e0989B0700a57034C9A211bfBcF858B";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

function readJson(filePath) {
  return fs.existsSync(filePath)
    ? JSON.parse(fs.readFileSync(filePath, "utf8"))
    : null;
}

async function main() {
  const deploymentFile = path.join(
    __dirname,
    "..",
    "deployments",
    `dzap-adapter-v2-${hre.network.name}-deployment.json`,
  );
  const saved = readJson(deploymentFile);
  const address =
    process.env.DZAP_ADAPTER_V2_ADDRESS ||
    process.env.NEXT_PUBLIC_DZAP_ADAPTER_V2_MAINNET_ADDRESS ||
    saved?.adapter;
  const owner = saved?.owner || process.env.OWNER_ADDRESS;

  if (!ethers.isAddress(address || "") || !ethers.isAddress(owner || "")) {
    throw new Error(
      "Set DZAP_ADAPTER_V2_ADDRESS (or NEXT_PUBLIC_DZAP_ADAPTER_V2_MAINNET_ADDRESS) and OWNER_ADDRESS, or first run the recovery command that creates the DZap V2 deployment JSON.",
    );
  }

  const status = await verifyOnArcscan(hre, {
    address,
    constructorArguments: [DZAP_ROUTER, PERMIT2, owner],
    contract: "contracts/adapters/DZapAdapterV2.sol:DZapAdapterV2",
    label: "DZapAdapterV2",
    license: "MIT",
  });

  if (saved) {
    fs.writeFileSync(
      deploymentFile,
      JSON.stringify({ ...saved, verificationStatus: status }, null, 2),
    );
  }

  console.log("Verification status:", status);
  if (status !== "verified" && status !== "skipped") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
