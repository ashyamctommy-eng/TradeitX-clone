'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { RefreshCw, AlertTriangle, ArrowRight, Bitcoin, Smartphone, CreditCard, Copy, Check } from 'lucide-react';
import { PageHead } from '@/components/app-shell';
import { Badge, Button, Card, Field, Modal } from '@/components/ui';
import { api, post } from '@/lib/api';
import { usd } from '@/lib/format';

type Fx = { rates: Record<string, number>; updatedAt: string };
type Invoice = { id: string; network: string; address: string; cryptoAmount: number; usdAmount: number; status: string; sandbox: boolean };

const GROUPS = [
  {
    title: 'Cards & Wallets', icon: CreditCard, items: [
      { id: 'payhero', label: 'Payhero', note: 'Instant' },
      { id: 'visa', label: 'Visa', note: 'Popular' },
      { id: 'neteller', label: 'Neteller' },
      { id: 'skrill', label: 'Skrill' },
      { id: 'dusupay', label: 'Dusupay' },
      { id: 'enovpay', label: 'Enovpay' },
    ],
  },
  {
    title: 'Mobile Money', icon: Smartphone, items: [
      { id: 'mpesa', label: 'M-Pesa', note: 'Fast' },
      { id: 'airtel', label: 'Airtel Money' },
    ],
  },
  {
    title: 'Cryptocurrency', icon: Bitcoin, items: [
      { id: 'BTC', label: 'Bitcoin', note: 'BTC' },
      { id: 'ETH_ERC20', label: 'Ethereum', note: 'ERC-20' },
      { id: 'USDT_TRC20', label: 'USDT', note: 'TRC-20' },
      { id: 'USDT_ERC20', label: 'USDT', note: 'ERC-20' },
    ],
  },
];

