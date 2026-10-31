'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Minus, Plus, ChevronLeft, ChevronRight, ChevronDown, CandlestickChart, AreaChart,
  PenLine, Minus as LineIcon, MoveUpRight, GitBranch, SlidersHorizontal, Trash2, Sparkles, Bot, Users,
} from 'lucide-react';
import { TradingChart, type Tool } from '@/components/chart';
import { CopyTradeSheet } from '@/components/copy-trade-sheet';
import { Badge, Button, Modal } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { api, post } from '@/lib/api';
import { usd } from '@/lib/format';
import { cn } from '@/lib/cn';

type Instrument = { symbol: string; label: string; mode: string; payoutRate: number; minStake: number; maxStake: number; digits: number; price: number };

const FLAGS: Record<string, string> = {
  'EUR/USD': '🇪🇺🇺🇸', 'GBP/USD': '🇬🇧🇺🇸', 'BTC/USD': '₿', 'ETH/USD': 'Ξ', 'XAU/USD': '🥇', 'USD/KES': '🇺🇸🇰🇪',
};
const DURATIONS = [5, 15, 30, 60, 300];
const DUR_LABEL: Record<number, string> = { 5: '5s', 15: '15s', 30: '30s', 60: '1m', 300: '5m' };

const INDICATORS = {
  TREND: ['EMA 20', 'SMA 50', 'SMA 200', 'Bollinger Bands', 'Ichimoku Cloud', 'Parabolic SAR', 'VWAP', 'SuperTrend', 'Donchian Channels'],
  OSCILLATORS: ['RSI 14', 'MACD', 'Stochastic', 'CCI', 'Williams %R', 'Momentum', 'ROC', 'Ultimate Oscillator', 'ATR', 'ADX', 'OBV', 'MFI', 'Aroon'],
};
const TOTAL_INDICATORS = Object.values(INDICATORS).flat().length;

