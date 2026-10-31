import { prisma } from '../db.js';

export type PalPlussSettings = {
  apiKey: string;
  environment: 'live' | 'sandbox';
  depositRate: number;   // KES per 1 USD charged on deposit
  withdrawRate: number;  // KES per 1 USD paid out
  defaultChannelId: string | null;
};

export type NowPaymentsSettings = {
  apiKey: string;
  ipnSecret: string;
  coins: string[];
};

export type GatewaySettings = { palpluss: PalPlussSettings; nowpayments: NowPaymentsSettings };

const PP_KEY = 'gateway.palpluss';
const NP_KEY = 'gateway.nowpayments';

export const DEFAULTS: GatewaySettings = {
  palpluss: {
    apiKey: process.env.PALPLUSS_API_KEY || '',
    environment: (process.env.PALPLUSS_ENV as 'live' | 'sandbox') || 'sandbox',
    depositRate: 129.35,
    withdrawRate: 128.5,
    defaultChannelId: null,
  },
  nowpayments: {
    apiKey: process.env.NOWPAYMENTS_API_KEY || '',
    ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET || '',
    coins: ['btc', 'eth', 'usdttrc20', 'usdterc20', 'ltc'],
  },
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.appSetting.findUnique({ where: { key } }).catch(() => null);
  if (!row) return fallback;
  try {
    return { ...fallback, ...JSON.parse(row.value) };
  } catch {
    return fallback;
  }
}

export async function getGatewaySettings(): Promise<GatewaySettings> {
  const [pp, np] = await Promise.all([
    readJson<PalPlussSettings>(PP_KEY, DEFAULTS.palpluss),
    readJson<NowPaymentsSettings>(NP_KEY, DEFAULTS.nowpayments),
  ]);
  return { palpluss: pp, nowpayments: np };
}

export async function savePalPluss(patch: Partial<PalPlussSettings>) {
  const current = (await getGatewaySettings()).palpluss;
  const next = { ...current, ...patch };
  await prisma.appSetting.upsert({
    where: { key: PP_KEY },
    create: { key: PP_KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  return next;
}

export async function saveNowPayments(patch: Partial<NowPaymentsSettings>) {
  const current = (await getGatewaySettings()).nowpayments;
  const next = { ...current, ...patch };
  await prisma.appSetting.upsert({
    where: { key: NP_KEY },
    create: { key: NP_KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  return next;
}

/** Never return a full key to the browser. `pp_live_…abcd` */
export function maskKey(key: string) {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 7)}••••${key.slice(-4)}`;
}

export const palplussEnabled = (s: PalPlussSettings) => s.apiKey.trim().length > 0;
