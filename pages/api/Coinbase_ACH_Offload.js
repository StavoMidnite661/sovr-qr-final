// LIVE ACH OFFLOAD EXECUTION SCRIPT (Node.js)

const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { createPrivateKey } = require('crypto');

// ENV CONFIG (replace with your real values or use dotenv)
require('dotenv').config();

const COINBASE_API_KEY_NAME = `organizations/SOVRDevelopmentHoldingsLLC/apiKeys/${process.env.CDP_API_KEY_ID}`;
const COINBASE_PRIVATE_KEY = process.env.CDP_API_KEY_SECRET;
const ACCOUNT_ID = 'your_coinbase_account_id'; // Get from Coinbase brokerage
const PAYMENT_METHOD_ID = '8bfc20d7-f7c6-4422-bf07-8243ca4169fe'; // Ally/Valley Strong ACH method
const AMOUNT = '50000';

function generateJWT(uri) {
  const privateKey = createPrivateKey(COINBASE_PRIVATE_KEY);
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: COINBASE_API_KEY_NAME,
      iss: 'cdp',
      nbf: now,
      exp: now + 120,
      uri
    },
    privateKey,
    {
      algorithm: 'ES256',
      header: {
        kid: COINBASE_API_KEY_NAME,
        nonce: require('crypto').randomBytes(16).toString('hex')
      }
    }
  );
}

async function sendACHOffload() {
  const uri = `POST api.coinbase.com/api/v3/brokerage/accounts/${ACCOUNT_ID}/withdrawals`;
  const jwtToken = generateJWT(uri);

  const res = await fetch(`https://api.coinbase.com/api/v3/brokerage/accounts/${ACCOUNT_ID}/withdrawals`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwtToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount: AMOUNT,
      currency: 'USD',
      destination_payment_method_id: PAYMENT_METHOD_ID,
      beneficiary_name: 'GM FAMILY TRUST',
      note: 'SOVR Vault offload to pay for goods and services on behalf of GM FAMILY TRUST (100% beneficiary)'
    })
  });

  const data = await res.json();
  console.log('✅ ACH TRANSFER RESPONSE:', data);
}

sendACHOffload().catch(console.error);
