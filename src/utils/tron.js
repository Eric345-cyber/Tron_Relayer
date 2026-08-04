const TronWeb = require('tronweb');
const { logger } = require('./logger');

const tronWeb = new TronWeb({
  fullHost: process.env.TRON_FULL_NODE || 'https://api.trongrid.io',
  solidityNode: process.env.TRON_SOLIDITY_NODE || 'https://api.trongrid.io',
  eventServer: process.env.TRON_EVENT_SERVER || 'https://api.trongrid.io',
  privateKey: process.env.RELAYER_PRIVATE_KEY
});

const relayerAddress = tronWeb.defaultAddress.base58;

async function getRelayerBalance() {
  try {
    const balance = await tronWeb.trx.getBalance(relayerAddress);
    return parseFloat(tronWeb.fromSun(balance));
  } catch (e) {
    logger.error('Failed to get relayer balance:', e.message);
    return 0;
  }
}

async function getRelayerResources() {
  try {
    const res = await tronWeb.trx.getAccountResources(relayerAddress);
    return {
      energy: Math.max(0, (res.EnergyLimit || 0) - (res.EnergyUsed || 0)),
      bandwidth: Math.max(0, (res.NetLimit || 0) - (res.NetUsed || 0))
    };
  } catch (e) {
    logger.error('Failed to get relayer resources:', e.message);
    return { energy: 0, bandwidth: 0 };
  }
}

module.exports = { tronWeb, relayerAddress, getRelayerBalance, getRelayerResources };
