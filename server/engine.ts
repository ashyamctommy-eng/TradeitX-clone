import { prisma } from './db.js';
import { D, n, lockFunds, adjustBalance, getBalances } from './money.js';
import { market } from './market.js';
import { emitUser } from './realtime.js';

const lastAuto = new Map<string, number>();
const lastCopy = new Map<string, number>();

export type OpenTradeInput = {
  userId: string;
  accountType: 'real' | 'demo';
  symbol: string;
  direction: 'BUY' | 'SELL';
  stake: number;
  durationSeconds: number;
  triggeredBy?: 'MANUAL' | 'AUTO_BOT' | 'COPY_TRADE';
  strategy?: string;
};

export async function openTrade(input: OpenTradeInput) {
  const cfg = market.config(input.symbol);
  if (!cfg || !cfg.isActive) throw new Error('INSTRUMENT_INACTIVE');
  if (input.stake < cfg.minStake) throw new Error(`MIN_STAKE_${cfg.minStake}`);
  if (input.stake > cfg.maxStake) throw new Error(`MAX_STAKE_${cfg.maxStake}`);

  await lockFunds(input.userId, input.accountType, input.stake);

  const entry = market.price(input.symbol);
  const trade = await prisma.trade.create({
    data: {
      userId: input.userId,
      accountType: input.accountType,
      symbol: input.symbol,
      mode: cfg.mode,
      direction: input.direction,
      stake: D(input.stake),
      durationSeconds: input.durationSeconds,
      payoutRate: cfg.payoutRate,
      entryPrice: entry,
      triggeredBy: input.triggeredBy ?? 'MANUAL',
      strategy: input.strategy,
      status: 'OPEN',
      expiresAt: new Date(Date.now() + input.durationSeconds * 1000),
    },
  });

  emitUser(input.userId, 'balance:update', await getBalances(input.userId));
  emitUser(input.userId, 'trade:open', serializeTrade(trade));
  return trade;
}

export function serializeTrade(t: {
  id: string; symbol: string; mode: string; direction: string; stake: unknown; durationSeconds: number;
  payoutRate: number; entryPrice: number; exitPrice: number | null; pnl: unknown; status: string;
  triggeredBy: string; strategy: string | null; createdAt: Date; expiresAt: Date; accountType: string;
}) {
  return {
    id: t.id, symbol: t.symbol, mode: t.mode, direction: t.direction, stake: n(t.stake as never),
    durationSeconds: t.durationSeconds, payoutRate: t.payoutRate, entryPrice: t.entryPrice,
    exitPrice: t.exitPrice, pnl: t.pnl === null || t.pnl === undefined ? null : n(t.pnl as never),
    status: t.status, triggeredBy: t.triggeredBy, strategy: t.strategy,
    accountType: t.accountType,
    createdAt: t.createdAt.toISOString(), expiresAt: t.expiresAt.toISOString(),
  };
}

async function settleDueTrades() {
  const due = await prisma.trade.findMany({
    where: { status: 'OPEN', expiresAt: { lte: new Date() } },
    take: 100,
  });

  for (const trade of due) {
    const exit = market.price(trade.symbol);
    const stake = n(trade.stake);
    const won =
      trade.direction === 'BUY' ? exit >= trade.entryPrice : exit <= trade.entryPrice;
    const pnl = won ? stake * trade.payoutRate : -stake;

    await prisma.$transaction(async (tx) => {
      const bal = await tx.balance.findUnique({
        where: { userId_accountType: { userId: trade.userId, accountType: trade.accountType } },
      });
      if (!bal) return;
      const locked = Math.max(0, n(bal.lockedAmount) - stake);
      const available = Math.max(0, n(bal.amount) + (won ? stake + stake * trade.payoutRate : 0));
      await tx.balance.update({ where: { id: bal.id }, data: { lockedAmount: D(locked), amount: D(available) } });

      await tx.trade.update({
        where: { id: trade.id },
        data: { status: won ? 'WON' : 'LOST', exitPrice: exit, pnl: D(pnl.toFixed(2)) },
      });

      await tx.transaction.create({
        data: {
          userId: trade.userId,
          accountType: trade.accountType,
          type: 'trade',
          amount: D(pnl.toFixed(2)),
          provider: 'internal',
          status: 'completed',
          details: `${trade.direction} ${trade.symbol} · ${won ? 'WON' : 'LOST'} · stake $${stake.toFixed(2)}`,
        },
      });
    });

    emitUser(trade.userId, 'trade:settled', {
      id: trade.id, status: won ? 'WON' : 'LOST', pnl: Number(pnl.toFixed(2)),
      exitPrice: exit, symbol: trade.symbol, direction: trade.direction,
    });
    emitUser(trade.userId, 'balance:update', await getBalances(trade.userId));
  }
}