export default function DepositOptionsPage() {
  const router = useRouter();
  const [amount, setAmount] = useState(100);
  const [fx, setFx] = useState<Fx | null>(null);
  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState('EUR');
  const [fxAmount, setFxAmount] = useState(100);
  const [mpesaOpen, setMpesaOpen] = useState(false);
  const [phone, setPhone] = useState('+254717702563');
  const [crypto, setCrypto] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadFx = async () => setFx(await api<Fx>('/fx'));
  useEffect(() => { loadFx(); }, []);

  const converted = useMemo(() => {
    if (!fx) return 0;
    const r = fx.rates;
    return (fxAmount * (r[to] ?? 1)) / (r[from] ?? 1);
  }, [fx, fxAmount, from, to]);

  const startMpesa = async () => {
    setBusy(true); setNotice(null);
    try {
      const res = await post<{ id: string }>('/deposits/mpesa', { amount, phone });
      router.push(`/mpesa-status?id=${res.id}`);
    } catch (e) {
      setNotice((e as Error).message === 'LIVE_PAYMENTS_DISABLED'
        ? 'Live payments are disabled in this environment.'
        : `Could not start the STK push (${(e as Error).message}).`);
    } finally { setBusy(false); }
  };

  const startCrypto = async () => {
    setBusy(true); setNotice(null);
    try {
      const inv = await post<Invoice>('/deposits/crypto', { network: crypto, usdAmount: amount });
      setInvoice(inv);
    } catch (e) {
      setNotice(`Could not create invoice (${(e as Error).message}).`);
    } finally { setBusy(false); }
  };

  const cryptoLabel = (id: string) => id.replace('_', ' ');

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <PageHead title="Deposit" subtitle="Top up your account" />

      <div className="rounded-2xl bg-[#0b0b0d] p-5 text-white shadow-xl ring-1 ring-white/10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Top up your account</h2>
            <p className="text-xs text-white/45">Choose a method to deposit funds securely.</p>
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">Amount</span>
            <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
              <span className="text-2xl font-bold text-[#FFCC00]"><input
                value={amount}
                onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
                className="w-24 bg-transparent text-right outline-none"
                inputMode="decimal"
              /></span>
              <span className="text-sm text-white/50">$</span>
            </div>
          </label>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/8 px-3 py-2 text-[11px] text-red-300/90">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span><span className="font-semibold">Risk Warning.</span> Trading is risky. You may lose your deposited funds. Only deposit what you can afford to lose. Funds cannot be reversed once deposited.</span>
        </div>
      </div>

      {/* FX */}
      <Card className="mt-4 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Currency Converter</h3>
            <p className="text-[11px] text-[var(--muted)]">Live exchange rates · {fx ? new Date(fx.updatedAt).toLocaleTimeString() : '—'}</p>
          </div>
          <Button variant="outline" size="sm" onClick={loadFx}><RefreshCw size={13} /> Refresh</Button>
        </div>
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <Field label="From">
            <div className="flex gap-2">
              <input className="input" value={fxAmount} onChange={(e) => setFxAmount(Number(e.target.value) || 0)} inputMode="decimal" />
              <select className="input w-24" value={from} onChange={(e) => setFrom(e.target.value)}>
                {Object.keys(fx?.rates ?? { USD: 1 }).map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </Field>
          <div className="hidden pb-3 text-[var(--muted)] sm:block"><ArrowRight size={16} /></div>
          <Field label="To">
            <div className="flex gap-2">
              <input className="input bg-[var(--surface-2)]" value={converted.toLocaleString('en-US', { maximumFractionDigits: 4 })} readOnly />
              <select className="input w-24" value={to} onChange={(e) => setTo(e.target.value)}>
                {Object.keys(fx?.rates ?? { EUR: 1 }).map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </Field>
        </div>
      </Card>

      {notice && <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{notice}</p>}

      {GROUPS.map((g) => {
        const Icon = g.icon;
        return (
          <div key={g.title} className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><Icon size={15} /> {g.title}</h3>
              <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{g.items.length} options</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {g.items.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    if (m.id === 'mpesa') setMpesaOpen(true);
                    else if (['BTC', 'ETH_ERC20', 'USDT_TRC20', 'USDT_ERC20'].includes(m.id)) { setCrypto(m.id); setInvoice(null); }
                    else setNotice(`${m.label} acquiring is not configured in this build. Use M-Pesa or crypto.`);
                  }}
                  className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-left transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--surface-2)] text-xs font-bold uppercase">{m.label.slice(0, 2)}</div>
                    <div>
                      <p className="text-sm font-medium">{m.label}</p>
                      <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Tap to select</p>
                    </div>
                  </div>
                  {m.note && <Badge tone="warning" className="h-5 px-2 text-[9px] uppercase">{m.note}</Badge>}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {/* mpesa modal */}
      <Modal open={mpesaOpen} onClose={() => setMpesaOpen(false)} title="M-Pesa deposit" width={440}>
        <div className="space-y-3">
          <p className="text-sm text-[var(--muted)]">We send an STK push to your phone. Minimum deposit is $16.</p>
          <Field label="M-Pesa phone number">
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+254712345678" />
          </Field>
          <Field label="Amount (USD)">
            <input className="input" value={amount} onChange={(e) => setAmount(Math.max(16, Number(e.target.value) || 16))} inputMode="decimal" />
          </Field>
          <p className="text-[11px] text-[var(--muted)]">Deposits are credited only after the M-Pesa confirmation is received. You can track the request on the next screen.</p>
          <Button className="w-full" onClick={startMpesa} disabled={busy || amount < 16}>Send STK push · {usd(amount)}</Button>
        </div>
      </Modal>

      {/* crypto modal */}
      <Modal open={Boolean(crypto)} onClose={() => { setCrypto(null); setInvoice(null); }} title={`${cryptoLabel(crypto ?? '')} deposit`} width={480}>
        {!invoice ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--muted)]">
              We generate a one-time address for this deposit. Minimum $16. The invoice expires in 30 minutes.
            </p>
            <Field label="Amount (USD)">
              <input className="input" value={amount} onChange={(e) => setAmount(Math.max(16, Number(e.target.value) || 16))} inputMode="decimal" />
            </Field>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--muted)]">
              You will send <span className="font-semibold text-[var(--text)]">{(amount / (crypto === 'BTC' ? 67420 : crypto === 'ETH_ERC20' ? 3284.5 : 1)).toFixed(8)}</span> {crypto === 'BTC' ? 'BTC' : crypto === 'ETH_ERC20' ? 'ETH' : 'USDT'} to the address shown next.
            </div>
            <Button className="w-full" onClick={startCrypto} disabled={busy}>Generate invoice</Button>
          </div>
        ) : (
          <div className="space-y-4 text-center">
            <div className="mx-auto w-fit rounded-xl bg-white p-3">
              <QRCodeSVG value={`${invoice.network.toLowerCase()}:${invoice.address}`} size={168} />
            </div>
            <div>
              <p className="text-2xl font-bold">{invoice.cryptoAmount.toFixed(8)}</p>
              <p className="text-xs text-[var(--muted)]">{cryptoLabel(invoice.network)} · ≈ {usd(invoice.usdAmount)}</p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">Deposit address</p>
              <p className="break-all font-mono text-[11px]">{invoice.address}</p>
              <button
                onClick={() => { navigator.clipboard?.writeText(invoice.address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy address'}
              </button>
            </div>
            <p className="text-[11px] text-[var(--muted)]">
              Status: <span className="font-semibold">{invoice.status}</span>. Credited automatically after the network confirms.
              {invoice.sandbox && ' Sandbox invoice — no real funds move.'}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
