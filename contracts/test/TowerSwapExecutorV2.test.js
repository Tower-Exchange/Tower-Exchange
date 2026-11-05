const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TowerSwapExecutorV2", function () {
  async function deployFixture() {
    const [owner, user, treasury, nextOwner] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const tokenIn = await MockERC20.deploy("USD Coin", "USDC", 6);
    const tokenOut = await MockERC20.deploy("Euro Coin", "EURC", 6);
    const MockSwapRouter = await ethers.getContractFactory("MockSwapRouter");
    const router = await MockSwapRouter.deploy();
    const Executor = await ethers.getContractFactory("TowerSwapExecutorV2");
    const executor = await Executor.deploy(treasury.address, owner.address, 30);
    await executor.setRouteTarget(await router.getAddress(), true);
    await executor.setApprovalSpender(await router.getAddress(), true);
    return { owner, user, treasury, nextOwner, tokenIn, tokenOut, router, executor };
  }

  async function paramsFor(fixture, deadlineOffset = 600) {
    const { user, tokenIn, tokenOut, router, executor } = fixture;
    const amountIn = 1_000_000n;
    const fee = (amountIn * 30n) / 10_000n;
    const swapAmount = amountIn - fee;
    await tokenIn.mint(user.address, amountIn);
    await tokenOut.mint(await router.getAddress(), swapAmount * 2n);
    await tokenIn.connect(user).approve(await executor.getAddress(), amountIn);
    const routeCalldata = router.interface.encodeFunctionData("swapExactInput", [
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      swapAmount,
      swapAmount,
      await executor.getAddress(),
    ]);
    const block = await ethers.provider.getBlock("latest");
    return {
      tokenIn: await tokenIn.getAddress(), tokenOut: await tokenOut.getAddress(), amountIn,
      minAmountOut: swapAmount, recipient: user.address, routeTarget: await router.getAddress(),
      approvalSpender: await router.getAddress(), routeCalldata,
      deadline: BigInt(block.timestamp + deadlineOffset),
    };
  }

  it("settles a valid, non-expired swap", async function () {
    const fixture = await deployFixture();
    const params = await paramsFor(fixture);
    await expect(fixture.executor.connect(fixture.user).executeSwap(params)).to.not.be.reverted;
    expect(await fixture.tokenOut.balanceOf(fixture.user.address)).to.equal(params.minAmountOut);
  });

  it("rejects an expired swap before moving funds", async function () {
    const fixture = await deployFixture();
    const params = await paramsFor(fixture, -1);
    await expect(fixture.executor.connect(fixture.user).executeSwap(params)).to.be.revertedWith("Swap expired");
  });

  it("uses a two-step ownership handover and forbids renouncing ownership", async function () {
    const { executor, owner, nextOwner } = await deployFixture();
    await executor.connect(owner).transferOwnership(nextOwner.address);
    expect(await executor.owner()).to.equal(owner.address);
    await executor.connect(nextOwner).acceptOwnership();
    expect(await executor.owner()).to.equal(nextOwner.address);
    await expect(executor.connect(nextOwner).renounceOwnership()).to.be.revertedWith("Renounce ownership disabled");
  });
});
