const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;
const { assertWritableRpc } = require("./assertWritableRpc.cjs");
const { verifyContractWithRetry } = require("./verifyOnArcscan.cjs");

async function deployV2Adapter({
  contractName,
  contractPath,
  label,
  envName,
  constructorArguments,
  deploymentName,
  metadata = {},
}) {
  const [deployer] = await ethers.getSigners();
  const owner = process.env.OWNER_ADDRESS || deployer.address;
  const executorAddress = process.env.TOWER_SWAP_EXECUTOR_V2_ADDRESS;

  if (!ethers.isAddress(owner) || !ethers.isAddress(executorAddress || "")) {
    throw new Error("Set OWNER_ADDRESS and TOWER_SWAP_EXECUTOR_V2_ADDRESS to valid addresses.");
  }

  await assertWritableRpc({
    ethers,
    network: hre.network,
    expectedChainId: hre.network.config.chainId,
  });

  const executor = await ethers.getContractAt("TowerSwapExecutorV2", executorAddress);
  const executorOwner = await executor.owner();
  if (executorOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(
      "The deployment EOA must still own TowerSwapExecutorV2 while adapter allowlists are configured. Transfer ownership only after deployment and smoke tests.",
    );
  }

  const Factory = await ethers.getContractFactory(contractName);
  const adapter = await Factory.deploy(...constructorArguments(owner));
  await adapter.waitForDeployment();
  const adapterAddress = await adapter.getAddress();

  await (await executor.setRouteTarget(adapterAddress, true)).wait();
  await (await executor.setApprovalSpender(adapterAddress, true)).wait();

  const deployment = {
    contract: contractName,
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    adapter: adapterAddress,
    executor: executorAddress,
    owner,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    ...metadata,
  };
  const deploymentFile = path.join(
    __dirname,
    "..",
    "..",
    "deployments",
    `${deploymentName}-${hre.network.name}-deployment.json`,
  );
  fs.mkdirSync(path.dirname(deploymentFile), { recursive: true });
  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));

  const verificationStatus = await verifyContractWithRetry(hre, {
    address: adapterAddress,
    constructorArguments: constructorArguments(owner),
    contract: contractPath,
    label,
  });
  fs.writeFileSync(
    deploymentFile,
    JSON.stringify({ ...deployment, verificationStatus }, null, 2),
  );

  console.log(`${label} deployed: ${adapterAddress}`);
  console.log(`${envName}=${adapterAddress}`);
}

module.exports = { deployV2Adapter };
