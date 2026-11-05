const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;

const ADAPTERS = [
  {
    key: "aero",
    label: "AeroAdapterV2",
    env: "AERO_ADAPTER_V2_MAINNET_ADDRESS",
    publicEnv: "NEXT_PUBLIC_AERO_ADAPTER_V2_MAINNET_ADDRESS",
    deployment: "aero-adapter-v2-arc-mainnet.json",
  },
  {
    key: "dzap",
    label: "DZapAdapterV2",
    env: "DZAP_ADAPTER_V2_MAINNET_ADDRESS",
    publicEnv: "NEXT_PUBLIC_DZAP_ADAPTER_V2_MAINNET_ADDRESS",
    deployment: "dzap-adapter-v2-arc-mainnet-deployment.json",
  },
  {
    key: "kyberswap",
    label: "KyberSwapAdapterV2",
    env: "KYBERSWAP_ADAPTER_V2_MAINNET_ADDRESS",
    publicEnv: "NEXT_PUBLIC_KYBERSWAP_ADAPTER_V2_MAINNET_ADDRESS",
    deployment: "kyberswap-adapter-v2-arc-mainnet-deployment.json",
  },
  {
    key: "uniswap",
    label: "UniswapAdapterV2",
    env: "UNISWAP_ADAPTER_V2_MAINNET_ADDRESS",
    publicEnv: "NEXT_PUBLIC_UNISWAP_ADAPTER_V2_MAINNET_ADDRESS",
    deployment: "uniswap-adapter-v2-arc-mainnet-deployment.json",
  },
];

function readDeployment(fileName) {
  const filePath = path.join(__dirname, "..", "deployments", fileName);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveAddress({ env, publicEnv, deployment }) {
  return process.env[env] || process.env[publicEnv] || readDeployment(deployment)?.adapter;
}

async function main() {
  if (hre.network.name !== "arc-mainnet") {
    throw new Error("Run this preflight only with --network arc-mainnet.");
  }

  const executorAddress =
    process.env.TOWER_SWAP_EXECUTOR_V2_ADDRESS ||
    process.env.NEXT_PUBLIC_TOWER_SWAP_EXECUTOR_V2_ADDRESS;
  if (!ethers.isAddress(executorAddress || "")) {
    throw new Error("Set TOWER_SWAP_EXECUTOR_V2_ADDRESS to a valid address.");
  }

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 5042n) {
    throw new Error(`Expected Arc mainnet (5042), received chain ${network.chainId}.`);
  }
  if ((await ethers.provider.getCode(executorAddress)) === "0x") {
    throw new Error(`No contract code at TowerSwapExecutorV2 ${executorAddress}.`);
  }

  const executor = await ethers.getContractAt("TowerSwapExecutorV2", executorAddress);
  const [owner, paused, treasury, feeBps] = await Promise.all([
    executor.owner(),
    executor.paused(),
    executor.treasury(),
    executor.platformFeeBps(),
  ]);

  console.log("Arc mainnet V2 swap preflight");
  console.log(`Executor: ${executorAddress}`);
  console.log(`Owner: ${owner}`);
  console.log(`Treasury: ${treasury}`);
  console.log(`Platform fee: ${feeBps.toString()} bps`);
  console.log(`Paused: ${paused}`);

  let failed = Boolean(paused);
  for (const definition of ADAPTERS) {
    const address = resolveAddress(definition);
    if (!ethers.isAddress(address || "")) {
      console.log(`${definition.label}: MISSING ADDRESS`);
      failed = true;
      continue;
    }

    const [code, routeTarget, approvalSpender] = await Promise.all([
      ethers.provider.getCode(address),
      executor.routeTargets(address),
      executor.approvalSpenders(address),
    ]);
    const ready = code !== "0x" && routeTarget && approvalSpender;
    console.log(
      `${definition.label}: ${ready ? "READY" : "NOT READY"} (${address}) — code=${code !== "0x"}, routeTarget=${routeTarget}, approvalSpender=${approvalSpender}`,
    );
    if (!ready) failed = true;
  }

  if (failed) {
    throw new Error("V2 preflight failed. Do not send a live swap until every required adapter is READY and the executor is unpaused.");
  }
  console.log("V2 preflight passed. No transaction was sent.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
