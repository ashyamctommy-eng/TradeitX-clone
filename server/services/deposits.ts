import crypto from 'crypto';
import { prisma } from '../db.js';
import { D, n, adjustBalance, getBalances } from '../money.js';
import { pushTelegramEvent } from '../telegram.js';
import { emitUser } from '../realtime.js';
import { getGatewaySettings, palplussEnabled } from './gatewaySettings.js';
import {
  initiateStk, getTransaction as getPalPlussTransaction,
  PalPlussError, type PalPlussTransaction,
} from '../../src/services/palplussService.js';
import {
  createPayment as createNowPayment, type NowPayment,
} from '../../src/services/nowpaymentsService.js';

export const CRYPTO_NETWORKS: Record<string, { label: string; ticker: string; min: number; rate: number; payCurrency: string }> = {
  BTC: { label: 'Bitcoin', ticker: 'BTC', min: 16, rate: 67420, payCurrency: 'btc' },
  ETH_ERC20: { label: 'Ethereum (ERC-20)', ticker: 'ETH', min: 16, rate: 3284.5, payCurrency: 'eth' },
  USDT_TRC20: { label: 'USDT (TRC-20)', ticker: 'USDT', min: 16, rate: 1, payCurrency: 'usdttrc20' },
  USDT_ERC20: { label: 'USDT (ERC-20)', ticker: 'USDT', min: 16, rate: 1, payCurrency: 'usdterc20' },
  LTC: { label: 'Litecoin', ticker: 'LTC', min: 16, rate: 84.2, payCurrency: 'ltc' },
};

const DEMO_ADDRESSES: Record<string, string> = {
  BTC: 'bc1qtradeitx9k2m4v7p8s0d3f6g5h2j4l7n',
  ETH_ERC20: '0x7A3f9C2bE14d88aB6c05F1e9D2b47C8a93E01b5D',
  USDT_TRC20: 'TQn9Y2kLm4vP7sR3dF6hJ8xZ1cV5bN0aM2w',
  USDT_ERC20: '0x7A3f9C2bE14d88aB6c05F1e9D2b47C8a93E01b5D',
  LTC: 'ltc1qtradeitx4k9m2v7p0s3d6f5g8h1j4l7n',
};

const publicUrl = () => (process.env.PUBLIC_URL || 'http://localhost:4000').replace(/\/$/, '');

/* ------------------------------------------------------------------ */
/* M-Pesa deposits — PalPluss STK when configured, simulation otherwise */
/* ------------------------------------------------------------------ */

export async function createMpesaDeposit(userId: string, amountUsd: number, phone: string) {
  if (amountUsd < 16) throw new Error('MIN_DEPOSIT_16');

  const { palpluss } = await getGatewaySettings();
  const rate = palpluss.depositRate || 129.35;
  const kes = Math.round(amountUsd * rate * 100) / 100;

  if (palplussEnabled(palpluss)) {
    const stk = await initiateStk(
      { apiKey: palpluss.apiKey, environment: palpluss.environment },
      {
        amountKes: kes,
        phone,
        accountReference: `D-${Date.now().toString(36).toUpperCase()}`.slice(0, 12),
        transactionDesc: 'Deposit',
        callbackUrl: `${publicUrl()}/api/webhooks/palpluss/stk`,
        channelId: palpluss.defaultChannelId || undefined,
      },
    );

    const tx = await prisma.transaction.create({
      data: {
        userId, accountType: 'real', type: 'deposit', amount: D(amountUsd),
        provider: 'palpluss', providerRef: stk.transactionId,
        providerTransactionId: stk.transactionId,
        gatewayAmount: D(kes), gatewayCurrency: 'KES',
        status: 'pending',
        details: `M-Pesa STK Push via PalPluss · KES ${kes.toFixed(2)} @ ${rate} · ${phone}`,
      },
    });

    await pushTelegramEvent({
      kind: 'DEPOSIT',
      title: `M-Pesa deposit · $${amountUsd.toFixed(2)}`,
      body: `PalPluss STK sent to ${phone}\nKES ${kes.toFixed(2)} · ref ${stk.transactionId}\nAwaiting customer PIN.`,
      refId: tx.id, status: 'PENDING',
    });

    return tx;
  }

  // No gateway key configured — local simulation (clearly labelled in the UI).
  const ref = `ws_CO_${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1e6).toString().padStart(6, '0')}`;
  const tx = await prisma.transaction.create({
    data: {
      userId, accountType: 'real', type: 'deposit', amount: D(amountUsd),
      provider: 'mpesa', providerRef: ref, status: 'pending',
      gatewayAmount: D(kes), gatewayCurrency: 'KES',
      details: `M-Pesa STK push (simulated) to ${phone} · ref ${ref}`,
    },
  });

  await pushTelegramEvent({
    kind: 'DEPOSIT',
    title: `M-Pesa deposit · $${amountUsd.toFixed(2)}`,
    body: `Ref ${ref}\nSimulated STK — no PalPluss key configured.\nConfirm only after funds land in the paybill.`,
    refId: tx.id, status: 'PENDING',
    buttons: [{ text: '✅ Confirm received', data: `dep:credit:${tx.id}` }],
  });
  return tx;
}

