/**
 * PalPluss webhook + key-handling test.
 *
 * 1. accepts a `pp_test_…` key (no prefix validation)
 * 2. settles an STK success callback and credits the balance
 * 3. ignores the duplicate delivery (idempotent on transaction.id)
 * 4. refunds a B2C failure back to the user's balance
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE = process.env.API_BASE || 'http://localhost:4000';

type Jar = { cookie: string };
async function call<T>(jar: Jar, path: string, init: RequestInit = {}): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(jar.cookie ? { cookie: jar.cookie } : {}), ...(init.headers || {}) },
  });
  const sc = res.headers.get('set-cookie');
  if (sc) jar.cookie = sc.split(';')[0];
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, extra = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};

async function main() {
  console.log('\nPalPluss webhook test\n');
  const admin: Jar = { cookie: '' };
  const trader: Jar = { cookie: '' };

  await call(admin, '/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@tradeitx.com', password: 'BrabicanaAdmin123!' }) });
  await call(trader, '/auth/login', { method: 'POST', body: JSON.stringify({ email: 'wildpharmtech9@gmail.com', password: 'TraderDemo123!' }) });

  /* --- 1. key prefix handling --- */
  const saved = await call<{ configured: boolean; keyPreview: string }>(admin, '/admin/gateways/palpluss', {
    method: 'PUT', body: JSON.stringify({ apiKey: 'pp_test_9f3c2b7a1d4e', environment: 'sandbox' }),
  });
  check('pp_test_ key accepted (no prefix regex)', saved.status === 200 && saved.data.configured === true, JSON.stringify(saved.data));
  check('key masked in response', saved.data.keyPreview.startsWith('pp_test') && !saved.data.keyPreview.includes('9f3c2b7a1d4e'), saved.data.keyPreview);

  /* back to simulated mode so no outbound calls are attempted */
  await call(admin, '/admin/gateways/palpluss', { method: 'PUT', body: JSON.stringify({ apiKey: '' }) });

  const profile = await prisma.profile.findUniqueOrThrow({ where: { email: 'wildpharmtech9@gmail.com' } });
  const before = Number((await prisma.balance.findUniqueOrThrow({
    where: { userId_accountType: { userId: profile.id, accountType: 'real' } },
  })).amount);

  /* --- 2. STK success --- */
  const stkId = `stk-test-${Date.now()}`;
  const dep = await prisma.transaction.create({
    data: {
      userId: profile.id, accountType: 'real', type: 'deposit', amount: 20,
      provider: 'palpluss', providerRef: stkId, providerTransactionId: stkId,
      gatewayAmount: 2587, gatewayCurrency: 'KES', status: 'pending',
      details: 'Test STK deposit',
    },
  });

  const webhook = (body: unknown) => fetch(`${BASE}/api/webhooks/palpluss/stk`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  const okRes = await webhook({
    event: 'transaction.updated',
    event_type: 'transaction.success',
    transaction: {
      id: stkId, type: 'STK', status: 'SUCCESS', amount: 2587, currency: 'KES',
      phone_number: '254717702563', external_reference: 'D-TEST', mpesa_receipt: 'RKL9TEST01',
      result_code: '0', result_desc: 'The service request is processed successfully.',
    },
  });
  const okBody = await okRes.json();
  check('webhook returns 200', okRes.status === 200, String(okRes.status));
  check('webhook matched the deposit', okBody.matched === true, JSON.stringify(okBody));

  const depAfter = await prisma.transaction.findUniqueOrThrow({ where: { id: dep.id } });
  check('deposit marked completed', depAfter.status === 'completed');
  check('mpesa receipt stored', depAfter.mpesaReceipt === 'RKL9TEST01');
  const mid = Number((await prisma.balance.findUniqueOrThrow({
    where: { userId_accountType: { userId: profile.id, accountType: 'real' } },
  })).amount);
  check('balance credited $20', Math.abs(mid - before - 20) < 0.001, `${before} → ${mid}`);

  /* --- 3. duplicate delivery --- */
  const dup = await (await webhook({
    event: 'transaction.updated', event_type: 'transaction.success',
    transaction: { id: stkId, type: 'STK', status: 'SUCCESS', amount: 2587, currency: 'KES', mpesa_receipt: 'RKL9TEST01' },
  })).json();
  const afterDup = Number((await prisma.balance.findUniqueOrThrow({
    where: { userId_accountType: { userId: profile.id, accountType: 'real' } },
  })).amount);
  check('duplicate is acknowledged', dup.ok === true);
  check('duplicate does not double-credit', Math.abs(afterDup - mid) < 0.001, `${mid} → ${afterDup}`);

  /* --- 4. B2C failure refunds --- */
  const wd = await prisma.transaction.create({
    data: {
      userId: profile.id, accountType: 'real', type: 'withdrawal', amount: 10,
      provider: 'mpesa', destinationAddress: '+254717702563', status: 'pending',
      reviewStage: 'PROCESSING', providerTransactionId: `b2c-test-${Date.now()}`,
      gatewayAmount: 1285, gatewayCurrency: 'KES', details: 'Test payout',
    },
  });
  // simulate the locked funds that a real request would have moved
  await prisma.balance.update({
    where: { userId_accountType: { userId: profile.id, accountType: 'real' } },
    data: { amount: { decrement: 10 }, lockedAmount: { increment: 10 } },
  });

  const failRes = await fetch(`${BASE}/api/webhooks/palpluss/b2c`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'transaction.updated', event_type: 'transaction.failed',
      transaction: {
        id: wd.providerTransactionId, type: 'B2C', status: 'FAILED', amount: 1285, currency: 'KES',
        phone_number: '254717702563', result_code: '1037', result_desc: 'DS timeout',
      },
    }),
  });
  const failBody = await failRes.json();
  check('B2C failure accepted', failRes.status === 200 && failBody.matched === true, JSON.stringify(failBody));

  const wdAfter = await prisma.transaction.findUniqueOrThrow({ where: { id: wd.id } });
  check('withdrawal declined with provider code', wdAfter.reviewStage === 'DECLINED' && (wdAfter.statusReason || '').includes('1037'), wdAfter.statusReason || '');
  const afterRefund = await prisma.balance.findUniqueOrThrow({
    where: { userId_accountType: { userId: profile.id, accountType: 'real' } },
  });
  check('funds returned to available', Math.abs(Number(afterRefund.amount) - afterDup) < 0.001, `${afterDup} → ${afterRefund.amount}`);
  check('locked balance cleared', Math.abs(Number(afterRefund.lockedAmount) - 0) < 0.001, String(afterRefund.lockedAmount));

  /* --- 5. unknown transaction --- */
  const unknown = await (await webhook({
    event: 'transaction.updated', event_type: 'transaction.success',
    transaction: { id: `nope-${Date.now()}`, type: 'STK', status: 'SUCCESS', amount: 1 },
  })).json();
  check('unknown transaction is acknowledged but unmatched', unknown.ok === true && unknown.matched === false);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
}

main().finally(() => prisma.$disconnect());
