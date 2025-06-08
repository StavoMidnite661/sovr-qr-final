const { ethers } = require('ethers');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Add xAI API client (hypothetical, adjust based on actual SDK)
const xaiApiKey = 'xai-vNG8T9jfjYL0oLcvg3bxohn2yAqG3MK2Fy3tYSLParbtnwJOErk1lQRFdu1kHKii2WuNVq74TWn0nzMS';
const xaiClient = axios.create({
  baseURL: 'https://api.x.ai/v1',
  headers: {
    'Authorization': `Bearer ${xaiApiKey}`,
    'Content-Type': 'application/json'
  }
});

// Environment variables (loaded from Vercel)
const SQUARE_API_KEY = process.env.SQUARE_API_KEY;
const COINBASE_API_KEY = process.env.COINBASE_API_KEY;
const SOVR_CONTRACT_ADDRESS = process.env.SOVR_CONTRACT_ADDRESS;
const PROVIDER_URL = process.env.PROVIDER_URL;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS;

// Initialize Ethereum provider and contract
const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
const contractAbi = [
  'function verifyTrustCheck(string txId, uint256 amount, bytes32 trustCheckHash) view returns (bool)',
  'function updateLedger(string txId, string action, uint256 amount) external',
  'function balanceOf(address owner) view returns (uint256)',
  'function deductUnits(address from, uint256 amount) external'
];
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const sovrContract = new ethers.Contract(SOVR_CONTRACT_ADDRESS, contractAbi, wallet);

const PAYOUT_ROUTES = {
  FOOD: { provider: 'square', endpoint: 'https://connect.squareup.com/v2/payments' },
  RENT: { provider: 'zelle', endpoint: 'https://api.zellepay.com/transactions' },
  SERVICE: { provider: 'coinbase', endpoint: 'https://api.commerce.coinbase.com/charges' }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { qrPayload, vaultAddress, intentType, kycData, message, signature } = req.body;

    if (!qrPayload || !vaultAddress || !intentType) {
      return res.status(400).json({ error: 'Missing required fields: qrPayload, vaultAddress, intentType' });
    }

    const { txId, amount, trustCheckHash } = JSON.parse(qrPayload);

    // Call Grok via xAI API for transaction validation or guidance
    const grokResponse = await xaiClient.post('/chat/completions', {
      model: 'grok',
      messages: [{ role: 'user', content: `Validate this SOVR transaction: txId=${txId}, amount=${amount}, intentType=${intentType}` }]
    });
    const grokAdvice = grokResponse.data.choices[0].message.content;
    console.log('Grok says:', grokAdvice);

    // Verify Trust Check on-chain
    const isValid = await sovrContract.verifyTrustCheck(txId, amount, ethers.utils.hexlify(trustCheckHash));
    if (!isValid) {
      return res.status(403).json({ error: 'Invalid Trust Check' });
    }

    const signer = ethers.utils.verifyMessage(ethers.utils.arrayify(message), signature);
    if (signer.toLowerCase() !== vaultAddress.toLowerCase()) {
      return res.status(403).json({ error: 'Invalid signature' });
    }

    const vaultBalance = await sovrContract.balanceOf(VAULT_ADDRESS);
    const vaultUnits = ethers.BigNumber.from(vaultBalance.toString());
    const requiredUnits = ethers.BigNumber.from(amount.toString());

    if (vaultUnits.lt(requiredUnits)) {
      return res.status(403).json({ error: 'Insufficient units in vault to offset transaction' });
    }

    const deductTx = await sovrContract.deductUnits(VAULT_ADDRESS, requiredUnits);
    await deductTx.wait();

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
      case 'zelle':
        payoutResponse = await processZellePayment(txId, amount, kycData);
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
      unitsDeducted: amount,
      vaultBalanceAfter: (vaultUnits.sub(requiredUnits)).toString()
    };
    const trustIndex = await publishToTrustIndex(ledgerSnapshot);

    return res.status(200).json({
      status: 'success',
      message: 'Transaction received, approved, and paid in full',
      txId,
      amount,
      provider: route.provider,
      receipt: payoutResponse,
      ledgerSnapshot,
      trustIndex,
      grokAdvice
    });
  } catch (error) {
    console.error('Error in Presentment Router:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
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
  const response = await axios.post(
    PAYOUT_ROUTES.SERVICE.endpoint,
    {
      name: `SOVR Trust Check ${txId}`,
      description: 'Payment via SOVR Intent Engine',
      pricing_type: 'fixed_price',
      local_price: { amount: amount.toString(), currency: 'USD' }
    },
    { headers: { 'X-CC-Api-Key': COINBASE_API_KEY } }
  );
  return response.data;
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
  const { create } = require('ipfs-http-client');
  const ipfs = create({ host: 'ipfs.infura.io', port: 5001, protocol: 'https' });
  const { cid } = await ipfs.add(JSON.stringify(snapshot));
  console.log('Published to SOVR Trust Index:', `https://ipfs.io/ipfs/${cid}`);
  return { ipfsHash: cid.toString() };
}