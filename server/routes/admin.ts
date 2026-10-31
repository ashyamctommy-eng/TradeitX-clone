import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAdmin } from '../auth.js';
import { n, D, adjustBalance, getBalances } from '../money.js';
import { approveWithdrawal, completeWithdrawal, declineWithdrawal } from '../services/treasury.js';
import { creditDeposit, settleCryptoInvoice } from '../services/deposits.js';
import { emitUser, emitTicket, emitAdmin } from '../realtime.js';
import { market } from '../market.js';

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

  app.post('/admin/broadcast', async (req) => {
    const { title, body } = z.object({ title: z.string(), body: z.string() }).parse(req.body);
    emitAdmin('admin:notice', { title, body, at: Date.now() });
    return { ok: true };
  });
}
