/**
 * End-to-end API smoke test.
 * Exercises auth, trading, settlement, deposits, crypto invoices, the
 * withdrawal maker-checker flow, support tickets and the admin surface.
 */
const BASE = process.env.API_BASE || 'http://localhost:4000';

type Jar = { cookie: string };

async function call<T>(jar: Jar, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(jar.cookie ? { cookie: jar.cookie } : {}),
      ...(init.headers || {}),
    },
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) jar.cookie = setCookie.split(';')[0];
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data as T;
}

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('\nTradeitX API smoke test\n');

  const trader: Jar = { cookie: '' };
  const admin: Jar = { cookie: '' };

  /* auth */
  const login = await call<{ userType: string }>(trader, '/auth/login', {
    method: 'POST', body: JSON.stringify({ email: 'wildpharmtech9@gmail.com', password: 'TraderDemo123!' }),
  });
  check('trader login', login.userType === 'standard');

  const me = await call<{ balances: Record<string, { amount: number }>; username: string }>(trader, '/me');
  check('profile seeded as Blvd', me.username === 'Blvd');
  check('demo balance seeded', me.balances.demo.amount > 9000, JSON.stringify(me.balances));

  const txs = await call<{ rows: { providerRef: string | null; status: string }[] }>(trader, '/transactions');
  check('historical failed M-Pesa row', txs.rows.some((t) => t.providerRef?.startsWith('ws_CO_') && t.status === 'failed'));

  /* trading + settlement */
  const before = (await call<{ demo: { amount: number } }>(trader, '/balances')).demo.amount;
  const trade = await call<{ id: string; status: string }>(trader, '/trades', {
    method: 'POST',
    body: JSON.stringify({ symbol: 'EUR/USD', direction: 'BUY', stake: 1, durationSeconds: 5, accountType: 'demo' }),
  });
  check('trade opens', trade.status === 'OPEN');
  await sleep(7500);
  const after = (await call<{ demo: { amount: number } }>(trader, '/balances')).demo.amount;
  const settled = await call<{ id: string; status: string; pnl: number | null }[]>(trader, '/trades?account=demo');
  const t = settled.find((x) => x.id === trade.id);
  check('trade settles', t?.status === 'WON' || t?.status === 'LOST', JSON.stringify(t));
  check('balance moved by settlement', Math.abs(after - before) > 0.5);

  /* mpesa deposit → admin credit */
  const dep = await call<{ id: string; ref: string }>(trader, '/deposits/mpesa', {
    method: 'POST', body: JSON.stringify({ amount: 20, phone: '+254717702563' }),
  });
  check('M-Pesa STK request created', dep.ref.startsWith('ws_CO_'));

  const al = await call<{ userType: string }>(admin, '/auth/login', {
    method: 'POST', body: JSON.stringify({ email: 'admin@tradeitx.com', password: 'BrabicanaAdmin123!' }),
  });
  check('admin login', al.userType === 'admin');

  const realBefore = (await call<{ real: { amount: number } }>(trader, '/balances')).real.amount;
  await call(admin, `/admin/deposits/${dep.id}/credit`, { method: 'POST', body: '{}' });
  const realAfterDeposit = (await call<{ real: { amount: number } }>(trader, '/balances')).real.amount;
  check('deposit credited after confirmation', Math.abs(realAfterDeposit - realBefore - 20) < 0.001);

  /* crypto invoice → webhook-equivalent settlement */
  const inv = await call<{ id: string; address: string }>(trader, '/deposits/crypto', {
    method: 'POST', body: JSON.stringify({ network: 'USDT_TRC20', usdAmount: 25 }),
  });
  check('crypto invoice has address', inv.address.length > 10);
  await call(admin, `/admin/sandbox/crypto/${inv.id}/confirm`, { method: 'POST', body: '{}' });
  const realAfterCrypto = (await call<{ real: { amount: number } }>(trader, '/balances')).real.amount;
  check('crypto deposit settles', Math.abs(realAfterCrypto - realAfterDeposit - 25) < 0.001);

  /* withdrawal maker-checker */
  const wd = await call<{ id: string; stage: string }>(trader, '/withdrawals', {
    method: 'POST', body: JSON.stringify({ accountType: 'real', amount: 10, method: 'mpesa', destination: '+254717702563' }),
  });
  check('withdrawal starts PENDING_REVIEW', wd.stage === 'PENDING_REVIEW');
  const locked = (await call<{ real: { locked: number } }>(trader, '/balances')).real.locked;
  check('withdrawal locks funds', Math.abs(locked - 10) < 0.001, String(locked));

  await call(admin, `/admin/withdrawals/${wd.id}/approve`, { method: 'POST', body: '{}' });
  const list = await call<{ id: string; stage: string }[]>(trader, '/withdrawals');
  check('approval moves to PROCESSING', list.find((w) => w.id === wd.id)?.stage === 'PROCESSING');

  const done = await call<{ reference: string }>(admin, `/admin/withdrawals/${wd.id}/complete`, { method: 'POST', body: '{}' });
  check('completion returns a reference', Boolean(done.reference));
  const afterWd = await call<{ real: { amount: number; locked: number } }>(trader, '/balances');
  check('locked released after payout', Math.abs(afterWd.real.locked) < 0.001);
  check('payout debited real balance', Math.abs(afterWd.real.amount - (realAfterCrypto - 10)) < 0.001);

  /* decline path refunds */
  const wd2 = await call<{ id: string }>(trader, '/withdrawals', {
    method: 'POST', body: JSON.stringify({ accountType: 'real', amount: 10, method: 'mpesa', destination: '+254717702563' }),
  });
  await call(admin, `/admin/withdrawals/${wd2.id}/decline`, {
    method: 'POST', body: JSON.stringify({ reason: 'Test decline', code: 'AML-402' }),
  });
  const afterDecline = await call<{ real: { amount: number; locked: number } }>(trader, '/balances');
  check('decline refunds balance', Math.abs(afterDecline.real.amount - afterWd.real.amount) < 0.001);
  check('decline clears locked', Math.abs(afterDecline.real.locked) < 0.001);

  /* support round-trip */
  const ticket = await call<{ id: string }>(trader, '/support/tickets', {
    method: 'POST', body: JSON.stringify({ subject: 'Smoke test ticket', message: 'Does support work?' }),
  });
  await call(admin, `/admin/tickets/${ticket.id}/reply`, { method: 'POST', body: JSON.stringify({ body: 'Yes — DB-backed, no 403.' }) });
  const thread = await call<{ messages: { senderType: string; body: string }[] }>(trader, `/support/tickets/${ticket.id}`);
  check('support thread has agent reply', thread.messages.some((m) => m.senderType === 'AGENT'));

  /* admin surfaces */
  const ov = await call<{ users: number; trades: number }>(admin, '/admin/overview');
  check('admin overview computes', ov.users >= 2 && ov.trades >= 1);
  const tg = await call<{ events: unknown[] }>(admin, '/admin/telegram');
  check('telegram mirror has events', tg.events.length > 0);
  const instr = await call<{ symbol: string }[]>(admin, '/admin/instruments');
  check('instrument config available', instr.length >= 6);

  /* guards */
  let blocked = false;
  try { await call(trader, '/admin/overview'); } catch { blocked = true; }
  check('non-admin blocked from /admin API', blocked);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error('SMOKE FAILED:', e); process.exit(1); });
