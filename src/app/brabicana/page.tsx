'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard, Users, ArrowDownLeft, ArrowUpRight, Wrench, MessageSquare,
  Send, LogOut, Search, RefreshCw, Bitcoin, ShieldAlert, CreditCard,
} from 'lucide-react';
import { api, post, put } from '@/lib/api';
import { Badge, Button, Card, Field, Modal, Spinner } from '@/components/ui';
import { dt, usd } from '@/lib/format';
import { cn } from '@/lib/cn';
import { getSocket } from '@/lib/socket';
import { GatewaysPanel } from '@/components/admin-gateways';

type Section = 'overview' | 'users' | 'deposits' | 'withdrawals' | 'gateways' | 'instruments' | 'support' | 'telegram';

type Overview = { users: number; depositsTotal: number; withdrawalsTotal: number; pendingDeposits: number; pendingWithdrawals: number; tickets: number; trades: number };
type User = { id: string; email: string; username: string; userType: string; frozen: boolean; kycRequired: boolean; country: string; preferredAccountType: string; balances: Record<string, { amount: number; locked: number }>; createdAt: string };
type Tx = { id: string; user: string; email: string; type: string; amount: number; provider: string; ref: string | null; status: string; stage: string | null; reason: string | null; destination: string | null; createdAt: string; details: string };
type Ticket = { id: string; subject: string; status: string; user: string; email: string; updatedAt: string; lastMessage: string };
type TgEvent = { id: string; direction: string; kind: string; title: string; body: string; status: string; refId: string | null; createdAt: string; buttons: { text: string; data: string }[] };
type Instrument = { symbol: string; label: string; mode: string; payoutRate: number; minStake: number; maxStake: number; isActive: boolean };
type Invoice = { id: string; user: string; network: string; usd: number; crypto: number; address: string; status: string; txHash: string | null; createdAt: string };

