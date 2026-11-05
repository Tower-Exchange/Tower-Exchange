const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");
require("dotenv").config();

const { isTransientRpcError, sendAndWait } = require("./lib/waitForTx.cjs");
const { MAINNET_TREASURY } = require("./lib/mainnetAddresses.cjs");

const TESTNET_TOWER_DEX_ROUTER = "0xDf115b4f2F22B9255B2E63348423B6C5B379Bce2";
const TESTNET_TOWER_SWAP_EXECUTOR =
  "0x2De8906a641d65d490bC60A4179d961d59742bCb";
const SYNTHRA_MAINNET = {
  universalRouter: "0xe4C51D643A7d6D94be2646e482C59CF681B7AcEB",
  swapRouter02: "0xa50eDe66a573eE5bB37E28AF5789B76aE5FEb828",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
};

function splitAddresses(value) {
  return String(value || "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
}

function validateAddress(name, value) {
  if (!ethers.isAddress(value)) {
    throw new Error(`${name} must be a valid 0x address. Received: ${value}`);
  }
}

function sameAddress(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function isTestnetAddress(address) {
  return (
    sameAddress(address, TESTNET_TOWER_DEX_ROUTER) ||
    sameAddress(address, TESTNET_TOWER_SWAP_EXECUTOR)
  );
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function isStaleMainnetTreasury(address) {
  return (
    !address ||
    isTestnetAddress(address) ||
    sameAddress(address, "0xe71dD45E7d21409b04b609D0E6C67FFff592d43d") ||
    sameAddress(address, "0x6396DfE7949c785Ab8b3e4634d0c9aB97d700a4B")
  );
}

function resolveTreasury() {
  const fromEnv =
    process.env.TOWER_SWAP_EXECUTOR_TREASURY ||
    process.env.TREASURY_ADDRESS ||
    process.env.TOWER_TREASURY_ADDRESS;

  if (network.name !== "arc-mainnet") {
    return fromEnv || "";
  }

  if (fromEnv && ethers.isAddress(fromEnv) && !isStaleMainnetTreasury(fromEnv)) {
    return fromEnv;
  }

  return MAINNET_TREASURY;
}

function executorDeploymentFile() {
  return path.join(
    __dirname,
    "..",
    "deployments",
    "tower-swap-executor-arc-mainnet-deployment.json",
  );
}

function saveMainnetExecutorTreasury(treasury) {
  const saved = savedMainnetExecutor();
  if (!saved) {
    return;
  }

  fs.writeFileSync(
    executorDeploymentFile(),
    JSON.stringify(
      {
        ...saved,
        constructorTreasury:
          saved.constructorTreasury || saved.deployer || saved.treasury,
        constructorOwner: saved.constructorOwner || saved.owner,
        treasury,
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

function saveMainnetFactoryFeeTo(treasury) {
  const file = path.join(
    __dirname,
    "..",
    "..",
    "Tower-AMM",
    "deployments",
    "arc-mainnet.json",
  );
  const saved = readJson(file);
  if (!saved) {
    return;
  }

  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        ...saved,
        feeTo: treasury,
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

async function setExecutorTreasury(executor, treasury) {
  if (!treasury) {
    return;
  }

  validateAddress("treasury", treasury);
  const current = await executor.treasury();
  if (sameAddress(current, treasury)) {
    console.log("Executor treasury already set:", treasury);
    if (network.name === "arc-mainnet") {
      saveMainnetExecutorTreasury(treasury);
    }
    return;
  }

  await sendAndWait(
    executor.setTreasury(treasury),
    "setTreasury",
    ethers.provider,
  );
  if (network.name === "arc-mainnet") {
    saveMainnetExecutorTreasury(treasury);
  }
  console.log("Executor treasury:", treasury);
}

async function setFactoryFeeTo(treasury) {
  if (network.name !== "arc-mainnet" || !treasury) {
    return;
  }

  const factoryAddress = savedMainnetAmm()?.factory;
  if (!ethers.isAddress(factoryAddress || "")) {
    console.warn("Skipping factory feeTo: no saved mainnet factory address.");
    return;
  }

  const factory = await ethers.getContractAt(
    [
      "function feeTo() view returns (address)",
      "function setFeeTo(address) external",
    ],
    factoryAddress,
  );
  const current = await factory.feeTo();
  if (sameAddress(current, treasury)) {
    console.log("Factory feeTo already set:", treasury);
    saveMainnetFactoryFeeTo(treasury);
    return;
  }

  await sendAndWait(factory.setFeeTo(treasury), "factory setFeeTo", ethers.provider);
  saveMainnetFactoryFeeTo(treasury);
  console.log("Factory feeTo:", treasury);
}

function uniqueAddresses(addresses) {
  const seen = new Set();
  const out = [];
  for (const address of addresses) {
    if (!ethers.isAddress(address) || isTestnetAddress(address)) {
      continue;
    }
    const key = address.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(address);
  }
  return out;
}

function savedMainnetExecutor() {
  return readJson(
    path.join(
      __dirname,
      "..",
      "deployments",
      "tower-swap-executor-arc-mainnet-deployment.json",
    ),
  );
}

function savedMainnetAmm() {
  return readJson(
    path.join(__dirname, "..", "..", "Tower-AMM", "deployments", "arc-mainnet.json"),
  );
}

function savedMainnetAdapter() {
  return readJson(
    path.join(
      __dirname,
      "..",
      "deployments",
      "tower-dex-adapter-arc-mainnet-deployment.json",
    ),
  );
}

function savedAeroAdapter() {
  return readJson(
    path.join(
      __dirname,
      "..",
      "deployments",
      "aero-adapter-arc-mainnet-deployment.json",
    ),
  );
}

function savedDzapAdapter() {
  return readJson(
    path.join(
      __dirname,
      "..",
      "deployments",
      "dzap-adapter-arc-mainnet-deployment.json",
    ),
  );
}

function savedKyberSwapAdapter() {
  return readJson(
    path.join(
      __dirname,
      "..",
      "deployments",
      "kyberswap-adapter-arc-mainnet-deployment.json",
    ),
  );
}

function savedUniswapAdapter() {
  return readJson(
    path.join(
      __dirname,
      "..",
      "deployments",
      "uniswap-adapter-arc-mainnet-deployment.json",
    ),
  );
}

function savedUnitFlowMainnet() {
  return readJson(
    path.join(__dirname, "..", "deployments", "unitflow-arc-mainnet.json"),
  );
}

function resolveExecutorAddress() {
  const fromEnv = process.env.TOWER_SWAP_EXECUTOR_ADDRESS;
  const fromFile = savedMainnetExecutor()?.executor;

  if (network.name !== "arc-mainnet") {
    return fromEnv;
  }

  if (fromEnv && !isTestnetAddress(fromEnv)) {
    return fromEnv;
  }

  if (fromEnv && isTestnetAddress(fromEnv)) {
    console.warn(
      "Ignoring testnet TOWER_SWAP_EXECUTOR_ADDRESS from env. Using the saved mainnet executor.",
    );
  }

  return fromFile || "";
}

function resolveAllowlist(kind) {
  const envName =
    kind === "route"
      ? "TOWER_SWAP_EXECUTOR_ROUTE_TARGETS"
      : "TOWER_SWAP_EXECUTOR_APPROVAL_SPENDERS";
  const fromEnv = splitAddresses(process.env[envName]).filter(
    (address) => !isTestnetAddress(address),
  );

  if (network.name !== "arc-mainnet") {
    return fromEnv;
  }

  const adapter = savedMainnetAdapter()?.adapter;
  const aeroAdapter = savedAeroAdapter()?.adapter;
  const dzapAdapter = savedDzapAdapter()?.adapter;
  const kyberAdapter = savedKyberSwapAdapter()?.adapter;
  const uniswapAdapter = savedUniswapAdapter()?.adapter;
  const router = savedMainnetAmm()?.router;
  const unitflowRouter = savedUnitFlowMainnet()?.v3?.swapRouter;
  const aeroSwapRouter = "0xb4702E1375F712da2e0d5F534c30c0c1513EdB2B";
  const routeDefaults = [
    adapter,
    aeroAdapter,
    dzapAdapter,
    kyberAdapter,
    uniswapAdapter,
    SYNTHRA_MAINNET.universalRouter,
    SYNTHRA_MAINNET.swapRouter02,
    unitflowRouter,
    aeroSwapRouter,
  ];
  const spenderDefaults = [
    adapter,
    aeroAdapter,
    dzapAdapter,
    kyberAdapter,
    uniswapAdapter,
    SYNTHRA_MAINNET.permit2,
    SYNTHRA_MAINNET.swapRouter02,
    SYNTHRA_MAINNET.universalRouter,
    router,
    unitflowRouter,
    aeroSwapRouter,
  ];
  const defaults = kind === "route" ? routeDefaults : spenderDefaults;

  if (process.env[envName] && fromEnv.length === 0) {
    console.warn(
      `Ignoring testnet ${envName} from env. Using saved mainnet contracts.`,
    );
  }

  return uniqueAddresses([...defaults, ...fromEnv]);
}

async function withRpcRetry(label, action, attempts = 6) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error) || attempt === attempts) {
        throw error;
      }
      const delayMs = Math.min(15_000, 1500 * attempt);
      console.warn(
        `${label} RPC error (${attempt}/${attempts}): ${
          error instanceof Error ? error.message : String(error)
        }. Retrying in ${delayMs}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

async function setAllowlist(contract, label, setter, addresses) {
  for (const address of addresses) {
    validateAddress(label, address);
    const isAlreadyAllowed = await withRpcRetry(
      `${label} check ${address}`,
      () =>
        setter === "setRouteTarget"
          ? contract.routeTargets(address)
          : contract.approvalSpenders(address),
    );

    if (isAlreadyAllowed) {
      console.log(`${label} already allowed:`, address);
      continue;
    }

    console.log(`Allowlisting ${label}:`, address);
    const code = await withRpcRetry(`${label} getCode ${address}`, () =>
      ethers.provider.getCode(address),
    );
    if (!code || code === "0x") {
      console.warn(
        `Skipping ${label} ${address}: no contract code on this network.`,
      );
      continue;
    }

    await sendAndWait(
      contract[setter](address, true),
      `${label} ${address}`,
      ethers.provider,
    );
    console.log(`${label} allowed:`, address);
  }
}

async function main() {
  const executorAddress = resolveExecutorAddress();
  const treasury = resolveTreasury();
  const routeTargets = resolveAllowlist("route");
  const approvalSpenders = resolveAllowlist("spender");

  validateAddress("TOWER_SWAP_EXECUTOR_ADDRESS", executorAddress);

  if (network.name === "arc-mainnet" && isTestnetAddress(executorAddress)) {
    throw new Error(
      "Refusing to configure the testnet TowerSwapExecutor on arc-mainnet.",
    );
  }

  if (routeTargets.length === 0 && approvalSpenders.length === 0 && !treasury) {
    throw new Error(
      "Set TOWER_SWAP_EXECUTOR_ROUTE_TARGETS and/or TOWER_SWAP_EXECUTOR_APPROVAL_SPENDERS, or run this on arc-mainnet after the AMM router is saved.",
    );
  }

  const executor = await ethers.getContractAt(
    "TowerSwapExecutor",
    executorAddress,
  );
  console.log("Configuring TowerSwapExecutor:", executorAddress);
  console.log("Network:", network.name);
  if (treasury) {
    console.log("Treasury:", treasury);
  }
  console.log("Route targets:", routeTargets.join(", ") || "(none)");
  console.log("Approval spenders:", approvalSpenders.join(", ") || "(none)");

  await setExecutorTreasury(executor, treasury);
  await setFactoryFeeTo(treasury);

  await setAllowlist(executor, "route target", "setRouteTarget", routeTargets);
  await setAllowlist(
    executor,
    "approval spender",
    "setApprovalSpender",
    approvalSpenders,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
