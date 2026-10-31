import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../auth.js';
import { n } from '../money.js';
import {
  createMpesaDeposit, createCryptoInvoice, settleCryptoInvoice,
  reconcileMpesaDeposit, applyPalPlussTransaction, applyNowPaymentsIpn, CRYPTO_NETWORKS,
} from '../services/deposits.js';
import { getGatewaySettings, palplussEnabled } from '../services/gatewaySettings.js';
import { verifyIpn } from '../../src/services/nowpaymentsService.js';
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
    await reconcileMpesaDeposit(id).catch(() => null);
    const tx = await prisma.transaction.findFirst({ where: { id, userId: req.user!.id, type: 'deposit' } });
    if (!tx) return reply.code(404).send({ error: 'NOT_FOUND' });
    return {
      id: tx.id, ref: tx.providerRef, status: tx.status, amount: n(tx.amount),
      details: tx.details, createdAt: tx.createdAt.toISOString(),
      mpesaReceipt: tx.mpesaReceipt,
      gatewayAmount: tx.gatewayAmount === null ? null : n(tx.gatewayAmount),
      gatewayCurrency: tx.gatewayCurrency,
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
    const { nowpayments } = await getGatewaySettings();
    const secret = nowpayments.ipnSecret || process.env.NOWPAYMENTS_IPN_SECRET || '';

    if (secret && !verifyIpn(raw, sig, secret)) {
      return reply.code(401).send({ error: 'INVALID_SIGNATURE' });
    }

    const payload = req.body as {
      payment_id?: string | number; payment_status?: string; payin_hash?: string;
      order_id?: string; actually_paid?: number;
    };

    const result = await applyNowPaymentsIpn(payload).catch(() => ({ ok: false }));
    return { ...result };
  });

  /* ---------------- PalPluss webhooks ---------------- */

  const palplussWebhook = async (req: { body: unknown }) => {
    // Acknowledge immediately; PalPluss retries up to 5× on non-2xx.
    const body = req.body as {
      event?: string;
      event_type?: string;
      transaction?: {
        id: string; type?: string; status?: string; amount?: number; currency?: string;
        phone_number?: string; external_reference?: string; mpesa_receipt?: string | null;
        result_code?: string | null; result_desc?: string | null;
        provider_request_id?: string | null; provider_checkout_id?: string | null;
        transaction_fee?: number;
      };
    };

    const t = body.transaction;
    if (!t?.id || !t.status) return { ok: true, ignored: 'NO_TRANSACTION' };

    // Map the callback shape onto the API transaction shape, then reuse one
    // idempotent settlement path (guarded by transaction.id).
    const mapped = {
      transactionId: t.id,
      type: (t.type as 'STK' | 'B2C') ?? 'STK',
      status: t.status as 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'PENDING' | 'PROCESSING' | 'REVERSED',
      amount: t.amount ?? 0,
      currency: t.currency ?? 'KES',
      phone: t.phone_number,
      accountReference: t.external_reference,
      resultCode: t.result_code ?? null,
      resultDesc: t.result_desc ?? null,
      mpesaReceipt: t.mpesa_receipt ?? null,
      providerRequestId: t.provider_request_id ?? null,
      providerCheckoutId: t.provider_checkout_id ?? null,
      transactionFee: t.transaction_fee ?? 0,
    };

    const result = await applyPalPlussTransaction(mapped).catch((e) => ({ ok: false, error: (e as Error).message }));
    return { ...result };
  };

  app.post('/webhooks/palpluss/stk', palplussWebhook);
  app.post('/webhooks/palpluss/b2c', palplussWebhook);

  /* ---------------- gateway info for the deposit UI ---------------- */
  app.get('/gateway-info', { preHandler: requireUser }, async () => {
    const { palpluss, nowpayments } = await getGatewaySettings();
    return {
      palpluss: {
        configured: palplussEnabled(palpluss),
        environment: palpluss.environment,
        depositRate: palpluss.depositRate,
        withdrawRate: palpluss.withdrawRate,
      },
      nowpayments: { configured: Boolean(nowpayments.apiKey), coins: nowpayments.coins },
    };
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