export default function AdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [section, setSection] = useState<Section>('overview');
  const [ov, setOv] = useState<Overview | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [q, setQ] = useState('');
  const [deps, setDeps] = useState<Tx[]>([]);
  const [wds, setWds] = useState<Tx[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [tg, setTg] = useState<{ configured: boolean; events: TgEvent[] }>({ configured: false, events: [] });
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [adjust, setAdjust] = useState<User | null>(null);
  const [thread, setThread] = useState<{ id: string; subject: string; user: string; messages: { id: string; senderType: string; senderName: string; body: string; createdAt: string }[] } | null>(null);
  const [reply, setReply] = useState('');
  const [confirm, setConfirm] = useState<{ title: string; body: string; action: () => Promise<void> } | null>(null);
  const [busy, setBusy] = useState(false);

  const guard = useCallback(async () => {
    try {
      const me = await api<{ userType: string }>('/me');
      if (me.userType !== 'admin') { router.replace('/brabicana/login'); return; }
      setReady(true);
    } catch { router.replace('/brabicana/login'); }
  }, [router]);

  const loadAll = useCallback(async () => {
    const [o, d, w, t, g, i, inv] = await Promise.all([
      api<Overview>('/admin/overview').catch(() => null),
      api<Tx[]>('/admin/transactions?type=deposit&status=pending').catch(() => []),
      api<Tx[]>('/admin/transactions?type=withdrawal').catch(() => []),
      api<Ticket[]>('/admin/tickets').catch(() => []),
      api<{ configured: boolean; events: TgEvent[] }>('/admin/telegram').catch(() => ({ configured: false, events: [] })),
      api<Instrument[]>('/admin/instruments').catch(() => []),
      api<Invoice[]>('/admin/crypto/invoices').catch(() => []),
    ]);
    setOv(o); setDeps(d); setWds(w); setTickets(t); setTg(g); setInstruments(i); setInvoices(inv);
  }, []);

  const loadUsers = useCallback(async (query = '') => {
    setUsers(await api<User[]>(`/admin/users?q=${encodeURIComponent(query)}`));
  }, []);

  useEffect(() => { guard(); }, [guard]);
  useEffect(() => { if (ready) { loadAll(); loadUsers(); } }, [ready, loadAll, loadUsers]);

  useEffect(() => {
    if (!ready) return;
    const s = getSocket();
    const onTg = (ev: TgEvent) => setTg((prev) => ({ ...prev, events: [ev, ...prev.events].slice(0, 60) }));
    s.on('admin:telegram', onTg);
    return () => { s.off('admin:telegram', onTg); };
  }, [ready]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await loadAll(); if (section === 'users') await loadUsers(q); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(false); setConfirm(null); }
  };

  const tgAction = async (data: string) => {
    const [, action, id] = data.split(':');
    if (action === 'approve') await run(() => post(`/admin/withdrawals/${id}/approve`));
    if (action === 'complete') await run(() => post(`/admin/withdrawals/${id}/complete`));
    if (action === 'decline') await run(() => post(`/admin/withdrawals/${id}/decline`, { reason: 'Declined from Telegram feed', code: 'MRG-108' }));
    if (action === 'credit') await run(() => post(`/admin/deposits/${id}/credit`));
  };

  if (!ready) return <div className="flex h-screen items-center justify-center"><Spinner /></div>;

  return (
    <div className="flex min-h-screen bg-[#0a0a0b] text-[#fafafa]">
      {/* sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-white/10 bg-[#0d0d0f] p-3 md:flex">
        <div className="mb-5 flex items-center gap-2 px-2 pt-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#FFCC00] text-black"><ShieldAlert size={16} /></div>
          <div>
            <p className="text-sm font-semibold leading-tight">Management</p>
            <p className="text-[10px] text-white/35">Brabicana portal</p>
          </div>
        </div>
        {([
          ['overview', 'Overview', LayoutDashboard],
          ['users', 'Users', Users],
          ['deposits', 'Deposits', ArrowDownLeft],
          ['withdrawals', 'Withdrawals', ArrowUpRight],
          ['gateways', 'Gateways', CreditCard],
          ['instruments', 'Instruments', Wrench],
          ['support', 'Support desk', MessageSquare],
          ['telegram', 'Telegram bot', Send],
        ] as [Section, string, typeof Users][]).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={cn('mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-white/60 transition hover:bg-white/5 hover:text-white',
              section === id && 'bg-white/[0.07] text-white')}
          >
            <Icon size={15} /> {label}
            {id === 'withdrawals' && ov && ov.pendingWithdrawals > 0 && (
              <span className="ml-auto rounded-full bg-[#FFCC00] px-1.5 text-[10px] font-bold text-black">{ov.pendingWithdrawals}</span>
            )}
            {id === 'deposits' && ov && ov.pendingDeposits > 0 && (
              <span className="ml-auto rounded-full bg-white/10 px-1.5 text-[10px] font-bold">{ov.pendingDeposits}</span>
            )}
          </button>
        ))}
        <div className="mt-auto border-t border-white/10 pt-2">
          <button onClick={async () => { await post('/auth/logout').catch(() => {}); router.replace('/brabicana/login'); }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-white/50 hover:bg-white/5 hover:text-white">
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 md:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold capitalize">{section === 'support' ? 'Support desk' : section === 'telegram' ? 'Telegram command center' : section === 'gateways' ? 'Payment gateways' : section}</h1>
          <Button variant="outline" size="sm" onClick={() => run(loadAll)} className="border-white/15 text-white">
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>

        {section === 'overview' && ov && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Users', String(ov.users)], ['Trades', String(ov.trades)],
                ['Deposits (settled)', usd(ov.depositsTotal)], ['Withdrawals (paid)', usd(ov.withdrawalsTotal)],
                ['Pending deposits', String(ov.pendingDeposits)], ['Pending withdrawals', String(ov.pendingWithdrawals)],
                ['Open tickets', String(ov.tickets)], ['Live payments', process.env.NEXT_PUBLIC_LIVE_PAYMENTS ?? 'on'],
              ].map(([k, v]) => (
                <Card key={k} className="border-white/10 bg-white/[0.04] p-4">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-white/40">{k}</p>
                  <p className="mt-1 text-xl font-semibold">{v}</p>
                </Card>
              ))}
            </div>
            <Card className="mt-4 border-white/10 bg-white/[0.03] p-4">
              <h2 className="mb-2 text-sm font-semibold">Operational note</h2>
              <p className="text-xs leading-relaxed text-white/50">
                Withdrawals move PENDING_REVIEW → PROCESSING → COMPLETED entirely on admin action. Nothing is auto-settled on a timer.
                Every deposit is credited only after confirmation from its rail. All transitions are logged here and mirrored to Telegram.
              </p>
            </Card>
          </>
        )}

        {section === 'users' && (
          <div>
            <div className="mb-3 flex gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input className="input border-white/10 bg-white/[0.04] pl-8 text-white" placeholder="Search email or username"
                  value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadUsers(q)} />
              </div>
              <Button variant="outline" size="sm" className="border-white/15 text-white" onClick={() => loadUsers(q)}>Search</Button>
            </div>
            <Card className="border-white/10 bg-white/[0.03]">
              {users.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{u.username} <span className="text-xs font-normal text-white/40">{u.email}</span></p>
                    <p className="text-[11px] text-white/40">
                      Real {usd(u.balances.real?.amount ?? 0)} · Demo {usd(u.balances.demo?.amount ?? 0)} · {u.country || '—'} · {u.userType}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={u.frozen ? 'negative' : 'positive'} className="h-5 px-2 text-[10px]">{u.frozen ? 'Frozen' : 'Active'}</Badge>
                    {u.kycRequired && <Badge tone="warning" className="h-5 px-2 text-[10px]">KYC</Badge>}
                    <Button size="sm" variant="outline" className="border-white/15 text-white" onClick={() => setAdjust(u)}>Adjust</Button>
                    <Button size="sm" variant="ghost" className="text-white/60"
                      onClick={() => run(() => post(`/admin/users/${u.id}/flags`, { frozen: !u.frozen }))}>
                      {u.frozen ? 'Unfreeze' : 'Freeze'}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-white/60"
                      onClick={() => run(() => post(`/admin/users/${u.id}/flags`, { kycRequired: !u.kycRequired }))}>
                      {u.kycRequired ? 'Clear KYC' : 'Require KYC'}
                    </Button>
                  </div>
                </div>
              ))}
            </Card>
          </div>
        )}

        {section === 'deposits' && (
          <>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">Awaiting rail confirmation</h2>
            <Card className="mb-5 border-white/10 bg-white/[0.03]">
              {deps.length === 0 && <p className="p-6 text-center text-xs text-white/35">No pending deposits.</p>}
              {deps.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 last:border-0">
                  <div>
                    <p className="text-sm">{usd(d.amount)} · <span className="text-white/50">{d.provider}</span> <span className="text-xs text-white/40">{d.ref}</span></p>
                    <p className="text-[11px] text-white/40">{d.user} · {dt(d.createdAt)} · {d.details}</p>
                  </div>
                  <Button size="sm" onClick={() => setConfirm({
                    title: 'Confirm deposit received?',
                    body: `Credit ${usd(d.amount)} to ${d.user}. Only do this after the funds are confirmed in the payment rail.`,
                    action: async () => { await post(`/admin/deposits/${d.id}/credit`); },
                  })}>Force credit</Button>
                </div>
              ))}
            </Card>

            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">Crypto invoices</h2>
            <Card className="border-white/10 bg-white/[0.03]">
              {invoices.length === 0 && <p className="p-6 text-center text-xs text-white/35">No invoices.</p>}
              {invoices.map((i) => (
                <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 last:border-0">
                  <div className="flex items-center gap-2">
                    <Bitcoin size={14} className="text-[#FFCC00]" />
                    <div>
                      <p className="text-sm">{usd(i.usd)} · {i.network}</p>
                      <p className="text-[11px] text-white/40">{i.user} · {i.status} · {dt(i.createdAt)}</p>
                    </div>
                  </div>
                  {i.status !== 'FINISHED' && (
                    <Button size="sm" variant="outline" className="border-white/15 text-white"
                      onClick={() => run(() => post(`/admin/sandbox/crypto/${i.id}/confirm`))}>
                      Sandbox confirm
                    </Button>
                  )}
                </div>
              ))}
            </Card>
            <p className="mt-2 text-[11px] text-white/30">Sandbox confirm is disabled when NODE_ENV=production. It exists to test the webhook/settlement path locally.</p>
          </>
        )}

        {section === 'withdrawals' && (
          <Card className="border-white/10 bg-white/[0.03]">
            {wds.length === 0 && <p className="p-6 text-center text-xs text-white/35">No withdrawal requests.</p>}
            {wds.map((w) => (
              <div key={w.id} className="border-b border-white/10 px-4 py-3 last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{usd(w.amount)} · {w.provider} <span className="text-xs font-normal text-white/40">{w.destination}</span></p>
                    <p className="text-[11px] text-white/40">{w.user} · {dt(w.createdAt)}</p>
                  </div>
                  <Badge tone={w.stage === 'COMPLETED' ? 'positive' : w.stage === 'DECLINED' ? 'negative' : 'warning'} className="h-5 px-2 text-[10px]">
                    {w.stage ?? w.status}
                  </Badge>
                </div>
                {w.reason && <p className="mt-1 text-[11px] text-white/35">{w.reason}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {w.stage === 'PENDING_REVIEW' && (
                    <>
                      <Button size="sm" onClick={() => setConfirm({
                        title: 'Approve withdrawal?', body: `Move ${usd(w.amount)} for ${w.user} to PROCESSING.`,
                        action: async () => { await post(`/admin/withdrawals/${w.id}/approve`); },
                      })}>Approve</Button>
                      <Button size="sm" variant="outline" className="border-red-500/40 text-red-300" onClick={() => setConfirm({
                        title: 'Decline and refund?', body: `Return ${usd(w.amount)} to ${w.user}'s real balance with code MRG-108.`,
                        action: async () => { await post(`/admin/withdrawals/${w.id}/decline`, { reason: 'Declined by compliance', code: 'MRG-108' }); },
                      })}>Decline & refund</Button>
                    </>
                  )}
                  {w.stage === 'PROCESSING' && (
                    <Button size="sm" onClick={() => setConfirm({
                      title: 'Mark as paid?', body: `Settle ${usd(w.amount)}. A transaction reference will be generated.`,
                      action: async () => { await post(`/admin/withdrawals/${w.id}/complete`, {}); },
                    })}>Mark completed</Button>
                  )}
                </div>
              </div>
            ))}
          </Card>
        )}

        {section === 'gateways' && <GatewaysPanel />}

        {section === 'instruments' && (
          <div className="space-y-2">
            {instruments.map((i) => (
              <Card key={i.symbol} className="border-white/10 bg-white/[0.03] p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[110px]">
                    <p className="text-sm font-semibold">{i.symbol}</p>
                    <p className="text-[11px] text-white/40">{i.label}</p>
                  </div>
                  <label className="text-[10px] uppercase tracking-wide text-white/40">Payout
                    <input defaultValue={i.payoutRate} type="number" step="0.01" className="input mt-1 h-9 w-20 border-white/10 bg-white/[0.05] text-white"
                      onBlur={(e) => put(`/admin/instruments/${encodeURIComponent(i.symbol)}`, { payoutRate: Number(e.target.value) }).then(loadAll)} />
                  </label>
                  <label className="text-[10px] uppercase tracking-wide text-white/40">Min
                    <input defaultValue={i.minStake} type="number" className="input mt-1 h-9 w-20 border-white/10 bg-white/[0.05] text-white"
                      onBlur={(e) => put(`/admin/instruments/${encodeURIComponent(i.symbol)}`, { minStake: Number(e.target.value) }).then(loadAll)} />
                  </label>
                  <label className="text-[10px] uppercase tracking-wide text-white/40">Max
                    <input defaultValue={i.maxStake} type="number" className="input mt-1 h-9 w-24 border-white/10 bg-white/[0.05] text-white"
                      onBlur={(e) => put(`/admin/instruments/${encodeURIComponent(i.symbol)}`, { maxStake: Number(e.target.value) }).then(loadAll)} />
                  </label>
                  <label className="text-[10px] uppercase tracking-wide text-white/40">Mode
                    <select defaultValue={i.mode} className="input mt-1 h-9 w-20 border-white/10 bg-white/[0.05] text-white"
                      onChange={(e) => put(`/admin/instruments/${encodeURIComponent(i.symbol)}`, { mode: e.target.value }).then(loadAll)}>
                      <option value="OTC">OTC</option><option value="LIVE">LIVE</option>
                    </select>
                  </label>
                  <Button size="sm" variant={i.isActive ? 'outline' : 'primary'} className={i.isActive ? 'border-white/15 text-white' : ''}
                    onClick={() => put(`/admin/instruments/${encodeURIComponent(i.symbol)}`, { isActive: !i.isActive }).then(loadAll)}>
                    {i.isActive ? 'Active' : 'Inactive'}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}

        {section === 'support' && (
          <div className="grid gap-3 lg:grid-cols-[340px_1fr]">
            <Card className="border-white/10 bg-white/[0.03]">
              {tickets.map((t) => (
                <button key={t.id} onClick={async () => {
                  const d = await api<{ id: string; subject: string; user: string; messages: { id: string; senderType: string; senderName: string; body: string; createdAt: string }[] }>(`/admin/tickets/${t.id}`);
                  setThread(d);
                }} className="block w-full border-b border-white/10 p-3 text-left hover:bg-white/5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm">{t.subject}</span>
                    <Badge tone={t.status === 'OPEN' ? 'positive' : 'warning'} className="h-5 px-2 text-[9px]">{t.status}</Badge>
                  </div>
                  <p className="truncate text-[11px] text-white/40">{t.user} · {t.lastMessage}</p>
                </button>
              ))}
              {tickets.length === 0 && <p className="p-6 text-center text-xs text-white/35">No tickets.</p>}
            </Card>
            <Card className="flex min-h-[380px] flex-col border-white/10 bg-white/[0.03]">
              {!thread ? <p className="m-auto text-xs text-white/35">Select a ticket</p> : (
                <>
                  <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">{thread.subject}</div>
                  <div className="flex-1 space-y-2 overflow-y-auto p-4">
                    {thread.messages.map((m) => (
                      <div key={m.id} className={cn('max-w-[85%] rounded-xl px-3 py-2 text-sm', m.senderType === 'USER' ? 'bg-white/[0.06]' : 'ml-auto bg-[#FFCC00]/15')}>
                        <p className="mb-0.5 text-[10px] uppercase text-white/35">{m.senderName}</p>
                        <p>{m.body}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 border-t border-white/10 p-3">
                    <input className="input border-white/10 bg-white/[0.05] text-white" value={reply} onChange={(e) => setReply(e.target.value)}
                      placeholder="Reply as agent…" onKeyDown={(e) => e.key === 'Enter' && reply.trim() && (async () => {
                        await post(`/admin/tickets/${thread.id}/reply`, { body: reply });
                        setThread({ ...thread, messages: [...thread.messages, { id: `a-${Date.now()}`, senderType: 'AGENT', senderName: 'Brabicana', body: reply, createdAt: new Date().toISOString() }] });
                        setReply('');
                      })()} />
                    <Button onClick={async () => {
                      if (!reply.trim()) return;
                      await post(`/admin/tickets/${thread.id}/reply`, { body: reply });
                      setThread({ ...thread, messages: [...thread.messages, { id: `a-${Date.now()}`, senderType: 'AGENT', senderName: 'Brabicana', body: reply, createdAt: new Date().toISOString() }] });
                      setReply('');
                    }}>Send</Button>
                  </div>
                </>
              )}
            </Card>
          </div>
        )}

        {section === 'telegram' && (
          <>
            <Card className="mb-3 border-white/10 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">Bot status</p>
                  <p className="text-[11px] text-white/40">TELEGRAM_BOT_TOKEN + TELEGRAM_ADMIN_CHAT_ID drive outbound delivery.</p>
                </div>
                <Badge tone={tg.configured ? 'positive' : 'warning'}>{tg.configured ? 'Connected' : 'Mirror only'}</Badge>
              </div>
            </Card>
            <div className="space-y-2">
              {tg.events.map((e) => (
                <Card key={e.id} className="border-white/10 bg-white/[0.03] p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{e.title}</p>
                      <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-white/45">{e.body}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge className="h-5 px-2 text-[9px]">{e.kind}</Badge>
                      <span className="text-[10px] text-white/30">{dt(e.createdAt)}</span>
                    </div>
                  </div>
                  {e.buttons.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {e.buttons.map((b) => (
                        <button key={b.data} onClick={() => tgAction(b.data)} disabled={busy}
                          className="rounded-md border border-white/15 px-2.5 py-1 text-[11px] text-white/80 hover:bg-white/10 disabled:opacity-40">
                          {b.text}
                        </button>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
              {tg.events.length === 0 && <Card className="border-white/10 bg-white/[0.03] p-8 text-center text-xs text-white/35">No events yet.</Card>}
            </div>
          </>
        )}
      </main>

      {/* adjust modal */}
      <Modal open={Boolean(adjust)} onClose={() => setAdjust(null)} title={`Adjust balance · ${adjust?.username ?? ''}`}>
        {adjust && (
          <form onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget as HTMLFormElement);
            await run(() => post(`/admin/users/${adjust.id}/balance`, {
              accountType: fd.get('accountType'), direction: fd.get('direction'),
              amount: Number(fd.get('amount')), reason: String(fd.get('reason') || 'Admin adjustment'),
            }));
            setAdjust(null);
          }} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Account">
                <select name="accountType" className="input"><option value="real">Real</option><option value="demo">Demo</option></select>
              </Field>
              <Field label="Direction">
                <select name="direction" className="input"><option value="credit">Credit</option><option value="debit">Debit</option></select>
              </Field>
            </div>
            <Field label="Amount (USD)"><input name="amount" type="number" min={0.01} step="0.01" className="input" required /></Field>
            <Field label="Reason"><input name="reason" className="input" placeholder="Goodwill credit / correction" /></Field>
            <Button type="submit" className="w-full" disabled={busy}>Apply adjustment</Button>
          </form>
        )}
      </Modal>

      {/* confirm modal */}
      <Modal open={Boolean(confirm)} onClose={() => setConfirm(null)} title={confirm?.title} width={460}>
        <p className="text-sm text-white/60">{confirm?.body}</p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1 border-white/15 text-white" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button className="flex-1" disabled={busy} onClick={() => confirm && run(confirm.action)}>Confirm</Button>
        </div>
      </Modal>
    </div>
  );
}
