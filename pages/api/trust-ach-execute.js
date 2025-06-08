// pages/api/trust-ach-execute.js
const crypto = require('crypto');
const axios = require('axios');

function signMessage(message, privateKeyBase64) {
  const sodium = require('libsodium-wrappers');
  return (async () => {
    await sodium.ready;
    const key = Buffer.from(privateKeyBase64, 'base64');
    const signature = sodium.crypto_sign_detached(message, key);
    return Buffer.from(signature).toString('base64');
  })();
}

module.exports = async (req, res) => {
  const { amount, toAddress, currency } = req.body;

  const keyId = process.env.CDP_KEY_ID;
  const privateKey = process.env.CDP_PRIVATE_KEY;
  const url = `${process.env.CDP_API_URL}/send`;

  const body = JSON.stringify({
    to: toAddress,
    amount,
    currency
  });

  const signature = await signMessage(body, privateKey);

  const headers = {
    'Content-Type': 'application/json',
    'CB-ACCESS-KEY': keyId,
    'CB-ACCESS-SIGN': signature,
  };

  try {
    const response = await axios.post(url, body, { headers });
    return res.status(200).json({ success: true, data: response.data });
  } catch (err) {
    console.error('CDP send error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
