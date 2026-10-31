'use client';
import { useEffect, useRef, useState } from 'react';
import {
  createChart, ColorType, CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type UTCTimestamp,
} from 'lightweight-charts';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';

type Candle = { time: number; open: number; high: number; low: number; close: number };
export type Tool = 'none' | 'trend' | 'horizontal' | 'ray' | 'fib';

type Drawing = { type: Exclude<Tool, 'none'>; p1: { time: number; price: number }; p2?: { time: number; price: number } };

const TF_SECONDS: Record<string, number> = { '5s': 5, '1m': 60, '5m': 300 };

export function TradingChart({
  symbol, digits, kind, tf, tool, indicators, clearSignal, onPrice,
}: {
  symbol: string;
  digits: number;
  kind: 'area' | 'candles';
  tf: string;
  tool: Tool;
  indicators: string[];
  clearSignal: number;
  onPrice?: (p: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | ISeriesApi<'Candlestick'> | null>(null);
  const dataRef = useRef<Candle[]>([]);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const pendingRef = useRef<{ time: number; price: number } | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const onPriceRef = useRef(onPrice);
  onPriceRef.current = onPrice;

  /* clear drawings on demand */
  useEffect(() => {
    if (clearSignal > 0) { setDrawings([]); pendingRef.current = null; }
  }, [clearSignal]);

  /* build chart */
  useEffect(() => {
    let disposed = false;
    const el = wrapRef.current;
    if (!el) return;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b8b93',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 11,
        attributionLogo: false,
      } as never,
      grid: {
        vertLines: { color: 'rgba(120,120,130,0.10)' },
        horzLines: { color: 'rgba(120,120,130,0.10)' },
      },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { labelBackgroundColor: '#111113' }, horzLine: { labelBackgroundColor: '#111113' } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.12 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: tf === '5s', rightOffset: 4 },
      localization: { priceFormatter: (p: number) => p.toFixed(digits) },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true },
    });
    chartRef.current = chart;

    let series: ISeriesApi<'Area'> | ISeriesApi<'Candlestick'>;
    if (kind === 'area') {
      series = chart.addAreaSeries({
        lineColor: '#3B82F6', lineWidth: 2,
        topColor: 'rgba(59,130,246,0.28)', bottomColor: 'rgba(59,130,246,0.02)',
        priceLineColor: 'rgba(59,130,246,0.5)', priceLineStyle: LineStyle.Dotted,
      });
    } else {
      series = chart.addCandlestickSeries({
        upColor: '#16A34A', downColor: '#DC2626',
        wickUpColor: '#16A34A', wickDownColor: '#DC2626',
        borderVisible: false,
      });
    }
    seriesRef.current = series;

    const load = async () => {
      try {
        const res = await api<{ candles: Candle[] }>(
          `/prices/${encodeURIComponent(symbol)}/history?tf=${tf}`,
        );
        if (disposed) return;
        const candles = res.candles;
        dataRef.current = candles;
        if (kind === 'area') {
          (series as ISeriesApi<'Area'>).setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
        } else {
          (series as ISeriesApi<'Candlestick'>).setData(candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
        }
        chart.timeScale().fitContent();
        const price = candles[candles.length - 1]?.close ?? 0;
        setLast(price);
        onPriceRef.current?.(price);
      } catch { /* ignore */ }
    };
    load();

    /* live ticks */
    const socket = getSocket();
    socket.emit('market:subscribe', symbol);
    const bucket = TF_SECONDS[tf] ?? 60;
    const onTick = (tick: { symbol: string; price: number }) => {
      if (tick.symbol !== symbol) return;
      const arr = dataRef.current;
      if (!arr.length) return;
      const now = Math.floor(Date.now() / 1000);
      const b = Math.floor(now / bucket) * bucket;
      const cur = arr[arr.length - 1];
      if (b === cur.time) {
        cur.close = tick.price;
        cur.high = Math.max(cur.high, tick.price);
        cur.low = Math.min(cur.low, tick.price);
      } else {
        arr.push({ time: b, open: cur.close, high: Math.max(cur.close, tick.price), low: Math.min(cur.close, tick.price), close: tick.price });
        if (arr.length > 600) arr.shift();
      }
      if (kind === 'area') {
        (series as ISeriesApi<'Area'>).update({ time: cur.time as UTCTimestamp, value: cur.close });
      } else {
        (series as ISeriesApi<'Candlestick'>).update({ ...cur, time: cur.time as UTCTimestamp });
      }
      setLast(tick.price);
      onPriceRef.current?.(tick.price);
    };
    socket.on('market:tick', onTick);

    /* click-to-draw */
    const onClick = (param: { time?: unknown; point?: { x: number; y: number } }) => {
      if (tool === 'none' || !param.time || !param.point) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price === null) return;
      const p = { time: param.time as number, price: Number(price) };
      if (tool === 'horizontal') {
        setDrawings((d) => [...d, { type: 'horizontal', p1: p }]);
        return;
      }
      if (!pendingRef.current) { pendingRef.current = p; return; }
      setDrawings((d) => [...d, { type: tool, p1: pendingRef.current!, p2: p }]);
      pendingRef.current = null;
    };
    chart.subscribeClick(onClick as never);

    return () => {
      disposed = true;
      socket.off('market:tick', onTick);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [symbol, tf, kind, digits, tool]);

  /* indicators */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const added: ISeriesApi<'Line'>[] = [];
    const data = dataRef.current;
    if (!data.length) return;

    const addLine = (values: { time: number; value: number }[], color: string, width: 1 | 2 = 1) => {
      const s = chart.addLineSeries({
        color, lineWidth: width, priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData(values.map((v) => ({ time: v.time as UTCTimestamp, value: v.value })));
      added.push(s);
    };

    if (indicators.includes('EMA 20')) {
      const ema = computeEMA(data.map((d) => d.close), 20);
      addLine(data.map((d, i) => ({ time: d.time, value: ema[i] })).filter((v) => Number.isFinite(v.value)), '#f59e0b');
    }
    if (indicators.includes('SMA 50')) {
      const sma = computeSMA(data.map((d) => d.close), 50);
      addLine(data.map((d, i) => ({ time: d.time, value: sma[i] })).filter((v) => Number.isFinite(v.value)), '#a855f7');
    }
    if (indicators.includes('Bollinger Bands')) {
      const { upper, lower } = computeBollinger(data.map((d) => d.close), 20, 2);
      addLine(data.map((d, i) => ({ time: d.time, value: upper[i] })).filter((v) => Number.isFinite(v.value)), 'rgba(148,163,184,0.8)');
      addLine(data.map((d, i) => ({ time: d.time, value: lower[i] })).filter((v) => Number.isFinite(v.value)), 'rgba(148,163,184,0.8)');
    }

    return () => { for (const s of added) chart.removeSeries(s); };
  }, [indicators, symbol, tf, kind]);

  /* drawing overlay */
  useEffect(() => {
    const chart = chartRef.current;
    const canvas = canvasRef.current;
    const series = seriesRef.current;
    if (!chart || !canvas || !series) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.font = '10px Inter, sans-serif';

      const xOf = (t: number) => chart.timeScale().timeToCoordinate(t as UTCTimestamp);
      const yOf = (p: number) => series.priceToCoordinate(p);

      for (const d of drawings) {
        const x1 = xOf(d.p1.time); const y1 = yOf(d.p1.price);
        if (x1 === null || y1 === null) continue;
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.4;
        ctx.beginPath();

        if (d.type === 'horizontal') {
          ctx.moveTo(0, y1); ctx.lineTo(rect.width, y1);
          ctx.stroke();
          ctx.fillStyle = '#f59e0b';
          ctx.fillText(d.p1.price.toFixed(digits), 6, y1 - 4);
          continue;
        }
        if (!d.p2) continue;
        const x2 = xOf(d.p2.time); const y2 = yOf(d.p2.price);
        if (x2 === null || y2 === null) continue;

        if (d.type === 'trend') {
          ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        } else if (d.type === 'ray') {
          const dx = x2 - x1; const dy = y2 - y1;
          const k = dx === 0 ? 0 : (rect.width - x1) / dx;
          ctx.moveTo(x1, y1); ctx.lineTo(x1 + dx * Math.max(1, k), y1 + dy * Math.max(1, k));
          ctx.stroke();
        } else if (d.type === 'fib') {
          const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
          for (const lv of levels) {
            const y = y1 + (y2 - y1) * lv;
            ctx.strokeStyle = 'rgba(245,158,11,0.65)';
            ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
            ctx.fillStyle = '#f59e0b';
            ctx.fillText(`${(lv * 100).toFixed(1)}%`, Math.min(x1, x2) + 4, y - 3);
          }
        }
      }
    };

    draw();
    chart.timeScale().subscribeVisibleLogicalRangeChange(draw);
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(draw);
      ro.disconnect();
    };
  }, [drawings, digits, symbol, tf, kind]);

  return (
    <div className="relative h-full w-full">
      <div ref={wrapRef} className="absolute inset-0" />
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      {last !== null && (
        <div className="absolute left-2 top-2 z-10 rounded-md bg-[#3B82F6] px-2 py-0.5 text-[11px] font-semibold text-white shadow">
          {last.toFixed(digits)}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-2 z-10 text-[10px] text-[var(--muted-2)]">
        {pendingRef.current ? 'Click second point to finish drawing' : 'Drag to explore'}
      </div>
    </div>
  );
}

/* ---------------- social markers ---------------- */
const FEED = [
  { name: 'Darius4700', amount: 75 }, { name: 'Nasir4074', amount: 1500 },
  { name: 'Callen451', amount: 10 }, { name: 'Ivy8043', amount: 2000 },
  { name: 'Sebastian3916', amount: 75 }, { name: 'Callan7770', amount: 100 },
  { name: 'David8563', amount: 50 }, { name: 'Kingston8757', amount: 5000 },
];

let FEED_SEQ = 0;

export function SocialMarkers({ payout }: { payout: number }) {
  const [items, setItems] = useState<{ id: number; name: string; amount: number; dir: 'BUY' | 'SELL'; top: number; left: number }[]>([]);

  useEffect(() => {
    const spawn = () => {
      const t = FEED[Math.floor(Math.random() * FEED.length)];
      setItems((prev) => [
        ...prev.slice(-4),
        {
          id: ++FEED_SEQ, name: t.name, amount: t.amount,
          dir: Math.random() > 0.5 ? 'BUY' : 'SELL',
          top: 18 + Math.random() * 55, left: 30 + Math.random() * 50,
        },
      ]);
    };
    spawn(); spawn();
    const iv = setInterval(spawn, 4200);
    return () => clearInterval(iv);
  }, []);

  return (
    <>
      {items.map((m) => (
        <div
          key={m.id}
          className="pointer-events-none absolute z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)]/95 px-1.5 py-1 text-[10px] font-semibold shadow-md backdrop-blur"
          style={{ top: `${m.top}%`, left: `${m.left}%` }}
        >
          <span className={`grid h-4 w-4 place-items-center rounded-full text-[8px] text-white ${m.dir === 'BUY' ? 'bg-emerald-500' : 'bg-red-500'}`}>
            {m.dir === 'BUY' ? '▲' : '▼'}
          </span>
          <span className="text-[var(--muted)]">${m.amount >= 1000 ? `${m.amount / 1000}K` : m.amount}</span>
          <span className="hidden text-[var(--muted-2)] sm:inline">{m.name}</span>
        </div>
      ))}
    </>
  );
}

/* ---------------- math ---------------- */
function computeSMA(values: number[], period: number) {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : NaN);
  }
  return out;
}

function computeEMA(values: number[], period: number) {
  const out: number[] = [];
  const k = 2 / (period + 1);
  let prev = NaN;
  values.forEach((v, i) => {
    if (i < period - 1) { out.push(NaN); return; }
    if (i === period - 1) {
      prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
      out.push(prev); return;
    }
    prev = v * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}

function computeBollinger(values: number[], period: number, mult: number) {
  const mid = computeSMA(values, period);
  const upper: number[] = [];
  const lower: number[] = [];
  values.forEach((_, i) => {
    if (i < period - 1) { upper.push(NaN); lower.push(NaN); return; }
    const slice = values.slice(i - period + 1, i + 1);
    const mean = mid[i];
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper.push(mean + mult * sd);
    lower.push(mean - mult * sd);
  });
  return { upper, lower, mid };
}
