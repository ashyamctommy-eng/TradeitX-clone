'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart, ColorType, CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type UTCTimestamp,
} from 'lightweight-charts';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import * as ta from '@/lib/indicators';
import type { Candle } from '@/lib/indicators';

export type Tool = 'none' | 'trend' | 'horizontal' | 'ray' | 'fib';

type Drawing = { type: Exclude<Tool, 'none'>; p1: { time: number; price: number }; p2?: { time: number; price: number } };

type LinePoint = { time: number; value: number };
type Marker = { time: number; position: 'aboveBar' | 'belowBar'; color: string; shape: 'circle' | 'arrowUp' | 'arrowDown'; text?: string };

type OverlaySeries =
  | { kind: 'line'; name: string; color: string; width?: 1 | 2; dashed?: boolean; data: LinePoint[] }
  | { kind: 'markers'; name: string; markers: Marker[] };

type PaneSeries = { kind: 'line' | 'hist'; color: string; width?: 1 | 2; data: LinePoint[] };
type PaneDef = { id: string; title: string; series: PaneSeries[]; levels?: { value: number; color: string }[] };

const TF_SECONDS: Record<string, number> = { '5s': 5, '1m': 60, '5m': 300 };

const toPoints = (values: ta.Series, candles: Candle[]): LinePoint[] =>
  values.reduce<LinePoint[]>((acc, v, i) => {
    if (v !== null && Number.isFinite(v)) acc.push({ time: candles[i].time, value: v });
    return acc;
  }, []);

/* ------------------------------------------------------------------ */
/* Overlay + pane builders                                             */
/* ------------------------------------------------------------------ */

function buildOverlays(candles: Candle[], selected: string[]): OverlaySeries[] {
  if (!candles.length) return [];
  const closes = candles.map((c) => c.close);
  const out: OverlaySeries[] = [];
  const has = (n: string) => selected.includes(n);

  if (has('EMA 20')) out.push({ kind: 'line', name: 'EMA 20', color: '#f59e0b', width: 2, data: toPoints(ta.ema(closes, 20), candles) });
  if (has('SMA 50')) out.push({ kind: 'line', name: 'SMA 50', color: '#a855f7', width: 1, data: toPoints(ta.sma(closes, 50), candles) });
  if (has('SMA 200')) out.push({ kind: 'line', name: 'SMA 200', color: '#64748b', width: 1, data: toPoints(ta.sma(closes, 200), candles) });

  if (has('Bollinger Bands')) {
    const bb = ta.bollinger(closes, 20, 2);
    out.push({ kind: 'line', name: 'BB upper', color: 'rgba(148,163,184,0.85)', data: toPoints(bb.upper, candles) });
    out.push({ kind: 'line', name: 'BB mid', color: 'rgba(148,163,184,0.55)', dashed: true, data: toPoints(bb.mid, candles) });
    out.push({ kind: 'line', name: 'BB lower', color: 'rgba(148,163,184,0.85)', data: toPoints(bb.lower, candles) });
  }

  if (has('Parabolic SAR')) {
    const sar = ta.psar(candles);
    const markers: Marker[] = [];
    sar.forEach((s, i) => {
      const flip = i > 0 && sar[i - 1].up !== s.up;
      if (flip || i % 8 === 0) {
        markers.push({
          time: candles[i].time as UTCTimestamp,
          position: s.up ? 'belowBar' : 'aboveBar',
          color: s.up ? '#22c55e' : '#ef4444',
          shape: 'circle',
        });
      }
    });
    out.push({ kind: 'markers', name: 'PSAR', markers });
  }

  if (has('Ichimoku Cloud')) {
    const ich = ta.ichimoku(candles);
    out.push({ kind: 'line', name: 'Tenkan', color: '#38bdf8', data: toPoints(ich.tenkan, candles) });
    out.push({ kind: 'line', name: 'Kijun', color: '#f472b6', data: toPoints(ich.kijun, candles) });
    out.push({ kind: 'line', name: 'Senkou A', color: 'rgba(34,197,94,0.75)', data: toPoints(ich.senkouA, candles) });
    out.push({ kind: 'line', name: 'Senkou B', color: 'rgba(239,68,68,0.75)', data: toPoints(ich.senkouB, candles) });
  }

  if (has('VWAP')) out.push({ kind: 'line', name: 'VWAP', color: '#eab308', width: 2, data: toPoints(ta.vwap(candles), candles) });

  if (has('SuperTrend')) {
    const st = ta.superTrend(candles, 10, 3);
    const last = st[st.length - 1]?.up ?? true;
    out.push({
      kind: 'line', name: 'SuperTrend', color: last ? '#22c55e' : '#ef4444', width: 2,
      data: st.map((s, i) => ({ time: candles[i].time, value: s.value })),
    });
  }

  if (has('Donchian Channels')) {
    const dc = ta.donchian(candles, 20);
    out.push({ kind: 'line', name: 'Donchian upper', color: 'rgba(59,130,246,0.8)', data: toPoints(dc.upper, candles) });
    out.push({ kind: 'line', name: 'Donchian mid', color: 'rgba(59,130,246,0.45)', dashed: true, data: toPoints(dc.mid, candles) });
    out.push({ kind: 'line', name: 'Donchian lower', color: 'rgba(59,130,246,0.8)', data: toPoints(dc.lower, candles) });
  }

  return out;
}

