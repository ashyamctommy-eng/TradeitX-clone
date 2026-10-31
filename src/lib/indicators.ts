/**
 * Technical indicators — pure functions over OHLC candles.
 * Every function returns an array aligned 1:1 with the input (null during warm-up).
 *
 * Volume-dependent indicators (VWAP, OBV, MFI) use candle range (high-low) as a
 * volume proxy because the simulated feed carries price only. This is documented
 * on the chart legend; swap `volume()` for real volume when a feed provides it.
 */

export type Candle = { time: number; open: number; high: number; low: number; close: number };
export type Series = (number | null)[];

const empty = (n: number): Series => new Array(n).fill(null);
const volume = (c: Candle) => Math.max(1e-9, c.high - c.low);

export function sma(values: number[], period: number): Series {
  const out = empty(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): Series {
  const out = empty(values.length);
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue;
    if (i === period - 1) {
      prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

export function bollinger(values: number[], period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper = empty(values.length);
  const lower = empty(values.length);
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const mean = mid[i]!;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return { upper, mid, lower };
}

export function trueRange(candles: Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  });
}

export function atr(candles: Candle[], period = 14): Series {
  const tr = trueRange(candles);
  const out = empty(candles.length);
  let prev = 0;
  for (let i = 0; i < tr.length; i++) {
    if (i === period - 1) {
      prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
      out[i] = prev;
    } else if (i >= period) {
      prev = (prev * (period - 1) + tr[i]) / period;
      out[i] = prev;
    }
  }
  return out;
}

export function rsi(values: number[], period = 14): Series {
  const out = empty(values.length);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = Math.max(0, diff);
    const loss = Math.max(0, -diff);
    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      if (i === period) out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9) {
  const fastE = ema(values, fast);
  const slowE = ema(values, slow);
  const line = values.map((_, i) => (fastE[i] === null || slowE[i] === null ? null : fastE[i]! - slowE[i]!));
  const nonNull = line.filter((v): v is number => v !== null);
  const sig = ema(nonNull, signalPeriod);
  const signal: Series = empty(values.length);
  const offset = line.findIndex((v) => v !== null);
  if (offset >= 0) sig.forEach((v, i) => { signal[offset + i] = v; });
  const hist = line.map((v, i) => (v === null || signal[i] === null ? null : v - signal[i]!));
  return { macd: line, signal, hist };
}

export function stochastic(candles: Candle[], period = 14, smoothK = 3, smoothD = 3) {
  const kRaw = empty(candles.length);
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1);
    const hh = Math.max(...slice.map((c) => c.high));
    const ll = Math.min(...slice.map((c) => c.low));
    kRaw[i] = hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100;
  }
  const k = smoothSeries(kRaw, smoothK);
  const d = smoothSeries(k, smoothD);
  return { k, d };
}

function smoothSeries(input: Series, period: number): Series {
  const out = empty(input.length);
  for (let i = 0; i < input.length; i++) {
    const slice = input.slice(Math.max(0, i - period + 1), i + 1);
    if (slice.length < period || slice.some((v) => v === null)) continue;
    out[i] = (slice as number[]).reduce((a, b) => a + b, 0) / period;
  }
  return out;
}

export function cci(candles: Candle[], period = 20): Series {
  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  const ma = sma(tp, period);
  const out = empty(candles.length);
  for (let i = period - 1; i < candles.length; i++) {
    const slice = tp.slice(i - period + 1, i + 1);
    const mean = ma[i]!;
    const dev = slice.reduce((a, b) => a + Math.abs(b - mean), 0) / period;
    out[i] = dev === 0 ? 0 : (tp[i] - mean) / (0.015 * dev);
  }
  return out;
}

export function williamsR(candles: Candle[], period = 14): Series {
  const out = empty(candles.length);
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1);
    const hh = Math.max(...slice.map((c) => c.high));
    const ll = Math.min(...slice.map((c) => c.low));
    out[i] = hh === ll ? -50 : ((hh - candles[i].close) / (hh - ll)) * -100;
  }
  return out;
}

