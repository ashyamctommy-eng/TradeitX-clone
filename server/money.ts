import { Prisma } from '@prisma/client';
import { prisma } from './db.js';

export const D = (v: string | number) => new Prisma.Decimal(String(v));
export const n = (v: Prisma.Decimal | number | string | null | undefined) =>
  v === null || v === undefined ? 0 : Number(v);

export type AccountType = 'real' | 'demo';

export async function ensureBalances(userId: string) {
  await prisma.balance.upsert({
    where: { userId_accountType: { userId, accountType: 'real' } },
    create: { userId, accountType: 'real', amount: D(0), lockedAmount: D(0) },
    update: {},
  });
  await prisma.balance.upsert({
    where: { userId_accountType: { userId, accountType: 'demo' } },
    create: { userId, accountType: 'demo', amount: D(10000), lockedAmount: D(0) },
    update: {},
  });
}

export async function getBalances(userId: string) {
  await ensureBalances(userId);
  const rows = await prisma.balance.findMany({ where: { userId } });
  const out: Record<string, { amount: number; locked: number }> = {};
  for (const r of rows) out[r.accountType] = { amount: n(r.amount), locked: n(r.lockedAmount) };
  return out;
}

/** Atomic-ish credit/debit of available funds. Throws INSUFFICIENT_FUNDS. */
export async function adjustBalance(
  userId: string,
  accountType: AccountType,
  delta: { available?: number; locked?: number },
) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.balance.findUnique({
      where: { userId_accountType: { userId, accountType } },
    });
    if (!row) throw new Error('BALANCE_NOT_FOUND');
    const available = n(row.amount) + (delta.available ?? 0);
    const locked = n(row.lockedAmount) + (delta.locked ?? 0);
    if (available < -1e-9) throw new Error('INSUFFICIENT_FUNDS');
    if (locked < -1e-9) throw new Error('INSUFFICIENT_LOCKED');
    return tx.balance.update({
      where: { id: row.id },
      data: { amount: D(Math.max(0, available)), lockedAmount: D(Math.max(0, locked)) },
    });
  });
}

export async function lockFunds(userId: string, accountType: AccountType, amount: number) {
  return adjustBalance(userId, accountType, { available: -amount, locked: amount });
}
