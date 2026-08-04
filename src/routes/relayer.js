const express = require('express');
const router = express.Router();
const { TronWeb } = require('tronweb');
const { tronWeb: relayerTronWeb, getRelayerBalance, getRelayerResources } = require('../utils/tron');
const { logger } = require('../utils/logger');

// ─── SAFE MIDDLEWARE RESOLVER ─────────────────────────────────────────
let auth = require('../middleware/auth');

// Safely handle cases where middleware might be exported as an object, null, or empty
if (!auth || typeof auth !== 'function') {
  if (auth && typeof auth === 'object') {
    if (typeof auth.verifyApiKey === 'function') {
      auth = auth.verifyApiKey;
    } else if (typeof auth.auth === 'function') {
      auth = auth.auth;
    } else {
      // Look for the first exported function in the object
      const foundFunction = Object.values(auth).find(val => typeof val === 'function');
      if (foundFunction) {
        auth = foundFunction;
      }
    }
  }

  // Final fallback to prevent a routing crash if no valid function was found
  if (typeof auth !== 'function') {
    logger.warn('Could not find API key verification function in src/middleware/auth.js. Using local fallback.');
    auth = (req, res, next) => {
      const apiKey = req.headers['x-api-key'] || req.headers['api-key'];
      if (apiKey && apiKey === process.env.API_KEY) {
        return next();
      }
      res.status(401).json({ success: false, message: 'Unauthorized' });
    };
  }
}

// POST /api/relayer/approve
router.post('/approve', async (req, res) => {
  try {
    const { owner, spender, signedTransaction, timestamp } = req.body;

    // 1. Signature Verification
    if (!signedTransaction || !signedTransaction.signature || signedTransaction.signature.length === 0) {
      return res.status(400).json({ success: false, message: 'Missing transaction signature' });
    }

    const txId = signedTransaction.txID;
    const signature = signedTransaction.signature[0];

    // Recover address from signature to verify ownership
    const recovered = TronWeb.utils.crypto.recoverSignature(txId, signature);
    const recoveredAddress = TronWeb.address.fromHex(recovered);

    if (recoveredAddress !== owner) {
      logger.warn(`Signature validation failed. Recovered: ${recoveredAddress}, Expected: ${owner}`);
      return res.status(403).json({ success: false, message: 'Invalid signature' });
    }

    // 2. Anti-Replay Check (expires after 5 minutes)
    if (Date.now() - timestamp > 300000) {
      return res.status(400).json({ success: false, message: 'Transaction expired' });
    }

    // 3. Broadcast transaction via the relayer (TRX burn fee paid automatically by relayer's wallet)
    const result = await relayerTronWeb.trx.sendRawTransaction(signedTransaction);

    if (result.result) {
      logger.info(`Relayed transaction successfully: ${result.txid || txId}`);
      res.json({
        success: true,
        txid: result.txid || txId,
        relayerFee: '~6.5 TRX'
      });
    } else {
      const errMsg = result.message 
        ? (typeof result.message === 'string' ? result.message : TronWeb.utils.bytes.bytesToString(result.message))
        : 'Unknown error';
      logger.error(`Broadcast failed: ${errMsg}`);
      res.status(500).json({ success: false, message: `Broadcast failed: ${errMsg}` });
    }
  } catch (err) {
    logger.error('Error in relayer route:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /api/relayer/stats (Protected by resolved auth middleware)
router.get('/stats', auth, async (req, res) => {
  try {
    const balance = await getRelayerBalance();
    const resources = await getRelayerResources();
    res.json({
      success: true,
      balance: `${balance} TRX`,
      energy: resources.energy,
      bandwidth: resources.bandwidth
    });
  } catch (err) {
    logger.error('Error fetching relayer stats:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve stats' });
  }
});

module.exports = router;
