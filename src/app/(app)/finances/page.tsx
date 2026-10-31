'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, ArrowDownLeft, ArrowUpRight, Wallet } from 'lucide-react';
import { PageHead } from '@/components/app-shell';
import { Badge, Card, Empty } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { api } from '@/lib/api';
import { dt, usd } from '@/lib/format';

type Tx = { id: string; type: string; amount: number; status: string; createdAt: string; details: string };

export default function FinancesPage() {
  const { me, balance, account } = useUser();
  const [hidden, setHidden] = useState(false);
  const [rows, setRows] = useState<Tx[]>([]);

  useEffect(() => {
    api<{ rows: Tx[] }>('/transactions?limit=8').then((r) => setRows(r.rows)).catch(() => {});
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <PageHead title="Finances" subtitle="Wallet and balances" />

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <Badge tone="positive" className="uppercase">{account} account</Badge>
          <button onClick={() => setHidden((v) => !v)} className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-2)]">
            {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <p className="label">Total balance</p>
        <p className="mt-1 text-4xl font-bold tracking-tight">{hidden ? '••••••' : usd(balance)} <span className="text-base font-medium text-[var(--muted)]">USD</span></p>
        {account === 'real' && (
          <p className="mt-1 text-xs text-[var(--muted)]">
            Locked in open withdrawals: {usd(me?.balances?.real?.locked ?? 0)}
          </p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Link href="/deposit-options" className="btn btn-primary h-11 rounded-xl">
            <ArrowDownLeft size={16} /> Deposit
          </Link>
          <Link href="/withdrawal" className="btn btn-outline h-11 rounded-xl">
            <ArrowUpRight size={16} /> Withdraw
          </Link>
        </div>
      </Card>

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent activity</h2>
          <Link href="/transactions" className="text-xs text-[var(--muted)] hover:text-[var(--text)]">View all</Link>
        </div>
        <Card>
          {rows.length === 0 ? (
            <Empty icon={<Wallet size={22} />} title="No transactions yet" hint="Your deposits and withdrawals will appear here." />
          ) : rows.map((t) => (
            <div key={t.id} className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 last:border-0">
              <div className="flex items-center gap-3">
                <div className={`grid h-9 w-9 place-items-center rounded-lg ${t.type === 'deposit' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : t.type === 'withdrawal' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'}`}>
                  {t.type === 'deposit' ? <ArrowDownLeft size={15} /> : t.type === 'withdrawal' ? <ArrowUpRight size={15} /> : <Wallet size={15} />}
                </div>
                <div>
                  <p className="text-sm font-medium capitalize">{t.type}</p>
                  <p className="text-[11px] text-[var(--muted)]">{dt(t.createdAt)}</p>
                </div>
              </div>
              <div className="text-right">
                <p className={`text-sm font-semibold ${t.amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                  {t.amount >= 0 ? '+' : ''}{usd(t.amount)}
                </p>
                <Badge tone={t.status === 'completed' ? 'positive' : t.status === 'failed' ? 'negative' : 'warning'} className="mt-0.5 h-5 px-2 text-[10px] uppercase">
                  {t.status}
                </Badge>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