async function runAutoTraders() {
  const configs = await prisma.autoTradeConfig.findMany({ where: { isRunning: true } });
  const now = Date.now();
  for (const cfg of configs) {
    const last = lastAuto.get(cfg.userId) ?? 0;
    if (now - last < cfg.frequencySeconds * 1000) continue;
    lastAuto.set(cfg.userId, now);

    const profile = await prisma.profile.findUnique({ where: { id: cfg.userId } });
    if (!profile || profile.frozen) continue;
    const accountType = profile.preferredAccountType === 'demo' ? 'demo' : 'real';
    const balances = await getBalances(cfg.userId);
    const stake = n(cfg.fixedAmount);
    if ((balances[accountType]?.amount ?? 0) < stake) continue;

    const strategies: string[] = safeJson(cfg.activeStrategies);
    const strategy = strategies[0] ?? 'Trend Following';
    const direction = momentumDirection('EUR/USD', strategy);
    try {
      await openTrade({
        userId: cfg.userId, accountType, symbol: 'EUR/USD', direction,
        stake, durationSeconds: 15, triggeredBy: 'AUTO_BOT', strategy,
      });
    } catch {
      /* insufficient funds / inactive instrument */
    }
  }
}

async function runCopyTrades() {
  const subs = await prisma.userCopySubscription.findMany({
    where: { active: true },
    include: { trader: true, user: true },
  });
  const now = Date.now();
  for (const sub of subs) {
    const key = `${sub.userId}:${sub.traderId}`;
    const last = lastCopy.get(key) ?? 0;
    if (now - last < 120_000) continue;
    lastCopy.set(key, now);

    const accountType = sub.user.preferredAccountType === 'demo' ? 'demo' : 'real';
    const balances = await getBalances(sub.userId);
    if ((balances[accountType]?.amount ?? 0) < 10) continue;

    const symbol = (sub.trader.pairs.split(',')[0] || 'EUR/USD').trim();
    if (!market.config(symbol)) continue;
    try {
      await openTrade({
        userId: sub.userId, accountType, symbol,
        direction: Math.random() > 0.45 ? 'BUY' : 'SELL',
        stake: 10, durationSeconds: 60, triggeredBy: 'COPY_TRADE', strategy: sub.trader.name,
      });
    } catch {
      /* ignore */
    }
  }
}

function safeJson(v: string): string[] {
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function momentumDirection(symbol: string, strategy = 'Trend Following'): 'BUY' | 'SELL' {
  const pts = market.points(symbol).slice(-60);
  if (pts.length < 2) return 'BUY';
  const change = pts[pts.length - 1].p - pts[0].p;
  if (strategy.toLowerCase().includes('reversion')) return change >= 0 ? 'SELL' : 'BUY';
  return change >= 0 ? 'BUY' : 'SELL';
}

export function signalSnapshot(symbol = 'EUR/USD') {
  const pts = market.points(symbol).slice(-120);
  const first = pts[0]?.p ?? 0;
  const last = pts[pts.length - 1]?.p ?? 0;
  const change = first ? (last - first) / first : 0;
  const strength = Math.min(100, Math.round(Math.abs(change) * 100000));
  return {
    symbol,
    buyStrength: change >= 0 ? Math.max(4, strength) : Math.max(2, 100 - strength),
    sellStrength: change >= 0 ? Math.max(2, 100 - strength) : Math.max(4, strength),
    volatility: Math.abs(change) > 0.002 ? 'High' : Math.abs(change) > 0.0006 ? 'Medium' : 'Low',
    trend: change > 0.0004 ? 'Bullish' : change < -0.0004 ? 'Bearish' : 'Neutral',
    signal: Math.abs(change) < 0.0003 ? 'Hold' : change > 0 ? 'BUY' : 'SELL',
    changePct: Number((change * 100).toFixed(4)),
    price: last,
  };
}

export function startEngines() {
  setInterval(() => settleDueTrades().catch((e) => console.error('[settle]', e.message)), 1000);
  setInterval(() => runAutoTraders().catch((e) => console.error('[auto]', e.message)), 3000);
  setInterval(() => runCopyTrades().catch((e) => console.error('[copy]', e.message)), 15_000);
  console.log('[engine] settlement + auto-trade + copy loops running');
}
