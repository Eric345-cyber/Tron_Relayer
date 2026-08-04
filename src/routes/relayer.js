const express = require('express');
const router = express.Router();
const { tronWeb, relayerAddress, getRelayerBalance } = require('../utils/tron');
const { checkRateLimit } = require('../utils/rateLimiter');
const { logger } = require('../utils/logger');

// In-memory stats (use Redis in production)
const stats = {
  totalRelays: 0,
  totalFeesBurned: 0,
  lastRelayAt: null
};

// Minimum relayer balance to accept new relays (stops service if too low)
const MIN_RELAYER_BALANCE = parseFloat(process.env.MIN_RELAYER_BALANCE) || 10;

/**
 * POST /api/relayer/approve
 * Relays a signed USDT approval transaction
 */
router.post('/approve', async (req, res) => {
  const startTime = Date.now();

  try {
    const { owner, spender, contract, signedTransaction, timestamp } = req.body;

    // ─── VALIDATION ──────────────────────────────────────────────────
    if (!owner || !spender || !contract || !signedTransaction || !timestamp) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: owner, spender, contract, signedTransaction, timestamp'
      });
    }

    if (!tronWeb.isAddress(owner)) {
      return res.status(400).json({ success: false, message: 'Invalid owner address' });
    }
    if (!tronWeb.isAddress(spender)) {
      return res.status(400).json({ success: false, message: 'Invalid spender address' });
    }
    if (!tronWeb.isAddress(contract)) {
      return res.status(400).json({ success: false, message: 'Invalid contract address' });
    }

    // Anti-replay: timestamp within 5 minutes
    const now = Date.now();
    if (Math.abs(now - timestamp) > 5 * 60 * 1000) {
      return res.status(400).json({
        success: false,
        message: 'Transaction expired. Timestamp must be within 5 minutes.'
      });
    }

    // ─── RATE LIMITING ───────────────────────────────────────────────
    const rateCheck = await checkRateLimit(owner);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        message: `Rate limit exceeded. Try again in ${rateCheck.retryAfter}s.`,
        retryAfter: rateCheck.retryAfter
      });
    }

    // ─── SIGNATURE VERIFICATION ──────────────────────────────────────
    const txId = signedTransaction.txID;
    const signature = signedTransaction.signature?.[0];

    if (!txId || !signature) {
      return res.status(400).json({
        success: false,
        message: 'Invalid signed transaction: missing txID or signature'
      });
    }

    try {
      const recovered = tronWeb.utils.crypto.recoverSignature(txId, signature);
      const recoveredAddress = tronWeb.address.fromHex(recovered);

      if (recoveredAddress !== owner) {
        logger.warn(`Signature mismatch: claimed ${owner}, recovered ${recoveredAddress}`);
        return res.status(403).json({
          success: false,
          message: 'Signature verification failed'
        });
      }
    } catch (e) {
      logger.error('Signature recovery failed:', e.message);
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    // ─── VERIFY TRANSACTION CONTENT ──────────────────────────────────
    const rawData = signedTransaction.raw_data;
    if (!rawData || !rawData.contract || !rawData.contract[0]) {
      return res.status(400).json({ success: false, message: 'Invalid transaction structure' });
    }

    const contractData = rawData.contract[0];
    if (contractData.type !== 'TriggerSmartContract') {
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction type: expected TriggerSmartContract'
      });
    }

    const contractAddress = tronWeb.address.fromHex(
      contractData.parameter.value.contract_address
    );
    if (contractAddress !== contract) {
      return res.status(400).json({ success: false, message: 'Contract address mismatch' });
    }

    const ownerAddress = tronWeb.address.fromHex(
      contractData.parameter.value.owner_address
    );
    if (ownerAddress !== owner) {
      return res.status(400).json({ success: false, message: 'Owner address mismatch' });
    }

    // ─── CHECK RELAYER BALANCE ───────────────────────────────────────
    const relayerBalance = await getRelayerBalance();

    if (relayerBalance < MIN_RELAYER_BALANCE) {
      logger.error(`Relayer balance too low: ${relayerBalance} TRX (min: ${MIN_RELAYER_BALANCE})`);
      return res.status(503).json({
        success: false,
        message: 'Relayer temporarily unavailable. Please try again later.',
        relayerBalance: `${relayerBalance.toFixed(2)} TRX`,
        minRequired: `${MIN_RELAYER_BALANCE} TRX`
      });
    }

    // ─── BROADCAST ───────────────────────────────────────────────────
    logger.info(`Relaying approval for ${owner} -> ${spender}`);

    const result = await tronWeb.trx.sendRawTransaction(signedTransaction);

    if (!result.result) {
      logger.error('Broadcast failed:', result);
      return res.status(500).json({
        success: false,
        message: result.message || 'Broadcast failed',
        code: result.code
      });
    }

    // ─── SUCCESS ─────────────────────────────────────────────────────
    const duration = Date.now() - startTime;
    const estimatedFee = '~6.5 TRX';

    stats.totalRelays++;
    stats.totalFeesBurned += 6.5;
    stats.lastRelayAt = new Date().toISOString();

    logger.info(`Relay successful: ${result.txid} (${duration}ms)`);

    res.json({
      success: true,
      txid: result.txid,
      path: 'relayer',
      relayerFee: estimatedFee,
      relayerAddress,
      duration: `${duration}ms`,
      remainingRelays: rateCheck.remaining - 1
    });

  } catch (e) {
    logger.error('Relay error:', e);
    res.status(500).json({ success: false, message: e.message || 'Internal relay error' });
  }
});

/**
 * GET /api/relayer/stats
 * Protected endpoint for monitoring
 */
router.get('/stats', async (req, res, next) => {
  const { apiKeyAuth } = require('../middleware/auth');
  apiKeyAuth(req, res, next);
}, (req, res) => {
  res.json({
    relayerAddress,
    minBalance: MIN_RELAYER_BALANCE,
    stats: {
      ...stats,
      uptime: process.uptime()
    }
  });
});

module.exports = router;
