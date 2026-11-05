const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
const { assertWritableRpc } = require("./lib/assertWritableRpc.cjs");
const { MAINNET_TREASURY } = require("./lib/mainnetAddresses.cjs");
const { verifyContractWithRetry } = require("./lib/verifyOnArcscan.cjs");

function sameAddress(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function isStaleMainnetTreasury(address) {
  return (
    !address ||
    sameAddress(address, "0xe71dD45E7d21409b04b609D0E6C67FFff592d43d") ||
    sameAddress(address, "0x6396DfE7949c785Ab8b3e4634d0c9aB97d700a4B")
  );
}

function resolveDeployTreasury(deployerAddress) {
  const fromEnv =
    process.env.TOWER_SWAP_EXECUTOR_TREASURY || process.env.TREASURY_ADDRESS;

  if (hre.network.name === "arc-mainnet") {
    if (
      fromEnv &&
      ethers.isAddress(fromEnv) &&
      !sameAddress(fromEnv, deployerAddress) &&
      !isStaleMainnetTreasury(fromEnv)
    ) {
      return fromEnv;
    }
    return MAINNET_TREASURY;
  }

  return fromEnv;
}

function splitAddresses(value) {
  return String(value || "")
    .split(",")
    .map((address) => address.trim())
    .filter((address) => ethers.isAddress(address));
}

async function addressesWithCode(addresses) {
  const unique = [...new Set(addresses.map((address) => ethers.getAddress(address)))];
  const present = [];

  for (const address of unique) {
    const code = await ethers.provider.getCode(address);
    if (!code || code === "0x") {
      console.warn(
        `Skipping ${address}: no contract code on ${hre.network.name}. Testnet addresses cannot be allowlisted on mainnet.`,
      );
      continue;
    }
    present.push(address);
  }

  return present;
}

async function allowlistExecutor(executor, routeTargets, approvalSpenders) {
  const usableTargets = await addressesWithCode(routeTargets);
  const usableSpenders = await addressesWithCode(approvalSpenders);

  for (const target of usableTargets) {
    console.log("Allowlisting route target:", target);
    const tx = await executor.setRouteTarget(target, true);
    await tx.wait();
  }

  for (const spender of usableSpenders) {
    console.log("Allowlisting approval spender:", spender);
    const tx = await executor.setApprovalSpender(spender, true);
    await tx.wait();
  }

  return { routeTargets: usableTargets, approvalSpenders: usableSpenders };
}

async function saveDeploymentInfo(deployment) {
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const filename = path.join(
    deploymentsDir,
    hre.network.name === "arc-testnet"
      ? "tower-swap-executor-deployment.json"
      : `tower-swap-executor-${hre.network.name}-deployment.json`,
  );
  fs.writeFileSync(filename, JSON.stringify(deployment, null, 2));
  return filename;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const treasury = resolveDeployTreasury(deployer.address);
  const owner = process.env.OWNER_ADDRESS || deployer.address;
  const feeBps = Number(process.env.TOWER_SWAP_EXECUTOR_FEE_BPS || "25");
  const routeTargets = splitAddresses(process.env.TOWER_SWAP_EXECUTOR_ROUTE_TARGETS);
  const approvalSpenders = splitAddresses(process.env.TOWER_SWAP_EXECUTOR_APPROVAL_SPENDERS);

  if (!ethers.isAddress(treasury || "")) {
    throw new Error("Set TOWER_SWAP_EXECUTOR_TREASURY or TREASURY_ADDRESS to a valid address.");
  }

  if (!ethers.isAddress(owner)) {
    throw new Error("OWNER_ADDRESS must be a valid address when provided.");
  }

  console.log("Deploying TowerSwapExecutor");
  console.log("Network:", hre.network.name);
  console.log("Deployer:", deployer.address);
  console.log("Treasury:", treasury);
  console.log("Owner:", owner);
  console.log("Fee BPS:", feeBps);

  await assertWritableRpc({
    ethers,
    network: hre.network,
    expectedChainId: hre.network.config.chainId,
  });

  const TowerSwapExecutor = await ethers.getContractFactory("TowerSwapExecutor");
  const constructorArgs = [treasury, owner, feeBps];
  const executor = await TowerSwapExecutor.deploy(...constructorArgs);
  await executor.waitForDeployment();
  const executorAddress = await executor.getAddress();

  console.log("TowerSwapExecutor deployed:", executorAddress);

  const deploymentDraft = {
    contract: "TowerSwapExecutor",
    network: hre.network.name,
    executor: executorAddress,
    constructorTreasury: treasury,
    constructorOwner: owner,
    treasury,
    owner,
    feeBps,
    routeTargets,
    approvalSpenders,
    verificationStatus: "pending",
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    blockExplorerUrl:
      hre.network.name === "arc-mainnet"
        ? `https://arc.etherscan.io/address/${executorAddress}`
        : hre.network.name === "arc-testnet"
          ? `https://testnet.arcscan.app/address/${executorAddress}`
          : null,
  };
  await saveDeploymentInfo(deploymentDraft);
  console.log(
    "Saved executor address before allowlisting:",
    deploymentDraft.blockExplorerUrl || executorAddress,
  );

  const verificationStatus = await verifyContractWithRetry(
    hre,
    {
      address: executorAddress,
      constructorArguments: constructorArgs,
      contract: "contracts/TowerSwapExecutor.sol:TowerSwapExecutor",
      label: "TowerSwapExecutor",
    },
    Number(process.env.TOWER_SWAP_EXECUTOR_VERIFY_MAX_RETRIES || "3"),
    Number(process.env.TOWER_SWAP_EXECUTOR_VERIFY_RETRY_DELAY_MS || "5000"),
  );
  await saveDeploymentInfo({
    ...deploymentDraft,
    verificationStatus,
  });

  const allowlisted = await allowlistExecutor(
    executor,
    routeTargets,
    approvalSpenders,
  );

  const deployment = {
    ...deploymentDraft,
    routeTargets: allowlisted.routeTargets,
    approvalSpenders: allowlisted.approvalSpenders,
    skippedRouteTargets: routeTargets.filter(
      (address) =>
        !allowlisted.routeTargets.some(
          (allowed) => allowed.toLowerCase() === address.toLowerCase(),
        ),
    ),
    skippedApprovalSpenders: approvalSpenders.filter(
      (address) =>
        !allowlisted.approvalSpenders.some(
          (allowed) => allowed.toLowerCase() === address.toLowerCase(),
        ),
    ),
    verificationStatus,
    timestamp: new Date().toISOString(),
  };

  const savedFile = await saveDeploymentInfo(deployment);

  console.log("Deployment summary:");
  console.log(JSON.stringify(deployment, null, 2));
  console.log("Deployment info saved to:", savedFile);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
