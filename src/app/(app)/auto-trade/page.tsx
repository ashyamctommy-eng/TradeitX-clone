'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Play, Square, RotateCcw, Sparkles, FlaskConical, Plus, Activity, Terminal } from 'lucide-react';
import { PageHead } from '@/components/app-shell';
import { Badge, Button, Card, Field, Modal, Tabs } from '@/components/ui';
import { CopyTradeSheet } from '@/components/copy-trade-sheet';
import { useUser } from '@/components/user-context';
import { api, post, put } from '@/lib/api';
import { dt, usd } from '@/lib/format';
import { getSocket } from '@/lib/socket';
import { cn } from '@/lib/cn';

type Strategy = {
  id: string; name: string; description: string; winRate: number;
  targetYield: number; riskLevel: number; isCustom: boolean;
  config: { symbol?: string; frequency?: number; duration?: number };
};
type Config = {
  isRunning: boolean; activeStrategies: string[]; frequencySeconds: number;
  fixedAmount: number; riskLevel: number; reinvestProfits: boolean; useMarketAnalysis: boolean;
};
type Signal = {
  symbol: string; buyStrength: number; sellStrength: number; volatility: string;
  trend: string; signal: string; changePct: number; price: number;
};
type TelemetryLog = { ts: number; level: 'info' | 'trade' | 'win' | 'loss' | 'warn'; msg: string };
type Telemetry = {
  ts: number; running: boolean;
  strategy: { id: string; name: string; winRate: number; targetYield: number; riskLevel: number } | null;
  symbol: string; signal: Signal;
  stats: { winRate: number; pnl: number; settled: number; botTrades: number; frequency: number; stake: number };
  logs: TelemetryLog[];
};
type Trade = {
  id: string; symbol: string; direction: string; stake: number; pnl: number | null;
  status: string; triggeredBy: string; strategy: string | null; createdAt: string; accountType: string;
};

