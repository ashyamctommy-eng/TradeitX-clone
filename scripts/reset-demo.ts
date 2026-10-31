/**
 * Restore the seeded demo state after test runs.
 * Keeps the historical failed $16 M-Pesa row and the closed example ticket.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SEED_REF = 'ws_CO_25102026153901329717702563';

async function main() {
  await prisma.trade.deleteMany({});
  const keep = await prisma.transaction.findFirst({ where: { providerRef: SEED_REF } });
  await prisma.transaction.deleteMany({ where: keep ? { NOT: { id: keep.id } } : {} });
  await prisma.cryptoDepositInvoice.deleteMany({});
  await prisma.supportTicket.deleteMany({ where: { NOT: { subject: 'Verification timeline' } } });
  await prisma.telegramEvent.deleteMany({});
  await prisma.userCopySubscription.deleteMany({});
  await prisma.autoTradeConfig.updateMany({
    data: { isRunning: false, activeStrategies: '["strat_alpha"]', frequencySeconds: 30,
      fixedAmount: 10, riskLevel: 3, reinvestProfits: false, useMarketAnalysis: true },
  });

  const users = await prisma.profile.findMany();
  for (const u of users) {
    await prisma.balance.updateMany({ where: { userId: u.id, accountType: 'real' }, data: { amount: 0, lockedAmount: 0 } });
    await prisma.balance.updateMany({ where: { userId: u.id, accountType: 'demo' }, data: { amount: 10000, lockedAmount: 0 } });
  }
  await prisma.aiStrategy.deleteMany({ where: { isCustom: true } });
  await prisma.appSetting.deleteMany({ where: { key: { startsWith: 'gateway.' } } });

  console.log(`Reset ${users.length} profiles · real $0 · demo $10,000 · test rows cleared`);
}
main().finally(() => prisma.$disconnect());
