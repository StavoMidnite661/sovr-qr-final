// presentment-router.js - SOVR Node Alpha Presentment Router

/**
 * SOVR Presentment Router API Endpoint
 * Handles POST requests for Trust Check presentments, routes to payment providers (Square, Coinbase, Zelle, etc),
 * verifies on-chain, logs actions, and returns results for settlement and Trust Index evidence.
 */

const express = require('express');
const bodyParser = require('body-parser');
const { verifyTrustCheck, logPresentment, routePayment } = require('./presentment-utils'); // Assume utils for core logic

const router = express.Router();
router.use(bodyParser.json());

// POST /api/presentment-router
router.post('/', async (req, res) => {
  try {
    // Step 1: Input Validation
    const {
      qrPayload,           // Raw payload from QR or frontend
      vaultAddress,        // Wallet/vault address initiating payment
      intentType,          // SERVICE, PAYMENT, etc
      trustCheckHash,      // Hash of digital trust check or settlement doc
      kycData,             // {recipientEmail, other}
      message,             // (optional) Any custom message
      signature            // Signed by sender wallet
    } = req.body;

    if (!qrPayload || !vaultAddress || !intentType || !trustCheckHash || !kycData || !signature) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    // Step 2: Verify Trust Check & Signature
    const verified = await verifyTrustCheck({ qrPayload, vaultAddress, trustCheckHash, signature });
    if (!verified) {
      return res.status(403).json({ error: 'Trust check or signature invalid.' });
    }

    // Step 3: Route Payment
    const paymentResult = await routePayment({
      qrPayload,
      vaultAddress,
      intentType,
      trustCheckHash,
      kycData,
      message
    });

    // Step 4: Log Presentment
    await logPresentment({
      vaultAddress,
      trustCheckHash,
      intentType,
      paymentResult,
      kycData,
      timestamp: Date.now(),
    });

    // Step 5: Return Result
    res.status(200).json({
      status: 'success',
      paymentResult,
      trustCheckHash,
      trustIndexUrl: `https://sovr-trust-index.vercel.app/check/${trustCheckHash}`
    });
  } catch (err) {
    console.error('Presentment Router Error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
