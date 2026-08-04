const express = require('express');
const router = express.Router();
const { TronWeb } = require('tronweb');
const { tronWeb: relayerTronWeb, getRelayerBalance, getRelayerResources } = require('../utils/tron');
const { logger } = require('../utils/logger');
const auth = require('../middleware/auth');

const MIN_RELAYER_BALANCE = 20; // Reject new relays if relayer falls below 20 TRX

// POST /api/relayer/approve
router.post('/approve', async (req, res) => {
  try {
    const { owner, spender, signedTransaction, timestamp } = req.body;

    // 0. Balance Safe-Check
    const balance = await getRelayerBalance();
    if (balance < MIN_RELAYER_BALANCE) {
      logger.warn(`Relayer balance too low (${balance} TRX). Rejecting request.`);
      return res.status(503).json({
        success: false,
        message: 'Relayer is temporarily offline (low balance)'
      });
    }

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

    // 3. Broadcast transaction via the relayer
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

// GET /api/relayer/stats (Protected by API Key)
router.get('/stats', auth, async (req, res) => {
  try {
    const balance = await getRelayerBalance();
    const resources = await getRelayerResources();
    res.json({
      success: true,
      balance: `${balance} TRX`,
      energy: resources.energy,
      bandwidth: resources.bandwidth,
      minRequiredBalance: `${MIN_RELAYER_BALANCE} TRX`
    });
  } catch (err) {
    logger.error('Error fetching relayer stats:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve stats' });
  }
});

module.exports = router;
