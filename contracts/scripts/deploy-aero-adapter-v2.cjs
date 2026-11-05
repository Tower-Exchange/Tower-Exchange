const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;
const { assertWritableRpc } = require("./lib/assertWritableRpc.cjs");
const { verifyContractWithRetry } = require("./lib/verifyOnArcscan.cjs");

const ARC_AERO_ROUTER = "0xb4702E1375F712da2e0d5F534c30c0c1513EdB2B";

async function main() {
  const [deployer] = await ethers.getSigners();
  const owner = process.env.OWNER_ADDRESS || deployer.address;
  const swapRouter = process.env.AERO_SWAP_ROUTER_ADDRESS || ARC_AERO_ROUTER;
  const executorAddress = process.env.TOWER_SWAP_EXECUTOR_V2_ADDRESS;
  if (!ethers.isAddress(owner) || !ethers.isAddress(swapRouter) || !ethers.isAddress(executorAddress || "")) throw new Error("Set OWNER_ADDRESS, AERO_SWAP_ROUTER_ADDRESS, and TOWER_SWAP_EXECUTOR_V2_ADDRESS to valid addresses.");

  await assertWritableRpc({ ethers, network: hre.network, expectedChainId: hre.network.config.chainId });
  const Factory = await ethers.getContractFactory("AeroAdapterV2");
  const args = [swapRouter, owner];
  const adapter = await Factory.deploy(...args);
  await adapter.waitForDeployment();
  const adapterAddress = await adapter.getAddress();
  const executor = await ethers.getContractAt("TowerSwapExecutorV2", executorAddress);
  await (await executor.setRouteTarget(adapterAddress, true)).wait();
  await (await executor.setApprovalSpender(adapterAddress, true)).wait();

  const deployment = { contract: "AeroAdapterV2", network: hre.network.name, chainId: hre.network.config.chainId, adapter: adapterAddress, swapRouter, executor: executorAddress, owner, deployer: deployer.address, timestamp: new Date().toISOString() };
  const deploymentFile = path.join(__dirname, "..", "deployments", `aero-adapter-v2-${hre.network.name}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  const verificationStatus = await verifyContractWithRetry(hre, { address: adapterAddress, constructorArguments: args, contract: "contracts/adapters/AeroAdapterV2.sol:AeroAdapterV2", label: "AeroAdapterV2" });
  fs.writeFileSync(deploymentFile, JSON.stringify({ ...deployment, verificationStatus }, null, 2));
  console.log(`AeroAdapterV2 deployed: ${adapterAddress}`);
  console.log(`NEXT_PUBLIC_AERO_ADAPTER_V2_MAINNET_ADDRESS=${adapterAddress}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
