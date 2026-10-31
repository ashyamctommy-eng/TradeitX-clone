/**
 * NOWPayments client — https://documenter.getpostman.com/view/7907941/S1a32n38
 *
 * POST /v1/payment        create a payment / address
 * GET  /v1/payment/:id    payment status
 * GET  /v1/status         API availability
 * IPN: HMAC-SHA512 over the JSON body with keys sorted, header `x-nowpayments-sig`
 */
import crypto from 'crypto';

export const NOWPAYMENTS_BASE = 'https://api.nowpayments.io/v1';

export const SUPPORTED_COINS = [
  { id: 'btc', label: 'Bitcoin', network: 'BTC' },
  { id: 'eth', label: 'Ethereum', network: 'ETH_ERC20' },
  { id: 'usdttrc20', label: 'USDT (TRC-20)', network: 'USDT_TRC20' },
  { id: 'usdterc20', label: 'USDT (ERC-20)', network: 'USDT_ERC20' },
  { id: 'ltc', label: 'Litecoin', network: 'LTC' },
] as const;

export type NowPaymentsConfig = { apiKey: string; ipnSecret: string };

export class NowPaymentsError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'NowPaymentsError';
    this.status = status;
  }
}

export type NowPayment = {
  payment_id: string;
  payment_status: string; // waiting | confirming | confirmed | sending | partially_paid | finished | failed | refunded | expired
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  actually_paid?: number;
  pay_currency: string;
  order_id?: string;
  outcome_amount?: number;
  created_at?: string;
  updated_at?: string;
};

async function request<T>(cfg: NowPaymentsConfig, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  if (!cfg.apiKey) throw new NowPaymentsError('NOWPayments API key is not configured', 0);
  const res = await fetch(`${NOWPAYMENTS_BASE}${path}`, {
    method,
    headers: { 'x-api-key': cfg.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = `NOWPayments ${method} ${path} failed (${res.status})`;
    try {
      const parsed = JSON.parse(text);
      message = parsed.message || parsed.error || message;
    } catch { /* non-JSON error body */ }
    throw new NowPaymentsError(message, res.status);
  }
  return JSON.parse(text) as T;
}

export async function createPayment(
  cfg: NowPaymentsConfig,
  input: {
    priceAmountUsd: number;
    payCurrency: string;
    orderId: string;
    ipnUrl: string;
    description?: string;
  },
): Promise<NowPayment> {
  return request<NowPayment>(cfg, 'POST', '/payment', {
    price_amount: input.priceAmountUsd,
    price_currency: 'usd',
    pay_currency: input.payCurrency,
    order_id: input.orderId,
    order_description: input.description || 'TradeitX deposit',
    ipn_callback_url: input.ipnUrl,
  });
}

export async function getPaymentStatus(cfg: NowPaymentsConfig, paymentId: string): Promise<NowPayment> {
  return request<NowPayment>(cfg, 'GET', `/payment/${encodeURIComponent(paymentId)}`);
}

export async function getApiStatus(cfg: NowPaymentsConfig): Promise<{ message: string }> {
  return request<{ message: string }>(cfg, 'GET', '/status');
}

/* ------------------------------ IPN ------------------------------ */

export function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortObject((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

export function signIpn(rawBody: string, secret: string): string {
  const parsed = JSON.parse(rawBody);
  return crypto.createHmac('sha512', secret).update(JSON.stringify(sortObject(parsed))).digest('hex');
}

export function verifyIpn(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  try {
    const expected = signIpn(rawBody, secret);
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const nowpaymentsEnabled = (cfg: NowPaymentsConfig) => Boolean(cfg.apiKey && cfg.ipnSecret);
