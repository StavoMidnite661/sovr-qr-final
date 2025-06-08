// GET ACCOUNT ID FROM COINBASE API

const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { createPrivateKey } = require('crypto');
require('dotenv').config();

const COINBASE_API_KEY_NAME = `organizations/SOVRDevelopmentHoldingsLLC/apiKeys/${process.env.CDP_API_KEY_ID}`;
const COINBASE_PRIVATE_KEY = process.env.CDP_API_KEY_SECRET;

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

async function getAccountId() {
  const uri = 'GET api.coinbase.com/api/v3/brokerage/accounts';
  const jwtToken = generateJWT(uri);

  const res = await fetch('https://api.coinbase.com/api/v3/brokerage/accounts', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${jwtToken}`,
      'Content-Type': 'application/json'
    }
  });

  const data = await res.json();

  console.log('\n🔍 Coinbase Accounts:');
  data.accounts.forEach(acc => {
    console.log(`💼 ${acc.currency} | ID: ${acc.uuid} | Balance: ${acc.available_balance.value}`);
  });
}

getAccountId().catch(console.error);