/** Manual confirmation used by admins and the Telegram bot. */
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
    body: `$${amount.toFixed(2)} added to real balance · ${tx.mpesaReceipt ?? tx.providerRef ?? tx.provider}`,
    refId: id,
  });
  return { ok: true };
}

/** Poll PalPluss when a webhook has not arrived (fallback path). */
const lastPoll = new Map<string, number>();

export async function reconcileMpesaDeposit(transactionId: string) {
  const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!tx || tx.status !== 'pending' || !tx.providerTransactionId) return tx;

  const now = Date.now();
  if (now - (lastPoll.get(transactionId) ?? 0) < 10_000) return tx;
  lastPoll.set(transactionId, now);

  const { palpluss } = await getGatewaySettings();
  if (!palplussEnabled(palpluss)) return tx;

  try {
    const remote = await getPalPlussTransaction(
      { apiKey: palpluss.apiKey, environment: palpluss.environment },
      tx.providerTransactionId,
    );
    await applyPalPlussTransaction(remote);
  } catch {
    /* rate-limited or transient — next poll retries */
  }
  return prisma.transaction.findUnique({ where: { id: transactionId } });
}

/* ------------------------------------------------------------------ */
/* PalPluss webhook                                                    */
/* ------------------------------------------------------------------ */

export type PalPlussWebhook = {
  event?: string;
  event_type?: string;
  transaction?: {
    id: string;
    type?: string;
    status?: string;
    amount?: number;
    currency?: string;
    phone_number?: string;
    external_reference?: string;
    mpesa_receipt?: string | null;
    transaction_fee?: number;
    result_code?: string | null;
    result_desc?: string | null;
    provider_request_id?: string | null;
    provider_checkout_id?: string | null;
  };
};

export async function applyPalPlussTransaction(remote: PalPlussTransaction) {
  const row = await prisma.transaction.findFirst({
    where: { OR: [{ providerTransactionId: remote.transactionId }, { providerRef: remote.transactionId }] },
  });
  if (!row) return { ok: true, matched: false as const };

  const status = remote.status;
  const terminal = ['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED', 'REVERSED'];
  if (!terminal.includes(status)) {
    await prisma.transaction.update({
      where: { id: row.id },
      data: { statusReason: `Provider status ${status}` },
    });
    return { ok: true, matched: true as const, status };
  }

  if (row.type === 'deposit') {
    if (row.status === 'completed') return { ok: true, matched: true as const, duplicate: true as const };
    if (status === 'SUCCESS') {
      const amount = n(row.amount);
      await prisma.$transaction([
        prisma.transaction.update({
          where: { id: row.id },
          data: {
            status: 'completed',
            statusReason: remote.resultDesc || 'M-Pesa confirmed',
            mpesaReceipt: remote.mpesaReceipt ?? remote.mpesa_receipt ?? null,
            providerTransactionId: remote.transactionId,
            details: `${row.details} · receipt ${remote.mpesaReceipt ?? remote.mpesa_receipt ?? '—'}`,
          },
        }),
      ]);
      await adjustBalance(row.userId, 'real', { available: amount });
      emitUser(row.userId, 'deposit:update', { id: row.id, status: 'completed' });
      emitUser(row.userId, 'balance:update', await getBalances(row.userId));
      await pushTelegramEvent({
        kind: 'DEPOSIT', title: 'Deposit settled', status: 'COMPLETED',
        body: `$${amount.toFixed(2)} · receipt ${remote.mpesaReceipt ?? remote.mpesa_receipt ?? '—'}`, refId: row.id,
      });
      return { ok: true, matched: true as const, status: 'completed' as const };
    }

    // failed / cancelled / expired
    await prisma.transaction.update({
      where: { id: row.id },
      data: {
        status: 'failed',
        statusReason: `${remote.resultCode ?? ''} ${remote.resultDesc ?? status}`.trim(),
      },
    });
    emitUser(row.userId, 'deposit:update', { id: row.id, status: 'failed' });
    await pushTelegramEvent({
      kind: 'DEPOSIT', title: 'Deposit failed', status: 'FAILED',
      body: `${status} · ${remote.resultDesc ?? 'No reason provided'}`, refId: row.id,
    });
    return { ok: true, matched: true as const, status: 'failed' as const };
  }

  if (row.type === 'withdrawal') {
    if (row.reviewStage === 'COMPLETED' || row.reviewStage === 'DECLINED') {
      return { ok: true, matched: true as const, duplicate: true as const };
    }
    if (status === 'SUCCESS') {
      const { approveWithdrawal, completeWithdrawal } = await import('./treasury.js');
      if (row.reviewStage === 'PENDING_REVIEW') await approveWithdrawal(row.id, 'palpluss');
      await completeWithdrawal(row.id, remote.mpesaReceipt ?? remote.mpesa_receipt ?? remote.transactionId);
      return { ok: true, matched: true as const, status: 'completed' as const };
    }
    if (['FAILED', 'REVERSED', 'CANCELLED', 'EXPIRED'].includes(status)) {
      const { declineWithdrawal } = await import('./treasury.js');
      await declineWithdrawal(
        row.id,
        remote.resultDesc || `Payout ${status.toLowerCase()}`,
        `PLP-${remote.resultCode || status}`,
      );
      return { ok: true, matched: true as const, status: 'refunded' as const };
    }
  }

  return { ok: true, matched: true as const };
}