export default function DashboardPage() {
  const { account, balance, refresh } = useUser();
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [symbol, setSymbol] = useState('EUR/USD');
  const [kind, setKind] = useState<'area' | 'candles'>('area');
  const [tf, setTf] = useState('1m');
  const [tool, setTool] = useState<Tool>('none');
  const [indicators, setIndicators] = useState<string[]>([]);
  const [clearSignal, setClearSignal] = useState(0);
  const [price, setPrice] = useState<number | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [indOpen, setIndOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [symOpen, setSymOpen] = useState(false);
  const [stake, setStake] = useState(10);
  const [duration, setDuration] = useState(5);
  const [busy, setBusy] = useState<'BUY' | 'SELL' | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api<Instrument[]>('/instruments').then(setInstruments);
  }, []);

  const active = instruments.find((i) => i.symbol === symbol);
  const payout = active?.payoutRate ?? 0.82;
  const digits = active?.digits ?? 5;

  const notify = useCallback((ok: boolean, msg: string) => {
    setToast({ ok, msg });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const place = async (direction: 'BUY' | 'SELL') => {
    setBusy(direction);
    try {
      await post('/trades', { symbol, direction, stake, durationSeconds: duration, accountType: account });
      notify(true, `${direction} ${symbol} · ${usd(stake)} · ${DUR_LABEL[duration]}`);
      await refresh();
    } catch (e) {
      const code = (e as Error).message;
      notify(false, code === 'INSUFFICIENT_FUNDS' ? 'Insufficient balance for this stake.' : code);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-[calc(100vh-105px)] flex-col">
      {/* instrument bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setSymOpen((v) => !v)}
              className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-sm font-semibold"
            >
              <span className="text-base leading-none">{FLAGS[symbol] ?? '📈'}</span>
              <span>{symbol}</span>
              <span className="hidden text-[10px] font-medium text-[var(--muted)] sm:inline">· {active?.mode ?? 'OTC'} · LIVE</span>
              <ChevronDown size={14} className="text-[var(--muted)]" />
            </button>
            {symOpen && (
              <div className="absolute left-0 top-11 z-50 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-xl">
                {instruments.map((i) => (
                  <button
                    key={i.symbol}
                    onClick={() => { setSymbol(i.symbol); setSymOpen(false); setPrice(null); }}
                    className={cn('flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm hover:bg-[var(--surface-2)]', i.symbol === symbol && 'bg-[var(--surface-2)] font-semibold')}
                  >
                    <span className="flex items-center gap-2"><span>{FLAGS[i.symbol] ?? '📈'}</span>{i.symbol}</span>
                    <span className="text-[11px] text-[var(--muted)]">{i.mode} · {(i.payoutRate * 100).toFixed(0)}%</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setAiOpen(true)} className="chip border-[#0ea5e9]/30 bg-[#0ea5e9]/10 text-[#0284c7] dark:text-[#7dd3fc]">
            <Sparkles size={12} /> AI
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => setCopyOpen(true)} className="btn btn-outline h-8 gap-1.5 px-3 text-xs">
            <Users size={13} /> Copy Trade <span className="text-[var(--muted)]">+</span>
          </button>
          <Link href="/auto-trade" className="btn btn-outline h-8 gap-1.5 px-3 text-xs">
            <Bot size={13} /> Auto Trade <span className="text-[var(--muted)]">+</span>
          </Link>
        </div>
      </div>

      {/* chart */}
      <div className="relative min-h-[280px] flex-1 overflow-y-auto border-b border-[var(--border)] bg-[var(--surface)]">
        <TradingChart
          symbol={symbol} digits={digits} kind={kind} tf={tf} tool={tool}
          indicators={indicators} clearSignal={clearSignal} onPrice={setPrice}
          payout={payout}
        />

        <div className="absolute right-14 top-2 z-20 flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)]/95 p-1 shadow-sm backdrop-blur">
          <ToolBtn active={kind === 'candles'} onClick={() => setKind('candles')} title="Candlesticks"><CandlestickChart size={15} /></ToolBtn>
          <ToolBtn active={kind === 'area'} onClick={() => setKind('area')} title="Area"><AreaChart size={15} /></ToolBtn>
          <span className="mx-0.5 h-4 w-px bg-[var(--border)]" />
          <ToolBtn active={tool === 'trend'} onClick={() => setTool(tool === 'trend' ? 'none' : 'trend')} title="Trendline"><PenLine size={15} /></ToolBtn>
          <ToolBtn active={tool === 'horizontal'} onClick={() => setTool(tool === 'horizontal' ? 'none' : 'horizontal')} title="Horizontal line"><LineIcon size={15} /></ToolBtn>
          <ToolBtn active={tool === 'ray'} onClick={() => setTool(tool === 'ray' ? 'none' : 'ray')} title="Ray"><MoveUpRight size={15} /></ToolBtn>
          <ToolBtn active={tool === 'fib'} onClick={() => setTool(tool === 'fib' ? 'none' : 'fib')} title="Fib retracement"><GitBranch size={15} /></ToolBtn>
          <ToolBtn onClick={() => setClearSignal((v) => v + 1)} title="Clear drawings"><Trash2 size={15} /></ToolBtn>
          <span className="mx-0.5 h-4 w-px bg-[var(--border)]" />
          <button onClick={() => setIndOpen(true)} className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
            <SlidersHorizontal size={14} /> Indicators
          </button>
          <select
            value={tf}
            onChange={(e) => setTf(e.target.value)}
            className="h-7 rounded-md border border-[var(--border)] bg-transparent px-1.5 text-[11px] text-[var(--muted)] outline-none"
          >
            {['5s', '1m', '5m'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {toast && (
          <div className={cn(
            'absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-lg border px-3 py-2 text-xs font-medium shadow-lg',
            toast.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
          )}>
            {toast.msg}
          </div>
        )}
      </div>

      {/* order ticket */}
      <div className="grid grid-cols-1 gap-3 border-t border-[var(--border)] bg-[var(--surface)] p-3 md:grid-cols-2">
        <Stepper
          label="investment" value={`${stake}`} prefix="$"
          onDec={() => setStake((s) => Math.max(active?.minStake ?? 1, s - 1))}
          onInc={() => setStake((s) => Math.min(active?.maxStake ?? 1000, s + 1))}
          editable
          onValue={(v) => setStake(Math.max(active?.minStake ?? 1, Math.min(active?.maxStake ?? 1000, Number(v) || 0)))}
        />
        <Stepper
          label="duration" value={DUR_LABEL[duration]}
          onDec={() => setDuration((d) => DURATIONS[Math.max(0, DURATIONS.indexOf(d) - 1)])}
          onInc={() => setDuration((d) => DURATIONS[Math.min(DURATIONS.length - 1, DURATIONS.indexOf(d) + 1)])}
        />
        <button
          onClick={() => place('SELL')}
          disabled={busy !== null}
          className="flex h-[58.5px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-red-500 to-red-600 text-base font-semibold text-white shadow-lg shadow-red-500/20 transition hover:brightness-105 disabled:opacity-60"
        >
          <span className="text-xs">▼</span> SELL <span className="text-sm opacity-90">{(payout * 100).toFixed(0)}%</span>
        </button>
        <button
          onClick={() => place('BUY')}
          disabled={busy !== null}
          className="flex h-[58.5px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-emerald-500 to-emerald-600 text-base font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:brightness-105 disabled:opacity-60"
        >
          <span className="text-xs">▲</span> BUY <span className="text-sm opacity-90">{(payout * 100).toFixed(0)}%</span>
        </button>
      </div>

      {/* footer clocks */}
      <div className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[10px] text-[var(--muted)]">
        <ClientClock />
        <span className="hidden sm:inline">Simulated market data · {account} account · {usd(balance)} available</span>
        <UtcClock />
      </div>

      <CopyTradeSheet open={copyOpen} onClose={() => setCopyOpen(false)} />
      <IndicatorsModal
        open={indOpen} onClose={() => setIndOpen(false)}
        selected={indicators} onChange={setIndicators}
      />
      <AiModal open={aiOpen} onClose={() => setAiOpen(false)} symbol={symbol} />
    </div>
  );
}

function ToolBtn({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        'grid h-7 w-7 place-items-center rounded-md transition',
        active ? 'bg-[var(--primary)] text-black' : 'text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
      )}
    >
      {children}
    </button>
  );
}

function Stepper({
  label, value, prefix, onDec, onInc, editable, onValue,
}: {
  label: string; value: string; prefix?: string;
  onDec: () => void; onInc: () => void;
  editable?: boolean; onValue?: (v: string) => void;
}) {
  return (
    <div className="flex h-[58.5px] flex-col justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/60 px-3">
      <div className="flex items-center justify-between">
        <button onClick={onDec} className="grid h-6 w-6 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-3)]">
          <Minus size={13} />
        </button>
        <div className="text-center">
          <div className="text-base font-bold leading-tight">
            {prefix}{editable ? (
              <input
                value={value}
                onChange={(e) => onValue?.(e.target.value)}
                className="w-14 bg-transparent text-center outline-none"
                inputMode="decimal"
              />
            ) : value}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
        </div>
        <button onClick={onInc} className="grid h-6 w-6 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-3)]">
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}

function IndicatorsModal({
  open, onClose, selected, onChange,
}: { open: boolean; onClose: () => void; selected: string[]; onChange: (v: string[]) => void }) {
  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name]);
  };
  return (
    <Modal open={open} onClose={onClose} title={`Indicators · ${TOTAL_INDICATORS} available`} width={560}>
      <div className="space-y-4">
        {Object.entries(INDICATORS).map(([group, items]) => (
          <div key={group}>
            <p className="label mb-2">{group}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {items.map((name) => {
                const active = selected.includes(name);
                return (
                  <button
                    key={name}
                    onClick={() => toggle(name)}
                    className={cn(
                      'flex items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs transition',
                      active ? 'border-[var(--primary)] bg-[var(--primary)]/10 font-semibold' : 'border-[var(--border)] hover:bg-[var(--surface-2)]',
                    )}
                  >
                    <span>{name}</span>
                    {active ? <span className="text-[#8a6d00] dark:text-[#ffcc00]">●</span> : <span className="text-[10px] text-[var(--muted-2)]">add</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <p className="text-[11px] text-[var(--muted)]">
          {selected.length} selected · trend overlays draw on the main chart, oscillators open as stacked
          sub-panes below it. All 22 are computed from the live candle series.
        </p>
      </div>
    </Modal>
  );
}

function AiModal({ open, onClose, symbol }: { open: boolean; onClose: () => void; symbol: string }) {
  const [data, setData] = useState<{ signal: string; trend: string; volatility: string; buyStrength: number; sellStrength: number; changePct: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    api<typeof data>('/auto-trade/signals').then(setData).catch(() => {});
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="AI market read" width={460}>
      {!data ? <p className="text-sm text-[var(--muted)]">Analysing…</p> : (
        <div className="space-y-3 text-sm">
          <p className="text-[var(--muted)]">Momentum read for <span className="font-semibold text-[var(--text)]">{symbol}</span> over the last two minutes.</p>
          <div className="grid grid-cols-3 gap-2">
            {[['Signal', data.signal], ['Trend', data.trend], ['Volatility', data.volatility]].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2 text-center">
                <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{k}</p>
                <p className="font-semibold">{v}</p>
              </div>
            ))}
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs text-[var(--muted)]"><span>BUY strength</span><span>{data.buyStrength}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${data.buyStrength}%` }} />
            </div>
            <div className="mb-1 mt-2 flex justify-between text-xs text-[var(--muted)]"><span>SELL strength</span><span>{data.sellStrength}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
              <div className="h-full rounded-full bg-red-500" style={{ width: `${data.sellStrength}%` }} />
            </div>
          </div>
          <p className="text-[11px] text-[var(--muted)]">
            Derived from the platform price series (change {data.changePct}%). This is not investment advice.
          </p>
        </div>
      )}
    </Modal>
  );
}

function ClientClock() {
  const [t, setT] = useState('');
  useEffect(() => {
    const iv = setInterval(() => setT(new Date().toLocaleTimeString('en-GB')), 1000);
    setT(new Date().toLocaleTimeString('en-GB'));
    return () => clearInterval(iv);
  }, []);
  return <span>{t} local</span>;
}

function UtcClock() {
  const [t, setT] = useState('');
  useEffect(() => {
    const iv = setInterval(() => setT(new Date().toISOString().slice(11, 19)), 1000);
    setT(new Date().toISOString().slice(11, 19));
    return () => clearInterval(iv);
  }, []);
  return <span>{t} UTC</span>;
}
