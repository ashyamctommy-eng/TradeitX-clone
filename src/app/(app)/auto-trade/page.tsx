'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Play, Square, RotateCcw, Sparkles, FlaskConical, Plus, Activity } from 'lucide-react';
import { PageHead } from '@/components/app-shell';
import { Badge, Button, Card, Field, Modal, Tabs } from '@/components/ui';
import { CopyTradeSheet } from '@/components/copy-trade-sheet';
import { useUser } from '@/components/user-context';
import { api, post, put } from '@/lib/api';
import { dt, usd } from '@/lib/format';
import { cn } from '@/lib/cn';

type Config = {
  isRunning: boolean; activeStrategies: string[]; frequencySeconds: number;
  fixedAmount: number; riskLevel: number; reinvestProfits: boolean; useMarketAnalysis: boolean;
};
type Signal = {
  symbol: string; buyStrength: number; sellStrength: number; volatility: string;
  trend: string; signal: string; changePct: number; price: number;
};
type Trade = {
  id: string; symbol: string; direction: string; stake: number; pnl: number | null;
  status: string; triggeredBy: string; strategy: string | null; createdAt: string; accountType: string;
};

const STRATEGIES = [
  { name: 'Trend Following', desc: 'Follows market momentum to capture larger price movements', icon: '📈' },
  { name: 'Mean Reversion', desc: 'Trades price reversals to capture market corrections', icon: '↩️' },
  { name: 'Breakout Trading', desc: 'Captures sudden price movements in either direction', icon: '⚡' },
  { name: 'Statistical Arbitrage', desc: 'Exploits price differences using mathematical models', icon: '🧮' },
];

