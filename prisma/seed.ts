import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const adminPass = await bcrypt.hash('BrabicanaAdmin123!', 10);
  const traderPass = await bcrypt.hash('TraderDemo123!', 10);

  const admin = await prisma.profile.upsert({
    where: { email: 'admin@tradeitx.com' },
    update: { userType: 'admin', passwordHash: adminPass },
    create: {
      email: 'admin@tradeitx.com',
      passwordHash: adminPass,
      username: 'Brabicana',
      userType: 'admin',
      country: 'KE',
      countryCode: '+254',
      phoneNumber: '700000001',
    },
  });

  const trader = await prisma.profile.upsert({
    where: { email: 'wildpharmtech9@gmail.com' },
    update: {},
    create: {
      email: 'wildpharmtech9@gmail.com',
      passwordHash: traderPass,
      username: 'Blvd',
      country: 'KE',
      countryCode: '+254',
      phoneNumber: '717702563',
      preferredAccountType: 'real',
      createdAt: new Date('2026-10-25T12:33:41Z'),
    },
  });

  for (const uid of [admin.id, trader.id]) {
    await prisma.balance.upsert({
      where: { userId_accountType: { userId: uid, accountType: 'real' } },
      update: {},
      create: { userId: uid, accountType: 'real', amount: 0, lockedAmount: 0 },
    });
    await prisma.balance.upsert({
      where: { userId_accountType: { userId: uid, accountType: 'demo' } },
      update: {},
      create: { userId: uid, accountType: 'demo', amount: 10000, lockedAmount: 0 },
    });
    await prisma.autoTradeConfig.upsert({
      where: { userId: uid },
      update: {},
      create: { userId: uid },
    });
  }

  const existingTx = await prisma.transaction.findFirst({ where: { providerRef: 'ws_CO_25102026153901329717702563' } });
  if (!existingTx) {
    await prisma.transaction.create({
      data: {
        userId: trader.id,
        accountType: 'real',
        type: 'deposit',
        amount: 16,
        feeAmount: 0,
        provider: 'mpesa',
        providerRef: 'ws_CO_25102026153901329717702563',
        status: 'failed',
        statusReason: 'Rail declined the STK request',
        details: 'M-Pesa deposit via Nexus Pay: ws_CO_25102026153901329717702563',
        createdAt: new Date('2026-10-25T12:39:25Z'),
      },
    });
  }

  const traders = [
    { name: 'Chen Wei', flag: '🇨🇳', strategy: 'Algo Mean Reversion', pairs: 'EUR/USD, USD/JPY', risk: 'Medium', winRate: 89.2, profit: 11.3, trades: 309, drawdown: 4.7, followers: 4200, lastTradeMins: 15, sortOrder: 1 },
    { name: 'Brian Kamau', flag: '🇰🇪', strategy: 'Scalping Master', pairs: 'EUR/USD, GBP/USD', risk: 'Medium', winRate: 88.2, profit: 13.3, trades: 321, drawdown: 8.5, followers: 2900, lastTradeMins: 7, sortOrder: 2 },
    { name: 'James Carter', flag: '🇺🇸', strategy: 'USD Day Trader', pairs: 'USD/CHF, USD/CAD', risk: 'High', winRate: 85.7, profit: 15.0, trades: 364, drawdown: 11.1, followers: 4600, lastTradeMins: 30, sortOrder: 3 },
    { name: 'Achieng Akinyi', flag: '🇰🇪', strategy: 'Forex Breakout', pairs: 'USD/JPY, EUR/USD', risk: 'Medium', winRate: 82.8, profit: 9.1, trades: 165, drawdown: 11.2, followers: 1500, lastTradeMins: 60, sortOrder: 4 },
    { name: 'Wanjiru Mwangi', flag: '🇰🇪', strategy: 'Swing Trader', pairs: 'EUR/JPY, GBP/JPY', risk: 'Low', winRate: 82.3, profit: 10.8, trades: 183, drawdown: 11.3, followers: 2200, lastTradeMins: 240, sortOrder: 5 },
  ];
  for (const t of traders) {
    const existing = await prisma.copyTrader.findFirst({ where: { name: t.name } });
    if (existing) await prisma.copyTrader.update({ where: { id: existing.id }, data: t });
    else await prisma.copyTrader.create({ data: t });
  }

  const instr = [
    { symbol: 'EUR/USD', label: 'Euro / US Dollar', mode: 'OTC', basePrice: 1.0852, payoutRate: 0.82, minStake: 1, maxStake: 1000, isActive: true, digits: 5, sortOrder: 1 },
    { symbol: 'GBP/USD', label: 'British Pound / US Dollar', mode: 'OTC', basePrice: 1.2714, payoutRate: 0.82, minStake: 1, maxStake: 1000, isActive: true, digits: 5, sortOrder: 2 },
    { symbol: 'BTC/USD', label: 'Bitcoin / US Dollar', mode: 'LIVE', basePrice: 67420, payoutRate: 0.85, minStake: 1, maxStake: 2500, isActive: true, digits: 2, sortOrder: 3 },
    { symbol: 'ETH/USD', label: 'Ethereum / US Dollar', mode: 'LIVE', basePrice: 3284.5, payoutRate: 0.84, minStake: 1, maxStake: 2500, isActive: true, digits: 2, sortOrder: 4 },
    { symbol: 'XAU/USD', label: 'Gold / US Dollar', mode: 'OTC', basePrice: 2338.7, payoutRate: 0.8, minStake: 1, maxStake: 2000, isActive: true, digits: 2, sortOrder: 5 },
    { symbol: 'USD/KES', label: 'US Dollar / Kenyan Shilling', mode: 'OTC', basePrice: 129.35, payoutRate: 0.8, minStake: 1, maxStake: 500, isActive: true, digits: 3, sortOrder: 6 },
  ];
  for (const i of instr) {
    await prisma.instrument.upsert({ where: { symbol: i.symbol }, update: i, create: i });
  }

  const ticketCount = await prisma.supportTicket.count({ where: { userId: trader.id } });
  if (ticketCount === 0) {
    await prisma.supportTicket.create({
      data: {
        userId: trader.id,
        subject: 'Verification timeline',
        status: 'CLOSED',
        assignedAgentName: 'Brabicana',
        messages: {
          create: [
            { senderType: 'USER', senderName: 'Blvd', body: 'How long does account verification usually take?' },
            { senderType: 'AGENT', senderName: 'Brabicana', body: 'Usually under 24 hours once documents are received. Reply here if it takes longer.' },
          ],
        },
      },
    });
  }

  await prisma.appSetting.upsert({ where: { key: 'seed_version' }, update: { value: '1' }, create: { key: 'seed_version', value: '1' } });

  console.log('Seed complete');
  console.log('  trader: wildpharmtech9@gmail.com / TraderDemo123!');
  console.log('  admin : admin@tradeitx.com / BrabicanaAdmin123!');
}

main().finally(() => prisma.$disconnect());
