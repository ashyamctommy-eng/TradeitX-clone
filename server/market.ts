import fs from 'fs';
import path from 'path';

export type SymbolConfig = {
  symbol: string;
  label: string;
  mode: 'OTC' | 'LIVE';
  basePrice: number;
  payoutRate: number;
  minStake: number;
  maxStake: number;
  isActive: boolean;
  digits: number;
};

export const DEFAULT_SYMBOLS: SymbolConfig[] = [
  { symbol: 'EUR/USD', label: 'Euro / US Dollar', mode: 'OTC', basePrice: 1.0852, payoutRate: 0.82, minStake: 1, maxStake: 1000, isActive: true, digits: 5 },
  { symbol: 'GBP/USD', label: 'British Pound / US Dollar', mode: 'OTC', basePrice: 1.2714, payoutRate: 0.82, minStake: 1, maxStake: 1000, isActive: true, digits: 5 },
  { symbol: 'BTC/USD', label: 'Bitcoin / US Dollar', mode: 'LIVE', basePrice: 67420, payoutRate: 0.85, minStake: 1, maxStake: 2500, isActive: true, digits: 2 },
  { symbol: 'ETH/USD', label: 'Ethereum / US Dollar', mode: 'LIVE', basePrice: 3284.5, payoutRate: 0.84, minStake: 1, maxStake: 2500, isActive: true, digits: 2 },
  { symbol: 'XAU/USD', label: 'Gold / US Dollar', mode: 'OTC', basePrice: 2338.7, payoutRate: 0.8, minStake: 1, maxStake: 2000, isActive: true, digits: 2 },
  { symbol: 'USD/KES', label: 'US Dollar / Kenyan Shilling', mode: 'OTC', basePrice: 129.35, payoutRate: 0.8, minStake: 1, maxStake: 500, isActive: true, digits: 3 },
];

type Point = { t: number; p: number };

class Market {
  private prices = new Map<string, number>();
  private history = new Map<string, Point[]>();
  private listeners = new Set<(s: string, p: number, prev: number) => void>();

  constructor() {
    for (const s of DEFAULT_SYMBOLS) {
      this.prices.set(s.symbol, s.basePrice);
      this.history.set(s.symbol, seedHistory(s.basePrice, s.symbol));
    }
    setInterval(() => this.tick(), 1000);
  }

  configs(): SymbolConfig[] {
    return DEFAULT_SYMBOLS;
  }

  config(symbol: string) {
    return DEFAULT_SYMBOLS.find((s) => s.symbol === symbol);
  }

  price(symbol: string) {
    return this.prices.get(symbol) ?? 0;
  }

  subscribe(fn: (s: string, p: number, prev: number) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  points(symbol: string) {
    return this.history.get(symbol) ?? [];
  }

  /** Deterministic pseudo-history so the chart is populated on first paint. */
  candles(symbol: string, seconds: number, count = 320) {
    const cfg = this.config(symbol);
    const now = Math.floor(Date.now() / 1000);
    const end = Math.floor(now / seconds) * seconds;
    const live = this.points(symbol).filter((p) => p.t > end - count * seconds);
    const out: { time: number; open: number; high: number; low: number; close: number }[] = [];

    let price = cfg?.basePrice ?? 1;
    let seed = hash(symbol) + seconds;
    for (let i = count - 1; i >= 0; i--) {
      const time = end - i * seconds;
      const rnd = mulberry(seed++);
      const vol = (cfg?.basePrice ?? 1) * 0.0009;
      const open = price;
      const close = open + (rnd() - 0.5) * vol * 2;
      const high = Math.max(open, close) + rnd() * vol * 0.6;
      const low = Math.min(open, close) - rnd() * vol * 0.6;
      out.push({ time, open, high, low, close });
      price = close;
    }
    // Shift the whole synthetic path so it terminates at the live price —
    // otherwise the newest tick draws a vertical cliff on the last candle.
    const cur = this.price(symbol);
    if (out.length && cur) {
      const delta = cur - out[out.length - 1].close;
      for (const c of out) {
        c.open += delta; c.high += delta; c.low += delta; c.close += delta;
      }
    }

    // stitch live ticks into the last buckets
    for (const p of live) {
      const time = Math.floor(p.t / seconds) * seconds;
      const last = out[out.length - 1];
      if (!last) continue;
      if (time === last.time) {
        last.close = p.p;
        last.high = Math.max(last.high, p.p);
        last.low = Math.min(last.low, p.p);
      } else if (time > last.time) {
        out.push({ time, open: last.close, high: Math.max(last.close, p.p), low: Math.min(last.close, p.p), close: p.p });
      }
    }
    return out.slice(-count);
  }

  private tick() {
    for (const cfg of DEFAULT_SYMBOLS) {
      const prev = this.prices.get(cfg.symbol)!;
      const vol = cfg.basePrice * 0.00035;
      const drift = (Math.random() - 0.5) * vol * 2;
      const price = Math.max(0.0001, prev + drift);
      this.prices.set(cfg.symbol, price);
      const h = this.history.get(cfg.symbol)!;
      h.push({ t: Math.floor(Date.now() / 1000), p: price });
      if (h.length > 7200) h.splice(0, h.length - 7200);
      for (const fn of this.listeners) fn(cfg.symbol, price, prev);
    }
  }
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function mulberry(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedHistory(base: number, symbol: string): Point[] {
  const out: Point[] = [];
  let p = base;
  let seed = hash(symbol);
  const now = Math.floor(Date.now() / 1000);
  for (let i = 900; i > 0; i--) {
    const r = mulberry(seed++);
    p = p + (r() - 0.5) * base * 0.0006;
    out.push({ t: now - i, p });
  }
  return out;
}

export const market = new Market();
