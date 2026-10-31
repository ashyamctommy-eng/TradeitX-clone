'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, Wallet, ArrowDownLeft, ArrowUpRight, Receipt } from 'lucide-react';
import { Badge, Button, Card, Field, Tabs } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { patch, post } from '@/lib/api';
import { usd } from '@/lib/format';

export default function ProfilePage() {
  const { me, refresh, account } = useUser();
  const router = useRouter();
  const [tab, setTab] = useState<'personal' | 'finances'>('personal');
  const [form, setForm] = useState({ username: '', phoneNumber: '', countryCode: '+254', country: 'KE' });
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me) setForm({
      username: me.username, phoneNumber: me.phoneNumber ?? '',
      countryCode: me.countryCode, country: me.country,
    });
  }, [me]);

  if (!me) return null;
  const real = me.balances?.real?.amount ?? 0;
  const demo = me.balances?.demo?.amount ?? 0;

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      await patch('/profile', form);
      await refresh();
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } finally { setBusy(false); }
  };

  const signOut = async () => { await post('/auth/logout').catch(() => {}); router.replace('/auth'); };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-[var(--primary)]/20 text-lg font-bold text-[#8a6d00] dark:text-[#ffcc00]">
            {me.username.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold">{me.username}</h1>
              <Badge className="uppercase">{me.userType}</Badge>
              {me.kycRequired && <Badge tone="warning">KYC required</Badge>}
              {me.frozen && <Badge tone="negative">Frozen</Badge>}
            </div>
            <p className="text-xs text-[var(--muted)]">{me.email}</p>
          </div>
          <div className="flex gap-6 text-right">
            <div><p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Total</p><p className="text-sm font-semibold">{usd(real + demo)}</p></div>
            <div><p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Real</p><p className="text-sm font-semibold">{usd(real)}</p></div>
            <div><p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Demo</p><p className="text-sm font-semibold">{usd(demo)}</p></div>
          </div>
        </div>
      </Card>

      <div className="mt-4">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'personal', label: 'Personal' }, { id: 'finances', label: 'Finances' }]} />
      </div>

      {tab === 'personal' && (
        <Card className="mt-4 p-5">
          <h2 className="text-sm font-semibold">Personal Information</h2>
          <p className="mb-4 text-xs text-[var(--muted)]">Manage your account details.</p>
          <form onSubmit={save} className="space-y-3">
            <Field label="Email"><input className="input bg-[var(--surface-2)]" value={me.email} readOnly /></Field>
            <Field label="Username">
              <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </Field>
            <div className="grid grid-cols-[100px_1fr] gap-2">
              <Field label="Code">
                <input className="input" value={form.countryCode} onChange={(e) => setForm({ ...form, countryCode: e.target.value })} />
              </Field>
              <Field label="Phone">
                <input className="input" value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} placeholder="717702563" />
              </Field>
            </div>
            <Field label="Country">
              <input className="input" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
            </Field>
            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save Changes'}</Button>
              <Button type="button" variant="outline" onClick={signOut}><LogOut size={14} /> Sign Out</Button>
              {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
            </div>
          </form>
        </Card>
      )}

      {tab === 'finances' && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="p-4">
              <Badge tone="positive" className="mb-2 uppercase">Real account</Badge>
              <p className="text-2xl font-bold">{usd(real)}</p>
              <p className="text-xs text-[var(--muted)]">Locked {usd(me.balances?.real?.locked ?? 0)}</p>
            </Card>
            <Card className="p-4">
              <Badge className="mb-2 uppercase">Demo account</Badge>
              <p className="text-2xl font-bold">{usd(demo)}</p>
              <p className="text-xs text-[var(--muted)]">Play money — not withdrawable</p>
            </Card>
          </div>
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Quick Actions</h3>
            <div className="grid gap-2 sm:grid-cols-3">
              <Link href="/deposit-options" className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-3 text-sm hover:bg-[var(--surface-2)]">
                <ArrowDownLeft size={16} className="text-emerald-500" /><span>Deposit Funds<br /><span className="text-[10px] text-[var(--muted)]">M-Pesa, crypto and more</span></span>
              </Link>
              <Link href="/withdrawal" className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-3 text-sm hover:bg-[var(--surface-2)]">
                <ArrowUpRight size={16} className="text-red-500" /><span>Withdraw Funds<br /><span className="text-[10px] text-[var(--muted)]">Cash out to your account</span></span>
              </Link>
              <Link href="/transactions" className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-3 text-sm hover:bg-[var(--surface-2)]">
                <Receipt size={16} className="text-blue-500" /><span>Transaction History<br /><span className="text-[10px] text-[var(--muted)]">Review past activity</span></span>
              </Link>
            </div>
          </Card>
          <p className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
            <Wallet size={12} /> Active trading account: <span className="font-semibold capitalize">{account}</span>
          </p>
        </div>
      )}
    </div>
  );
}
