import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../auth.js';
import { n } from '../money.js';
import {
  createMpesaDeposit, createCryptoInvoice, settleCryptoInvoice, verifyNowPaymentsSignature,
  CRYPTO_NETWORKS,
} from '../services/deposits.js';
import { createWithdrawal, cancelWithdrawal, WITHDRAWAL_METHODS } from '../services/treasury.js';

const livePayments = () => process.env.ENABLE_LIVE_PAYMENTS === 'true';

export async function paymentRoutes(app: FastifyInstance) {
  app.get('/payment-methods', async () => ({
    livePaymentsEnabled: livePayments(),
    deposits: [
      { group: 'Mobile Money', id: 'mpesa', label: 'M-Pesa', min: 16, note: 'Instant STK push' },
      { group: 'Mobile Money', id: 'airtel', label: 'Airtel Money', min: 16, note: 'Instant' },
      { group: 'Cards & Wallets', id: 'payhero', label: 'Payhero', min: 16, note: 'Instant' },
      { group: 'Cards & Wallets', id: 'visa', label: 'Visa', min: 16, note: 'Popular' },
      { group: 'Cards & Wallets', id: 'neteller', label: 'Neteller', min: 16 },
      { group: 'Cards & Wallets', id: 'skrill', label: 'Skrill', min: 16 },
      { group: 'Cards & Wallets', id: 'dusupay', label: 'Dusupay', min: 16 },
      { group: 'Cards & Wallets', id: 'enovpay', label: 'Enovpay', min: 16 },
      ...Object.entries(CRYPTO_NETWORKS).map(([id, v]) => ({ group: 'Cryptocurrency', id, label: v.label, min: v.min })),
    ],
    withdrawals: Object.entries(WITHDRAWAL_METHODS).map(([id, v]) => ({ id, ...v })),
  }));

  app.post('/deposits/mpesa', { preHandler: requireUser }, async (req, reply) => {
    if (!livePayments()) return reply.code(403).send({ error: 'LIVE_PAYMENTS_DISABLED' });
    const body = z.object({ amount: z.number().min(16), phone: z.string().min(7) }).parse(req.body);
    try {
      const tx = await createMpesaDeposit(req.user!.id, body.amount, body.phone);
      return { id: tx.id, ref: tx.providerRef, status: tx.status, amount: n(tx.amount) };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get('/deposits/mpesa/:id', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const tx = await prisma.transaction.findFirst({ where: { id, userId: req.user!.id, type: 'deposit' } });
    if (!tx) return reply.code(404).send({ error: 'NOT_FOUND' });
    return {
      id: tx.id, ref: tx.providerRef, status: tx.status, amount: n(tx.amount),
      details: tx.details, createdAt: tx.createdAt.toISOString(),
    };
  });

  app.post('/deposits/crypto', { preHandler: requireUser }, async (req, reply) => {
    if (!livePayments()) return reply.code(403).send({ error: 'LIVE_PAYMENTS_DISABLED' });
    const body = z.object({ network: z.string(), usdAmount: z.number().min(16) }).parse(req.body);
    try {
      const { invoice, sandbox } = await createCryptoInvoice(req.user!.id, body.network, body.usdAmount);
      return {
        id: invoice.id, network: invoice.network, address: invoice.depositAddress,
        cryptoAmount: n(invoice.cryptoAmount), usdAmount: n(invoice.usdAmount),
        status: invoice.status, sandbox, expiresAt: invoice.expiresAt.toISOString(),
      };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get('/deposits/crypto/:id', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const inv = await prisma.cryptoDepositInvoice.findFirst({ where: { id, userId: req.user!.id } });
    if (!inv) return reply.code(404).send({ error: 'NOT_FOUND' });
    return {
      id: inv.id, network: inv.network, address: inv.depositAddress, status: inv.status,
      cryptoAmount: n(inv.cryptoAmount), usdAmount: n(inv.usdAmount), txHash: inv.txHash,
      confirmations: inv.confirmations, expiresAt: inv.expiresAt.toISOString(),
    };
  });

  app.post('/webhooks/nowpayments', async (req, reply) => {
    const raw = (req as { rawBody?: string }).rawBody ?? '';
    const sig = req.headers['x-nowpayments-sig'] as string | undefined;
    if (process.env.NOWPAYMENTS_IPN_SECRET && !verifyNowPaymentsSignature(raw, sig)) {
      return reply.code(401).send({ error: 'INVALID_SIGNATURE' });
    }
    const payload = req.body as { payment_status?: string; order_id?: string; payin_hash?: string };
    // Sandbox/testing path: order_id may carry invoice id directly.
    const invoiceId = payload.order_id?.startsWith('inv_') ? payload.order_id.slice(4) : payload.order_id;
    if (invoiceId && ['finished', 'confirmed', 'partially_paid'].includes(payload.payment_status ?? '')) {
      await settleCryptoInvoice(invoiceId, payload.payin_hash ?? null, 6);
    }
    return { ok: true };
  });

  /* ---------------- withdrawals ---------------- */
  app.post('/withdrawals', { preHandler: requireUser }, async (req, reply) => {
    if (!livePayments()) return reply.code(403).send({ error: 'LIVE_PAYMENTS_DISABLED' });
    const body = z.object({
      accountType: z.enum(['real', 'demo']).default('real'),
      amount: z.number().positive(),
      method: z.string(),
      destination: z.string().min(4),
    }).parse(req.body);
    try {
      const tx = await createWithdrawal(req.user!.id, body);
      return { id: tx.id, stage: tx.reviewStage, status: tx.status, amount: n(tx.amount) };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get('/withdrawals', { preHandler: requireUser }, async (req) => {
    const rows = await prisma.transaction.findMany({
      where: { userId: req.user!.id, type: 'withdrawal' },
      orderBy: { createdAt: 'desc' }, take: 50,
    });
    return rows.map((t) => ({
      id: t.id, amount: n(t.amount), method: t.provider, destination: t.destinationAddress,
      status: t.status, stage: t.reviewStage, reason: t.statusReason,
      reference: t.providerRef, createdAt: t.createdAt.toISOString(), details: t.details,
    }));
  });

  app.post('/withdrawals/:id/cancel', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await cancelWithdrawal(req.user!.id, id);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
}
