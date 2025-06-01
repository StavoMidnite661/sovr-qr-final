// 📂 File: api/presentment-router.js

import { ethers } from 'ethers';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { SiweMessage } from 'siwe';
import pinataSDK from '@pinata/sdk';
import { Pool } from 'pg';
import rateLimit from 'express-rate-limit';

// Environment variables
const SQUARE_API_KEY = process.env.SQUARE_API_KEY;
const COINBASE_API_KEY = process.env.COINBASE_API_KEY;
const SOVR_CONTRACT_ADDRESS = process.env.SOVR_CONTRACT_ADDRESS;
const PROVIDER_URL = process.env.PROVIDER_URL;
const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const DWOLLA_API_KEY = process.env.DWOLLA_API_KEY;

// Initialize providers
const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
const pinata = new pinataSDK(PINATA_API_KEY, PINATA_SECRET_KEY);
const pool = new Pool({ connectionString: DATABASE_URL });
const contractAbi = [
  'function verifyTrustCheck(string txId, uint256 amount, bytes32 trustCheckHash) view returns (bool)',
  'function updateLedger(string txId, string action, uint256 amount) external'
];
const sovrContract = new ethers.Contract(SOVR_CONTRACT_ADDRESS, contractAbi, provider);

// Payout routes
const PAYOUT_ROUTES = {
  FOOD: { provider: 'square', endpoint: 'https://connect.squareup.com/v2/payments' },
  RENT: { provider: 'dwolla', endpoint: 'https://api.dwolla.com/transfers' },
  SERVICE: { provider: 'coinbase', endpoint: 'https://api.commerce.coinbase.com/charges' }
};

// Rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

// SIWE middleware
const verifySIWE = async (req, res, next) => {
  try {
    const { message, signature } = req.body;
    const siweMessage = new SiweMessage(message);
    const { data } = await siweMessage.verify({ signature });
    req.wallet_address = data.address;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid SIWE signature' });
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  limiter(req, res, async () => {
    try {
      const { qrPayload, vaultAddress, intentType, kycData, message, signature } = req.body;
      if (!qrPayload || !vaultAddress || !intentType || !message || !signature) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      await verifySIWE(req, res, () => {});
      const { txId, amount, trustCheckHash } = JSON.parse(qrPayload);

      const isValid = await sovrContract.verifyTrustCheck(txId, amount, ethers.utils.hexlify(trustCheckHash));
      if (!isValid) {
        return res.status(403).json({ error: 'Invalid Trust Check' });
      }

      const route = PAYOUT_ROUTES[intentType.toUpperCase()];
      if (!route) {
        return res.status(400).json({ error: 'Invalid intent type' });
      }

      let payoutResponse;
      switch (route.provider) {
        case 'square':
          payoutResponse = await processSquarePayment(txId, amount);
          break;
        case 'coinbase':
          payoutResponse = await processCoinbasePayment(txId, amount);
          break;
        case 'dwolla':
          payoutResponse = await processDwollaPayment(txId, amount, kycData);
          break;
        default:
          return res.status(400).json({ error: 'Unsupported payout provider' });
      }

      await sovrContract.updateLedger(txId, route.provider, amount);

      const ledgerSnapshot = {
        txId,
        amount,
        provider: route.provider,
        timestamp: new Date().toISOString(),
        hash: ethers.utils.keccak256(ethers.utils.toUtf8Bytes(JSON.stringify(payoutResponse))),
        wallet_address: req.wallet_address
      };
      const ipfsResult = await pinata.pinJSONToIPFS(ledgerSnapshot, {
        pinataMetadata: { name: `LedgerSnapshot_${txId}.json` }
      });

      const result = await pool.query(
        `INSERT INTO vault_entries (user_id, token, amount, tx_hash, ledger_id, ipfs_hash, qr_code)
         SELECT id, $1, $2, $3, $4, $5, $6 FROM users WHERE wallet_address = $7 RETURNING *`,
        ['SOVR', amount, txId, `SOVR-${txId}`, ipfsResult.IpfsHash, `https://sovr.io/vault/verify/SOVR-${txId}`, req.wallet_address]
      );

      return res.status(200).json({
        status: 'success',
        txId,
        amount,
        provider: route.provider,
        receipt: payoutResponse,
        ledgerSnapshot,
        ipfs_url: `https://ipfs.io/ipfs/${ipfsResult.IpfsHash}`,
        vault_entry: result.rows[0]
      });
    } catch (error) {
      console.error('Error in Presentment Router:', error);
      return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  });
}

async function processSquarePayment(txId, amount) {
  const response = await axios.post(
    PAYOUT_ROUTES.FOOD.endpoint,
    {
      idempotency_key: uuidv4(),
      amount_money: { amount: amount * 100, currency: 'USD' },
      source_id: 'SOVR_TRUST_CHECK'
    },
    { headers: { Authorization: `Bearer ${SQUARE_API_KEY}` } }
  );
  return response.data;
}

async function processCoinbasePayment(txId, amount) {
  try {
    const response = await axios.post(
      PAYOUT_ROUTES.SERVICE.endpoint,
      {
        name: `SOVR Trust Check ${txId}`,
        description: 'Payment via SOVR Intent Engine',
        pricing_type: 'fixed_price',
        local_price: { amount: amount.toString(), currency: 'USD' }
      },
      {
        headers: {
          'X-CC-Api-Key': COINBASE_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error(`Error processing Coinbase payment for txId ${txId}:`, error.message);
    throw new Error('Failed to process Coinbase payment');
  }
}

async function processDwollaPayment(txId, amount, kycData) {
  const response = await axios.post(
    PAYOUT_ROUTES.RENT.endpoint,
    {
      _links: {
        source: { href: 'https://api.dwolla.com/funding-sources/source-id' },
        destination: { href: 'https://api.dwolla.com/funding-sources/destination-id' }
      },
      amount: { value: amount.toString(), currency: 'USD' }
    },
    { headers: { Authorization: `Bearer ${DWOLLA_API_KEY}` } }
  );
  return response.data;
}
