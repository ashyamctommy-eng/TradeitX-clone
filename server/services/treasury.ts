import { prisma } from '../db.js';
import { D, n, adjustBalance, lockFunds, getBalances } from '../money.js';
import { pushTelegramEvent } from '../telegram.js';
import { emitUser } from '../realtime.js';
import { getGatewaySettings, palplussEnabled } from './gatewaySettings.js';
import { createPayout, PalPlussError } from '../../src/services/palplussService.js';

export const WITHDRAWAL_METHODS: Record<string, { label: string; min: number; eta: string }> = {
  mpesa: { label: 'M-Pesa', min: 10, eta: '~10 min after approval' },
  bank: { label: 'Bank Transfer', min: 10, eta: '3–5 business days' },
  btc: { label: 'Bitcoin (BTC)', min: 50, eta: 'On-chain confirmation' },
  usdt_trc20: { label: 'USDT (TRC-20)', min: 50, eta: 'On-chain confirmation' },
};

export async function createWithdrawal(
  userId: string,
  input: { accountType: 'real' | 'demo'; amount: number; method: string; destination: string },
) {
  const method = WITHDRAWAL_METHODS[input.method];
  if (!method) throw new Error('UNKNOWN_METHOD');
  if (!Number.isFinite(input.amount) || input.amount < method.min) throw new Error(`MIN_WITHDRAWAL_${method.min}`);

  const profile = await prisma.profile.findUniqueOrThrow({ where: { id: userId } });
  if (profile.kycRequired) throw new Error('KYC_REQUIRED');
  if (input.accountType === 'demo') throw new Error('DEMO_NOT_WITHDRAWABLE');

  await lockFunds(userId, 'real', input.amount);

  const tx = await prisma.transaction.create({
    data: {
      userId,
      accountType: 'real',
      type: 'withdrawal',
      amount: D(input.amount),
      feeAmount: D(0),
      provider: input.method,
      destinationAddress: input.destination,
      status: 'pending',
      reviewStage: 'PENDING_REVIEW',
      details: `${method.label} withdrawal to ${input.destination}`,
    },
  });

  await pushTelegramEvent({
    kind: 'WITHDRAWAL',
    title: `Withdrawal request · $${input.amount.toFixed(2)}`,
    body: `${profile.username} (${profile.email})\n${method.label} → ${input.destination}\nStatus: Pending compliance & treasury review`,
    refId: tx.id,
    status: 'PENDING_REVIEW',
    buttons: [
      { text: '✅ Approve', data: `wd:approve:${tx.id}` },
      { text: '❌ Decline', data: `wd:decline:${tx.id}` },
    ],
  });

  emitUser(userId, 'balance:update', await getBalances(userId));
  return tx;
}

export async function cancelWithdrawal(userId: string, id: string) {
  const tx = await prisma.transaction.findFirstOrThrow({ where: { id, userId, type: 'withdrawal' } });
  if (tx.reviewStage !== 'PENDING_REVIEW') throw new Error('NOT_CANCELLABLE');
  const amount = n(tx.amount);
  await prisma.$transaction([
    prisma.transaction.update({
      where: { id },
      data: { status: 'failed', reviewStage: 'CANCELLED', statusReason: 'Cancelled by user', details: `${tx.details} — cancelled by user` },
    }),
    prisma.balance.update({
      where: { userId_accountType: { userId, accountType: 'real' } },
      data: { lockedAmount: { decrement: D(amount) }, amount: { increment: D(amount) } },
    }),
  ]);
  emitUser(userId, 'balance:update', await getBalances(userId));
  return { ok: true };
}

