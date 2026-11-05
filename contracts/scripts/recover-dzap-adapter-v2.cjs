const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;

const DZAP_ROUTER = "0xb3926deF2e0989B0700a57034C9A211bfBcF858B";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const ADAPTER_ABI = [
  "function primaryRouteTarget() view returns (address)",
  "function secondaryRouteTarget() view returns (address)",
  "function permit2() view returns (address)",
  "function owner() view returns (address)",
];

function normalise(address) {
  return String(address).toLowerCase();
}

function configuredDepth() {
  const value = Number(process.env.DZAP_ADAPTER_V2_RECOVERY_NONCE_DEPTH || "16");
  if (!Number.isInteger(value) || value < 1 || value > 256) {
    throw new Error(
      "DZAP_ADAPTER_V2_RECOVERY_NONCE_DEPTH must be an integer between 1 and 256.",
    );
  }
  return value;
}

async function isExpectedAdapter(address, { owner, executor }) {
  if ((await ethers.provider.getCode(address)) === "0x") return false;

  try {
    const adapter = new ethers.Contract(address, ADAPTER_ABI, ethers.provider);
    const [primaryRouteTarget, secondaryRouteTarget, permit2, adapterOwner, routeAllowed, spenderAllowed] =
      await Promise.all([
        adapter.primaryRouteTarget(),
        adapter.secondaryRouteTarget(),
        adapter.permit2(),
        adapter.owner(),
        executor.routeTargets(address),
        executor.approvalSpenders(address),
      ]);

    return (
      normalise(primaryRouteTarget) === normalise(DZAP_ROUTER) &&
      normalise(secondaryRouteTarget) === normalise(ethers.ZeroAddress) &&
      normalise(permit2) === normalise(PERMIT2) &&
      normalise(adapterOwner) === normalise(owner) &&
      routeAllowed === true &&
      spenderAllowed === true
    );
  } catch {
    return false;
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const owner = process.env.OWNER_ADDRESS || deployer.address;
  const executorAddress = process.env.TOWER_SWAP_EXECUTOR_V2_ADDRESS;

  if (!ethers.isAddress(owner) || !ethers.isAddress(executorAddress || "")) {
    throw new Error("Set OWNER_ADDRESS and TOWER_SWAP_EXECUTOR_V2_ADDRESS to valid addresses.");
  }

  const executor = await ethers.getContractAt("TowerSwapExecutorV2", executorAddress);
  const manualAddress = process.env.DZAP_ADAPTER_V2_RECOVERY_ADDRESS;
  const candidates = [];

  if (manualAddress) {
    if (!ethers.isAddress(manualAddress)) {
      throw new Error("DZAP_ADAPTER_V2_RECOVERY_ADDRESS must be a valid address.");
    }
    candidates.push(ethers.getAddress(manualAddress));
  } else {
    // Deployment, route-target allowlisting, and approval-spender allowlisting
    // are three sequential transactions. Inspect recent CREATE addresses from
    // the same deployment EOA instead of issuing any new on-chain transaction.
    const nextNonce = await ethers.provider.getTransactionCount(deployer.address, "latest");
    const depth = configuredDepth();
    for (let nonce = Math.max(0, nextNonce - depth); nonce < nextNonce; nonce += 1) {
      candidates.push(ethers.getCreateAddress({ from: deployer.address, nonce }));
    }
  }

  const matches = [];
  for (const address of candidates) {
    if (await isExpectedAdapter(address, { owner, executor })) {
      matches.push(address);
    }
  }

  if (matches.length === 0) {
    throw new Error(
      "No matching deployed DZapAdapterV2 was found. Do not deploy again. Set DZAP_ADAPTER_V2_RECOVERY_ADDRESS to the contract-creation address, or increase DZAP_ADAPTER_V2_RECOVERY_NONCE_DEPTH (maximum 256) and rerun this read-only recovery command.",
    );
  }
  let adapterAddress = matches[0];
  if (matches.length > 1 && !manualAddress) {
    // `candidates` is assembled in ascending nonce order. A CREATE address
    // derives from its sender and nonce, so the last match is definitively the
    // newest matching deployment from this EOA. The failed file write happens
    // after the deploy and both allowlist transactions, so it is the record to
    // recreate; earlier matching adapters remain untouched.
    adapterAddress = matches[matches.length - 1];
    console.log(
      `Multiple matching adapters found; recovering the newest deployment by EOA nonce: ${adapterAddress}`,
    );
  }

  const deployment = {
    contract: "DZapAdapterV2",
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    adapter: adapterAddress,
    executor: executorAddress,
    owner,
    deployer: deployer.address,
    dzapRouter: DZAP_ROUTER,
    permit2: PERMIT2,
    recoveredAt: new Date().toISOString(),
    verificationStatus: "pending",
  };
  const deploymentFile = path.join(
    __dirname,
    "..",
    "deployments",
    `dzap-adapter-v2-${hre.network.name}-deployment.json`,
  );
  fs.mkdirSync(path.dirname(deploymentFile), { recursive: true });
  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));

  console.log(`Recovered DZapAdapterV2 deployment record: ${adapterAddress}`);
  console.log(`NEXT_PUBLIC_DZAP_ADAPTER_V2_MAINNET_ADDRESS=${adapterAddress}`);
  console.log(`Saved: ${deploymentFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
