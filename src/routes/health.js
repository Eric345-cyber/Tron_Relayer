const express = require('express');
const router = express.Router();
const { getRelayerBalance, getRelayerResources } = require('../utils/tron');
const { logger } = require('../utils/logger');

router.get('/health', async (req, res) => {
  try {
    let balance = 0;
    let resources = { energy: 0, bandwidth: 0 };
    let checkFailed = false;
    let checkError = null;

    try {
      balance = await getRelayerBalance();
      resources = await getRelayerResources();
    } catch (err) {
      checkFailed = true;
      checkError = err.message;
      logger.warn(`Healthcheck failed to query TRON Network: ${err.message}`);
    }

    let status = 'healthy';
    if (checkFailed) {
      status = 'degraded';
    } else if (balance < 20) {
      status = 'warning'; // Warning only, do not crash or flag offline
    }

    res.status(200).json({
      status,
      relayer: {
        balance,
        energy: resources.energy,
        bandwidth: resources.bandwidth
      },
      networkCheck: checkFailed ? { success: false, error: checkError } : { success: true }
    });
  } catch (error) {
    logger.error('Critical failure in health route logic:', error);
    res.status(200).json({ status: 'error', message: error.message });
  }
});

module.exports = router;
