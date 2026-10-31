'use client';
import { useCallback, useEffect, useState } from 'react';
import { Clock, CheckCircle2, XCircle, Ban, ArrowUpRight } from 'lucide-react';
import { PageHead } from '@/components/app-shell';
import { Badge, Button, Card, Field, Empty } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { api, post } from '@/lib/api';
import { dt, usd } from '@/lib/format';

type Wd = {
  id: string; amount: number; method: string; destination: string; status: string;
  stage: string; reason: string | null; reference: string | null; createdAt: string;
};

const METHODS = [
  { id: 'mpesa', label: 'M-Pesa · min $10 · ~10 min after approval' },
  { id: 'bank', label: 'Bank Transfer · min $10 · 3–5 business days' },
  { id: 'btc', label: 'Bitcoin (BTC) · min $50' },
  { id: 'usdt_trc20', label: 'USDT (TRC-20) · min $50' },
];

const STAGES: Record<string, { label: string; tone: 'neutral' | 'warning' | 'positive' | 'negative'; icon: typeof Clock }> = {
  PENDING_REVIEW: { label: 'Pending compliance & treasury review', tone: 'warning', icon: Clock },
  PROCESSING: { label: 'Approved · payout in progress', tone: 'neutral', icon: Clock },
  COMPLETED: { label: 'Completed', tone: 'positive', icon: CheckCircle2 },
  DECLINED: { label: 'Declined · refunded', tone: 'negative', icon: XCircle },
  CANCELLED: { label: 'Cancelled · refunded', tone: 'neutral', icon: Ban },
};

export default function WithdrawalPage() {
  const { me, refresh } = useUser();
  const [list, setList] = useState<Wd[]>([]);
  const [amount, setAmount] = useState(10);
  const [method, setMethod] = useState('mpesa');
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [kesRate, setKesRate] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await api<Wd[]>('/withdrawals');
    setList(res);
  }, []);

  useEffect(() => { load().catch(() => {}); }, [load]);
  useEffect(() => {
    api<{ palpluss: { configured: boolean; withdrawRate: number } }>('/gateway-info')
      .then((g) => setKesRate(g.palpluss.withdrawRate)).catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setOk(null);
    try {
      await post('/withdrawals', { accountType: 'real', amount, method, destination: destination || '+254717702563' });
      setOk('Withdrawal submitted · pending compliance & treasury review (ETA 24h).');
      await load(); await refresh();
    } catch (err) {
      const code = (err as Error).message;
      setError(
        code === 'INSUFFICIENT_FUNDS' ? 'Insufficient available real balance.'
          : code.startsWith('MIN_WITHDRAWAL') ? `Minimum for this method is ${usd(Number(code.split('_').pop()))}.`
          : code === 'KYC_REQUIRED' ? 'KYC verification is required before withdrawing.'
          : code,
      );
    } finally { setBusy(false); }
  };

  const cancel = async (id: string) => {
    await post(`/withdrawals/${id}/cancel`).then(load).then(refresh).catch(() => {});
  };

  const available = me?.balances?.real?.amount ?? 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <PageHead title="Withdraw Funds" subtitle="Choose your withdrawal options" />

      <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
        <Card className="p-5">
          <form onSubmit={submit} className="space-y-4">
            <div className="flex items-center justify-between rounded-lg bg-[var(--surface-2)] px-3 py-2">
              <span className="text-xs text-[var(--muted)]">Real balance available</span>
              <span className="text-sm font-semibold">{usd(available)}</span>
            </div>
            <Field label="Account type">
              <input className="input bg-[var(--surface-2)]" value="Real account" readOnly />
            </Field>
            <Field label="Amount (USD)" hint={kesRate ? `≈ KES ${(amount * kesRate).toLocaleString('en-KE', { minimumFractionDigits: 2 })} at ${kesRate} KES/USD` : undefined}>
              <input className="input" type="number" min={10} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} />
            </Field>
            <Field label="Withdrawal method">
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="Destination" hint="Phone number, bank account or wallet address">
              <input className="input" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="+254712345678" />
            </Field>

            {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">{error}</p>}
            {ok && <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">{ok}</p>}

            <Button type="submit" className="w-full" disabled={busy || amount > available}>
              {busy ? 'Submitting…' : 'Request withdrawal'}
            </Button>
            <p className="text-[11px] leading-relaxed text-[var(--muted)]">
              Every request is reviewed by compliance and treasury. Funds are held in your locked balance until the request is approved or declined; you can cancel while it is still pending.
            </p>
          </form>
        </Card>

        <div>
          <h2 className="mb-2 text-sm font-semibold">Your withdrawals</h2>
          <Card>
            {list.length === 0 ? (
              <Empty icon={<ArrowUpRight size={20} />} title="No withdrawal requests yet" />
            ) : list.map((w) => {
              const stage = STAGES[w.stage ?? 'PENDING_REVIEW'] ?? STAGES.PENDING_REVIEW;
              const Icon = stage.icon;
              return (
                <div key={w.id} className="border-b border-[var(--border)] px-4 py-3 last:border-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{usd(w.amount)} <span className="text-xs font-normal text-[var(--muted)]">· {w.method}</span></p>
                      <p className="text-[11px] text-[var(--muted)]">{dt(w.createdAt)} · {w.destination}</p>
                    </div>
                    <Badge tone={stage.tone} className="h-6 shrink-0"><Icon size={11} /> {stage.label}</Badge>
                  </div>
                  {w.reason && <p className="mt-1.5 text-[11px] text-[var(--muted)]">{w.reason}</p>}
                  {w.reference && <p className="mt-1 text-[11px] text-[var(--muted)]">Ref: <span className="font-mono">{w.reference}</span></p>}
                  {w.stage === 'PENDING_REVIEW' && (
                    <button onClick={() => cancel(w.id)} className="mt-2 text-[11px] font-medium text-red-600 underline-offset-2 hover:underline dark:text-red-400">
                      Cancel & return to balance
                    </button>
                  )}
                </div>
              );
            })}
          </Card>
        </div>
      </div>
    </div>
  );
}
