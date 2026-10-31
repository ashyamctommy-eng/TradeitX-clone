'use client';
import { useCallback, useEffect, useState } from 'react';
import { Download, ArrowDownLeft, ArrowUpRight, Wallet, Filter } from 'lucide-react';
import { PageHead } from '@/components/app-shell';
import { Badge, Button, Card, Empty } from '@/components/ui';
import { api } from '@/lib/api';
import { dt, usd } from '@/lib/format';

type Row = {
  id: string; type: string; accountType: string; amount: number; provider: string;
  providerRef: string | null; status: string; reviewStage: string | null;
  statusReason: string | null; details: string; createdAt: string;
};

export default function TransactionsPage() {
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [acc, setAcc] = useState('all');
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ deposits: 0, withdrawals: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ type, status, account: acc, limit: '200' });
    const res = await api<{ rows: Row[]; totals: { deposits: number; withdrawals: number } }>(`/transactions?${qs}`);
    setRows(res.rows); setTotals(res.totals); setLoading(false);
  }, [type, status, acc]);

  useEffect(() => { load().catch(() => setLoading(false)); }, [load]);

  const exportCsv = () => {
    const head = ['date', 'type', 'account', 'amount', 'provider', 'reference', 'status', 'details'];
    const body = rows.map((r) => [
      r.createdAt, r.type, r.accountType, r.amount.toFixed(2), r.provider,
      r.providerRef ?? '', r.status, r.details.replace(/"/g, '""'),
    ]);
    const csv = [head, ...body].map((line) => line.map((c) => `"${c}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `transactions-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <PageHead
        title="Transactions"
        subtitle="Every movement on your account"
        right={<Button variant="outline" size="sm" onClick={exportCsv}><Download size={14} /> Export CSV</Button>}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="px-5 py-4 text-center">
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{usd(totals.deposits)}</p>
          <p className="text-xs text-[var(--muted)]">Total Deposits</p>
        </Card>
        <Card className="px-5 py-4 text-center">
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">{usd(totals.withdrawals)}</p>
          <p className="text-xs text-[var(--muted)]">Total Withdrawals</p>
        </Card>
      </div>

      <Card className="mt-4 flex flex-wrap items-center gap-2 p-3">
        <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]"><Filter size={13} /> Filters</span>
        <Select value={type} onChange={setType} options={[['all', 'All Types'], ['deposit', 'Deposits'], ['withdrawal', 'Withdrawals'], ['trade', 'Trades']]} />
        <Select value={status} onChange={setStatus} options={[['all', 'All Status'], ['completed', 'Completed'], ['pending', 'Pending'], ['failed', 'Failed']]} />
        <Select value={acc} onChange={setAcc} options={[['all', 'All Accounts'], ['real', 'Real'], ['demo', 'Demo']]} />
      </Card>

      <Card className="mt-4">
        {loading ? (
          <div className="py-16 text-center text-sm text-[var(--muted)]">Loading…</div>
        ) : rows.length === 0 ? (
          <Empty icon={<Wallet size={22} />} title="No transactions match these filters" />
        ) : rows.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3.5 last:border-0">
            <div className="flex min-w-0 items-center gap-3">
              <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${t.type === 'deposit' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : t.type === 'withdrawal' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'}`}>
                {t.type === 'deposit' ? <ArrowDownLeft size={15} /> : t.type === 'withdrawal' ? <ArrowUpRight size={15} /> : <Wallet size={15} />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium capitalize">{t.type}</span>
                  <Badge className="h-5 px-1.5 text-[10px] uppercase">{t.accountType}</Badge>
                </div>
                <p className="truncate text-[11px] text-[var(--muted)]">{dt(t.createdAt)} · {t.details}</p>
              </div>
            </div>
            <div className="text-right">
              <p className={`text-sm font-semibold ${t.amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {t.amount >= 0 ? '+' : ''}{usd(t.amount)}
              </p>
              <div className="mt-0.5 flex items-center justify-end gap-1.5">
                <Badge tone={t.status === 'completed' ? 'positive' : t.status === 'failed' ? 'negative' : 'warning'} className="h-5 px-2 text-[10px] uppercase">
                  {t.reviewStage ?? t.status}
                </Badge>
              </div>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs font-medium outline-none"
    >
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
