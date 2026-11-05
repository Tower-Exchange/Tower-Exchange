const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers, network } = hre;
const { assertWritableRpc } = require("./lib/assertWritableRpc.cjs");
const { verifyContractWithRetry } = require("./lib/verifyOnArcscan.cjs");

const AERO_MAINNET_SWAP_ROUTER = "0xb4702E1375F712da2e0d5F534c30c0c1513EdB2B";
const TESTNET_TOWER_SWAP_EXECUTOR =
  "0x2De8906a641d65d490bC60A4179d961d59742bCb";
const AERO_ADAPTER_CONTRACT = "contracts/adapters/AeroAdapter.sol:AeroAdapter";

const sameAddress = (left, right) =>
  Boolean(left) &&
  Boolean(right) &&
  ethers.isAddress(left) &&
  ethers.isAddress(right) &&
  left.toLowerCase() === right.toLowerCase();

const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

const savedMainnetExecutor = () =>
  readJson(
    path.join(
      __dirname,
      "..",
      "deployments",
      "tower-swap-executor-arc-mainnet-deployment.json",
    ),
  )?.executor;

const pickAddress = (candidates, skipAddress) => {
  for (const candidate of candidates) {
    if (ethers.isAddress(candidate) && !sameAddress(candidate, skipAddress)) {
      return candidate;
    }
  }
  return "";
};

async function verifyContract(address, constructorArguments) {
  if (process.env.AERO_ADAPTER_VERIFY === "false") {
    console.log("Skipping verification because AERO_ADAPTER_VERIFY=false");
    return "skipped";
  }

  return verifyContractWithRetry(hre, {
    address,
    constructorArguments,
    contract: AERO_ADAPTER_CONTRACT,
    label: "AeroAdapter",
    license: "MIT",
  });
}

async function maybeAllowlistAdapter(executorAddress, adapterAddress) {
  if (!executorAddress || !ethers.isAddress(executorAddress)) {
    return;
  }

  const executor = await ethers.getContractAt("TowerSwapExecutor", executorAddress);

  console.log("Allowlisting AeroAdapter in TowerSwapExecutor:", executorAddress);

  const alreadyRoute = await executor.routeTargets(adapterAddress);
  if (!alreadyRoute) {
    const routeTargetTx = await executor.setRouteTarget(adapterAddress, true);
    await routeTargetTx.wait();
    console.log("  Route target allowed.");
  } else {
    console.log("  Route target already allowed.");
  }

  const alreadySpender = await executor.approvalSpenders(adapterAddress);
  if (!alreadySpender) {
    const spenderTx = await executor.setApprovalSpender(adapterAddress, true);
    await spenderTx.wait();
    console.log("  Approval spender allowed.");
  } else {
    console.log("  Approval spender already allowed.");
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const swapRouterAddress =
    network.name === "arc-mainnet"
      ? pickAddress(
          [
            process.env.AERO_SWAP_ROUTER_ADDRESS,
            AERO_MAINNET_SWAP_ROUTER,
          ],
          "",
        )
      : process.env.AERO_SWAP_ROUTER_ADDRESS || "";
  const executorAddress =
    network.name === "arc-mainnet"
      ? pickAddress(
          [
            process.env.TOWER_SWAP_EXECUTOR_ADDRESS,
            savedMainnetExecutor(),
            process.env.NEXT_PUBLIC_TOWER_SWAP_EXECUTOR_MAINNET_ADDRESS,
          ],
          TESTNET_TOWER_SWAP_EXECUTOR,
        )
      : process.env.TOWER_SWAP_EXECUTOR_ADDRESS ||
        process.env.NEXT_PUBLIC_TOWER_SWAP_EXECUTOR_ADDRESS ||
        "";

  if (!ethers.isAddress(swapRouterAddress)) {
    throw new Error("AERO_SWAP_ROUTER_ADDRESS must be a valid address.");
  }

  console.log("Deploying AeroAdapter");
  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);
  console.log("Aero swap router:", swapRouterAddress);
  if (executorAddress) {
    console.log("Executor for allowlisting:", executorAddress);
  }

  await assertWritableRpc({
    ethers,
    network,
    expectedChainId: network.config.chainId,
  });

  const AeroAdapter = await ethers.getContractFactory(AERO_ADAPTER_CONTRACT);
  const adapter = await AeroAdapter.deploy(swapRouterAddress);
  await adapter.waitForDeployment();

  const adapterAddress = await adapter.getAddress();
  console.log("AeroAdapter deployed:", adapterAddress);

  await maybeAllowlistAdapter(executorAddress, adapterAddress);

  const deployment = {
    contract: "AeroAdapter",
    network: network.name,
    chainId: network.config.chainId,
    adapter: adapterAddress,
    swapRouter: swapRouterAddress,
    executor: executorAddress || null,
    owner: deployer.address,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    blockExplorerUrl:
      network.name === "arc-mainnet"
        ? `https://arc.etherscan.io/address/${adapterAddress}`
        : network.name === "arc-testnet"
          ? `https://testnet.arcscan.app/address/${adapterAddress}`
          : null,
  };
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  const deploymentFile = path.join(
    deploymentsDir,
    `aero-adapter-${network.name}-deployment.json`,
  );
  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  console.log("Deployment info saved to:", deploymentFile);

  if (process.env.AERO_ADAPTER_VERIFY !== "false") {
    console.log("Waiting briefly before verification...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const verificationStatus = await verifyContract(adapterAddress, [
      swapRouterAddress,
    ]);
    fs.writeFileSync(
      deploymentFile,
      JSON.stringify({ ...deployment, verificationStatus }, null, 2),
    );
  }

  console.log("\nSet this in the frontend environment:");
  console.log(`NEXT_PUBLIC_AERO_ADAPTER_MAINNET_ADDRESS=${adapterAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
