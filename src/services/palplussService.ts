/**
 * PalPluss API client — https://docs.palpluss.com
 *
 * Base URL: https://api.palpluss.com/v1 (live) | https://sandbox.palpluss.com/v1
 * Auth:     HTTP Basic, API key as username, empty password.
 *
 * NOTE ON KEY PREFIXES
 * PalPluss keys issued by console.palpluss.com look like `pp_live_…` / `pp_test_…`.
 * Some static documentation snippets still show the older `pk_live_…` form.
 * This client therefore performs **no prefix validation at all** — any
 * non-empty trimmed key is accepted and sent verbatim.
 */

export type PalPlussEnvironment = 'live' | 'sandbox';

export type PalPlussConfig = {
  apiKey: string;
  environment: PalPlussEnvironment;
};

export const PALPLUSS_BASE_URL: Record<PalPlussEnvironment, string> = {
  live: 'https://api.palpluss.com/v1',
  sandbox: 'https://sandbox.palpluss.com/v1',
};

export class PalPlussError extends Error {
  code: string;
  status: number;
  requestId?: string;
  details?: unknown;

  constructor(message: string, code: string, status: number, requestId?: string, details?: unknown) {
    super(message);
    this.name = 'PalPlussError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.details = details;
  }
}

function authHeader(apiKey: string) {
  // Basic <base64(key + ":")> — trailing colon encodes the empty password.
  return `Basic ${Buffer.from(`${apiKey.trim()}:`).toString('base64')}`;
}

type Envelope<T> = {
  success: boolean;
  data: T;
  requestId?: string;
  error?: { message: string; code: string; details?: unknown };
};