export async function approveWithdrawal(id: string, adminName = 'admin') {
  const tx = await prisma.transaction.findUniqueOrThrow({ where: { id } });
  if (tx.type !== 'withdrawal' || tx.reviewStage !== 'PENDING_REVIEW') throw new Error('INVALID_STATE');
  const updated = await prisma.transaction.update({
    where: { id },
    data: {
      reviewStage: 'PROCESSING',
      statusReason: `Approved by ${adminName}`,
      details: `${tx.details} — approved ${new Date().toISOString()}`,
    },
  });
  // Hand the payout to PalPluss when it is configured. If the call fails the
  // request stays in PROCESSING so an operator can retry or decline it.
  let payoutNote = '';
  const { palpluss } = await getGatewaySettings();
  if (tx.provider === 'mpesa' && palplussEnabled(palpluss) && tx.destinationAddress) {
    try {
      const kes = Math.round(n(tx.amount) * (palpluss.withdrawRate || 128.5) * 100) / 100;
      const payout = await createPayout(
        { apiKey: palpluss.apiKey, environment: palpluss.environment },
        {
          amountKes: kes,
          phone: tx.destinationAddress,
          reference: `WD-${tx.id.slice(-8).toUpperCase()}`,
          description: 'TradeitX withdrawal',
          callbackUrl: `${(process.env.PUBLIC_URL || 'http://localhost:4000').replace(/\/$/, '')}/api/webhooks/palpluss/b2c`,
        },
      );
      await prisma.transaction.update({
        where: { id },
        data: {
          providerTransactionId: payout.transactionId,
          providerRef: payout.transactionId,
          gatewayAmount: D(kes),
          gatewayCurrency: 'KES',
          statusReason: `Approved by ${adminName} · PalPluss payout queued`,
          channelId: payout.channelId ?? null,
        },
      });
      payoutNote = `\nPalPluss payout ${payout.transactionId} · KES ${kes.toFixed(2)} queued.`;
    } catch (e) {
      const err = e as PalPlussError;
      const note = `PalPluss payout could not be queued: ${err.code ?? 'ERROR'} ${err.message}`;
      await prisma.transaction.update({ where: { id }, data: { statusReason: note } });
      payoutNote = `\n⚠️ ${note} Retry from the queue or settle manually.`;
    }
  }

  emitUser(tx.userId, 'withdrawal:update', { id, stage: 'PROCESSING' });
  await pushTelegramEvent({
    kind: 'WITHDRAWAL', title: 'Withdrawal approved', status: 'PROCESSING',
    body: `$${n(tx.amount).toFixed(2)} · ${tx.provider} · ${tx.destinationAddress}\nPayout in progress.${payoutNote}`,
    refId: id, buttons: [{ text: '✅ Mark completed', data: `wd:complete:${id}` }],
  });
  return updated;
}

export async function completeWithdrawal(id: string, reference?: string) {
  const tx = await prisma.transaction.findUniqueOrThrow({ where: { id } });
  if (tx.type !== 'withdrawal' || tx.reviewStage !== 'PROCESSING') throw new Error('INVALID_STATE');
  const amount = n(tx.amount);
  const ref = reference || `TX-${Date.now().toString(36).toUpperCase()}`;
  await prisma.$transaction([
    prisma.transaction.update({
      where: { id },
      data: {
        status: 'completed', reviewStage: 'COMPLETED', providerRef: ref,
        statusReason: 'Paid', details: `${tx.details} — paid ref ${ref}`,
      },
    }),
    prisma.balance.update({
      where: { userId_accountType: { userId: tx.userId, accountType: 'real' } },
      data: { lockedAmount: { decrement: D(amount) } },
    }),
  ]);
  emitUser(tx.userId, 'withdrawal:update', { id, stage: 'COMPLETED', reference: ref });
  emitUser(tx.userId, 'balance:update', await getBalances(tx.userId));
  await pushTelegramEvent({
    kind: 'WITHDRAWAL', title: 'Withdrawal settled', status: 'COMPLETED',
    body: `$${amount.toFixed(2)} paid · ref ${ref}`, refId: id,
  });
  return { ok: true, reference: ref };
}

export async function declineWithdrawal(id: string, reason = 'Declined by compliance', code = 'MRG-108') {
  const tx = await prisma.transaction.findUniqueOrThrow({ where: { id } });
  if (tx.type !== 'withdrawal' || !['PENDING_REVIEW', 'PROCESSING'].includes(tx.reviewStage || '')) {
    throw new Error('INVALID_STATE');
  }
  const amount = n(tx.amount);
  await prisma.$transaction([
    prisma.transaction.update({
      where: { id },
      data: {
        status: 'failed', reviewStage: 'DECLINED', statusReason: `${code} · ${reason}`,
        details: `${tx.details} — declined (${code}) ${reason}`,
      },
    }),
    prisma.balance.update({
      where: { userId_accountType: { userId: tx.userId, accountType: 'real' } },
      data: { lockedAmount: { decrement: D(amount) }, amount: { increment: D(amount) } },
    }),
  ]);
  emitUser(tx.userId, 'withdrawal:update', { id, stage: 'DECLINED', reason: `${code} · ${reason}` });
  emitUser(tx.userId, 'balance:update', await getBalances(tx.userId));
  await pushTelegramEvent({
    kind: 'WITHDRAWAL', title: 'Withdrawal declined', status: 'DECLINED',
    body: `$${amount.toFixed(2)} returned to balance\n${code} · ${reason}`, refId: id,
  });
  return { ok: true };
}