export function momentum(values: number[], period = 10): Series {
  return values.map((v, i) => (i < period ? null : v - values[i - period]));
}

export function roc(values: number[], period = 12): Series {
  return values.map((v, i) => (i < period || values[i - period] === 0 ? null : ((v - values[i - period]) / values[i - period]) * 100));
}

export function ultimateOscillator(candles: Candle[], p1 = 7, p2 = 14, p3 = 28): Series {
  const bp: number[] = [];
  const tr: number[] = [];
  candles.forEach((c, i) => {
    if (i === 0) { bp.push(0); tr.push(c.high - c.low); return; }
    const prevClose = candles[i - 1].close;
    bp.push(c.close - Math.min(c.low, prevClose));
    tr.push(Math.max(c.high, prevClose) - Math.min(c.low, prevClose));
  });
  const avg = (arr: number[], i: number, p: number) => {
    if (i < p - 1) return null;
    return arr.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0);
  };
  return candles.map((_, i) => {
    const a1 = avg(bp, i, p1); const t1 = avg(tr, i, p1);
    const a2 = avg(bp, i, p2); const t2 = avg(tr, i, p2);
    const a3 = avg(bp, i, p3); const t3 = avg(tr, i, p3);
    if (a1 === null || a2 === null || a3 === null || !t1 || !t2 || !t3) return null;
    return (100 * (4 * (a1 / t1) + 2 * (a2 / t2) + a3 / t3)) / 7;
  });
}

export function obv(candles: Candle[]): Series {
  const out = empty(candles.length);
  let acc = 0;
  candles.forEach((c, i) => {
    if (i > 0) {
      if (c.close > candles[i - 1].close) acc += volume(c);
      else if (c.close < candles[i - 1].close) acc -= volume(c);
    }
    out[i] = acc;
  });
  return out;
}

export function mfi(candles: Candle[], period = 14): Series {
  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  const flow = tp.map((v, i) => v * volume(candles[i]));
  const out = empty(candles.length);
  for (let i = period; i < candles.length; i++) {
    let pos = 0; let neg = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (tp[j] >= tp[j - 1]) pos += flow[j]; else neg += flow[j];
    }
    out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  }
  return out;
}

export function aroon(candles: Candle[], period = 25) {
  const up = empty(candles.length);
  const down = empty(candles.length);
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1);
    let hiIdx = 0; let loIdx = 0;
    slice.forEach((c, j) => {
      if (c.high >= slice[hiIdx].high) hiIdx = j;
      if (c.low <= slice[loIdx].low) loIdx = j;
    });
    up[i] = (hiIdx / period) * 100;
    down[i] = (loIdx / period) * 100;
  }
  return { up, down };
}

export function vwap(candles: Candle[]): Series {
  const out = empty(candles.length);
  let pv = 0; let vol = 0;
  candles.forEach((c, i) => {
    const tp = (c.high + c.low + c.close) / 3;
    pv += tp * volume(c);
    vol += volume(c);
    out[i] = vol === 0 ? null : pv / vol;
  });
  return out;
}

export function psar(candles: Candle[], step = 0.02, max = 0.2) {
  const out: { value: number; up: boolean }[] = [];
  if (!candles.length) return out;
  let up = true;
  let af = step;
  let ep = candles[0].high;
  let sar = candles[0].low;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) { out.push({ value: sar, up }); continue; }
    sar = sar + af * (ep - sar);

    if (up) {
      if (c.low < sar) { up = false; sar = ep; ep = c.low; af = step; }
      else if (c.high > ep) { ep = c.high; af = Math.min(max, af + step); }
    } else {
      if (c.high > sar) { up = true; sar = ep; ep = c.high; af = step; }
      else if (c.low < ep) { ep = c.low; af = Math.min(max, af + step); }
    }
    out.push({ value: sar, up });
  }
  return out;
}