function buildPanes(candles: Candle[], selected: string[]): PaneDef[] {
  if (!candles.length) return [];
  const closes = candles.map((c) => c.close);
  const panes: PaneDef[] = [];
  const has = (n: string) => selected.includes(n);

  if (has('RSI 14')) {
    panes.push({
      id: 'rsi', title: 'RSI 14',
      series: [{ kind: 'line', color: '#a855f7', width: 2, data: toPoints(ta.rsi(closes, 14), candles) }],
      levels: [{ value: 70, color: 'rgba(239,68,68,0.5)' }, { value: 30, color: 'rgba(34,197,94,0.5)' }],
    });
  }

  if (has('MACD')) {
    const m = ta.macd(closes);
    const hist = candles.reduce<LinePoint[]>((acc, c, i) => {
      const v = m.hist[i];
      if (v !== null) acc.push({ time: c.time, value: v });
      return acc;
    }, []);
    panes.push({
      id: 'macd', title: 'MACD 12/26/9',
      series: [
        { kind: 'hist', color: '#64748b', data: hist },
        { kind: 'line', color: '#38bdf8', width: 1, data: toPoints(m.macd, candles) },
        { kind: 'line', color: '#f59e0b', width: 1, data: toPoints(m.signal, candles) },
      ],
      levels: [{ value: 0, color: 'rgba(120,120,130,0.4)' }],
    });
  }

  if (has('Stochastic')) {
    const s = ta.stochastic(candles, 14, 3, 3);
    panes.push({
      id: 'stoch', title: 'Stochastic 14,3,3',
      series: [
        { kind: 'line', color: '#38bdf8', width: 1, data: toPoints(s.k, candles) },
        { kind: 'line', color: '#f59e0b', width: 1, data: toPoints(s.d, candles) },
      ],
      levels: [{ value: 80, color: 'rgba(239,68,68,0.45)' }, { value: 20, color: 'rgba(34,197,94,0.45)' }],
    });
  }

  if (has('CCI')) {
    panes.push({
      id: 'cci', title: 'CCI 20',
      series: [{ kind: 'line', color: '#22d3ee', width: 1, data: toPoints(ta.cci(candles, 20), candles) }],
      levels: [{ value: 100, color: 'rgba(239,68,68,0.35)' }, { value: -100, color: 'rgba(34,197,94,0.35)' }],
    });
  }

  if (has('Williams %R')) {
    panes.push({
      id: 'williams', title: 'Williams %R 14',
      series: [{ kind: 'line', color: '#f472b6', width: 1, data: toPoints(ta.williamsR(candles, 14), candles) }],
      levels: [{ value: -20, color: 'rgba(239,68,68,0.35)' }, { value: -80, color: 'rgba(34,197,94,0.35)' }],
    });
  }

  if (has('Momentum')) {
    panes.push({
      id: 'momentum', title: 'Momentum 10',
      series: [{ kind: 'line', color: '#fb923c', width: 1, data: toPoints(ta.momentum(closes, 10), candles) }],
      levels: [{ value: 0, color: 'rgba(120,120,130,0.4)' }],
    });
  }

  if (has('ROC')) {
    panes.push({
      id: 'roc', title: 'Rate of Change 12',
      series: [{ kind: 'line', color: '#34d399', width: 1, data: toPoints(ta.roc(closes, 12), candles) }],
      levels: [{ value: 0, color: 'rgba(120,120,130,0.4)' }],
    });
  }

  if (has('Ultimate Oscillator')) {
    panes.push({
      id: 'uo', title: 'Ultimate Oscillator 7/14/28',
      series: [{ kind: 'line', color: '#c084fc', width: 1, data: toPoints(ta.ultimateOscillator(candles), candles) }],
      levels: [{ value: 70, color: 'rgba(239,68,68,0.35)' }, { value: 30, color: 'rgba(34,197,94,0.35)' }],
    });
  }

  if (has('ATR')) {
    panes.push({
      id: 'atr', title: 'ATR 14',
      series: [{ kind: 'line', color: '#facc15', width: 1, data: toPoints(ta.atr(candles, 14), candles) }],
    });
  }

  if (has('ADX')) {
    const a = ta.adx(candles, 14);
    panes.push({
      id: 'adx', title: 'ADX / DI 14',
      series: [
        { kind: 'line', color: '#fafafa', width: 2, data: toPoints(a.adx, candles) },
        { kind: 'line', color: 'rgba(34,197,94,0.7)', width: 1, data: toPoints(a.plusDI, candles) },
        { kind: 'line', color: 'rgba(239,68,68,0.7)', width: 1, data: toPoints(a.minusDI, candles) },
      ],
      levels: [{ value: 25, color: 'rgba(250,204,21,0.4)' }],
    });
  }

  if (has('OBV')) {
    panes.push({
      id: 'obv', title: 'OBV',
      series: [{ kind: 'line', color: '#60a5fa', width: 1, data: toPoints(ta.obv(candles), candles) }],
    });
  }

  if (has('MFI')) {
    panes.push({
      id: 'mfi', title: 'MFI 14',
      series: [{ kind: 'line', color: '#2dd4bf', width: 1, data: toPoints(ta.mfi(candles, 14), candles) }],
      levels: [{ value: 80, color: 'rgba(239,68,68,0.35)' }, { value: 20, color: 'rgba(34,197,94,0.35)' }],
    });
  }

  if (has('Aroon')) {
    const ar = ta.aroon(candles, 25);
    panes.push({
      id: 'aroon', title: 'Aroon 25',
      series: [
        { kind: 'line', color: '#22c55e', width: 1, data: toPoints(ar.up, candles) },
        { kind: 'line', color: '#ef4444', width: 1, data: toPoints(ar.down, candles) },
      ],
      levels: [{ value: 50, color: 'rgba(120,120,130,0.35)' }],
    });
  }

  return panes;
}

