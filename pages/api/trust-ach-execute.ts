// pages/api/trust-ach-execute.js
require('dotenv').config();
const axios = require('axios');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { amount, currency, toAddress } = req.body;

    const response = await axios.post(
      'https://api.coinbase.com/v2/accounts/<YOUR-ACCOUNT-ID>/transactions',
      {
        type: 'send',
        to: toAddress,
        amount,
        currency
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.COINBASE_API_KEY}`,
          'CB-VERSION': '2021-05-30'
        }
      }
    );

    return res.status(200).json({ success: true, data: response.data });
  } catch (error) {
    console.error('Coinbase offload error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
};
