#!/usr/bin/env node
/**
 * NOWPayments IPN test: creates an invoice, signs a payload with
 * HMAC-SHA512 over the alphabetically-sorted body, and posts it.
 *
 * Usage: node scripts/test-webhook.mjs [apiBase]
 */
import crypto from 'crypto';

const BASE = process.argv[2] || process.env.API_BASE || 'http://localhost:4000';
const SECRET = process.env.NOWPAYMENTS_IPN_SECRET || 'sandbox-ipn-secret';

let cookie = '';
async function call(path, init = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...(init.headers || {}) },
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

const sortObject = (obj) => {
  if (Array.isArray(obj)) return obj.map(sortObject);
  if (obj && typeof obj === 'object') {
    return Object.keys(obj).sort().reduce((acc, k) => {
      acc[k] = sortObject(obj[k]);
      return acc;
    }, {});
  }
  return obj;
};

const login = await call('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: 'wildpharmtech9@gmail.com', password: 'TraderDemo123!' }),
});
if (login.status !== 200) throw new Error('login failed');

const inv = await call('/deposits/crypto', {
  method: 'POST',
  body: JSON.stringify({ network: 'BTC', usdAmount: 30 }),
});
if (inv.status !== 200) throw new Error('invoice failed: ' + JSON.stringify(inv.data));

const payload = {
  payment_status: 'finished',
  order_id: `inv_${inv.data.id}`,
  payin_hash: '0x' + crypto.randomBytes(12).toString('hex'),
  price_amount: 30,
  price_currency: 'usd',
  actually_paid: 30,
};

const sig = crypto
  .createHmac('sha512', SECRET)
  .update(JSON.stringify(sortObject(payload)))
  .digest('hex');

const bad = await fetch(`${BASE}/api/webhooks/nowpayments`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-nowpayments-sig': 'deadbeef' },
  body: JSON.stringify(payload),
});

const good = await call('/webhooks/nowpayments', {
  method: 'POST',
  headers: { 'x-nowpayments-sig': sig },
  body: JSON.stringify(payload),
});

const check = await call(`/deposits/crypto/${inv.data.id}`);

console.log('invoice      :', inv.data.id);
console.log('bad signature:', bad.status, bad.status === 401 ? '✓ rejected' : '✗ expected 401');
console.log('good request :', good.status, JSON.stringify(good.data));
console.log('invoice state:', check.data.status, check.data.status === 'FINISHED' ? '✓ settled' : '✗ not settled');
console.log('tx hash      :', check.data.txHash);

if (bad.status !== 401 || check.data.status !== 'FINISHED') process.exit(1);
