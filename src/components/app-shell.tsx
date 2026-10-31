'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Menu, X, LayoutDashboard, Bot, Users, Wallet, Receipt, CreditCard,
  User2, MessageCircle, HelpCircle, LogOut, Sun, Moon, ChevronDown, ChevronRight,
} from 'lucide-react';
import { useUser } from './user-context';
import { usd } from '@/lib/format';
import { cn } from '@/lib/cn';
import { post } from '@/lib/api';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', sub: 'Overview', icon: LayoutDashboard },
  { href: '/auto-trade', label: 'Auto Trading', sub: 'Automated bots', icon: Bot },
  { href: '/auto-trade?copy=1', label: 'Copy Trading', sub: 'Mirror elite traders', icon: Users },
  { href: '/finances', label: 'Finances', sub: 'Wallet & Balances', icon: Wallet },
  { href: '/transactions', label: 'Transactions', sub: 'History', icon: Receipt },
  { href: '/payment-methods', label: 'Payments', sub: 'Deposit / Withdraw', icon: CreditCard },
  { href: '/profile', label: 'Profile', sub: 'Account info', icon: User2 },
  { href: '/support', label: 'Live Chat', sub: 'Talk to an agent', icon: MessageCircle },
  { href: '/support', label: 'Help & FAQ', sub: 'Support', icon: HelpCircle },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, loading, account, setAccount, balance, refresh } = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  useEffect(() => {
    if (!loading && !me) router.replace('/auth');
  }, [loading, me, router]);

  useEffect(() => { setDrawer(false); setSwitcher(false); }, [pathname]);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('tx-theme', next ? 'dark' : 'light');
  };

  const signOut = async () => {
    await post('/auth/logout').catch(() => {});
    router.replace('/auth');
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--primary)]" />
      </div>
    );
  }
  if (!me) return null;

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <header className="sticky top-0 z-40">
        {/* top bar — 56px */}
        <div className="flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-3">
          <div className="flex items-center gap-2">
            <button
              aria-label="Open menu"
              onClick={() => setDrawer(true)}
              className="rounded-md p-1.5 text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            >
              <Menu size={20} />
            </button>
          </div>

          <Link href="/dashboard" className="absolute left-1/2 -translate-x-1/2 font-semibold tracking-tight">
            TradeitX
          </Link>

          <div className="flex items-center gap-2">
            <Link href="/dashboard" className="btn btn-primary h-9 px-3 text-sm">Trade Now</Link>
            <span className="hidden text-sm text-[var(--muted)] sm:inline">{me.username}</span>
            <button
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="rounded-md p-1.5 text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            >
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <Link href="/profile" className="rounded-md p-1.5 text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
              <User2 size={17} />
            </Link>
          </div>
        </div>

        {/* secondary bar — 49px */}
        <div className="flex h-[49px] items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-3">
          <div className="relative">
            <button
              onClick={() => setSwitcher((v) => !v)}
              className="flex h-8 items-center gap-2 rounded-full bg-gradient-to-r from-[#ffe680] to-[#ffcc00] px-3 text-sm font-bold text-black shadow-sm"
            >
              <span className="grid h-5 w-5 place-items-center rounded-full bg-black/15 text-[10px]">
                {account === 'real' ? 'R' : 'D'}
              </span>
              <span>{usd(balance)}</span>
              <ChevronDown size={14} />
            </button>
            {switcher && (
              <div className="absolute left-0 top-10 z-50 w-60 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-xl">
                {(['real', 'demo'] as const).map((a) => (
                  <button
                    key={a}
                    onClick={async () => { await setAccount(a); setSwitcher(false); }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-[var(--surface-2)]',
                      account === a && 'bg-[var(--surface-2)] font-semibold',
                    )}
                  >
                    <span className="capitalize">{a} account</span>
                    <span className="text-[var(--muted)]">{usd(me.balances?.[a]?.amount ?? 0)}</span>
                  </button>
                ))}
                <p className="px-3 pt-2 text-[11px] text-[var(--muted)]">Demo balance is play money. Real balance is withdrawable.</p>
              </div>
            )}
          </div>

          <Link
            href="/finances"
            className="text-sm font-medium text-[var(--muted)] transition hover:text-[var(--text)]"
          >
            Finances
          </Link>
          <Link href="/auto-trade" className="chip">
            <span className={cn('h-1.5 w-1.5 rounded-full', 'bg-emerald-500')} />
            Manual / Auto
          </Link>
        </div>
      </header>

      {children}

      {/* drawer */}
      {drawer && (
        <div className="fixed inset-0 z-[70]">
          <div className="absolute inset-0 bg-black/45" onClick={() => setDrawer(false)} />
          <aside className="sheet-in absolute left-0 top-0 flex h-full w-[280px] flex-col border-r border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] p-4">
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--primary)] text-sm font-bold text-black">T</div>
                <span className="font-semibold tracking-tight">TradeitX</span>
              </div>
              <button onClick={() => setDrawer(false)} className="rounded p-1 text-[var(--muted)] hover:bg-[var(--surface-2)]">
                <X size={16} />
              </button>
            </div>
            <div className="flex items-center gap-3 px-4 py-4">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-[var(--primary)]/20 text-sm font-bold text-[#8a6d00] dark:text-[#ffcc00]">
                {me.username.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{me.username}</p>
                <p className="truncate text-xs text-[var(--muted)]">{me.email}</p>
              </div>
            </div>
            <nav className="flex-1 overflow-y-auto px-2">
              <p className="label px-3 py-2">Menu</p>
              {NAV.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href.split('?')[0];
                return (
                  <Link key={item.label} href={item.href} className={cn('nav-item', active && 'bg-[var(--surface-2)]')}>
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--surface-2)] text-[var(--muted)]">
                      <Icon size={15} />
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm">{item.label}</span>
                      <span className="block text-[11px] text-[var(--muted)]">{item.sub}</span>
                    </span>
                    <ChevronRight size={14} className="text-[var(--muted-2)]" />
                  </Link>
                );
              })}
            </nav>
            <div className="border-t border-[var(--border)] p-3">
              <button onClick={signOut} className="btn btn-outline w-full justify-start gap-2 border-red-500/40 text-red-600 dark:text-red-400">
                <LogOut size={15} /> Sign out
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

export function PageHead({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-[var(--muted)]">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
