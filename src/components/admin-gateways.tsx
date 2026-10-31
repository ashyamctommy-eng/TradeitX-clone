'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  KeyRound, Wallet, RefreshCw, Plus, Trash2, Check, AlertTriangle, Plug, ExternalLink,
} from 'lucide-react';
import { api, post, put, patch, api as apiDelete } from '@/lib/api';
import { Badge, Button, Card, Field, Modal, Spinner } from './ui';
import { cn } from '@/lib/cn';

type Gw = {
  palpluss: {
    configured: boolean; keyPreview: string; environment: 'live' | 'sandbox';
    depositRate: number; withdrawRate: number; defaultChannelId: string | null;
  };
  nowpayments: { configured: boolean; keyPreview: string; ipnConfigured: boolean; coins: string[] };
  webhookBase: string;
};
type Balance = { currency: string; availableBalance: number; ledgerBalance: number };
type Channel = {
  id: string; name: string; type: string; shortcode: string;
  accountNumber?: string | null; isDefault: boolean;
};

const COINS = [
  ['btc', 'BTC'], ['eth', 'ETH'], ['usdttrc20', 'USDT TRC-20'],
  ['usdterc20', 'USDT ERC-20'], ['ltc', 'LTC'],
];

export function GatewaysPanel() {
  const [gw, setGw] = useState<Gw | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [ppKey, setPpKey] = useState('');
  const [ppEnv, setPpEnv] = useState<'live' | 'sandbox'>('sandbox');
  const [depRate, setDepRate] = useState('129.35');
  const [wdRate, setWdRate] = useState('128.5');

  const [topupOpen, setTopupOpen] = useState(false);
  const [topupAmount, setTopupAmount] = useState('500');
  const [topupPhone, setTopupPhone] = useState('');

  const [channelOpen, setChannelOpen] = useState(false);
  const [chName, setChName] = useState('');
  const [chType, setChType] = useState<'PAYBILL' | 'TILL_NUMBER' | 'SEND_MONEY'>('PAYBILL');
  const [chShortcode, setChShortcode] = useState('');
  const [chAccount, setChAccount] = useState('');
  const [chDefault, setChDefault] = useState(true);

  const [npKey, setNpKey] = useState('');
  const [npSecret, setNpSecret] = useState('');
  const [npCoins, setNpCoins] = useState<string[]>([]);

  const notify = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<Gw>('/admin/gateways');
      setGw(data);
      setPpEnv(data.palpluss.environment);
      setDepRate(String(data.palpluss.depositRate));
      setWdRate(String(data.palpluss.withdrawRate));
      setNpCoins(data.nowpayments.coins);
      if (data.palpluss.configured) {
        api<{ ok: boolean; items: Channel[] }>('/admin/gateways/palpluss/channels')
          .then((r) => setChannels(r.items)).catch(() => setChannels([]));
        api<Balance>('/admin/gateways/palpluss/balance')
          .then((b) => setBalance(b)).catch(() => setBalance(null));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true);
    try { await fn(); notify(true, okText); await load(); }
    catch (e) { notify(false, (e as Error).message); }
    finally { setBusy(false); }
  };

  if (loading || !gw) return <div className="py-16"><Spinner /></div>;

  const savePp = () =>
    run(async () => {
      await put('/admin/gateways/palpluss', {
        environment: ppEnv,
        depositRate: Number(depRate),
        withdrawRate: Number(wdRate),
        ...(ppKey.trim() ? { apiKey: ppKey.trim() } : {}),
      });
      setPpKey('');
    }, 'PalPluss settings saved');

  const saveNp = () =>
    run(async () => {
      await put('/admin/gateways/nowpayments', {
        coins: npCoins,
        ...(npKey.trim() ? { apiKey: npKey.trim() } : {}),
        ...(npSecret.trim() ? { ipnSecret: npSecret.trim() } : {}),
      });
      setNpKey(''); setNpSecret('');
    }, 'NOWPayments settings saved');

  const testPp = () =>
    run(async () => {
      const res = await post<{ latencyMs: number; balance: Balance }>('/admin/gateways/palpluss/test');
      setBalance(res.balance);
      notify(true, `Connected in ${res.latencyMs} ms · KES ${res.balance.availableBalance.toFixed(2)}`);
    }, '');

  const testNp = () =>
    run(async () => {
      const res = await post<{ latencyMs: number; message: string }>('/admin/gateways/nowpayments/test');
      notify(true, `NOWPayments OK (${res.latencyMs} ms) · ${res.message}`);
    }, '');

  const createCh = () =>
    run(async () => {
      await post('/admin/gateways/palpluss/channels', {
        name: chName, type: chType, shortcode: chShortcode,
        accountNumber: chAccount || undefined, isDefault: chDefault,
      });
      setChannelOpen(false); setChName(''); setChShortcode(''); setChAccount(''); setChDefault(true);
    }, 'Payment channel created');

  const makeDefault = (id: string) =>
    run(async () => {
      await patch(`/admin/gateways/palpluss/channels/${id}`, { isDefault: true });
    }, 'Default channel updated');

  const removeCh = (id: string) =>
    run(async () => {
      await fetch(`/api/admin/gateways/palpluss/channels/${id}`, { method: 'DELETE', credentials: 'include' })
        .then(async (r) => { if (!r.ok) throw new Error((await r.json()).message || 'Delete failed'); });
    }, 'Channel deleted');

  return (
    <div className="space-y-3">
      {msg && (
        <div className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
          msg.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300')}>
          {msg.ok ? <Check size={13} /> : <AlertTriangle size={13} />} {msg.text}
        </div>
      )}

      {/* ---------------- PalPluss ---------------- */}
      <Card className="border-white/10 bg-white/[0.03] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#FFCC00]/15 text-[#FFCC00]"><Plug size={15} /></div>
            <div>
              <p className="text-sm font-semibold">PalPluss · M-Pesa</p>
              <p className="text-[11px] text-white/40">STK Push, B2C payouts, service wallet, payment channels</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={gw.palpluss.configured ? 'positive' : 'warning'}>{gw.palpluss.configured ? 'Configured' : 'Not configured'}</Badge>
            <Badge className="uppercase">{gw.palpluss.environment}</Badge>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-3">
            <Field label="API key" hint={gw.palpluss.keyPreview ? `Saved: ${gw.palpluss.keyPreview}` : 'Paste the key from console.palpluss.com — pp_live_… or pp_test_…'}>
              <div className="relative">
                <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  className="input border-white/10 bg-white/[0.04] pl-9 text-white placeholder:text-white/25"
                  placeholder="pp_live_xxxxxxxxxxxxxxxxx"
                  value={ppKey} onChange={(e) => setPpKey(e.target.value)}
                  autoComplete="off" spellCheck={false}
                />
              </div>
            </Field>

            <div>
              <p className="label mb-1.5">Environment</p>
              <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.04] p-0.5">
                {(['sandbox', 'live'] as const).map((env) => (
                  <button
                    key={env}
                    onClick={() => setPpEnv(env)}
                    className={cn('rounded-md px-3 py-1.5 text-xs font-medium capitalize transition',
                      ppEnv === env ? 'bg-[#FFCC00] text-black' : 'text-white/50 hover:text-white')}
                  >
                    {env}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-white/30">
                {ppEnv === 'sandbox' ? 'Uses https://sandbox.palpluss.com/v1' : 'Uses https://api.palpluss.com/v1'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Deposit rate (KES/USD)">
                <input className="input border-white/10 bg-white/[0.04] text-white" value={depRate} onChange={(e) => setDepRate(e.target.value)} />
              </Field>
              <Field label="Withdraw rate (KES/USD)">
                <input className="input border-white/10 bg-white/[0.04] text-white" value={wdRate} onChange={(e) => setWdRate(e.target.value)} />
              </Field>
            </div>

            <div className="flex gap-2">
              <Button onClick={savePp} disabled={busy}>Save PalPluss</Button>
              <Button variant="outline" className="border-white/15 text-white" onClick={testPp} disabled={busy || !gw.palpluss.configured}>
                Test connection
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium text-white/60">Service wallet</p>
                <button onClick={() => run(async () => { const b = await api<Balance>('/admin/gateways/palpluss/balance'); setBalance(b); }, 'Balance refreshed')}
                  className="text-white/40 hover:text-white"><RefreshCw size={13} /></button>
              </div>
              <p className="text-2xl font-semibold">
                {balance ? `KES ${balance.availableBalance.toLocaleString('en-KE', { minimumFractionDigits: 2 })}` : '—'}
              </p>
              <p className="text-[10px] text-white/30">
                {balance ? `Ledger KES ${balance.ledgerBalance.toFixed(2)} · fees are deducted here` : 'Connect PalPluss to read the wallet'}
              </p>
              <Button size="sm" variant="outline" className="mt-2 border-white/15 text-white"
                onClick={() => setTopupOpen(true)} disabled={!gw.palpluss.configured}>
                <Wallet size={13} /> Top up
              </Button>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[10px] leading-relaxed text-white/35">
              <p className="mb-1 font-semibold text-white/50">Webhook endpoints</p>
              <p className="font-mono">{gw.webhookBase}/palpluss/stk</p>
              <p className="font-mono">{gw.webhookBase}/palpluss/b2c</p>
              <p className="mt-1">Must be public HTTPS. PalPluss retries 5×, so handlers are idempotent on transaction.id.</p>
            </div>
          </div>
        </div>
      </Card>

      {/* ---------------- Channels ---------------- */}
      <Card className="border-white/10 bg-white/[0.03] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Payment channels</p>
            <p className="text-[11px] text-white/40">Paybill / Till shortcodes used to route STK Push</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="border-white/15 text-white" onClick={() => setChannelOpen(true)} disabled={!gw.palpluss.configured}>
              <Plus size={13} /> New channel
            </Button>
          </div>
        </div>

        {channels.length === 0 ? (
          <p className="py-4 text-center text-xs text-white/30">
            {gw.palpluss.configured ? 'No channels returned by PalPluss.' : 'Add and save an API key to load channels.'}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-white/10">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.04] text-[10px] uppercase tracking-wide text-white/35">
                <tr><th className="px-3 py-2">Name</th><th className="px-2 py-2">Type</th><th className="px-2 py-2">Shortcode</th><th className="px-2 py-2">Account</th><th className="px-2 py-2">Default</th><th className="px-3 py-2 text-right">Actions</th></tr>
              </thead>
              <tbody>
                {channels.map((ch) => (
                  <tr key={ch.id} className="border-t border-white/10">
                    <td className="px-3 py-2">{ch.name}</td>
                    <td className="px-2 py-2 text-white/50">{ch.type}</td>
                    <td className="px-2 py-2 font-mono">{ch.shortcode}</td>
                    <td className="px-2 py-2 font-mono text-white/50">{ch.accountNumber || '—'}</td>
                    <td className="px-2 py-2">{ch.isDefault ? <Badge tone="positive" className="h-5 px-2 text-[9px]">default</Badge> : <span className="text-white/25">—</span>}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {!ch.isDefault && (
                          <button onClick={() => makeDefault(ch.id)} className="rounded border border-white/15 px-2 py-1 text-[10px] text-white/70 hover:bg-white/10">
                            Set default
                          </button>
                        )}
                        <button onClick={() => removeCh(ch.id)} className="rounded border border-red-500/30 px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/10">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[10px] text-white/30">
          If no channel is selected as default, PalPluss returns <code>NO_DEFAULT_CHANNEL</code> — set one here or pass a channel explicitly.
        </p>
      </Card>

      {/* ---------------- NOWPayments ---------------- */}
      <Card className="border-white/10 bg-white/[0.03] p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#f7931a]/15 text-[#f7931a]"><Wallet size={15} /></div>
            <div>
              <p className="text-sm font-semibold">NOWPayments · Crypto</p>
              <p className="text-[11px] text-white/40">Payment creation, status polling, HMAC-SHA512 IPN</p>
            </div>
          </div>
          <Badge tone={gw.nowpayments.configured ? 'positive' : 'warning'}>{gw.nowpayments.configured ? 'Configured' : 'Sandbox'}</Badge>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-3">
            <Field label="API key" hint={gw.nowpayments.keyPreview ? `Saved: ${gw.nowpayments.keyPreview}` : 'From account.nowpayments.io'}>
              <input className="input border-white/10 bg-white/[0.04] text-white placeholder:text-white/25" placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
                value={npKey} onChange={(e) => setNpKey(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="IPN secret" hint={gw.nowpayments.ipnConfigured ? 'Saved — signature verification enabled' : 'Used to verify x-nowpayments-sig'}>
              <input className="input border-white/10 bg-white/[0.04] text-white placeholder:text-white/25" placeholder="••••••••••••••••"
                value={npSecret} onChange={(e) => setNpSecret(e.target.value)} autoComplete="off" />
            </Field>
            <div className="flex gap-2">
              <Button onClick={saveNp} disabled={busy}>Save NOWPayments</Button>
              <Button variant="outline" className="border-white/15 text-white" onClick={testNp} disabled={busy || !gw.nowpayments.configured}>Test</Button>
            </div>
          </div>

          <div>
            <p className="label mb-2">Accepted coins</p>
            <div className="grid grid-cols-2 gap-1.5">
              {COINS.map(([id, label]) => (
                <button key={id}
                  onClick={() => setNpCoins((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))}
                  className={cn('flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs transition',
                    npCoins.includes(id) ? 'border-[#f7931a]/50 bg-[#f7931a]/10' : 'border-white/10')}>
                  <span>{label}</span>
                  <span className={cn('h-2 w-2 rounded-full', npCoins.includes(id) ? 'bg-[#f7931a]' : 'bg-white/15')} />
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-white/30">Disabled coins are hidden from the deposit screen.</p>
          </div>
        </div>
      </Card>

      {/* top-up modal */}
      <Modal open={topupOpen} onClose={() => setTopupOpen(false)} title="Top up service wallet" width={420}>
        <div className="space-y-3">
          <Field label="Amount (KES)">
            <input className="input" value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="M-Pesa phone">
            <input className="input" value={topupPhone} onChange={(e) => setTopupPhone(e.target.value)} placeholder="0712345678" />
          </Field>
          <p className="text-[11px] text-white/40">An STK prompt is sent to this number. Fees are paid from the wallet, so keep a buffer.</p>
          <Button className="w-full" disabled={busy || !topupAmount || !topupPhone}
            onClick={() => run(async () => {
              await post('/admin/gateways/palpluss/topup', { amountKes: Number(topupAmount), phone: topupPhone });
              setTopupOpen(false);
            }, 'Top-up STK sent')}>
            Send STK push
          </Button>
        </div>
      </Modal>

      {/* channel modal */}
      <Modal open={channelOpen} onClose={() => setChannelOpen(false)} title="New payment channel" width={440}>
        <div className="space-y-3">
          <Field label="Name">
            <input className="input" value={chName} onChange={(e) => setChName(e.target.value)} placeholder="Main Collections Paybill" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Type">
              <select className="input" value={chType} onChange={(e) => setChType(e.target.value as typeof chType)}>
                <option value="PAYBILL">PAYBILL</option>
                <option value="TILL_NUMBER">TILL_NUMBER</option>
                <option value="SEND_MONEY">SEND_MONEY</option>
              </select>
            </Field>
            <Field label="Shortcode">
              <input className="input" value={chShortcode} onChange={(e) => setChShortcode(e.target.value)} placeholder="123456" />
            </Field>
          </div>
          <Field label="Account number (Paybill only)">
            <input className="input" value={chAccount} onChange={(e) => setChAccount(e.target.value)} placeholder="ACCOUNT001" />
          </Field>
          <label className="flex items-center gap-2 text-xs text-white/60">
            <input type="checkbox" checked={chDefault} onChange={(e) => setChDefault(e.target.checked)} className="accent-[#FFCC00]" />
            Make this the default channel
          </label>
          <Button className="w-full" disabled={busy || !chName || !chShortcode} onClick={createCh}>Create channel</Button>
        </div>
      </Modal>
    </div>
  );
}
