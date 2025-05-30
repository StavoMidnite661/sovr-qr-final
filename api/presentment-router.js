import { ethers } from 'ethers';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

// Environment variables (loaded from Vercel)
const SQUARE_API_KEY = process.env.SQUARE_API_KEY;
const COINBASE_API_KEY = process.env.COINBASE_API_KEY;
const SOVR_CONTRACT_ADDRESS = process.env.SOVR_CONTRACT_ADDRESS;
const PROVIDER_URL = process.env.PROVIDER_URL;

// Initialize Ethereum provider and contract
const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
const contractAbi = [
  // Simplified ABI for SOVR contract
  'function verifyTrustCheck(string txId, uint256 amount, bytes32 trustCheckHash) view returns (bool)',
  'function updateLedger(string txId, string action, uint256 amount) external'
];
const sovrContract = new ethers.Contract(SOVR_CONTRACT_ADDRESS, contractAbi, provider);

// Route table for payout types
const PAYOUT_ROUTES = {
  FOOD: { provider: 'square', endpoint: 'https://connect.squareup.com/v2/payments' },
  RENT: { provider: 'zelle', endpoint: 'https://api.zellepay.com/transactions' },
  SERVICE: { provider: 'coinbase', endpoint: 'https://api.commerce.coinbase.com/charges' }
};

// Main handler for POST /api/presentment-router
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { qrPayload, vaultAddress, intentType, kycData } = req.body;

    // Validate input
    if (!qrPayload || !vaultAddress || !intentType) {
      return res.status(400).json({ error: 'Missing required fields: qrPayload, vaultAddress, intentType' });
    }

    // Decode QR payload
    const { txId, amount, trustCheckHash } = JSON.parse(qrPayload);

    // Verify Trust Check on-chain
    const isValid = await sovrContract.verifyTrustCheck(txId, amount, ethers.utils.hexlify(trustCheckHash));
    if (!isValid) {
      return res.status(403).json({ error: 'Invalid Trust Check' });
    }

    // Match intent to payout route
    const route = PAYOUT_ROUTES[intentType.toUpperCase()];
    if (!route) {
      return res.status(400).json({ error: 'Invalid intent type' });
    }

    // Execute payout based on provider
    let payoutResponse;
    switch (route.provider) {
      case 'square':
        payoutResponse = await processSquarePayment(txId, amount);
        break;
      case 'coinbase':
        payoutResponse = await processCoinbasePayment(txId, amount);
        break;
      case 'zelle':
        payoutResponse = await processZellePayment(txId, amount, kycData);
        break;
      default:
        return res.status(400).json({ error: 'Unsupported payout provider' });
    }

    // Update ledger
    await sovrContract.updateLedger(txId, route.provider, amount);

    // Publish to SOVR Trust Index (simulated here)
    const ledgerSnapshot = {
      txId,
      amount,
      provider: route.provider,
      timestamp: new Date().toISOString(),
      hash: ethers.utils.keccak256(ethers.utils.toUtf8Bytes(JSON.stringify(payoutResponse)))
    };
    await publishToTrustIndex(ledgerSnapshot);

    // Return receipt
    return res.status(200).json({
      status: 'success',
      txId,
      amount,
      provider: route.provider,
      receipt: payoutResponse,
      ledgerSnapshot
    });
  } catch (error) {
    console.error('Error in Presentment Router:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}

// Helper functions for payout providers
async function processSquarePayment(txId, amount) {
  const response = await axios.post(
    PAYOUT_ROUTES.FOOD.endpoint,
    {
      idempotency_key: uuidv4(),
      amount_money: { amount: amount * 500, currency: 'USD' },
      source_id: 'SOVR_TRUST_CHECK'
    },
    { headers: { Authorization: `Bearer ${SQUARE_API_KEY}` } }
  );
  return response.data;
}

async function processCoinbasePayment(txId, amount) {
  try {
    const response = await axios.post(
      'https://api.commerce.coinbase.com/charges',
      {
        name: `SOVR Trust Check ${txId}`,
        description: 'Payment via SOVR Intent Engine',
        pricing_type: 'fixed_price',
        local_price: {
          amount: amount.toString(),
          currency: 'USD'
        }
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
    console.error("Coinbase payment error:", error.response?.data || error.message);
    throw new Error("Coinbase payout failed.");
  }
}


async function processZellePayment(txId, amount, kycData) {
  const response = await axios.post(
    PAYOUT_ROUTES.RENT.endpoint,
    {
      transaction_id: txId,
      amount: amount.toString(),
      recipient: kycData?.recipientEmail || 'default@zellepay.com'
    },
    { headers: { Authorization: 'Bearer ZELLE_API_KEY' } }
  );
  return response.data;
}

async function publishToTrustIndex(snapshot) {
  console.log('Published to SOVR Trust Index:', snapshot);
}