export function superTrend(candles: Candle[], period = 10, mult = 3) {
  const atrSeries = atr(candles, period);
  const out: { value: number; up: boolean }[] = [];
  let finalUpper: number | null = null;
  let finalLower: number | null = null;
  let up = true;

  candles.forEach((c, i) => {
    const a = atrSeries[i];
    if (a === null) { out.push({ value: c.close, up }); return; }
    const mid = (c.high + c.low) / 2;
    const basicUpper = mid + mult * a;
    const basicLower = mid - mult * a;

    if (finalUpper === null || basicUpper < finalUpper || candles[i - 1].close > finalUpper) finalUpper = basicUpper;
    if (finalLower === null || basicLower > finalLower || candles[i - 1].close < finalLower) finalLower = basicLower;

    if (c.close > finalUpper) up = true;
    else if (c.close < finalLower) up = false;

    out.push({ value: up ? finalLower! : finalUpper!, up });
  });
  return out;
}

export function donchian(candles: Candle[], period = 20) {
  const upper = empty(candles.length);
  const lower = empty(candles.length);
  const mid = empty(candles.length);
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1);
    const hh = Math.max(...slice.map((c) => c.high));
    const ll = Math.min(...slice.map((c) => c.low));
    upper[i] = hh; lower[i] = ll; mid[i] = (hh + ll) / 2;
  }
  return { upper, lower, mid };
}

export function ichimoku(candles: Candle[], tenkanP = 9, kijunP = 26, senkouP = 52) {
  const mid = (i: number, p: number) => {
    if (i < p - 1) return null;
    const slice = candles.slice(i - p + 1, i + 1);
    return (Math.max(...slice.map((c) => c.high)) + Math.min(...slice.map((c) => c.low))) / 2;
  };
  const tenkan = empty(candles.length);
  const kijun = empty(candles.length);
  const senkouA = empty(candles.length);
  const senkouB = empty(candles.length);

  for (let i = 0; i < candles.length; i++) {
    tenkan[i] = mid(i, tenkanP);
    kijun[i] = mid(i, kijunP);
    if (tenkan[i] !== null && kijun[i] !== null) {
      const val = (tenkan[i]! + kijun[i]!) / 2;
      if (i + kijunP < candles.length) senkouA[i + kijunP] = val;
    }
    const b = mid(i, senkouP);
    if (b !== null && i + kijunP < candles.length) senkouB[i + kijunP] = b;
  }
  return { tenkan, kijun, senkouA, senkouB };
}

export function adx(candles: Candle[], period = 14) {
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  const tr = trueRange(candles);
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }

  const smooth = (arr: number[]) => {
    const out = empty(arr.length);
    let prev = 0;
    for (let i = 0; i < arr.length; i++) {
      if (i === period) {
        prev = arr.slice(1, period + 1).reduce((a, b) => a + b, 0);
        out[i] = prev;
      } else if (i > period) {
        prev = prev - prev / period + arr[i];
        out[i] = prev;
      }
    }
    return out;
  };
  const trS = smooth(tr as unknown as number[]);
  const pS = smooth(plusDM);
  const mS = smooth(minusDM);

  const plusDI = empty(candles.length);
  const minusDI = empty(candles.length);
  const dx = empty(candles.length);
  for (let i = 0; i < candles.length; i++) {
    if (trS[i] === null || pS[i] === null || mS[i] === null || trS[i] === 0) continue;
    plusDI[i] = (pS[i]! / trS[i]!) * 100;
    minusDI[i] = (mS[i]! / trS[i]!) * 100;
    const sum = plusDI[i]! + minusDI[i]!;
    dx[i] = sum === 0 ? 0 : (Math.abs(plusDI[i]! - minusDI[i]!) / sum) * 100;
  }

  const adxSeries = empty(candles.length);
  let prev = 0;
  let count = 0;
  for (let i = 0; i < candles.length; i++) {
    if (dx[i] === null) continue;
    count++;
    if (count === period) {
      prev = dx.slice(i - period + 1, i + 1).reduce<number>((a, b) => a + (b ?? 0), 0) / period;
      adxSeries[i] = prev;
    } else if (count > period) {
      prev = (prev * (period - 1) + dx[i]!) / period;
      adxSeries[i] = prev;
    }
  }
  return { adx: adxSeries, plusDI, minusDI };
}
