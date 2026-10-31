'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Clock, CheckCircle2, XCircle, Smartphone } from 'lucide-react';
import { Button, Card, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { usd } from '@/lib/format';

type Status = { id: string; ref: string | null; status: string; amount: number; details: string; createdAt: string };

function Inner() {
  const params = useSearchParams();
  const id = params.get('id');
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let stop = false;
    const poll = async () => {
      try {
        const res = await api<Status>(`/deposits/mpesa/${id}`);
        if (!stop) setData(res);
        if (res.status === 'completed' || res.status === 'failed') return;
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
      if (!stop) setTimeout(poll, 3000);
    };
    poll();
    return () => { stop = true; };
  }, [id]);

  const done = data?.status === 'completed';
  const failed = data?.status === 'failed';

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <Card className="p-6 text-center">
        <div className={`mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full ${done ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : failed ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-[var(--primary)]/15 text-[#8a6d00] dark:text-[#ffcc00]'}`}>
          {done ? <CheckCircle2 size={26} /> : failed ? <XCircle size={26} /> : <Smartphone size={26} />}
        </div>
        <h1 className="text-lg font-semibold">
          {done ? 'Deposit confirmed' : failed ? 'Deposit failed' : 'Waiting for confirmation'}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {done ? 'The funds are now in your real balance.'
            : failed ? (data?.details ?? 'The M-Pesa request was declined.')
            : 'Approve the STK prompt on your phone. This page updates automatically.'}
        </p>

        {!data && !error && <div className="mt-5 flex justify-center"><Spinner /></div>}
        {error && <p className="mt-4 text-xs text-red-500">{error}</p>}

        {data && (
          <div className="mt-5 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 text-left text-xs">
            <Row k="Amount" v={usd(data.amount)} />
            <Row k="Reference" v={data.ref ?? '—'} mono />
            <Row k="Status" v={done ? 'Completed' : failed ? 'Failed' : 'Awaiting M-Pesa'} />
            <Row k="Requested" v={new Date(data.createdAt).toLocaleString()} />
          </div>
        )}

        {!done && !failed && (
          <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-[var(--muted)]">
            <Clock size={12} /> Do not close this page until the prompt is approved.
          </p>
        )}

        <div className="mt-6 grid grid-cols-2 gap-2">
          <Link href="/finances" className="btn btn-outline">Back to finances</Link>
          <Link href="/deposit-options" className="btn btn-primary">New deposit</Link>
        </div>
      </Card>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--muted)]">{k}</span>
      <span className={mono ? 'font-mono text-[11px]' : 'font-medium'}>{v}</span>
    </div>
  );
}

export default function MpesaStatusPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-sm text-[var(--muted)]">Loading…</div>}>
      <Inner />
    </Suspense>
  );
}
