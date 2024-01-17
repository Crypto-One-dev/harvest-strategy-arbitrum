// Utilities
const Utils = require("../utilities/Utils.js");
const {
  impersonates,
  setupCoreProtocol,
  depositVault,
} = require("../utilities/hh-utils.js");

const addresses = require("../test-config.js");
const BigNumber = require("bignumber.js");
const IERC20 = artifacts.require("IERC20");

const Strategy = artifacts.require("RadpieStrategyMainnet_DAI");

// Developed and tested at blockNumber 144713000

// Vanilla Mocha test. Increased compatibility with tools that integrate Mocha.
describe("Arbitrum Mainnet Radpie DAI", function () {
  let accounts;

  // external contracts
  let underlying;

  // external setup
  // let underlyingWhale = "0x8494ea6211e36fab1aa408c4e925dadf4c6db4c8";
  let underlyingWhale = "0xF60B7C3282Ed70e00686e5f54a6dBF7028Cbc6BB";
  let weth = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
  let dai = "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1";
  let esrdnt = "0x1cC128a5d977B3BA7d598f01dB20A2116F59ef68";
  let rdnt = "0x0C4681e6C0235179ec3D4F4fc4DF3d14FDD96017";
  let ulOwner = addresses.ULOwner;

  // parties in the protocol
  let governance;
  let farmer1;

  // numbers used in tests
  let farmerBalance;

  // Core protocol contracts
  let controller;
  let vault;
  let strategy;

  async function setupExternalContracts() {
    underlying = await IERC20.at("0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1");
    console.log("Fetching Underlying at: ", underlying.address);
  }

  async function setupBalance() {
    let etherGiver = accounts[9];
    await web3.eth.sendTransaction({ from: etherGiver, to: underlyingWhale, value: 10e18 });

    farmerBalance = await underlying.balanceOf(underlyingWhale);
    await underlying.transfer(farmer1, farmerBalance, { from: underlyingWhale });
  }

  before(async function () {
    governance = addresses.Governance;
    accounts = await web3.eth.getAccounts();

    farmer1 = accounts[1];

    // impersonate accounts
    await impersonates([governance, underlyingWhale, ulOwner]);

    let etherGiver = accounts[9];
    await web3.eth.sendTransaction({ from: etherGiver, to: governance, value: 10e18 });
    await web3.eth.sendTransaction({ from: etherGiver, to: ulOwner, value: 10e18 });

    await setupExternalContracts();
    [controller, vault, strategy] = await setupCoreProtocol({
      "existingVaultAddress": null,
      "strategyArtifact": Strategy,
      "strategyArtifactIsUpgradable": true,
      "underlying": underlying,
      "governance": governance,
      "liquidation": [
        { "camelot": [esrdnt, rdnt, weth] },
        { "camelot": [weth, dai] }
      ],
      "ULOwner": ulOwner
    });

    // whale send underlying to farmers
    await setupBalance();
  });

  describe("Happy path", function () {
    it("Farmer should earn money", async function () {
      let farmerOldBalance = new BigNumber(await underlying.balanceOf(farmer1));
      await depositVault(farmer1, underlying, vault, farmerBalance);

      let hours = 10;
      // let blocksPerHour = 3600 * 4 * 24;
      let blocksPerHour = 3600 * 4;
      let oldSharePrice;
      let newSharePrice;

      for (let i = 0; i < hours; i++) {
        console.log("loop ", i);

        oldSharePrice = new BigNumber(await vault.getPricePerFullShare());
        await controller.doHardWork(vault.address, { from: governance });
        newSharePrice = new BigNumber(await vault.getPricePerFullShare());

        console.log("old shareprice: ", oldSharePrice.toFixed());
        console.log("new shareprice: ", newSharePrice.toFixed());
        console.log("growth: ", newSharePrice.toFixed() / oldSharePrice.toFixed());

        apr = (newSharePrice.toFixed() / oldSharePrice.toFixed() - 1) * (24 / (blocksPerHour / 300)) * 365;
        apy = ((newSharePrice.toFixed() / oldSharePrice.toFixed() - 1) * (24 / (blocksPerHour / 300)) + 1) ** 365;

        console.log("instant APR:", apr * 100, "%");
        console.log("instant APY:", (apy - 1) * 100, "%");

        await Utils.advanceNBlock(blocksPerHour);
      }
      await vault.withdraw(new BigNumber(await vault.balanceOf(farmer1)).toFixed(), { from: farmer1 });
      let farmerNewBalance = new BigNumber(await underlying.balanceOf(farmer1));
      Utils.assertBNGt(farmerNewBalance, farmerOldBalance);

      apr = (farmerNewBalance.toFixed() / farmerOldBalance.toFixed() - 1) * (24 / (blocksPerHour * hours / 300)) * 365;
      apy = ((farmerNewBalance.toFixed() / farmerOldBalance.toFixed() - 1) * (24 / (blocksPerHour * hours / 300)) + 1) ** 365;

      console.log("earned!");
      console.log("APR:", apr * 100, "%");
      console.log("APY:", (apy - 1) * 100, "%");

      await strategy.withdrawAllToVault({ from: governance }); // making sure can withdraw all for a next switch

    });
  });
});
