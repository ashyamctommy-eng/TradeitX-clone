import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../auth.js';
import { n, D, getBalances } from '../money.js';
import { market } from '../market.js';
import { openTrade, serializeTrade, signalSnapshot, momentumDirection } from '../engine.js';
import { emitUser } from '../realtime.js';

export async function tradingRoutes(app: FastifyInstance) {
  app.get('/balances', { preHandler: requireUser }, async (req) => getBalances(req.user!.id));

  app.get('/prices', async () => {
    const out: Record<string, number> = {};
    for (const c of market.configs()) out[c.symbol] = market.price(c.symbol);
    return out;
  });

  app.get('/prices/:symbol/history', async (req) => {
    const { symbol } = req.params as { symbol: string };
    const q = req.query as { tf?: string };
    const map: Record<string, number> = { '5s': 5, '15s': 15, '30s': 30, '1m': 60, '5m': 300 };
    const seconds = map[q.tf ?? '1m'] ?? 60;
    return { symbol: decodeURIComponent(symbol), tf: q.tf ?? '1m', candles: market.candles(decodeURIComponent(symbol), seconds) };
  });

  app.get('/trades', { preHandler: requireUser }, async (req) => {
    const { account } = req.query as { account?: string };
    const rows = await prisma.trade.findMany({
      where: { userId: req.user!.id, ...(account ? { accountType: account } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(serializeTrade);
  });

  app.post('/trades', { preHandler: requireUser }, async (req, reply) => {
    const body = z.object({
      symbol: z.string(),
      direction: z.enum(['BUY', 'SELL']),
      stake: z.number().positive(),
      durationSeconds: z.number().int().positive(),
      accountType: z.enum(['real', 'demo']),
    }).parse(req.body);

    try {
      const trade = await openTrade({ ...body, userId: req.user!.id, triggeredBy: 'MANUAL' });
      return { ...serializeTrade(trade), balances: await getBalances(req.user!.id) };
    } catch (e) {
      const msg = (e as Error).message;
      return reply.code(400).send({ error: msg });
    }
  });

  /* ---------------- auto trade ---------------- */
  app.get('/auto-trade/config', { preHandler: requireUser }, async (req) => {
    let cfg = await prisma.autoTradeConfig.findUnique({ where: { userId: req.user!.id } });
    if (!cfg) cfg = await prisma.autoTradeConfig.create({ data: { userId: req.user!.id } });
    return {
      isRunning: cfg.isRunning,
      activeStrategies: JSON.parse(cfg.activeStrategies || '[]'),
      frequencySeconds: cfg.frequencySeconds,
      fixedAmount: n(cfg.fixedAmount),
      riskLevel: cfg.riskLevel,
      reinvestProfits: cfg.reinvestProfits,
      useMarketAnalysis: cfg.useMarketAnalysis,
    };
  });

  app.put('/auto-trade/config', { preHandler: requireUser }, async (req) => {
    const body = z.object({
      isRunning: z.boolean().optional(),
      activeStrategies: z.array(z.string()).optional(),
      frequencySeconds: z.number().int().min(5).max(3600).optional(),
      fixedAmount: z.number().positive().optional(),
      riskLevel: z.number().int().min(1).max(5).optional(),
      reinvestProfits: z.boolean().optional(),
      useMarketAnalysis: z.boolean().optional(),
    }).parse(req.body);

    const data: Record<string, unknown> = { ...body };
    if (body.activeStrategies) data.activeStrategies = JSON.stringify(body.activeStrategies);
    const cfg = await prisma.autoTradeConfig.upsert({
      where: { userId: req.user!.id },
      create: { userId: req.user!.id, ...data },
      update: data,
    });
    return { ok: true, isRunning: cfg.isRunning };
  });

  app.get('/auto-trade/signals', async () => {
    const snap = signalSnapshot('EUR/USD');
    const trades = await prisma.trade.count({ where: { triggeredBy: 'AUTO_BOT' } }).catch(() => 0);
    return { ...snap, totalAutoTrades: trades };
  });

  app.post('/auto-trade/test', { preHandler: requireUser }, async (req) => {
    const body = z.object({ strategy: z.string() }).parse(req.body);
    // Deterministic 30-trade backtest over recent candles.
    const candles = market.candles('EUR/USD', 60, 240);
    let wins = 0, pnl = 0;
    for (let i = 1; i < candles.length - 1; i++) {
      const dir = candles[i].close >= candles[i - 1].close ? 'BUY' : 'SELL';
      const next = candles[i + 1].close;
      const won = dir === 'BUY' ? next >= candles[i].close : next <= candles[i].close;
      if (won) { wins++; pnl += 10 * 0.82; } else { pnl -= 10; }
    }
    return {
      strategy: body.strategy,
      trades: candles.length - 2,
      winRate: Number(((wins / (candles.length - 2)) * 100).toFixed(1)),
      pnl: Number(pnl.toFixed(2)),
      note: 'Simulated against the platform’s own historical price series.',
    };
  });

  /* ---------------- copy trading ---------------- */
  app.get('/copy-traders', { preHandler: requireUser }, async (req) => {
    const traders = await prisma.copyTrader.findMany({ orderBy: { sortOrder: 'asc' } });
    const subs = await prisma.userCopySubscription.findMany({ where: { userId: req.user!.id } });
    const active = new Set(subs.filter((s) => s.active).map((s) => s.traderId));
    return traders.map((t) => ({ ...t, subscribed: active.has(t.id) }));
  });

  app.post('/copy-traders/:id/toggle', { preHandler: requireUser }, async (req) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.userCopySubscription.findUnique({
      where: { userId_traderId: { userId: req.user!.id, traderId: id } },
    });
    if (existing) {
      const updated = await prisma.userCopySubscription.update({
        where: { id: existing.id }, data: { active: !existing.active },
      });
      return { subscribed: updated.active };
    }
    await prisma.userCopySubscription.create({ data: { userId: req.user!.id, traderId: id } });
    return { subscribed: true };
  });

  /* ---------------- transactions ---------------- */
  app.get('/transactions', { preHandler: requireUser }, async (req) => {
    const q = req.query as { type?: string; status?: string; account?: string; limit?: string };
    const rows = await prisma.transaction.findMany({
      where: {
        userId: req.user!.id,
        ...(q.type && q.type !== 'all' ? { type: q.type } : {}),
        ...(q.status && q.status !== 'all' ? { status: q.status } : {}),
        ...(q.account && q.account !== 'all' ? { accountType: q.account } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(q.limit) || 200, 500),
    });
    const all = await prisma.transaction.findMany({ where: { userId: req.user!.id } });
    const totals = {
      deposits: all.filter((t) => t.type === 'deposit' && t.status === 'completed').reduce((s, t) => s + n(t.amount), 0),
      withdrawals: all.filter((t) => t.type === 'withdrawal' && t.status === 'completed').reduce((s, t) => s + n(t.amount), 0),
    };
    return {
      totals,
      rows: rows.map((t) => ({
        id: t.id, type: t.type, accountType: t.accountType, amount: n(t.amount),
        fee: n(t.feeAmount), provider: t.provider, providerRef: t.providerRef,
        destination: t.destinationAddress, status: t.status, reviewStage: t.reviewStage,
        statusReason: t.statusReason, details: t.details, createdAt: t.createdAt.toISOString(),
      })),
    };
  });

  /* ---------------- support ---------------- */
  app.get('/support/tickets', { preHandler: requireUser }, async (req) => {
    const tickets = await prisma.supportTicket.findMany({
      where: { userId: req.user!.id },
      orderBy: { updatedAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return tickets.map((t) => ({
      id: t.id, subject: t.subject, status: t.status, updatedAt: t.updatedAt.toISOString(),
      lastMessage: t.messages[0]?.body ?? '', agent: t.assignedAgentName,
    }));
  });

  app.post('/support/tickets', { preHandler: requireUser }, async (req) => {
    const body = z.object({ subject: z.string().min(3), message: z.string().min(1) }).parse(req.body);
    const ticket = await prisma.supportTicket.create({
      data: {
        userId: req.user!.id, subject: body.subject, status: 'OPEN',
        messages: { create: { senderType: 'USER', senderName: req.user!.username, body: body.message } },
      },
    });
    const { pushTelegramEvent } = await import('../telegram.js');
    await pushTelegramEvent({
      kind: 'TICKET', title: `New ticket · ${body.subject}`, status: 'OPEN', refId: ticket.id,
      body: `${req.user!.username}: ${body.message.slice(0, 180)}`,
    });
    return { id: ticket.id };
  });

  app.get('/support/tickets/:id', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ticket = await prisma.supportTicket.findFirst({
      where: { id, userId: req.user!.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) return reply.code(404).send({ error: 'NOT_FOUND' });
    return {
      id: ticket.id, subject: ticket.subject, status: ticket.status,
      messages: ticket.messages.map((m) => ({
        id: m.id, senderType: m.senderType, senderName: m.senderName,
        body: m.body, createdAt: m.createdAt.toISOString(),
      })),
    };
  });

  app.post('/support/tickets/:id/messages', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { body } = z.object({ body: z.string().min(1).max(4000) }).parse(req.body);
    const ticket = await prisma.supportTicket.findFirst({ where: { id, userId: req.user!.id } });
    if (!ticket) return reply.code(404).send({ error: 'NOT_FOUND' });
    const msg = await prisma.supportMessage.create({
      data: { ticketId: id, senderType: 'USER', senderName: req.user!.username, body },
    });
    await prisma.supportTicket.update({ where: { id }, data: { status: 'OPEN', updatedAt: new Date() } });
    const { emitTicket, emitAdmin } = await import('../realtime.js');
    emitTicket(id, 'support:message', { id: msg.id, senderType: 'USER', senderName: msg.senderName, body, createdAt: msg.createdAt.toISOString() });
    emitAdmin('admin:support', { ticketId: id, body });
    const { pushTelegramEvent } = await import('../telegram.js');
    await pushTelegramEvent({
      kind: 'TICKET', title: `Reply · ${ticket.subject}`, status: 'OPEN', refId: id,
      body: `${req.user!.username}: ${body.slice(0, 180)}`,
    });
    return { ok: true };
  });

  app.get('/fx', async () => {
    const base: Record<string, number> = {
      USD: 1, EUR: 0.8959, GBP: 0.7862, JPY: 157.32, CNY: 7.26,
      INR: 83.42, BTC: 0.00001483, KES: 129.35, NGN: 1487.2,
      ZAR: 18.42, UGX: 3782.5, TZS: 2648.9, GHS: 14.72,
    };
    const jitter = (v: number) => v * (1 + (Math.random() - 0.5) * 0.0004);
    const rates: Record<string, number> = {};
    for (const [k, v] of Object.entries(base)) rates[k] = Number(jitter(v).toPrecision(6));
    return { base: 'USD', rates, updatedAt: new Date().toISOString() };
  });

  app.get('/terminal/summary', { preHandler: requireUser }, async (req) => {
    const [balances, openTrades, recent] = await Promise.all([
      getBalances(req.user!.id),
      prisma.trade.count({ where: { userId: req.user!.id, status: 'OPEN' } }),
      prisma.transaction.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 5 }),
    ]);
    return { balances, openTrades, recent: recent.map((t) => ({ id: t.id, type: t.type, amount: n(t.amount), status: t.status, createdAt: t.createdAt.toISOString(), details: t.details })) };
  });
}
