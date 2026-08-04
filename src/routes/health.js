const express = require('express');
const router = express.Router();
const { relayerAddress, getRelayerBalance, getRelayerResources } = require('../utils/tron');
const { logger } = require('../utils/logger');

const HEALTH_BALANCE_ALERT = parseFloat(process.env.HEALTH_BALANCE_ALERT) || 100;
const MIN_RELAYER_BALANCE = parseFloat(process.env.MIN_RELAYER_BALANCE) || 20;

router.get('/health', async (req, res) => {
  try {
    const [balance, resources] = await Promise.all([
      getRelayerBalance(),
      getRelayerResources()
    ]);

    // Status logic:
    // - healthy: balance >= alert threshold (plenty of funds)
    // - warning: balance between min and alert (still works but getting low)
    // - critical: balance < min (relays blocked)
    let status = 'healthy';
    if (balance < MIN_RELAYER_BALANCE) {
      status = 'critical';
    } else if (balance < HEALTH_BALANCE_ALERT) {
      status = 'warning';
    }

    const response = {
      status,
      relayer: {
        address: relayerAddress,
        balance: `${balance.toFixed(2)} TRX`,
        energy: resources.energy,
        bandwidth: resources.bandwidth
      },
      thresholds: {
        minForRelays: `${MIN_RELAYER_BALANCE} TRX`,
        alertLevel: `${HEALTH_BALANCE_ALERT} TRX`
      },
      acceptingRelays: balance >= MIN_RELAYER_BALANCE,
      network: process.env.TRON_FULL_NODE || 'https://api.trongrid.io',
      timestamp: new Date().toISOString()
    };

    // HTTP status reflects health
    const httpStatus = status === 'critical' ? 503 : 200;
    res.status(httpStatus).json(response);

    if (status !== 'healthy') {
      logger.warn(`Relayer health ${status}: ${balance} TRX`);
    }
  } catch (e) {
    logger.error('Health check failed:', e);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;
