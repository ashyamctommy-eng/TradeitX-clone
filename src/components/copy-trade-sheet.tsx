'use client';
import { useEffect, useState } from 'react';
import { X, BadgeCheck, ShieldCheck, Users2, Copy as CopyIcon } from 'lucide-react';
import { api, post } from '@/lib/api';
import { Badge, Button, Spinner } from './ui';
import { cn } from '@/lib/cn';

type Trader = {
  id: string; name: string; flag: string; strategy: string; pairs: string;
  risk: string; winRate: number; profit: number; trades: number; drawdown: number;
  followers: number; lastTradeMins: number; verified: boolean; subscribed: boolean;
};

export function CopyTradeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [traders, setTraders] = useState<Trader[]>([]);
  const [filter, setFilter] = useState<'all' | 'verified' | 'low'>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api<Trader[]>('/copy-traders').then(setTraders).finally(() => setLoading(false));
  }, [open]);

  const toggle = async (id: string) => {
    setBusy(id);
    try {
      const res = await post<{ subscribed: boolean }>(`/copy-traders/${id}/toggle`);
      setTraders((prev) => prev.map((t) => (t.id === id ? { ...t, subscribed: res.subscribed } : t)));
    } finally { setBusy(null); }
  };

  if (!open) return null;
  const list = traders.filter((t) =>
    filter === 'all' ? true : filter === 'verified' ? t.verified : t.risk.toLowerCase() === 'low',
  );

  return (
    <div className="fixed inset-0 z-[75]">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <aside className="sheet-in absolute right-0 top-0 flex h-full w-full max-w-[880px] flex-col border-l border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-start justify-between border-b border-[var(--border)] p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--primary)]/20 text-[#8a6d00] dark:text-[#ffcc00]">
              <Users2 size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold">Copy Trading</h2>
              <p className="text-xs text-[var(--muted)]">Mirror elite traders · Hourly updates</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-2)]"><X size={18} /></button>
        </div>

        <div className="flex gap-2 border-b border-[var(--border)] px-5 py-3">
          {([['all', 'All'], ['verified', 'Verified'], ['low', 'Low Risk']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-semibold transition',
                filter === id
                  ? 'border-[var(--primary)] bg-[var(--primary)]/15 text-[#8a6d00] dark:text-[#ffcc00]'
                  : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : (
            <div className="space-y-3">
              {list.map((t) => (
                <div key={t.id} className="card p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-sm font-bold">
                      {t.name.split(' ').map((x) => x[0]).join('')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold">{t.name}</span>
                        <span>{t.flag}</span>
                        {t.verified && <BadgeCheck size={14} className="text-[#3B82F6]" />}
                        <Badge tone={t.profit >= 0 ? 'positive' : 'negative'} className="ml-auto">
                          {t.profit >= 0 ? '+' : ''}{t.profit.toFixed(2)}%
                        </Badge>
                      </div>
                      <p className="text-xs text-[var(--muted)]">{t.strategy}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {t.pairs.split(',').map((p) => (
                          <span key={p} className="chip h-5 px-2 text-[10px]">{p.trim()}</span>
                        ))}
                        <Badge tone={t.risk === 'Low' ? 'positive' : t.risk === 'High' ? 'negative' : 'warning'} className="h-5 px-2 text-[10px]">
                          {t.risk}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/60 p-3 sm:grid-cols-4">
                    <Stat label="WIN" value={`${t.winRate}%`} tone="positive" />
                    <Stat label="PROFIT" value={`$${(t.profit >= 0 ? t.profit : 0).toFixed(1)}k`} />
                    <Stat label="TRD" value={String(t.trades)} />
                    <Stat label="DD" value={`${t.drawdown}%`} tone="negative" />
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-3 text-[11px] text-[var(--muted)]">
                      <span className="inline-flex items-center gap-1"><Users2 size={12} /> {t.followers.toLocaleString()}</span>
                      <span>{t.lastTradeMins}m ago</span>
                      <span className="inline-flex items-center gap-1"><ShieldCheck size={12} /> verified</span>
                    </div>
                    <Button size="sm" variant={t.subscribed ? 'outline' : 'primary'} disabled={busy === t.id} onClick={() => toggle(t.id)}>
                      <CopyIcon size={13} /> {t.subscribed ? 'Copying' : 'Copy'}
                    </Button>
                  </div>
                </div>
              ))}
              <p className="pt-2 text-center text-[11px] text-[var(--muted)]">
                Copy trading mirrors the trader&apos;s direction on your account. Past performance is not indicative of future results.
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
  return (
    <div>
      <p className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">{label}</p>
      <p className={cn('text-sm font-semibold', tone === 'positive' && 'text-emerald-600 dark:text-emerald-400', tone === 'negative' && 'text-red-600 dark:text-red-400')}>
        {value}
      </p>
    </div>
  );
}
