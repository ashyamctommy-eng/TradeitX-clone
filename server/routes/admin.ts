import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAdmin } from '../auth.js';
import { n, D, adjustBalance, getBalances } from '../money.js';
import { approveWithdrawal, completeWithdrawal, declineWithdrawal } from '../services/treasury.js';
import { creditDeposit, settleCryptoInvoice } from '../services/deposits.js';
import { emitUser, emitTicket, emitAdmin } from '../realtime.js';
import { pushTelegramEvent } from '../telegram.js';
import { market } from '../market.js';
import {
  getGatewaySettings, savePalPluss, saveNowPayments, maskKey, palplussEnabled,
} from '../services/gatewaySettings.js';
import {
  testConnection, getServiceBalance, topUpServiceWallet, listChannels,
  createChannel, updateChannel, deleteChannel, PalPlussError,
} from '../../src/services/palplussService.js';
import { getApiStatus, NowPaymentsError } from '../../src/services/nowpaymentsService.js';

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/overview', async () => {
    const [users, deposits, withdrawals, tickets, trades, pendingDeps, pendingWds] = await Promise.all([
      prisma.profile.count(),
      prisma.transaction.aggregate({ where: { type: 'deposit', status: 'completed' }, _sum: { amount: true } }),
      prisma.transaction.aggregate({ where: { type: 'withdrawal', status: 'completed' }, _sum: { amount: true } }),
      prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'PENDING'] } } }),
      prisma.trade.count(),
      prisma.transaction.count({ where: { type: 'deposit', status: 'pending' } }),
      prisma.transaction.count({ where: { type: 'withdrawal', status: 'pending' } }),
    ]);
    return {
      users, tickets, trades,
      depositsTotal: n(deposits._sum.amount), withdrawalsTotal: n(withdrawals._sum.amount),
      pendingDeposits: pendingDeps, pendingWithdrawals: pendingWds,
    };
  });

  app.get('/admin/users', async (req) => {
    const q = (req.query as { q?: string }).q?.trim();
    const users = await prisma.profile.findMany({
      where: q ? { OR: [{ email: { contains: q } }, { username: { contains: q } }] } : {},
      orderBy: { createdAt: 'desc' }, take: 50,
      include: { balances: true },
    });
    return users.map((u) => ({
      id: u.id, email: u.email, username: u.username, userType: u.userType,
      frozen: u.frozen, kycRequired: u.kycRequired, country: u.country, phoneNumber: u.phoneNumber,
      preferredAccountType: u.preferredAccountType, createdAt: u.createdAt.toISOString(),
      balances: Object.fromEntries(u.balances.map((b) => [b.accountType, { amount: n(b.amount), locked: n(b.lockedAmount) }])),
    }));
  });

  app.post('/admin/users/:id/balance', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      accountType: z.enum(['real', 'demo']),
      amount: z.number().positive(),
      direction: z.enum(['credit', 'debit']),
      reason: z.string().default('Admin adjustment'),
    }).parse(req.body);
    try {
      const delta = body.direction === 'credit' ? body.amount : -body.amount;
      await adjustBalance(id, body.accountType, { available: delta });
      await prisma.transaction.create({
        data: {
          userId: id, accountType: body.accountType,
          type: body.direction === 'credit' ? 'deposit' : 'withdrawal',
          amount: D(body.amount), provider: 'admin_adjustment', status: 'completed',
          statusReason: body.reason, details: `${body.direction === 'credit' ? 'Credit' : 'Debit'} by ${req.user!.username} · ${body.reason}`,
        },
      });
      emitUser(id, 'balance:update', await getBalances(id));
      return { ok: true, balances: await getBalances(id) };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post('/admin/users/:id/flags', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      frozen: z.boolean().optional(),
      kycRequired: z.boolean().optional(),
      userType: z.enum(['standard', 'vip', 'admin']).optional(),
    }).parse(req.body);
    const u = await prisma.profile.update({ where: { id }, data: body });
    emitUser(id, 'account:update', { frozen: u.frozen, kycRequired: u.kycRequired });
    return { ok: true, frozen: u.frozen, kycRequired: u.kycRequired, userType: u.userType };
  });

  app.get('/admin/transactions', async (req) => {
    const q = req.query as { type?: string; status?: string };
    const rows = await prisma.transaction.findMany({
      where: { ...(q.type ? { type: q.type } : {}), ...(q.status ? { status: q.status } : {}) },
      orderBy: { createdAt: 'desc' }, take: 80,
      include: { user: { select: { username: true, email: true } } },
    });
    return rows.map((t) => ({
      id: t.id, user: t.user.username, email: t.user.email, type: t.type, amount: n(t.amount),
      provider: t.provider, ref: t.providerRef, status: t.status, stage: t.reviewStage,
      reason: t.statusReason, destination: t.destinationAddress,
      createdAt: t.createdAt.toISOString(), details: t.details,
    }));
  });

  app.post('/admin/deposits/:id/credit', async (req) => {
    const { id } = req.params as { id: string };
    await creditDeposit(id, req.user!.username);
    return { ok: true };
  });

  app.post('/admin/withdrawals/:id/approve', async (req) => {
    const { id } = req.params as { id: string };
    await approveWithdrawal(id, req.user!.username);
    return { ok: true, stage: 'PROCESSING' };
  });

  app.post('/admin/withdrawals/:id/complete', async (req) => {
    const { id } = req.params as { id: string };
    const { reference } = z.object({ reference: z.string().optional() }).parse(req.body ?? {});
    return completeWithdrawal(id, reference);
  });

  app.post('/admin/withdrawals/:id/decline', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ reason: z.string().default('Declined by compliance'), code: z.string().default('MRG-108') }).parse(req.body ?? {});
    await declineWithdrawal(id, body.reason, body.code);
    return { ok: true };
  });

  app.get('/admin/tickets', async () => {
    const tickets = await prisma.supportTicket.findMany({
      orderBy: { updatedAt: 'desc' }, take: 60,
      include: { user: { select: { username: true, email: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return tickets.map((t) => ({
      id: t.id, subject: t.subject, status: t.status, user: t.user.username, email: t.user.email,
      updatedAt: t.updatedAt.toISOString(), lastMessage: t.messages[0]?.body ?? '',
      unread: t.status === 'OPEN',
    }));
  });

  app.get('/admin/tickets/:id', async (req) => {
    const { id } = req.params as { id: string };
    const t = await prisma.supportTicket.findUniqueOrThrow({ where: { id }, include: { messages: { orderBy: { createdAt: 'asc' } }, user: true } });
    return {
      id: t.id, subject: t.subject, status: t.status, user: t.user.username, email: t.user.email,
      messages: t.messages.map((m) => ({ id: m.id, senderType: m.senderType, senderName: m.senderName, body: m.body, createdAt: m.createdAt.toISOString() })),
    };
  });

  app.post('/admin/tickets/:id/reply', async (req) => {
    const { id } = req.params as { id: string };
    const { body } = z.object({ body: z.string().min(1) }).parse(req.body);
    const msg = await prisma.supportMessage.create({
      data: { ticketId: id, senderType: 'AGENT', senderName: req.user!.username, body },
    });
    const t = await prisma.supportTicket.update({ where: { id }, data: { status: 'PENDING', assignedAgentName: req.user!.username } });
    emitTicket(id, 'support:message', { id: msg.id, senderType: 'AGENT', senderName: msg.senderName, body, createdAt: msg.createdAt.toISOString() });
    emitUser(t.userId, 'support:update', { ticketId: id });
    return { ok: true };
  });

  app.get('/admin/instruments', async () => market.configs());

  app.put('/admin/instruments/:symbol', async (req, reply) => {
    const { symbol } = req.params as { symbol: string };
    const body = z.object({
      payoutRate: z.number().min(0.1).max(0.95).optional(),
      minStake: z.number().positive().optional(),
      maxStake: z.number().positive().optional(),
      isActive: z.boolean().optional(),
      mode: z.enum(['OTC', 'LIVE']).optional(),
    }).parse(req.body);
    const cfg = market.config(symbol);
    if (!cfg) return reply.code(404).send({ error: 'NOT_FOUND' });
    Object.assign(cfg, body);
    await prisma.instrument.upsert({
      where: { symbol },
      create: { symbol, label: cfg.label, mode: cfg.mode, basePrice: cfg.basePrice, payoutRate: cfg.payoutRate, minStake: cfg.minStake, maxStake: cfg.maxStake, isActive: cfg.isActive, digits: cfg.digits },
      update: body,
    }).catch(() => null);
    return { ok: true, instrument: cfg };
  });

  app.get('/admin/telegram', async () => {
    const events = await prisma.telegramEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 60 });
    return {
      configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ADMIN_CHAT_ID),
      events: events.map((e) => ({
        id: e.id, direction: e.direction, kind: e.kind, title: e.title, body: e.body,
        status: e.status, refId: e.refId, createdAt: e.createdAt.toISOString(),
        buttons: e.payload ? JSON.parse(e.payload) : [],
      })),
    };
  });

  app.get('/admin/crypto/invoices', async () => {
    const rows = await prisma.cryptoDepositInvoice.findMany({
      orderBy: { createdAt: 'desc' }, take: 40,
      include: { user: { select: { username: true, email: true } } },
    });
    return rows.map((i) => ({
      id: i.id, user: i.user.username, network: i.network, usd: n(i.usdAmount),
      crypto: n(i.cryptoAmount), address: i.depositAddress, status: i.status,
      txHash: i.txHash, createdAt: i.createdAt.toISOString(),
    }));
  });

  app.post('/admin/sandbox/crypto/:id/confirm', async (req, reply) => {
    if (process.env.NODE_ENV === 'production') return reply.code(403).send({ error: 'SANDBOX_DISABLED' });
    const { id } = req.params as { id: string };
    await settleCryptoInvoice(id, `sandbox_${Date.now().toString(16)}`, 6);
    return { ok: true, note: 'Sandbox confirmation — development only' };
  });


  /* ---------------- payment gateways ---------------- */

  app.get('/admin/gateways', async () => {
    const s = await getGatewaySettings();
    return {
      palpluss: {
        configured: palplussEnabled(s.palpluss),
        keyPreview: maskKey(s.palpluss.apiKey),
        environment: s.palpluss.environment,
        depositRate: s.palpluss.depositRate,
        withdrawRate: s.palpluss.withdrawRate,
        defaultChannelId: s.palpluss.defaultChannelId,
      },
      nowpayments: {
        configured: Boolean(s.nowpayments.apiKey),
        keyPreview: maskKey(s.nowpayments.apiKey),
        ipnConfigured: Boolean(s.nowpayments.ipnSecret),
        coins: s.nowpayments.coins,
      },
      webhookBase: `${(process.env.PUBLIC_URL || 'http://localhost:4000').replace(/\/$/, '')}/api/webhooks`,
    };
  });

  app.put('/admin/gateways/palpluss', async (req, reply) => {
    const body = z.object({
      apiKey: z.string().optional(),
      environment: z.enum(['live', 'sandbox']).optional(),
      depositRate: z.number().positive().max(1000).optional(),
      withdrawRate: z.number().positive().max(1000).optional(),
      defaultChannelId: z.string().nullable().optional(),
    }).parse(req.body);

    const patch: Record<string, unknown> = {};
    if (body.apiKey !== undefined && !body.apiKey.includes('•')) {
      patch.apiKey = body.apiKey.trim(); // no prefix validation — pp_ / pk_ / anything
    }
    if (body.environment !== undefined) patch.environment = body.environment;
    if (body.depositRate !== undefined) patch.depositRate = body.depositRate;
    if (body.withdrawRate !== undefined) patch.withdrawRate = body.withdrawRate;
    if (body.defaultChannelId !== undefined) patch.defaultChannelId = body.defaultChannelId;

    const saved = await savePalPluss(patch);
    return {
      ok: true,
      configured: palplussEnabled(saved),
      keyPreview: maskKey(saved.apiKey),
      environment: saved.environment,
      depositRate: saved.depositRate,
      withdrawRate: saved.withdrawRate,
      defaultChannelId: saved.defaultChannelId,
    };
  });

  const ppCfg = async () => {
    const s = await getGatewaySettings();
    return { apiKey: s.palpluss.apiKey, environment: s.palpluss.environment };
  };

  const ppError = (e: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (e instanceof PalPlussError) {
      return reply.code(e.status || 502).send({ error: e.code, message: e.message, requestId: e.requestId });
    }
    return reply.code(502).send({ error: 'GATEWAY_ERROR', message: (e as Error).message });
  };

  app.post('/admin/gateways/palpluss/test', async (_req, reply) => {
    try {
      const res = await testConnection(await ppCfg());
      return res;
    } catch (e) { return ppError(e, reply); }
  });

  app.get('/admin/gateways/palpluss/balance', async (_req, reply) => {
    try {
      return { ok: true, ...(await getServiceBalance(await ppCfg())) };
    } catch (e) { return ppError(e, reply); }
  });

  app.post('/admin/gateways/palpluss/topup', async (req, reply) => {
    const body = z.object({ amountKes: z.number().min(1), phone: z.string().min(7) }).parse(req.body);
    try {
      const tx = await topUpServiceWallet(
        await ppCfg(),
        { amountKes: body.amountKes, phone: body.phone, accountReference: 'TOPUP', transactionDesc: 'Wallet top-up' },
        `topup-${Date.now()}`,
      );
      return { ok: true, transactionId: tx.transactionId, status: tx.status, amount: tx.amount };
    } catch (e) { return ppError(e, reply); }
  });

  app.get('/admin/gateways/palpluss/channels', async (_req, reply) => {
    try {
      return { ok: true, items: await listChannels(await ppCfg()) };
    } catch (e) { return ppError(e, reply); }
  });

  app.post('/admin/gateways/palpluss/channels', async (req, reply) => {
    const body = z.object({
      name: z.string().min(1),
      type: z.enum(['PAYBILL', 'TILL_NUMBER', 'SEND_MONEY']),
      shortcode: z.string().min(1),
      accountNumber: z.string().optional(),
      isDefault: z.boolean().optional(),
    }).parse(req.body);
    try {
      const ch = await createChannel(await ppCfg(), body);
      if (ch.isDefault) await savePalPluss({ defaultChannelId: ch.id });
      return { ok: true, channel: ch };
    } catch (e) { return ppError(e, reply); }
  });

  app.patch('/admin/gateways/palpluss/channels/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      name: z.string().optional(),
      accountNumber: z.string().nullable().optional(),
      isDefault: z.boolean().optional(),
    }).parse(req.body);
    try {
      const ch = await updateChannel(await ppCfg(), id, body);
      if (body.isDefault) await savePalPluss({ defaultChannelId: id });
      return { ok: true, channel: ch };
    } catch (e) { return ppError(e, reply); }
  });

  app.delete('/admin/gateways/palpluss/channels/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await deleteChannel(await ppCfg(), id);
      const s = await getGatewaySettings();
      if (s.palpluss.defaultChannelId === id) await savePalPluss({ defaultChannelId: null });
      return { ok: true };
    } catch (e) { return ppError(e, reply); }
  });

  app.put('/admin/gateways/nowpayments', async (req) => {
    const body = z.object({
      apiKey: z.string().optional(),
      ipnSecret: z.string().optional(),
      coins: z.array(z.string()).optional(),
    }).parse(req.body);

    const patch: Record<string, unknown> = {};
    if (body.apiKey !== undefined && !body.apiKey.includes('•')) patch.apiKey = body.apiKey.trim();
    if (body.ipnSecret !== undefined && !body.ipnSecret.includes('•')) patch.ipnSecret = body.ipnSecret.trim();
    if (body.coins !== undefined) patch.coins = body.coins;

    const saved = await saveNowPayments(patch);
    return {
      ok: true,
      configured: Boolean(saved.apiKey),
      keyPreview: maskKey(saved.apiKey),
      ipnConfigured: Boolean(saved.ipnSecret),
      coins: saved.coins,
    };
  });

  app.post('/admin/gateways/nowpayments/test', async (_req, reply) => {
    const s = await getGatewaySettings();
    if (!s.nowpayments.apiKey) {
      return reply.code(400).send({ error: 'NO_API_KEY', message: 'Add a NOWPayments API key first.' });
    }
    try {
      const started = Date.now();
      const res = await getApiStatus({ apiKey: s.nowpayments.apiKey, ipnSecret: s.nowpayments.ipnSecret });
      return { ok: true, latencyMs: Date.now() - started, message: res.message };
    } catch (e) {
      if (e instanceof NowPaymentsError) return reply.code(e.status || 502).send({ error: 'NOWPAYMENTS_ERROR', message: e.message });
      return reply.code(502).send({ error: 'GATEWAY_ERROR', message: (e as Error).message });
    }
  });

  app.post('/admin/broadcast', async (req) => {
    const { title, body } = z.object({ title: z.string().min(1), body: z.string().min(1) }).parse(req.body);
    // Same path as every other alert: mirror in-app, and send to Telegram when configured.
    const ev = await pushTelegramEvent({ kind: 'SYSTEM', title: `📡 ${title}`, body, status: 'BROADCAST' });
    emitAdmin('admin:notice', { title, body, at: Date.now() });
    const delivered = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ADMIN_CHAT_ID);
    return { ok: true, eventId: ev.id, delivered };
  });
}
