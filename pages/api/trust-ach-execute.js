// pages/api/trust-ach-execute.js
const crypto = require('crypto');
const axios = require('axios');
const sodium = require('libsodium-wrappers');

function signMessage(message, privateKeyBase64) {
  return (async () => {
    await sodium.ready;
    const key = Buffer.from(privateKeyBase64, 'base64');
    const signature = sodium.crypto_sign_detached(message, key);
    return Buffer.from(signature).toString('base64');
  })();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { bondId, psik_auth } = req.body;

  if (!bondId || psik_auth !== 'TRUST-AUTH-SOVR') {
    return res.status(400).json({ error: 'Invalid request payload or authorization' });
  }

  const keyId = process.env.CDP_KEY_ID;
  const privateKey = process.env.CDP_PRIVATE_KEY;
  const url = `${process.env.CDP_API_URL}/send`;

  // Example: fetch bond metadata from a bond lookup table or service (mocked here)
  const bondMetadata = {
    'BOND-001': 10000,
    'BOND-002': 25000,
    'BOND-003': 5000,
  };

  const amount = bondMetadata[bondId];

  if (!amount) {
    return res.status(400).json({ error: 'Unknown bond ID or unsupported bond value' });
  }

  const bondPayload = {
    to: process.env.VAULT_ADDRESS,
    amount,
    currency: 'USD',
    bond_reference: bondId,
  };

  const body = JSON.stringify(bondPayload);
  const signature = await signMessage(body, privateKey);

  const headers = {
    'Content-Type': 'application/json',
    'CB-ACCESS-KEY': keyId,
    'CB-ACCESS-SIGN': signature,
  };

  try {
    const response = await axios.post(url, body, { headers });
    return res.status(200).json({ success: true, message: 'Bond executed and funds initiated.', data: response.data });
  } catch (err) {
    console.error('CDP execution error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
