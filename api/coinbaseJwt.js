// Coinbase JWT Generator (coinbaseJwt.js)
const jwt = require('jsonwebtoken');
const { createPrivateKey } = require('crypto');
const fetch = require('node-fetch');

function generateCoinbaseJWT(uri) {
  const privateKey = createPrivateKey(process.env.COINBASE_PRIVATE_KEY);
  const now = Math.floor(Date.now() / 1000);
  const keyName = process.env.COINBASE_KEY_NAME;

  return jwt.sign({
    sub: keyName,
    iss: 'cdp',
    nbf: now,
    exp: now + 120,
    uri: uri,
  }, privateKey, {
    algorithm: 'ES256',
    header: {
      kid: keyName,
      nonce: require('crypto').randomBytes(16).toString('hex')
    }
  });
}

async function getCoinbasePaymentMethods() {
  const uri = 'GET api.coinbase.com/api/v3/brokerage/payment_methods';
  const jwtToken = generateCoinbaseJWT(uri);

  const res = await fetch('https://api.coinbase.com/api/v3/brokerage/payment_methods', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${jwtToken}`,
      'Content-Type': 'application/json'
    }
  });

  const data = await res.json();
  return data.payment_methods;
}

async function createCoinbaseWithdrawal(accountId, amount, paymentMethodId) {
  const uri = `POST api.coinbase.com/api/v3/brokerage/accounts/${accountId}/withdrawals`;
  const jwtToken = generateCoinbaseJWT(uri);

  const res = await fetch(`https://api.coinbase.com/api/v3/brokerage/accounts/${accountId}/withdrawals`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwtToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount: amount.toString(),
      currency: 'USD',
      destination_payment_method_id: paymentMethodId,
      note: 'SOVR Trust-backed offload'
    })
  });

  const data = await res.json();
  return data;
}

module.exports = {
  generateCoinbaseJWT,
  getCoinbasePaymentMethods,
  createCoinbaseWithdrawal
};
