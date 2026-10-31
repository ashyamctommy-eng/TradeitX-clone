'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Plus, MessageCircle, ChevronLeft } from 'lucide-react';
import { PageHead } from '@/components/app-shell';
import { Badge, Button, Card, Empty, Field, Tabs } from '@/components/ui';
import { api, post } from '@/lib/api';
import { dt } from '@/lib/format';
import { getSocket } from '@/lib/socket';
import { cn } from '@/lib/cn';

type Ticket = { id: string; subject: string; status: string; updatedAt: string; lastMessage: string; agent: string | null };
type Msg = { id: string; senderType: string; senderName: string; body: string; createdAt: string };

export default function SupportPage() {
  const [tab, setTab] = useState<'new' | 'current' | 'past'>('current');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [thread, setThread] = useState<{ subject: string; status: string; messages: Msg[] } | null>(null);
  const [draft, setDraft] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setTickets(await api<Ticket[]>('/support/tickets'));
  }, []);

  const openTicket = useCallback(async (id: string) => {
    const t = await api<{ subject: string; status: string; messages: Msg[] }>(`/support/tickets/${id}`);
    setActive(id); setThread(t);
  }, []);

  useEffect(() => { load().catch(() => {}); }, [load]);

  useEffect(() => {
    if (!active) return;
    const s = getSocket();
    s.emit('support:join', active);
    const onMsg = (m: Msg) => setThread((prev) => (prev ? { ...prev, messages: [...prev.messages, m] } : prev));
    s.on('support:message', onMsg);
    return () => { s.off('support:message', onMsg); };
  }, [active]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread?.messages.length]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const res = await post<{ id: string }>('/support/tickets', { subject, message });
      setSubject(''); setMessage(''); await load(); await openTicket(res.id); setTab('current');
    } finally { setSending(false); }
  };

  const send = async () => {
    if (!draft.trim() || !active) return;
    const body = draft.trim();
    setDraft('');
    await post(`/support/tickets/${active}/messages`, { body }).catch(() => {});
    setThread((prev) => prev ? {
      ...prev,
      messages: [...prev.messages, { id: `local-${Date.now()}`, senderType: 'USER', senderName: 'You', body, createdAt: new Date().toISOString() }],
    } : prev);
  };

  const filtered = tickets.filter((t) =>
    tab === 'current' ? t.status !== 'CLOSED' : tab === 'past' ? t.status === 'CLOSED' : true,
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <PageHead title="Live Chat Support" subtitle="We're online 24/7" />

      <Tabs
        value={tab}
        onChange={(t) => { setTab(t); setActive(null); setThread(null); }}
        tabs={[
          { id: 'new', label: 'New' },
          { id: 'current', label: 'Current Tickets', badge: String(tickets.filter((t) => t.status !== 'CLOSED').length) },
          { id: 'past', label: 'Past Tickets' },
        ]}
      />

      <div className="mt-4 grid gap-4 md:grid-cols-[320px_1fr]">
        <Card className="overflow-hidden">
          <div className="max-h-[520px] overflow-y-auto">
            {tab === 'new' ? (
              <form onSubmit={create} className="space-y-3 p-4">
                <p className="text-sm font-semibold">Start a new conversation</p>
                <Field label="Subject"><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} required placeholder="Deposit not credited" /></Field>
                <Field label="Message"><textarea className="input h-28 py-2" value={message} onChange={(e) => setMessage(e.target.value)} required placeholder="Describe the issue…" /></Field>
                <Button type="submit" className="w-full" disabled={sending}><Plus size={14} /> {sending ? 'Sending…' : 'Create ticket'}</Button>
              </form>
            ) : filtered.length === 0 ? (
              <Empty icon={<MessageCircle size={22} />} title="No tickets here" hint={tab === 'current' ? 'Start a new conversation to reach an agent.' : undefined} />
            ) : filtered.map((t) => (
              <button
                key={t.id}
                onClick={() => openTicket(t.id)}
                className={cn('block w-full border-b border-[var(--border)] p-3.5 text-left transition hover:bg-[var(--surface-2)]', active === t.id && 'bg-[var(--surface-2)]')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{t.subject}</span>
                  <Badge tone={t.status === 'CLOSED' ? 'neutral' : t.status === 'PENDING' ? 'warning' : 'positive'} className="h-5 px-2 text-[9px] uppercase">{t.status}</Badge>
                </div>
                <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{t.lastMessage}</p>
                <p className="mt-0.5 text-[10px] text-[var(--muted-2)]">{dt(t.updatedAt)}</p>
              </button>
            ))}
          </div>
        </Card>

        <Card className="flex min-h-[420px] flex-col">
          {!thread ? (
            <Empty icon={<MessageCircle size={24} />} title="Select a conversation" hint="Pick a ticket on the left, or start a new one." />
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">{thread.subject}</p>
                  <p className="text-[11px] text-[var(--muted)]">Status {thread.status.toLowerCase()} · agent replies in-app</p>
                </div>
                <button onClick={() => { setActive(null); setThread(null); }} className="text-[var(--muted)] md:hidden"><ChevronLeft size={16} /></button>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {thread.messages.map((m) => (
                  <div key={m.id} className={cn('max-w-[80%] rounded-xl px-3 py-2 text-sm', m.senderType === 'USER' ? 'ml-auto bg-[var(--primary)]/20' : 'mr-auto bg-[var(--surface-2)]')}>
                    <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{m.senderType === 'USER' ? 'You' : m.senderName}</p>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <p className="mt-1 text-[9px] text-[var(--muted-2)]">{new Date(m.createdAt).toLocaleTimeString()}</p>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <div className="flex items-center gap-2 border-t border-[var(--border)] p-3">
                <input
                  className="input" placeholder="Type a message…" value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                />
                <Button onClick={send} disabled={!draft.trim()}><Send size={14} /></Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
