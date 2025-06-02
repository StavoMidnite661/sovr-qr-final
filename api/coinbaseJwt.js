// Coinbase JWT Generator (coinbaseJwt.js)
import jwt from 'jsonwebtoken';
import { createPrivateKey, randomBytes } from 'crypto';
import fetch from 'node-fetch';

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
      nonce: randomBytes(16).toString('hex')
    }
  });
}

export async function getCoinbasePaymentMethods() {
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

export async function createCoinbaseWithdrawal(accountId, amount, paymentMethodId) {
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

export { generateCoinbaseJWT };
