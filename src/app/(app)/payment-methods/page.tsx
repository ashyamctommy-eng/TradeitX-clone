'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Smartphone, Building2, Bitcoin, ArrowRight, ShieldCheck } from 'lucide-react';
import { PageHead } from '@/components/app-shell';
import { Badge, Card, Tabs } from '@/components/ui';

const DEPOSIT = [
  { group: 'Mobile Money', label: 'M-Pesa', note: 'Instant', min: 16, icon: Smartphone },
  { group: 'Mobile Money', label: 'Airtel Money', note: 'Instant', min: 16, icon: Smartphone },
  { group: 'Cryptocurrency', label: 'Bitcoin (BTC)', note: 'On-chain', min: 16, icon: Bitcoin },
  { group: 'Cryptocurrency', label: 'Ethereum (ERC-20)', note: 'On-chain', min: 16, icon: Bitcoin },
  { group: 'Cryptocurrency', label: 'USDT (TRC-20)', note: 'TRON', min: 16, icon: Bitcoin },
  { group: 'Cryptocurrency', label: 'USDT (ERC-20)', note: 'Ethereum', min: 16, icon: Bitcoin },
];

const WITHDRAW = [
  { group: 'Mobile Money', label: 'M-Pesa', note: '~10 min after approval', min: 10, icon: Smartphone },
  { group: 'Bank', label: 'Bank Transfer', note: '3–5 business days', min: 10, icon: Building2 },
  { group: 'Cryptocurrency', label: 'Bitcoin (BTC)', note: 'Network fees apply', min: 50, icon: Bitcoin },
  { group: 'Cryptocurrency', label: 'USDT (TRC-20)', note: 'Network fees apply', min: 50, icon: Bitcoin },
];

export default function PaymentMethodsPage() {
  const [tab, setTab] = useState<'deposit' | 'withdraw'>('deposit');
  const rows = tab === 'deposit' ? DEPOSIT : WITHDRAW;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <PageHead title="Payments" subtitle="Deposit and withdraw" />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[{ id: 'deposit', label: 'Deposit' }, { id: 'withdraw', label: 'Withdraw' }]}
      />

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-[11px] text-amber-800 dark:text-amber-300">
        <ShieldCheck size={14} className="mt-0.5 shrink-0" />
        <span>
          <span className="font-semibold">Risk warning.</span> Trading is risky. You may lose your deposited funds. Withdrawals are reviewed by compliance before payout.
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {rows.map((m) => {
          const Icon = m.icon;
          return (
            <Card key={m.label} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--surface-2)] text-[var(--muted)]"><Icon size={17} /></div>
                <div>
                  <p className="text-sm font-medium">{m.label}</p>
                  <p className="text-[11px] text-[var(--muted)]">{m.group} · {m.note}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone="warning" className="h-6">Min ${m.min}</Badge>
                <Link
                  href={tab === 'deposit' ? '/deposit-options' : '/withdrawal'}
                  className="btn btn-outline h-8 px-3 text-xs"
                >
                  {tab === 'deposit' ? 'Deposit' : 'Withdraw'} <ArrowRight size={12} />
                </Link>
              </div>
            </Card>
          );
        })}
      </div>

      <p className="mt-4 text-center text-[11px] text-[var(--muted)]">
        Withdrawal requests are processed within 24 hours on business days. Documentation may be required above $1,000.
      </p>
    </div>
  );
}