/* ------------------------------------------------------------------ */
/* Crypto deposits — NOWPayments when configured                       */
/* ------------------------------------------------------------------ */

export async function createCryptoInvoice(userId: string, network: string, usdAmount: number) {
  const net = CRYPTO_NETWORKS[network];
  if (!net) throw new Error('UNKNOWN_NETWORK');
  if (usdAmount < net.min) throw new Error(`MIN_DEPOSIT_${net.min}`);

  const { nowpayments } = await getGatewaySettings();
  const sandbox = !nowpayments.apiKey;

  let payAddress = DEMO_ADDRESSES[network] || DEMO_ADDRESSES.BTC;
  let cryptoAmount = usdAmount / net.rate;
  let providerPaymentId: string | null = null;
  let paymentStatus = 'WAITING';

  if (!sandbox) {
    const payment: NowPayment = await createNowPayment(
      { apiKey: nowpayments.apiKey, ipnSecret: nowpayments.ipnSecret },
      {
        priceAmountUsd: usdAmount,
        payCurrency: net.payCurrency,
        orderId: `dep_${userId}_${Date.now()}`,
        ipnUrl: `${publicUrl()}/api/webhooks/nowpayments`,
        description: `TradeitX ${net.label} deposit`,
      },
    );
    payAddress = payment.pay_address;
    cryptoAmount = payment.pay_amount;
    providerPaymentId = payment.payment_id;
    paymentStatus = payment.payment_status?.toUpperCase() === 'WAITING' ? 'WAITING' : 'CONFIRMING';
  }

  const inv = await prisma.cryptoDepositInvoice.create({
    data: {
      userId, network,
      usdAmount: D(usdAmount),
      cryptoAmount: D(Number(cryptoAmount.toFixed(8))),
      depositAddress: payAddress,
      status: paymentStatus,
      providerPaymentId,
      payCurrency: net.payCurrency,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });

  await pushTelegramEvent({
    kind: 'DEPOSIT',
    title: `Crypto invoice · $${usdAmount.toFixed(2)}`,
    body: `${net.label} · ${cryptoAmount.toFixed(8)} ${net.ticker}\nAddress ${payAddress}\nStatus ${paymentStatus}${sandbox ? ' · SANDBOX' : ''}.`,
    refId: inv.id, status: paymentStatus,
  });

  return { invoice: inv, sandbox };
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

/** Map a NOWPayments IPN body onto an invoice. */
export async function applyNowPaymentsIpn(payload: {
  payment_id?: string | number;
  payment_status?: string;
  payin_hash?: string;
  order_id?: string;
  actually_paid?: number;
}) {
  const pid = payload.payment_id ? String(payload.payment_id) : null;
  let inv = pid
    ? await prisma.cryptoDepositInvoice.findFirst({ where: { providerPaymentId: pid } })
    : null;

  if (!inv && payload.order_id?.startsWith('inv_')) {
    inv = await prisma.cryptoDepositInvoice.findUnique({ where: { id: payload.order_id.slice(4) } });
  }
  if (!inv) return { ok: true, matched: false };

  const status = (payload.payment_status || '').toLowerCase();
  if (['finished', 'confirmed'].includes(status)) {
    await settleCryptoInvoice(inv.id, payload.payin_hash ?? null, 6);
    return { ok: true, matched: true, status: 'FINISHED' };
  }
  if (['waiting', 'confirming', 'sending', 'partially_paid'].includes(status)) {
    await prisma.cryptoDepositInvoice.update({
      where: { id: inv.id },
      data: { status: status === 'waiting' ? 'WAITING' : 'CONFIRMING' },
    });
    return { ok: true, matched: true, status: status.toUpperCase() };
  }
  if (['failed', 'expired', 'refunded'].includes(status)) {
    await prisma.cryptoDepositInvoice.update({ where: { id: inv.id }, data: { status: 'EXPIRED' } });
    return { ok: true, matched: true, status: 'EXPIRED' };
  }
  return { ok: true, matched: true, status };
}

export { PalPlussError };