async function request<T>(
  cfg: PalPlussConfig,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  opts: { idempotencyKey?: string; timeoutMs?: number } = {},
): Promise<T> {
  if (!cfg.apiKey || !cfg.apiKey.trim()) {
    throw new PalPlussError('PalPluss API key is not configured', 'NO_API_KEY', 0);
  }

  const url = `${PALPLUSS_BASE_URL[cfg.environment]}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader(cfg.apiKey),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });

  const text = await res.text();
  let payload: Envelope<T> | null = null;
  try {
    payload = text ? (JSON.parse(text) as Envelope<T>) : null;
  } catch {
    payload = null;
  }

  if (!res.ok || (payload && payload.success === false)) {
    const err = payload?.error;
    throw new PalPlussError(
      err?.message || `PalPluss request failed (${res.status})`,
      err?.code || `HTTP_${res.status}`,
      res.status,
      payload?.requestId,
      err?.details,
    );
  }

  return (payload?.data ?? ({} as T)) as T;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type PalPlussTransaction = {
  transactionId: string;
  tenantId?: string;
  channelId?: string | null;
  type: 'STK' | 'B2C' | 'WALLET_TOPUP';
  status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'REVERSED' | 'CANCELLED' | 'EXPIRED';
  amount: number;
  currency: string;
  phone?: string;
  accountReference?: string | null;
  transactionDesc?: string | null;
  provider?: string | null;
  providerRequestId?: string | null;
  providerCheckoutId?: string | null;
  resultCode?: string | null;
  resultDesc?: string | null;
  mpesaReceipt?: string | null;
  mpesa_receipt?: string | null;
  transactionFee?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type PaymentChannel = {
  id: string;
  tenantId?: string;
  category?: string;
  type: 'PAYBILL' | 'TILL_NUMBER' | 'SEND_MONEY';
  shortcode: string;
  name: string;
  accountNumber?: string | null;
  isDefault: boolean;
  createdAt?: string;
};

export type ServiceBalance = {
  currency: string;
  availableBalance: number;
  ledgerBalance: number;
};

/* ------------------------------------------------------------------ */
/* STK Push                                                            */
/* ------------------------------------------------------------------ */

export type StkRequest = {
  amountKes: number;
  phone: string;
  accountReference: string;   // ≤ 12 chars
  transactionDesc: string;    // ≤ 13 chars
  callbackUrl: string;
  channelId?: string | null;
  credentialId?: string | null;
};

export async function initiateStk(cfg: PalPlussConfig, req: StkRequest): Promise<PalPlussTransaction> {
  return request<PalPlussTransaction>(cfg, 'POST', '/payments/stk', {
    amount: round2(req.amountKes),
    phone: normalisePhone(req.phone),
    accountReference: req.accountReference.slice(0, 12),
    transactionDesc: req.transactionDesc.slice(0, 13),
    callbackUrl: req.callbackUrl,
    ...(req.channelId ? { channelId: req.channelId } : {}),
    ...(req.credentialId ? { credential_id: req.credentialId } : {}),
  });
}

/* ------------------------------------------------------------------ */
/* Transactions                                                        */
/* ------------------------------------------------------------------ */

export async function getTransaction(cfg: PalPlussConfig, transactionId: string): Promise<PalPlussTransaction> {
  return request<PalPlussTransaction>(cfg, 'GET', `/transactions/${encodeURIComponent(transactionId)}`);
}

export async function listTransactions(
  cfg: PalPlussConfig,
  params: { limit?: number; cursor?: string; status?: string; type?: string } = {},
): Promise<{ overview?: Record<string, number>; items: PalPlussTransaction[]; nextCursor?: string | null }> {
  const qs = new URLSearchParams();
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.status) qs.set('status', params.status);
  if (params.type) qs.set('type', params.type);
  const suffix = qs.toString() ? `?${qs}` : '';
  return request(cfg, 'GET', `/transactions${suffix}`);
}

/* ------------------------------------------------------------------ */
/* B2C payouts                                                         */
/* ------------------------------------------------------------------ */

export type PayoutRequest = {
  amountKes: number;
  phone: string;
  reference: string;
  description?: string;
  channelId?: string | null;
  callbackUrl: string;
};

export async function createPayout(cfg: PalPlussConfig, req: PayoutRequest): Promise<PalPlussTransaction> {
  return request<PalPlussTransaction>(cfg, 'POST', '/b2c/payouts', {
    amount: round2(req.amountKes),
    currency: 'KES',
    phone: normalisePhone(req.phone),
    reference: req.reference,
    ...(req.description ? { description: req.description.slice(0, 100) } : {}),
    ...(req.channelId ? { channelId: req.channelId } : {}),
    callbackUrl: req.callbackUrl,
  });
}

/* ------------------------------------------------------------------ */
/* Service wallet                                                      */
/* ------------------------------------------------------------------ */

export async function getServiceBalance(cfg: PalPlussConfig): Promise<ServiceBalance> {
  return request<ServiceBalance>(cfg, 'GET', '/wallets/service/balance');
}

export async function topUpServiceWallet(
  cfg: PalPlussConfig,
  input: { amountKes: number; phone: string; accountReference?: string; transactionDesc?: string },
  idempotencyKey?: string,
): Promise<PalPlussTransaction> {
  return request<PalPlussTransaction>(
    cfg,
    'POST',
    '/wallets/service/topups',
    {
      amount: round2(input.amountKes),
      phone: normalisePhone(input.phone),
      ...(input.accountReference ? { accountReference: input.accountReference } : {}),
      ...(input.transactionDesc ? { transactionDesc: input.transactionDesc } : {}),
    },
    { idempotencyKey },
  );
}

/* ------------------------------------------------------------------ */
/* Payment channels — note the /payment-wallet prefix                  */
/* ------------------------------------------------------------------ */

export async function listChannels(cfg: PalPlussConfig): Promise<PaymentChannel[]> {
  const data = await request<{ items: PaymentChannel[] }>(cfg, 'GET', '/payment-wallet/channels');
  return data.items ?? [];
}

export async function getChannel(cfg: PalPlussConfig, id: string): Promise<PaymentChannel> {
  return request<PaymentChannel>(cfg, 'GET', `/payment-wallet/channels/${encodeURIComponent(id)}`);
}

export async function createChannel(
  cfg: PalPlussConfig,
  input: { name: string; type: PaymentChannel['type']; shortcode: string; accountNumber?: string; isDefault?: boolean },
): Promise<PaymentChannel> {
  return request<PaymentChannel>(cfg, 'POST', '/payment-wallet/channels', input);
}

export async function updateChannel(
  cfg: PalPlussConfig,
  id: string,
  patch: { name?: string; accountNumber?: string | null; isDefault?: boolean },
): Promise<PaymentChannel> {
  return request<PaymentChannel>(cfg, 'PATCH', `/payment-wallet/channels/${encodeURIComponent(id)}`, patch);
}

export async function deleteChannel(cfg: PalPlussConfig, id: string): Promise<void> {
  await request<Record<string, never>>(cfg, 'DELETE', `/payment-wallet/channels/${encodeURIComponent(id)}`);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function normalisePhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+254')) return digits.slice(1);
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (digits.startsWith('7') || digits.startsWith('1')) return `254${digits}`;
  return digits;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function testConnection(cfg: PalPlussConfig) {
  const started = Date.now();
  const balance = await getServiceBalance(cfg);
  return { ok: true, latencyMs: Date.now() - started, balance };
}
