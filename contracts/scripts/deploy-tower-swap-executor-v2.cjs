const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;
const { assertWritableRpc } = require("./lib/assertWritableRpc.cjs");
const { verifyContractWithRetry } = require("./lib/verifyOnArcscan.cjs");

const splitAddresses = (value) =>
  String(value || "").split(",").map((value) => value.trim()).filter((value) => ethers.isAddress(value));

async function main() {
  const [deployer] = await ethers.getSigners();
  const treasury = process.env.TOWER_SWAP_EXECUTOR_TREASURY || process.env.TREASURY_ADDRESS;
  const owner = process.env.OWNER_ADDRESS || deployer.address;
  const feeBps = Number(process.env.TOWER_SWAP_EXECUTOR_FEE_BPS || "30");
  const routeTargets = splitAddresses(process.env.TOWER_SWAP_EXECUTOR_V2_ROUTE_TARGETS);
  const approvalSpenders = splitAddresses(process.env.TOWER_SWAP_EXECUTOR_V2_APPROVAL_SPENDERS);

  if (!ethers.isAddress(treasury || "")) throw new Error("Set TOWER_SWAP_EXECUTOR_TREASURY to a valid address.");
  if (!ethers.isAddress(owner)) throw new Error("OWNER_ADDRESS must be a valid address.");

  await assertWritableRpc({ ethers, network: hre.network, expectedChainId: hre.network.config.chainId });
  const Factory = await ethers.getContractFactory("TowerSwapExecutorV2");
  const args = [treasury, owner, feeBps];
  const executor = await Factory.deploy(...args);
  await executor.waitForDeployment();
  const executorAddress = await executor.getAddress();

  for (const target of routeTargets) {
    if ((await ethers.provider.getCode(target)) === "0x") throw new Error(`Route target has no code: ${target}`);
    await (await executor.setRouteTarget(target, true)).wait();
  }
  for (const spender of approvalSpenders) {
    if ((await ethers.provider.getCode(spender)) === "0x") throw new Error(`Approval spender has no code: ${spender}`);
    await (await executor.setApprovalSpender(spender, true)).wait();
  }

  const deployment = {
    contract: "TowerSwapExecutorV2",
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    executor: executorAddress,
    treasury,
    owner,
    feeBps,
    routeTargets,
    approvalSpenders,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    blockExplorerUrl: hre.network.name === "arc-mainnet" ? `https://arc.etherscan.io/address/${executorAddress}` : null,
  };
  const deploymentFile = path.join(__dirname, "..", "deployments", `tower-swap-executor-v2-${hre.network.name}-deployment.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));

  const verificationStatus = await verifyContractWithRetry(hre, {
    address: executorAddress,
    constructorArguments: args,
    contract: "contracts/TowerSwapExecutorV2.sol:TowerSwapExecutorV2",
    label: "TowerSwapExecutorV2",
  });
  fs.writeFileSync(deploymentFile, JSON.stringify({ ...deployment, verificationStatus }, null, 2));

  console.log(`TowerSwapExecutorV2 deployed: ${executorAddress}`);
  console.log(`NEXT_PUBLIC_TOWER_SWAP_EXECUTOR_V2_ADDRESS=${executorAddress}`);
  console.log("Do not revoke V1 adapters until every V2 adapter is deployed, allowlisted, and smoke-tested.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