function Inner() {
  const params = useSearchParams();
  const { account, refresh } = useUser();
  const [tab, setTab] = useState<'strategies' | 'config' | 'signals'>('strategies');
  const [cfg, setCfg] = useState<Config | null>(null);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [signals, setSignals] = useState<Signal | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [copyOpen, setCopyOpen] = useState(false);
  const [test, setTest] = useState<{ strategy: string; trades: number; winRate: number; pnl: number } | null>(null);
  const [aiFor, setAiFor] = useState<Strategy | null>(null);
  const [busy, setBusy] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState({ name: '', description: '', baseId: '', riskLevel: 3 });
  const [customError, setCustomError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [c, s, t, st] = await Promise.all([
      api<Config>('/auto-trade/config'),
      api<Signal>('/auto-trade/signals'),
      api<Trade[]>(`/trades?account=${account}`),
      api<Strategy[]>('/ai-strategies'),
    ]);
    setCfg(c); setSignals(s); setTrades(t); setStrategies(st);
  }, [account]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  useEffect(() => {
    if (params.get('copy') === '1') setCopyOpen(true);
  }, [params]);

  /* live telemetry stream */
  useEffect(() => {
    const s = getSocket();
    s.emit('ai:subscribe');
    const onTelemetry = (t: Telemetry) => {
      setTelemetry(t);
      setSignals(t.signal);
      setCfg((prev) => (prev ? { ...prev, isRunning: t.running } : prev));
    };
    s.on('ai:telemetry', onTelemetry);
    return () => { s.off('ai:telemetry', onTelemetry); s.emit('ai:unsubscribe'); };
  }, []);

  useEffect(() => {
    if (tab === 'signals') logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [telemetry?.logs.length, tab]);

  const save = async (patch: Partial<Config>) => {
    if (!cfg) return;
    setCfg({ ...cfg, ...patch });
    await put('/auto-trade/config', patch).catch(() => {});
  };

  const toggleStrategy = (id: string) => {
    if (!cfg) return;
    const next = cfg.activeStrategies.includes(id)
      ? cfg.activeStrategies.filter((s) => s !== id)
      : [...cfg.activeStrategies, id];
    save({ activeStrategies: next });
  };

  const runTest = async (name: string) => {
    setBusy(true);
    try { setTest(await post('/auto-trade/test', { strategy: name })); } finally { setBusy(false); }
  };

  const createCustom = async () => {
    setCustomError(null); setBusy(true);
    try {
      const created = await post<Strategy>('/ai-strategies/custom', {
        name: custom.name.trim(),
        description: custom.description || undefined,
        riskLevel: custom.riskLevel,
        baseStrategyId: custom.baseId || undefined,
      });
      setStrategies((prev) => [...prev, created]);
      setCfg((prev) => (prev ? { ...prev, activeStrategies: [...prev.activeStrategies, created.id] } : prev));
      setCustomOpen(false);
      setCustom({ name: '', description: '', baseId: '', riskLevel: 3 });
    } catch (e) {
      const code = (e as Error).message;
      setCustomError(code === 'NAME_TAKEN' ? 'A strategy with that name already exists.' : code);
    } finally { setBusy(false); }
  };

  const stats = useMemo(() => {
    const settled = trades.filter((t) => t.status !== 'OPEN');
    const wins = settled.filter((t) => t.status === 'WON').length;
    return {
      winRate: settled.length ? ((wins / settled.length) * 100).toFixed(1) : '0.0',
      pnl: settled.reduce((s, t) => s + (t.pnl ?? 0), 0),
      count: settled.length,
      auto: trades.filter((t) => t.triggeredBy === 'AUTO_BOT').length,
    };
  }, [trades]);

  const running = telemetry?.running ?? cfg?.isRunning ?? false;
  const activeCount = cfg?.activeStrategies.length ?? 0;
  const shownSignal = telemetry?.signal ?? signals;
  const liveStats = telemetry?.stats;

  return (
    <div className="mx-auto max-w-5xl px-4 py-5">
      <PageHead title="Auto Trading" subtitle="Configure strategies and let the bot run" right={
        <Button variant="outline" size="sm" onClick={() => setCopyOpen(true)}>Copy Trading</Button>
      } />

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
              <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                {telemetry?.strategy?.name ?? 'no strategy'} · {shownSignal ? shownSignal.price.toFixed(5) : '—'}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {telemetry && (
            <Badge tone={running ? 'positive' : 'neutral'} className="gap-1">
              <span className={cn('h-1.5 w-1.5 rounded-full', running ? 'bg-emerald-500 live-dot' : 'bg-[var(--muted-2)]')} />
              telemetry
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={load}><RotateCcw size={13} /> Reset</Button>
        </div>
      </Card>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'strategies', label: 'Strategies', badge: `${activeCount}/${strategies.length}` },
          { id: 'config', label: 'Config' },
          { id: 'signals', label: 'Signals' },
        ]}
      />

      {tab === 'strategies' && cfg && (
        <div className="mt-4 space-y-2">
          {strategies.map((s) => {
            const on = cfg.activeStrategies.includes(s.id);
            return (
              <Card key={s.id} className={cn('flex flex-wrap items-center gap-3 p-3.5', on && 'border-[var(--primary)]/50 bg-[var(--primary)]/[0.04]')}>
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--surface-2)] text-base">
                  {s.isCustom ? '🧩' : '🤖'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-sm font-medium">{s.name}</p>
                    {s.isCustom && <Badge className="h-5 px-1.5 text-[10px]">custom</Badge>}
                    <Badge tone="positive" className="h-5 px-1.5 text-[10px]">win {s.winRate}%</Badge>
                    <Badge tone="primary" className="h-5 px-1.5 text-[10px]">target +{s.targetYield}%</Badge>
                    <Badge className="h-5 px-1.5 text-[10px]">risk {s.riskLevel}/5</Badge>
                  </div>
                  <p className="truncate text-[11px] text-[var(--muted)]">{s.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setAiFor(s)}><Sparkles size={12} /> AI</Button>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => runTest(s.name)}><FlaskConical size={12} /> Test</Button>
                  <button
                    onClick={() => toggleStrategy(s.id)}
                    className={cn('relative h-6 w-11 rounded-full transition', on ? 'bg-[var(--primary)]' : 'bg-[var(--surface-3)]')}
                    aria-label={`Toggle ${s.name}`}
                  >
                    <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', on ? 'left-[22px]' : 'left-0.5')} />
                  </button>
                </div>
              </Card>
            );
          })}
          <button onClick={() => setCustomOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] py-3 text-xs font-medium text-[var(--muted)] hover:text-[var(--text)]">
            <Plus size={14} /> Create Custom
          </button>
          <p className="pt-1 text-right text-[11px] text-[var(--muted)]">Active: {activeCount}/{strategies.length}</p>
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
              The bot places {usd(cfg.fixedAmount)} trades on the active strategy&apos;s instrument every {cfg.frequencySeconds}s.
              Settlements use the shared server price stream — no per-user odds.
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

      {tab === 'signals' && shownSignal && (
        <div className="mt-4 space-y-3">
          <Card className="p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Activity size={14} /> Live signal · {shownSignal.symbol}
              </h3>
              <div className="flex items-center gap-2">
                {telemetry?.strategy && <Badge tone="primary">{telemetry.strategy.name}</Badge>}
                <Badge tone={telemetry ? 'positive' : 'neutral'}>
                  <span className={cn('mr-1 h-1.5 w-1.5 rounded-full', telemetry ? 'bg-emerald-500 live-dot' : 'bg-[var(--muted-2)]')} />
                  {telemetry ? 'streaming' : 'polling'}
                </Badge>
              </div>
            </div>

            <div className="flex items-center justify-around gap-2 py-2">
              <RadialGauge label="BUY SIGNAL" value={shownSignal.buyStrength} tone="buy" />
              <RadialGauge label="SELL SIGNAL" value={shownSignal.sellStrength} tone="sell" />
            </div>

            <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniStat k="VOLATILITY" v={shownSignal.volatility} />
              <MiniStat k="TREND" v={shownSignal.trend} />
              <MiniStat k="SIGNAL" v={shownSignal.signal} />
              <MiniStat k="CHANGE" v={`${shownSignal.changePct}%`} />
            </div>
          </Card>

          <div className="grid gap-3 md:grid-cols-2">
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold">Performance</h3>
              <div className="grid grid-cols-2 gap-2">
                <MiniStat k="WIN RATE" v={`${liveStats?.winRate ?? stats.winRate}%`} />
                <MiniStat k="P/L" v={`${(liveStats?.pnl ?? stats.pnl) >= 0 ? '+' : ''}${usd(liveStats?.pnl ?? stats.pnl)}`} />
                <MiniStat k="SETTLED" v={String(liveStats?.settled ?? stats.count)} />
                <MiniStat k="BOT TRADES" v={String(liveStats?.botTrades ?? stats.auto)} />
              </div>
              <p className="mt-3 text-[11px] text-[var(--muted)]">
                {telemetry?.strategy
                  ? `${telemetry.strategy.name} · advertised win ${telemetry.strategy.winRate}% · target +${telemetry.strategy.targetYield}% · risk ${telemetry.strategy.riskLevel}/5`
                  : 'Signals are derived from the same price series used for settlement.'}
              </p>
            </Card>

            <Card className="flex flex-col overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                  <Terminal size={13} /> AI TELEMETRY
                  <span className={cn('ml-1 h-1.5 w-1.5 rounded-full', running ? 'bg-emerald-500 live-dot' : 'bg-[var(--muted-2)]')} />
                </span>
                <span className="text-[10px] text-[var(--muted)]">
                  {telemetry ? new Date(telemetry.ts).toLocaleTimeString() : 'waiting for stream…'}
                </span>
              </div>
              <div ref={logRef} className="h-[168px] overflow-y-auto bg-[#0b0b0d] p-3 font-mono text-[10.5px] leading-relaxed">
                {(telemetry?.logs ?? []).length === 0 && (
                  <p className="text-white/35">{running ? 'Waiting for the next execution…' : 'Bot stopped. Start it to stream execution logs.'}</p>
                )}
                {(telemetry?.logs ?? []).map((l, i) => (
                  <div key={`${l.ts}-${i}`} className="flex gap-2">
                    <span className="shrink-0 text-white/25">{new Date(l.ts).toLocaleTimeString('en-GB')}</span>
                    <span className={cn(
                      l.level === 'win' && 'text-emerald-400',
                      l.level === 'loss' && 'text-red-400',
                      l.level === 'trade' && 'text-[#FFCC00]',
                      l.level === 'warn' && 'text-amber-400',
                      l.level === 'info' && 'text-white/60',
                    )}>
                      {l.msg}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
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

      <Modal open={Boolean(aiFor)} onClose={() => setAiFor(null)} title={`AI analysis · ${aiFor?.name ?? ''}`} width={460}>
        {aiFor && (
          <div className="space-y-3 text-sm">
            <p className="text-[var(--muted)]">{aiFor.description}</p>
            <div className="grid grid-cols-2 gap-2">
              <MiniStat k="WIN RATE" v={`${aiFor.winRate}%`} />
              <MiniStat k="TARGET YIELD" v={`+${aiFor.targetYield}%`} />
              <MiniStat k="RISK" v={`${aiFor.riskLevel}/5`} />
              <MiniStat k="INSTRUMENT" v={aiFor.config.symbol ?? 'EUR/USD'} />
            </div>
            <p className="text-[11px] text-[var(--muted)]">Illustrative model metrics, not a guarantee of future results.</p>
          </div>
        )}
      </Modal>

      <Modal open={customOpen} onClose={() => setCustomOpen(false)} title="Create custom strategy" width={460}>
        <div className="space-y-3">
          <Field label="Strategy name">
            <input className="input" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} placeholder="London Open Momentum" />
          </Field>
          <Field label="Description">
            <input className="input" value={custom.description} onChange={(e) => setCustom({ ...custom, description: e.target.value })} placeholder="Optional" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Base model">
              <select className="input" value={custom.baseId} onChange={(e) => setCustom({ ...custom, baseId: e.target.value })}>
                <option value="">Blank</option>
                {strategies.filter((s) => !s.isCustom).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label={`Risk ${custom.riskLevel}/5`}>
              <input type="range" min={1} max={5} value={custom.riskLevel}
                onChange={(e) => setCustom({ ...custom, riskLevel: Number(e.target.value) })}
                className="w-full accent-[var(--primary)]" />
            </Field>
          </div>
          {customError && <p className="text-xs text-red-500">{customError}</p>}
          <Button className="w-full" disabled={busy || custom.name.trim().length < 3} onClick={createCustom}>Save strategy</Button>
          <p className="text-[11px] text-[var(--muted)]">Custom strategies are stored in the database and run the same server-side execution path.</p>
        </div>
      </Modal>
    </div>
  );
}

function RadialGauge({ label, value, tone }: { label: string; value: number; tone: 'buy' | 'sell' }) {
  const pct = Math.max(0, Math.min(100, value));
  const R = 54;
  const C = Math.PI * R;
  const color = tone === 'buy' ? '#22c55e' : '#ef4444';
  const soft = tone === 'buy' ? 'rgba(34,197,94,.16)' : 'rgba(239,68,68,.16)';

  return (
    <div className="flex flex-col items-center">
      <svg width="168" height="104" viewBox="0 0 168 104" role="img" aria-label={`${label} ${pct}%`}>
        <path d="M 26 88 A 58 58 0 0 1 142 88" fill="none" stroke="var(--surface-3)" strokeWidth="11" strokeLinecap="round" />
        <path
          d="M 26 88 A 58 58 0 0 1 142 88"
          fill="none" stroke={soft} strokeWidth="11" strokeLinecap="round"
          strokeDasharray={`${(C * pct) / 100} ${C}`}
        />
        <path
          d="M 26 88 A 58 58 0 0 1 142 88"
          fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${(C * pct) / 100} ${C}`}
        />
        <text x="84" y="76" textAnchor="middle" fontSize="26" fontWeight="700" fill="var(--text)">{Math.round(pct)}%</text>
        <text x="84" y="94" textAnchor="middle" fontSize="9" fontWeight="600" fill="var(--muted)" letterSpacing="1.4">{label}</text>
      </svg>
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
