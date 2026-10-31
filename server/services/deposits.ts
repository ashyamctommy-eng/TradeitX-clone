import crypto from 'crypto';
import { prisma } from '../db.js';
import { D, n, adjustBalance, getBalances } from '../money.js';
import { pushTelegramEvent } from '../telegram.js';
import { emitUser } from '../realtime.js';

export const CRYPTO_NETWORKS: Record<string, { label: string; ticker: string; min: number; rate: number }> = {
  BTC: { label: 'Bitcoin', ticker: 'BTC', min: 16, rate: 67420 },
  ETH_ERC20: { label: 'Ethereum (ERC-20)', ticker: 'ETH', min: 16, rate: 3284.5 },
  USDT_TRC20: { label: 'USDT (TRC-20)', ticker: 'USDT', min: 16, rate: 1 },
  USDT_ERC20: { label: 'USDT (ERC-20)', ticker: 'USDT', min: 16, rate: 1 },
  LTC: { label: 'Litecoin', ticker: 'LTC', min: 16, rate: 84.2 },
};

const addresses: Record<string, string> = {
  BTC: 'bc1qtradeitx9k2m4v7p8s0d3f6g5h2j4l7n',
  ETH_ERC20: '0x7A3f9C2bE14d88aB6c05F1e9D2b47C8a93E01b5D',
  USDT_TRC20: 'TQn9Y2kLm4vP7sR3dF6hJ8xZ1cV5bN0aM2w',
  USDT_ERC20: '0x7A3f9C2bE14d88aB6c05F1e9D2b47C8a93E01b5D',
  LTC: 'ltc1qtradeitx4k9m2v7p0s3d6f5g8h1j4l7n',
};

export async function createMpesaDeposit(userId: string, amount: number, phone: string) {
  if (amount < 16) throw new Error('MIN_DEPOSIT_16');
  const ref = `ws_CO_${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1e6).toString().padStart(6, '0')}`;
  const tx = await prisma.transaction.create({
    data: {
      userId, accountType: 'real', type: 'deposit', amount: D(amount),
      provider: 'mpesa', providerRef: ref, status: 'pending',
      details: `M-Pesa STK push to ${phone} · ref ${ref}`,
    },
  });
  await pushTelegramEvent({
    kind: 'DEPOSIT',
    title: `M-Pesa deposit · $${amount.toFixed(2)}`,
    body: `Ref ${ref}\nAwaiting confirmation from the M-Pesa rail.\nConfirm only after the funds land in the paybill.`,
    refId: tx.id, status: 'PENDING',
    buttons: [{ text: '✅ Confirm received', data: `dep:credit:${tx.id}` }],
  });
  return tx;
}

export async function creditDeposit(id: string, adminName = 'admin') {
  const tx = await prisma.transaction.findUniqueOrThrow({ where: { id } });
  if (tx.type !== 'deposit' || tx.status === 'completed') throw new Error('INVALID_STATE');
  const amount = n(tx.amount);
  await adjustBalance(tx.userId, 'real', { available: amount });
  await prisma.transaction.update({
    where: { id },
    data: {
      status: 'completed',
      statusReason: `Confirmed by ${adminName}`,
      details: `${tx.details} — credited`,
    },
  });
  emitUser(tx.userId, 'deposit:update', { id, status: 'completed' });
  emitUser(tx.userId, 'balance:update', await getBalances(tx.userId));
  await pushTelegramEvent({
    kind: 'DEPOSIT', title: 'Deposit credited', status: 'COMPLETED',
    body: `$${amount.toFixed(2)} added to real balance · ${tx.providerRef ?? tx.provider}`, refId: id,
  });
  return { ok: true };
}

export async function createCryptoInvoice(userId: string, network: string, usdAmount: number) {
  const net = CRYPTO_NETWORKS[network];
  if (!net) throw new Error('UNKNOWN_NETWORK');
  if (usdAmount < net.min) throw new Error(`MIN_DEPOSIT_${net.min}`);

  const amount = usdAmount / net.rate;
  const address = addresses[network] || addresses.BTC;
  const sandbox = process.env.NOWPAYMENTS_SANDBOX !== 'false' || !process.env.NOWPAYMENTS_API_KEY;

  let providerRef: string | null = null;
  if (!sandbox) {
    const res = await fetch('https://api.nowpayments.io/v1/invoice', {
      method: 'POST',
      headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        price_amount: usdAmount,
        price_currency: 'usd',
        pay_currency: net.ticker.toLowerCase(),
        order_id: `tx_${userId}_${Date.now()}`,
        order_description: 'TradeitX wallet deposit',
        ipn_callback_url: `${process.env.PUBLIC_URL || 'http://localhost:4000'}/api/webhooks/nowpayments`,
      }),
    });
    if (!res.ok) throw new Error(`NOWPAYMENTS_${res.status}`);
    const data = await res.json();
    providerRef = data.invoice_id ? String(data.invoice_id) : null;
  }

  const inv = await prisma.cryptoDepositInvoice.create({
    data: {
      userId, network,
      usdAmount: D(usdAmount),
      cryptoAmount: D(amount.toFixed(8)),
      depositAddress: address,
      status: 'WAITING',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });
  await pushTelegramEvent({
    kind: 'DEPOSIT',
    title: `Crypto invoice · $${usdAmount.toFixed(2)}`,
    body: `${net.label} · ${amount.toFixed(8)} ${net.ticker}\nAddress ${address}\nStatus WAITING for on-chain payment.`,
    refId: inv.id, status: 'WAITING',
  });
  return { invoice: inv, providerRef, sandbox };
}

/** HMAC-SHA512 over the alphabetically-sorted body — matches NOWPayments IPN spec. */
export function verifyNowPaymentsSignature(rawBody: string, signature: string | undefined): boolean {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret || !signature) return false;
  const parsed = JSON.parse(rawBody);
  const sorted = sortObject(parsed);
  const hmac = crypto.createHmac('sha512', secret).update(JSON.stringify(sorted)).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
  } catch {
    return false;
  }
}

function sortObject(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortObject);
  if (obj && typeof obj === 'object') {
    return Object.keys(obj as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortObject((obj as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return obj;
}

export async function settleCryptoInvoice(invoiceId: string, txHash: string | null, confirmations = 6) {
  const inv = await prisma.cryptoDepositInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (inv.status === 'FINISHED') return { ok: true, already: true };
  const usd = n(inv.usdAmount);
  await prisma.$transaction([
    prisma.cryptoDepositInvoice.update({
      where: { id: invoiceId },
      data: { status: 'FINISHED', txHash: txHash ?? `sandbox_${crypto.randomBytes(8).toString('hex')}`, confirmations },
    }),
    prisma.transaction.create({
      data: {
        userId: inv.userId, accountType: 'real', type: 'deposit', amount: D(usd),
        provider: `crypto:${inv.network}`, providerRef: txHash ?? invoiceId, status: 'completed',
        details: `${inv.network} deposit · ${n(inv.cryptoAmount).toFixed(8)} → $${usd.toFixed(2)}`,
      },
    }),
  ]);
  await adjustBalance(inv.userId, 'real', { available: usd });
  emitUser(inv.userId, 'deposit:update', { id: invoiceId, status: 'FINISHED' });
  emitUser(inv.userId, 'balance:update', await getBalances(inv.userId));
  await pushTelegramEvent({
    kind: 'DEPOSIT', title: 'Crypto deposit confirmed', status: 'COMPLETED',
    body: `$${usd.toFixed(2)} · ${inv.network} · ${confirmations} confirmations`, refId: invoiceId,
  });
  return { ok: true };
}
