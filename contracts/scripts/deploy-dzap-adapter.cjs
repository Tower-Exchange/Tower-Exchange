const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers, network } = hre;
const { assertWritableRpc } = require("./lib/assertWritableRpc.cjs");
const { verifyContractWithRetry } = require("./lib/verifyOnArcscan.cjs");

const DZAP_ROUTER = "0xb3926deF2e0989B0700a57034C9A211bfBcF858B";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const TESTNET_TOWER_SWAP_EXECUTOR =
  "0x2De8906a641d65d490bC60A4179d961d59742bCb";
const DZAP_ADAPTER_CONTRACT = "contracts/adapters/DZapAdapter.sol:DZapAdapter";

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
  if (process.env.DZAP_ADAPTER_VERIFY === "false") {
    console.log("Skipping verification because DZAP_ADAPTER_VERIFY=false");
    return "skipped";
  }

  return verifyContractWithRetry(hre, {
    address,
    constructorArguments,
    contract: DZAP_ADAPTER_CONTRACT,
    label: "DZapAdapter",
    license: "MIT",
  });
}

async function maybeAllowlistAdapter(executorAddress, adapterAddress) {
  if (!executorAddress || !ethers.isAddress(executorAddress)) {
    return;
  }

  const executor = await ethers.getContractAt("TowerSwapExecutor", executorAddress);

  console.log("Allowlisting DZapAdapter in TowerSwapExecutor:", executorAddress);

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
  const dzapRouterAddress = pickAddress(
    [process.env.DZAP_ROUTER_ADDRESS, DZAP_ROUTER],
    "",
  );
  const permit2Address =
    process.env.DZAP_PERMIT2_ADDRESS === "0x0" ||
    process.env.DZAP_PERMIT2_ADDRESS === ethers.ZeroAddress
      ? ethers.ZeroAddress
      : pickAddress([process.env.DZAP_PERMIT2_ADDRESS, PERMIT2], "");
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

  if (!ethers.isAddress(dzapRouterAddress)) {
    throw new Error("DZAP_ROUTER_ADDRESS must be a valid address.");
  }

  const dzapRouterCode = await ethers.provider.getCode(dzapRouterAddress);
  if (!dzapRouterCode || dzapRouterCode === "0x") {
    throw new Error(`DZap router has no contract code at ${dzapRouterAddress}.`);
  }

  let resolvedPermit2 = permit2Address || ethers.ZeroAddress;
  if (resolvedPermit2 && resolvedPermit2 !== ethers.ZeroAddress) {
    const permit2Code = await ethers.provider.getCode(resolvedPermit2);
    if (!permit2Code || permit2Code === "0x") {
      console.warn(
        `Permit2 has no contract code at ${resolvedPermit2}. Deploying adapter without Permit2.`,
      );
      resolvedPermit2 = ethers.ZeroAddress;
    }
  }

  console.log("Deploying DZapAdapter");
  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);
  console.log("DZap router:", dzapRouterAddress);
  console.log("Permit2:", resolvedPermit2);
  if (executorAddress) {
    console.log("Executor for allowlisting:", executorAddress);
  }

  await assertWritableRpc({
    ethers,
    network,
    expectedChainId: network.config.chainId,
  });

  const DZapAdapter = await ethers.getContractFactory(DZAP_ADAPTER_CONTRACT);
  const adapter = await DZapAdapter.deploy(dzapRouterAddress, resolvedPermit2);
  await adapter.waitForDeployment();

  const adapterAddress = await adapter.getAddress();
  console.log("DZapAdapter deployed:", adapterAddress);

  await maybeAllowlistAdapter(executorAddress, adapterAddress);

  const deployment = {
    contract: "DZapAdapter",
    network: network.name,
    chainId: network.config.chainId,
    adapter: adapterAddress,
    dzapRouter: dzapRouterAddress,
    permit2: resolvedPermit2,
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
    `dzap-adapter-${network.name}-deployment.json`,
  );
  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  console.log("Deployment info saved to:", deploymentFile);

  if (process.env.DZAP_ADAPTER_VERIFY !== "false") {
    console.log("Waiting briefly before verification...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const verificationStatus = await verifyContract(adapterAddress, [
      dzapRouterAddress,
      resolvedPermit2,
    ]);
    fs.writeFileSync(
      deploymentFile,
      JSON.stringify({ ...deployment, verificationStatus }, null, 2),
    );
  }

  console.log("\nSet this in the frontend environment:");
  if (network.name === "arc-mainnet") {
    console.log(`NEXT_PUBLIC_DZAP_ADAPTER_MAINNET_ADDRESS=${adapterAddress}`);
  } else {
    console.log(`NEXT_PUBLIC_DZAP_ADAPTER_ADDRESS=${adapterAddress}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
