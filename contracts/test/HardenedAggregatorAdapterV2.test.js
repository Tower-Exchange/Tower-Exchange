const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DZapAdapterV2", function () {
  it("exposes separately deployable KyberSwap and Uniswap V2 adapters", async function () {
    const [owner] = await ethers.getSigners();
    const Router = await ethers.getContractFactory("MockSwapRouter");
    const primary = await Router.deploy();
    const secondary = await Router.deploy();

    const KyberAdapter = await ethers.getContractFactory("KyberSwapAdapterV2");
    const kyber = await KyberAdapter.deploy(
      await primary.getAddress(),
      await secondary.getAddress(),
      ethers.ZeroAddress,
      owner.address,
    );
    expect(await kyber.primaryRouteTarget()).to.equal(await primary.getAddress());
    expect(await kyber.secondaryRouteTarget()).to.equal(await secondary.getAddress());

    const UniswapAdapter = await ethers.getContractFactory("UniswapAdapterV2");
    const uniswap = await UniswapAdapter.deploy(
      await primary.getAddress(),
      ethers.ZeroAddress,
      owner.address,
    );
    expect(await uniswap.primaryRouteTarget()).to.equal(await primary.getAddress());
    expect(await uniswap.secondaryRouteTarget()).to.equal(ethers.ZeroAddress);
  });

  it("refunds only its caller's unspent input and cannot sweep pre-existing balances", async function () {
    const [owner, user, recipient, donor] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MockERC20");
    const tokenIn = await Token.deploy("USD Coin", "USDC", 6);
    const tokenOut = await Token.deploy("Euro Coin", "EURC", 6);
    const Router = await ethers.getContractFactory("MockSwapRouter");
    const router = await Router.deploy();
    const Adapter = await ethers.getContractFactory("DZapAdapterV2");
    const adapter = await Adapter.deploy(await router.getAddress(), ethers.ZeroAddress, owner.address);

    const stranded = 1_000_000n;
    const amountIn = 500_000n;
    await tokenIn.mint(donor.address, stranded);
    await tokenIn.connect(donor).transfer(await adapter.getAddress(), stranded);
    await tokenIn.mint(user.address, amountIn);
    await tokenOut.mint(await router.getAddress(), amountIn);
    await tokenIn.connect(user).approve(await adapter.getAddress(), amountIn);
    const data = router.interface.encodeFunctionData("swapExactInput", [
      await tokenIn.getAddress(), await tokenOut.getAddress(), amountIn, amountIn, recipient.address,
    ]);

    await adapter.connect(user).swapExactInput(
      await tokenIn.getAddress(), await tokenOut.getAddress(), amountIn, amountIn,
      recipient.address, await router.getAddress(), data,
    );

    expect(await tokenIn.balanceOf(await adapter.getAddress())).to.equal(stranded);
    expect(await tokenOut.balanceOf(recipient.address)).to.equal(amountIn);
  });

  it("never treats Permit2 as a route target", async function () {
    const [owner, user, recipient] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MockERC20");
    const tokenIn = await Token.deploy("USD Coin", "USDC", 6);
    const tokenOut = await Token.deploy("Euro Coin", "EURC", 6);
    const Router = await ethers.getContractFactory("MockSwapRouter");
    const router = await Router.deploy();
    const Adapter = await ethers.getContractFactory("DZapAdapterV2");
    const adapter = await Adapter.deploy(await router.getAddress(), ethers.ZeroAddress, owner.address);
    await tokenIn.mint(user.address, 1n);
    await tokenIn.connect(user).approve(await adapter.getAddress(), 1n);
    await expect(adapter.connect(user).swapExactInput(
      await tokenIn.getAddress(), await tokenOut.getAddress(), 1n, 1n,
      recipient.address, user.address, "0x1234",
    )).to.be.revertedWith("Invalid route target");
  });
});
