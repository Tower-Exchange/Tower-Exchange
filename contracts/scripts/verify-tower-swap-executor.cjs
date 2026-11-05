const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { verifyOnArcscan } = require("./lib/verifyOnArcscan.cjs");

const TESTNET_TOWER_SWAP_EXECUTOR =
  "0x2De8906a641d65d490bC60A4179d961d59742bCb";

function sameAddress(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function main() {
  const saved = readJson(
    path.join(
      __dirname,
      "..",
      "deployments",
      hre.network.name === "arc-testnet"
        ? "tower-swap-executor-deployment.json"
        : `tower-swap-executor-${hre.network.name}-deployment.json`,
    ),
  );
  const savedV2 = readJson(
    path.join(
      __dirname,
      "..",
      "deployments",
      `tower-swap-executor-v2-${hre.network.name}-deployment.json`,
    ),
  );

  const savedAddress = saved?.executor;
  const envAddress = process.env.TOWER_SWAP_EXECUTOR_ADDRESS;
  const address =
    hre.network.name === "arc-mainnet" &&
    sameAddress(envAddress, TESTNET_TOWER_SWAP_EXECUTOR)
      ? savedAddress
      : envAddress || savedAddress;
  const constructorTreasury =
    saved?.constructorTreasury ||
    (hre.network.name === "arc-mainnet"
      ? saved?.deployer
      : process.env.TOWER_SWAP_EXECUTOR_TREASURY ||
        process.env.TREASURY_ADDRESS ||
        saved?.treasury);
  const owner =
    saved?.constructorOwner ||
    (hre.network.name === "arc-mainnet"
      ? saved?.deployer || saved?.owner
      : process.env.OWNER_ADDRESS || saved?.owner);
  const feeBps = Number(
    process.env.TOWER_SWAP_EXECUTOR_FEE_BPS || saved?.feeBps || "25",
  );

  if (
    hre.network.name === "arc-mainnet" &&
    sameAddress(envAddress, TESTNET_TOWER_SWAP_EXECUTOR)
  ) {
    console.warn(
      "Ignoring testnet TOWER_SWAP_EXECUTOR_ADDRESS from env. Using the saved mainnet executor.",
    );
  }

  if (!address) {
    throw new Error(
      "Set TOWER_SWAP_EXECUTOR_ADDRESS or deploy first so the mainnet deployment JSON exists.",
    );
  }

  if (sameAddress(address, savedV2?.executor)) {
    throw new Error(
      "This address is TowerSwapExecutorV2. Use npm run verify:tower-swap-executor:v2:mainnet instead of the legacy V1 verification command.",
    );
  }

  const status = await verifyOnArcscan(hre, {
    address,
    constructorArguments: [constructorTreasury, owner, feeBps],
    contract: "contracts/TowerSwapExecutor.sol:TowerSwapExecutor",
    label: "TowerSwapExecutor",
    license: "MIT",
  });

  if (saved) {
    fs.writeFileSync(
      path.join(
        __dirname,
        "..",
        "deployments",
        hre.network.name === "arc-testnet"
          ? "tower-swap-executor-deployment.json"
          : `tower-swap-executor-${hre.network.name}-deployment.json`,
      ),
      JSON.stringify({ ...saved, verificationStatus: status }, null, 2),
    );
  }

  console.log("Verification status:", status);
  if (status !== "verified" && status !== "skipped") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