function Inner() {
  const params = useSearchParams();
  const { account, refresh } = useUser();
  const [tab, setTab] = useState<'strategies' | 'config' | 'signals'>('strategies');
  const [cfg, setCfg] = useState<Config | null>(null);
  const [signals, setSignals] = useState<Signal | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [copyOpen, setCopyOpen] = useState(false);
  const [test, setTest] = useState<{ strategy: string; trades: number; winRate: number; pnl: number } | null>(null);
  const [aiFor, setAiFor] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, s, t] = await Promise.all([
      api<Config>('/auto-trade/config'),
      api<Signal>('/auto-trade/signals'),
      api<Trade[]>(`/trades?account=${account}`),
    ]);
    setCfg(c); setSignals(s); setTrades(t);
  }, [account]);

  useEffect(() => { load().catch(() => {}); }, [load]);
  useEffect(() => {
    if (params.get('copy') === '1') setCopyOpen(true);
  }, [params]);

  useEffect(() => {
    const iv = setInterval(() => { api<Signal>('/auto-trade/signals').then(setSignals).catch(() => {}); }, 3000);
    return () => clearInterval(iv);
  }, []);

  const save = async (patch: Partial<Config>) => {
    if (!cfg) return;
    const next = { ...cfg, ...patch };
    setCfg(next);
    await put('/auto-trade/config', patch).catch(() => {});
  };

  const toggleStrategy = (name: string) => {
    if (!cfg) return;
    const active = cfg.activeStrategies.includes(name)
      ? cfg.activeStrategies.filter((s) => s !== name)
      : [...cfg.activeStrategies, name];
    save({ activeStrategies: active });
  };

  const runTest = async (strategy: string) => {
    setBusy(true);
    try { setTest(await post('/auto-trade/test', { strategy })); } finally { setBusy(false); }
  };

  const stats = useMemo(() => {
    const settled = trades.filter((t) => t.status !== 'OPEN');
    const wins = settled.filter((t) => t.status === 'WON').length;
    const pnl = settled.reduce((s, t) => s + (t.pnl ?? 0), 0);
    return {
      winRate: settled.length ? ((wins / settled.length) * 100).toFixed(1) : '0.0',
      pnl, count: settled.length,
      auto: trades.filter((t) => t.triggeredBy === 'AUTO_BOT').length,
    };
  }, [trades]);

  const running = cfg?.isRunning ?? false;

  return (
    <div className="mx-auto max-w-5xl px-4 py-5">
      <PageHead title="Auto Trading" subtitle="Configure strategies and let the bot run" right={
        <Button variant="outline" size="sm" onClick={() => setCopyOpen(true)}>Copy Trading</Button>
      } />

      {/* strip */}
      <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => save({ isRunning: !running })}
            className={cn('grid h-11 w-11 place-items-center rounded-full text-white shadow transition',
              running ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600')}
            title={running ? 'Stop bot' : 'Start bot'}
          >
            {running ? <Square size={16} /> : <Play size={16} className="ml-0.5" />}
          </button>
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">Auto trader</p>
            <p className="text-sm font-semibold">
              {running ? <span className="text-emerald-600 dark:text-emerald-400">RUNNING</span> : 'STOPPED'}
              <span className="ml-2 text-xs font-normal text-[var(--muted)]">EUR/USD · {signals ? signals.price.toFixed(5) : '—'}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={load}><RotateCcw size={13} /> Reset</Button>
        </div>
      </Card>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'strategies', label: 'Strategies', badge: `${cfg?.activeStrategies.length ?? 0}/4` },
          { id: 'config', label: 'Config' },
          { id: 'signals', label: 'Signals' },
        ]}
      />

      {tab === 'strategies' && cfg && (
        <div className="mt-4 space-y-2">
          {STRATEGIES.map((s) => {
            const on = cfg.activeStrategies.includes(s.name);
            return (
              <Card key={s.name} className={cn('flex flex-wrap items-center gap-3 p-3.5', on && 'border-[var(--primary)]/50 bg-[var(--primary)]/[0.04]')}>
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--surface-2)] text-base">{s.icon}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="truncate text-[11px] text-[var(--muted)]">{s.desc}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setAiFor(s.name)}><Sparkles size={12} /> AI</Button>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => runTest(s.name)}><FlaskConical size={12} /> Test</Button>
                  <button
                    onClick={() => toggleStrategy(s.name)}
                    className={cn('relative h-6 w-11 rounded-full transition', on ? 'bg-[var(--primary)]' : 'bg-[var(--surface-3)]')}
                    aria-label={`Toggle ${s.name}`}
                  >
                    <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', on ? 'left-[22px]' : 'left-0.5')} />
                  </button>
                </div>
              </Card>
            );
          })}
          {cfg.activeStrategies.filter((n) => !STRATEGIES.some((s) => s.name === n)).map((name) => (
            <Card key={name} className="flex flex-wrap items-center gap-3 border-[var(--primary)]/50 bg-[var(--primary)]/[0.04] p-3.5">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--surface-2)] text-base">🧩</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{name}</p>
                <p className="text-[11px] text-[var(--muted)]">Custom strategy</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setAiFor(name)}><Sparkles size={12} /> AI</Button>
              <button
                onClick={() => save({ activeStrategies: cfg.activeStrategies.filter((s) => s !== name) })}
                className="relative h-6 w-11 rounded-full bg-[var(--primary)]"
              >
                <span className="absolute top-0.5 left-[22px] h-5 w-5 rounded-full bg-white shadow" />
              </button>
            </Card>
          ))}
          <button onClick={() => setCustomOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] py-3 text-xs font-medium text-[var(--muted)] hover:text-[var(--text)]">
            <Plus size={14} /> Create Custom
          </button>
          <p className="pt-1 text-right text-[11px] text-[var(--muted)]">Active: {cfg.activeStrategies.length}/4</p>
        </div>
      )}

      {tab === 'config' && cfg && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Card className="p-4">
            <Field label="Trade frequency">
              <select className="input" value={cfg.frequencySeconds} onChange={(e) => save({ frequencySeconds: Number(e.target.value) })}>
                {[10, 30, 60, 300, 900].map((s) => <option key={s} value={s}>{s < 60 ? `${s}s` : `${s / 60}m`}</option>)}
              </select>
            </Field>
            <div className="mt-3">
              <Field label="Fixed amount">
                <input className="input" type="number" min={1} value={cfg.fixedAmount}
                  onChange={(e) => save({ fixedAmount: Number(e.target.value) || 1 })} />
              </Field>
            </div>
            <div className="mt-3">
              <Field label={`Risk level · ${cfg.riskLevel}/5`}>
                <input type="range" min={1} max={5} value={cfg.riskLevel}
                  onChange={(e) => save({ riskLevel: Number(e.target.value) })}
                  className="w-full accent-[var(--primary)]" />
              </Field>
            </div>
          </Card>
          <Card className="p-4">
            <ToggleRow label="Reinvest profits" hint="Roll settled winnings back into the next stake"
              value={cfg.reinvestProfits} onChange={(v) => save({ reinvestProfits: v })} />
            <ToggleRow label="Use market analysis" hint="Filter entries with the signal engine"
              value={cfg.useMarketAnalysis} onChange={(v) => save({ useMarketAnalysis: v })} />
            <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[11px] text-[var(--muted)]">
              The bot places {usd(cfg.fixedAmount)} trades on EUR/USD every {cfg.frequencySeconds}s while running. All settlements use the server price stream — no per-user odds adjustment.
            </div>
          </Card>

          <Card className="md:col-span-2">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <h3 className="text-sm font-semibold">Trading History</h3>
              <span className="text-[11px] text-[var(--muted)]">{trades.length} trades</span>
            </div>
            {trades.length === 0 ? (
              <div className="py-12 text-center text-xs text-[var(--muted)]">No trades yet — start the bot to see activity</div>
            ) : (
              <div className="max-h-[320px] overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-[var(--surface-2)] text-[10px] uppercase tracking-wide text-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-2">Time</th><th className="px-2 py-2">Symbol</th><th className="px-2 py-2">Dir</th>
                      <th className="px-2 py-2">Stake</th><th className="px-2 py-2">Source</th><th className="px-2 py-2">Status</th><th className="px-4 py-2 text-right">P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.slice(0, 40).map((t) => (
                      <tr key={t.id} className="border-t border-[var(--border)]">
                        <td className="px-4 py-2 text-[var(--muted)]">{dt(t.createdAt)}</td>
                        <td className="px-2 py-2">{t.symbol}</td>
                        <td className={cn('px-2 py-2 font-semibold', t.direction === 'BUY' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>{t.direction}</td>
                        <td className="px-2 py-2">{usd(t.stake)}</td>
                        <td className="px-2 py-2 text-[var(--muted)]">{t.triggeredBy === 'AUTO_BOT' ? 'Bot' : t.triggeredBy === 'COPY_TRADE' ? 'Copy' : 'Manual'}</td>
                        <td className="px-2 py-2"><Badge tone={t.status === 'WON' ? 'positive' : t.status === 'LOST' ? 'negative' : 'warning'} className="h-5 px-2 text-[10px]">{t.status}</Badge></td>
                        <td className={cn('px-4 py-2 text-right font-semibold', (t.pnl ?? 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : (t.pnl ?? 0) < 0 ? 'text-red-600 dark:text-red-400' : 'text-[var(--muted)]')}>
                          {t.pnl === null ? '—' : `${t.pnl >= 0 ? '+' : ''}${usd(t.pnl)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'signals' && signals && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Card className="p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Activity size={14} /> Live signal · {signals.symbol}</h3>
            <Meter label="BUY SIGNAL" value={signals.buyStrength} tone="positive" />
            <div className="h-3" />
            <Meter label="SELL SIGNAL" value={signals.sellStrength} tone="negative" />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <MiniStat k="VOLATILITY" v={signals.volatility} />
              <MiniStat k="TREND" v={signals.trend} />
              <MiniStat k="SIGNAL" v={signals.signal} />
              <MiniStat k="CHANGE" v={`${signals.changePct}%`} />
            </div>
          </Card>
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Performance</h3>
            <div className="grid grid-cols-2 gap-2">
              <MiniStat k="WIN RATE" v={`${stats.winRate}%`} />
              <MiniStat k="P/L" v={`${stats.pnl >= 0 ? '+' : ''}${usd(stats.pnl)}`} />
              <MiniStat k="TRADES" v={String(stats.count)} />
              <MiniStat k="BOT TRADES" v={String(stats.auto)} />
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-[var(--muted)]">
              Signals are derived from the same price series used for settlement. Odds are identical for every account: payout {((signals.sellStrength ? 0.82 : 0.82) * 100).toFixed(0)}%.
            </p>
          </Card>
        </div>
      )}

      <CopyTradeSheet open={copyOpen} onClose={() => setCopyOpen(false)} />

      <Modal open={Boolean(test)} onClose={() => setTest(null)} title={`Backtest · ${test?.strategy ?? ''}`} width={420}>
        {test && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <MiniStat k="TRADES" v={String(test.trades)} />
              <MiniStat k="WIN RATE" v={`${test.winRate}%`} />
              <MiniStat k="P/L" v={usd(test.pnl)} />
            </div>
            <p className="text-[11px] text-[var(--muted)]">Simulated on the platform&apos;s recent 1-minute series. Historical results do not predict future returns.</p>
          </div>
        )}
      </Modal>

      <Modal open={customOpen} onClose={() => setCustomOpen(false)} title="Create custom strategy" width={440}>
        <div className="space-y-3">
          <Field label="Strategy name">
            <input className="input" value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="London Open Momentum" />
          </Field>
          <Field label="Base model">
            <select className="input" defaultValue="Trend Following">
              {STRATEGIES.map((s) => <option key={s.name}>{s.name}</option>)}
            </select>
          </Field>
          <p className="text-[11px] text-[var(--muted)]">
            Custom strategies run the same server-side execution path and settle against the shared price stream.
          </p>
          <Button
            className="w-full"
            disabled={!customName.trim() || !cfg}
            onClick={() => { save({ activeStrategies: [...(cfg?.activeStrategies ?? []), customName.trim()] }); setCustomName(''); setCustomOpen(false); }}
          >
            Save strategy
          </Button>
        </div>
      </Modal>

      <Modal open={Boolean(aiFor)} onClose={() => setAiFor(null)} title={`AI analysis · ${aiFor ?? ''}`} width={440}>
        {signals && (
          <div className="space-y-2 text-sm">
            <p className="text-[var(--muted)]">Current read for {signals.symbol}:</p>
            <div className="grid grid-cols-2 gap-2">
              <MiniStat k="BIAS" v={signals.signal} />
              <MiniStat k="TREND" v={signals.trend} />
              <MiniStat k="VOLATILITY" v={signals.volatility} />
              <MiniStat k="PRICE" v={signals.price.toFixed(5)} />
            </div>
            <p className="text-[11px] text-[var(--muted)]">The assistant summarises momentum; it does not guarantee outcomes.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ToggleRow({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] py-3 last:border-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[11px] text-[var(--muted)]">{hint}</p>
      </div>
      <button onClick={() => onChange(!value)} className={cn('relative mt-1 h-6 w-11 shrink-0 rounded-full transition', value ? 'bg-[var(--primary)]' : 'bg-[var(--surface-3)]')}>
        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', value ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </div>
  );
}

function Meter({ label, value, tone }: { label: string; value: number; tone: 'positive' | 'negative' }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px] font-semibold tracking-wide text-[var(--muted)]">
        <span>{label}</span><span>{value}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div className={cn('h-full rounded-full transition-all', tone === 'positive' ? 'bg-emerald-500' : 'bg-red-500')} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function MiniStat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/70 p-2.5 text-center">
      <p className="text-[9px] font-semibold tracking-[0.12em] text-[var(--muted)]">{k}</p>
      <p className="mt-0.5 text-sm font-semibold">{v}</p>
    </div>
  );
}

export default function AutoTradePage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-sm text-[var(--muted)]">Loading…</div>}>
      <Inner />
    </Suspense>
  );
}
