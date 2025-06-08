// /api/coinbaseWebhook.js

import { buffer } from 'micro';
import crypto from 'crypto';

const SHARED_SECRET = process.env.COINBASE_SHARED_SECRET;

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  const rawBody = await buffer(req);
  const signature = req.headers['x-cc-webhook-signature'];

  const expectedSig = crypto.createHmac('sha256', SHARED_SECRET).update(rawBody).digest('hex');

  if (signature !== expectedSig) {
    console.warn("❌ Invalid signature. Webhook blocked.");
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const event = JSON.parse(rawBody.toString());
  console.log("✅ Verified Coinbase Event:", event);

  if (event.type === 'charge:confirmed') {
    const charge = event.data;
    const amount = charge.pricing.local.amount;

    const response = await fetch("https://sovr-qr-final.vercel.app/api/trust-ach-execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount })
    });

    const achResult = await response.json();
    console.log("💸 ACH Triggered:", achResult);
  }

  return res.status(200).json({ received: true });
}