/* ------------------------------------------------------------------ */
/* Main chart                                                          */
/* ------------------------------------------------------------------ */

export function TradingChart({
  symbol, digits, kind, tf, tool, indicators, clearSignal, onPrice, payout,
}: {
  symbol: string;
  digits: number;
  kind: 'area' | 'candles';
  tf: string;
  tool: Tool;
  indicators: string[];
  clearSignal: number;
  onPrice?: (p: number) => void;
  payout?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | ISeriesApi<'Candlestick'> | null>(null);
  const overlayRef = useRef<ISeriesApi<'Line'>[]>([]);
  const dataRef = useRef<Candle[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [epoch, setEpoch] = useState(0);
  const pendingRef = useRef<{ time: number; price: number } | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const onPriceRef = useRef(onPrice);
  onPriceRef.current = onPrice;

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
      rightPriceScale: { borderVisible: false, minimumWidth: 76, scaleMargins: { top: 0.08, bottom: 0.12 } },
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
        wickUpColor: '#16A34A', wickDownColor: '#DC2626', borderVisible: false,
      });
    }
    seriesRef.current = series;

    const load = async () => {
      try {
        const res = await api<{ candles: Candle[] }>(`/prices/${encodeURIComponent(symbol)}/history?tf=${tf}`);
        if (disposed) return;
        const list = res.candles;
        dataRef.current = list;
        setCandles(list);
        if (kind === 'area') {
          (series as ISeriesApi<'Area'>).setData(list.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
        } else {
          (series as ISeriesApi<'Candlestick'>).setData(list.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
        }
        chart.timeScale().fitContent();
        const price = list[list.length - 1]?.close ?? 0;
        setLast(price);
        onPriceRef.current?.(price);
        setEpoch((e) => e + 1);
      } catch { /* ignore */ }
    };
    load();

    const socket = getSocket();
    socket.emit('market:subscribe', symbol);
    const bucket = TF_SECONDS[tf] ?? 60;
    const onTick = (tick: { symbol: string; price: number }) => {
      if (tick.symbol !== symbol) return;
      const arr = dataRef.current;
      if (!arr.length) return;
      const b = Math.floor(Math.floor(Date.now() / 1000) / bucket) * bucket;
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
      // refresh derived series at most every 5s to keep the UI light
      if (Date.now() % 5000 < 1100) setCandles([...arr]);
      setLast(tick.price);
      onPriceRef.current?.(tick.price);
    };
    socket.on('market:tick', onTick);

    const onClick = (param: { time?: unknown; point?: { x: number; y: number } }) => {
      if (tool === 'none' || !param.time || !param.point) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price === null) return;
      const p = { time: param.time as number, price: Number(price) };
      if (tool === 'horizontal') { setDrawings((d) => [...d, { type: 'horizontal', p1: p }]); return; }
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
      overlayRef.current = [];
    };
  }, [symbol, tf, kind, digits, tool]);

  /* overlays */
  const overlays = useMemo(() => buildOverlays(candles, indicators), [candles, indicators]);
  const panes = useMemo(() => buildPanes(candles, indicators), [candles, indicators]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const s of overlayRef.current) { try { chart.removeSeries(s); } catch { /* removed with chart */ } }
    overlayRef.current = [];

    for (const o of overlays) {
      if (o.kind === 'line') {
        if (!o.data.length) continue;
        const s = chart.addLineSeries({
          color: o.color, lineWidth: o.width ?? 1,
          lineStyle: o.dashed ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        s.setData(o.data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
        overlayRef.current.push(s);
      } else if (o.markers.length) {
        const s = chart.addLineSeries({
          color: 'rgba(0,0,0,0)', lineWidth: 1, priceLineVisible: false,
          lastValueVisible: false, crosshairMarkerVisible: false,
        });
        s.setData([]);
        s.setMarkers(o.markers.map((m) => ({ ...m, time: m.time as UTCTimestamp })) as never);
        overlayRef.current.push(s);
      }
    }
  }, [overlays, epoch]);

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
          ctx.moveTo(0, y1); ctx.lineTo(rect.width, y1); ctx.stroke();
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
  }, [drawings, digits, symbol, tf, kind, epoch]);

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto">
      <div className="relative min-h-[240px] flex-1">
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
        <SocialMarkers payout={payout} />
      </div>

      {panes.map((pane) => (
        <OscillatorPane key={pane.id} def={pane} mainChart={chartRef} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Oscillator sub-pane                                                 */
/* ------------------------------------------------------------------ */

function OscillatorPane({ def, mainChart }: { def: PaneDef; mainChart: React.MutableRefObject<IChartApi | null> }) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<any[]>([]);
  const fitted = useRef(false);

  // create once per pane
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b8b93', fontSize: 9, fontFamily: 'Inter, system-ui, sans-serif',
        attributionLogo: false,
      } as never,
      grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(120,120,130,0.08)' } },
      rightPriceScale: { borderVisible: false, minimumWidth: 76, scaleMargins: { top: 0.18, bottom: 0.12 } },
      timeScale: { visible: false, borderVisible: false },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { visible: false } },
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;

    seriesRef.current = def.series.map((s) => {
      if (s.kind === 'hist') {
        return chart.addHistogramSeries({ color: s.color, priceLineVisible: false, lastValueVisible: false, base: 0 });
      }
      return chart.addLineSeries({
        color: s.color, lineWidth: s.width ?? 1,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
    });

    // reference levels (RSI 70/30, ADX 25, …)
    const firstLine = seriesRef.current.find((x) => 'createPriceLine' in x) as ISeriesApi<'Line'> | undefined;
    if (firstLine && def.levels) {
      for (const lv of def.levels) {
        firstLine.createPriceLine({
          price: lv.value, color: lv.color, lineWidth: 1,
          lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '',
        });
      }
    }

    const main = mainChart.current;
    const sync = (range: { from: number; to: number } | null) => {
      if (range) chart.timeScale().setVisibleLogicalRange(range);
    };
    main?.timeScale().subscribeVisibleLogicalRangeChange(sync as never);
    const current = main?.timeScale().getVisibleLogicalRange();
    if (current) chart.timeScale().setVisibleLogicalRange(current);

    return () => {
      main?.timeScale().unsubscribeVisibleLogicalRangeChange(sync as never);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // stream new data without recreating the chart
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    def.series.forEach((s, i) => {
      const series = seriesRef.current[i];
      if (!series) return;
      if (s.kind === 'hist') {
        (series as ISeriesApi<'Histogram'>).setData(s.data.map((p) => ({
          time: p.time as UTCTimestamp,
          value: p.value,
          color: p.value >= 0 ? 'rgba(34,197,94,0.55)' : 'rgba(239,68,68,0.55)',
        })));
      } else {
        (series as ISeriesApi<'Line'>).setData(s.data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      }
    });
    if (!fitted.current) {
      chart.timeScale().fitContent();
      const main = mainChart.current;
      const range = main?.timeScale().getVisibleLogicalRange();
      if (range) chart.timeScale().setVisibleLogicalRange(range);
      fitted.current = true;
    }
  }, [def, mainChart]);

  return (
    <div data-testid="osc-pane" data-pane={def.id} className="relative h-[112px] w-full shrink-0 border-t border-[var(--border)]">
      <div ref={elRef} className="absolute inset-0" />
      <span className="pointer-events-none absolute left-2 top-1 z-10 rounded bg-[var(--surface)]/75 px-1.5 text-[10px] font-semibold text-[var(--muted)]">
        {def.title}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Social markers                                                      */
/* ------------------------------------------------------------------ */

const FEED = [
  { name: 'Darius4700', amount: 75 }, { name: 'Nasir4074', amount: 1500 },
  { name: 'Callen451', amount: 10 }, { name: 'Ivy8043', amount: 2000 },
  { name: 'Sebastian3916', amount: 75 }, { name: 'Callan7770', amount: 100 },
  { name: 'David8563', amount: 50 }, { name: 'Kingston8757', amount: 5000 },
];

let FEED_SEQ = 0;

export function SocialMarkers({ payout }: { payout?: number }) {
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
      {payout !== undefined && (
        <span className="pointer-events-none absolute right-2 bottom-2 z-10 text-[10px] text-[var(--muted-2)]">
          {(payout * 100).toFixed(0)}% payout
        </span>
      )}
    </>
  );
}
