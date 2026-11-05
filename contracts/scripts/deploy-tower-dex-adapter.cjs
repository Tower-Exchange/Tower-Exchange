const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers, network } = hre;
const { assertWritableRpc } = require("./lib/assertWritableRpc.cjs");
const { verifyContractWithRetry } = require("./lib/verifyOnArcscan.cjs");

const TESTNET_TOWER_DEX_ROUTER = "0xDf115b4f2F22B9255B2E63348423B6C5B379Bce2";
const TESTNET_TOWER_SWAP_EXECUTOR =
  "0x2De8906a641d65d490bC60A4179d961d59742bCb";
const DEFAULT_TOWER_DEX_ROUTER = TESTNET_TOWER_DEX_ROUTER;
const TOWER_DEX_ADAPTER_CONTRACT =
  "contracts/adapters/TowerDexAdapter.sol:TowerDexAdapter";

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

const savedMainnetRouter = () =>
  readJson(
    path.join(__dirname, "..", "..", "Tower-AMM", "deployments", "arc-mainnet.json"),
  )?.router;

const savedMainnetExecutor = () =>
  readJson(
    path.join(
      __dirname,
      "..",
      "deployments",
      "tower-swap-executor-arc-mainnet-deployment.json",
    ),
  )?.executor;

const pickAddress = (candidates, testnetAddress) => {
  for (const candidate of candidates) {
    if (ethers.isAddress(candidate) && !sameAddress(candidate, testnetAddress)) {
      return candidate;
    }
  }
  return "";
};

const assertMainnetAddresses = (networkName, routerAddress, executorAddress) => {
  if (networkName !== "arc-mainnet") {
    return;
  }

  if (sameAddress(routerAddress, TESTNET_TOWER_DEX_ROUTER)) {
    throw new Error(
      "Refusing to deploy TowerDexAdapter on arc-mainnet against the testnet Tower router (0xDf11...). Set TOWER_DEX_ROUTER_ADDRESS to the Arc mainnet router.",
    );
  }

  if (sameAddress(executorAddress, TESTNET_TOWER_SWAP_EXECUTOR)) {
    throw new Error(
      "Refusing to allowlist the testnet TowerSwapExecutor (0x2De8...) on arc-mainnet. Set TOWER_SWAP_EXECUTOR_ADDRESS to the mainnet executor, or leave it empty.",
    );
  }
};

async function verifyContract(address, constructorArguments) {
  if (process.env.TOWER_DEX_ADAPTER_VERIFY === "false") {
    console.log("Skipping verification because TOWER_DEX_ADAPTER_VERIFY=false");
    return "skipped";
  }

  return verifyContractWithRetry(hre, {
    address,
    constructorArguments,
    contract: TOWER_DEX_ADAPTER_CONTRACT,
    label: "TowerDexAdapter",
    license: "MIT",
  });
}

async function maybeAllowlistAdapter(executorAddress, adapterAddress) {
  if (!executorAddress || !ethers.isAddress(executorAddress)) {
    return;
  }

  const executor = await ethers.getContractAt("TowerSwapExecutor", executorAddress);

  console.log("Allowlisting adapter in TowerSwapExecutor:", executorAddress);

  const routeTargetTx = await executor.setRouteTarget(adapterAddress, true);
  await routeTargetTx.wait();
  console.log("  Route target allowed.");

  const spenderTx = await executor.setApprovalSpender(adapterAddress, true);
  await spenderTx.wait();
  console.log("  Approval spender allowed.");
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const rawRouterAddress =
    network.name === "arc-mainnet"
      ? pickAddress(
          [
            process.env.TOWER_DEX_ROUTER_ADDRESS,
            savedMainnetRouter(),
            process.env.NEXT_PUBLIC_TOWER_DEX_ROUTER_ADDRESS,
          ],
          TESTNET_TOWER_DEX_ROUTER,
        )
      : process.env.TOWER_DEX_ROUTER_ADDRESS ||
        process.env.NEXT_PUBLIC_TOWER_DEX_ROUTER_ADDRESS ||
        DEFAULT_TOWER_DEX_ROUTER;
  const executorAddress =
    network.name === "arc-mainnet"
      ? pickAddress(
          [
            process.env.TOWER_SWAP_EXECUTOR_ADDRESS,
            savedMainnetExecutor(),
            process.env.NEXT_PUBLIC_TOWER_SWAP_EXECUTOR_ADDRESS,
          ],
          TESTNET_TOWER_SWAP_EXECUTOR,
        )
      : process.env.TOWER_SWAP_EXECUTOR_ADDRESS ||
        process.env.NEXT_PUBLIC_TOWER_SWAP_EXECUTOR_ADDRESS ||
        "";

  if (!ethers.isAddress(rawRouterAddress)) {
    throw new Error("TOWER_DEX_ROUTER_ADDRESS must be a valid address.");
  }

  console.log("Deploying TowerDexAdapter");
  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);
  console.log("Raw Tower router:", rawRouterAddress);
  if (executorAddress) {
    console.log("Executor for allowlisting:", executorAddress);
  }

  assertMainnetAddresses(network.name, rawRouterAddress, executorAddress);

  await assertWritableRpc({
    ethers,
    network,
    expectedChainId: network.config.chainId,
  });

  const TowerDexAdapter = await ethers.getContractFactory(
    TOWER_DEX_ADAPTER_CONTRACT,
  );
  const adapter = await TowerDexAdapter.deploy(rawRouterAddress);
  await adapter.waitForDeployment();

  const adapterAddress = await adapter.getAddress();

  console.log("TowerDexAdapter deployed:", adapterAddress);

  await maybeAllowlistAdapter(executorAddress, adapterAddress);

  const finalOwner = process.env.TOWER_FINAL_OWNER || process.env.OWNER_ADDRESS || "";
  if (finalOwner && ethers.isAddress(finalOwner) && finalOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.log("Transferring TowerDexAdapter ownership to:", finalOwner);
    const ownTx = await adapter.transferOwnership(finalOwner);
    await ownTx.wait();

    if (executorAddress && ethers.isAddress(executorAddress)) {
      const executor = await ethers.getContractAt("TowerSwapExecutor", executorAddress);
      const currentOwner = await executor.owner();
      if (currentOwner.toLowerCase() === deployer.address.toLowerCase()) {
        console.log("Transferring TowerSwapExecutor ownership to:", finalOwner);
        const execOwnTx = await executor.transferOwnership(finalOwner);
        await execOwnTx.wait();
      } else {
        console.log("Executor owner is already:", currentOwner);
      }
    }
  }

  const deployment = {
    contract: "TowerDexAdapter",
    network: network.name,
    chainId: network.config.chainId,
    adapter: adapterAddress,
    router: rawRouterAddress,
    executor: executorAddress || null,
    owner: finalOwner && ethers.isAddress(finalOwner) ? finalOwner : deployer.address,
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
    `tower-dex-adapter-${network.name}-deployment.json`,
  );
  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  console.log("Deployment info saved to:", deploymentFile);

  if (process.env.TOWER_DEX_ADAPTER_VERIFY !== "false") {
    console.log("Waiting briefly before verification...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const verificationStatus = await verifyContract(adapterAddress, [rawRouterAddress]);
    fs.writeFileSync(
      deploymentFile,
      JSON.stringify({ ...deployment, verificationStatus }, null, 2),
    );
  }

  console.log("\nSet this in the frontend environment:");
  console.log(`NEXT_PUBLIC_TOWER_DEX_ADAPTER_ADDRESS=${adapterAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
