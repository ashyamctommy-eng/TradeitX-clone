# TradeitX Platform

A full-stack trading terminal, bot suite and back-office — **Next.js 15 · Fastify · Prisma · Socket.io · PostgreSQL/SQLite**.

Built as a transparent rebuild of the TradeitX/Netapal product: real maker-checker withdrawals, no rigged odds, and no invented
blockchain confirmations. The reference recon lives in `../recon/REPORT-AUTHENTICATED.md`.

---

## Access credentials

| Role | Portal | Email | Password | Starting balance |
|---|---|---|---|---|
| **Trader** (`Blvd`) | `/dashboard` | `wildpharmtech9@gmail.com` | `TraderDemo123!` | **$10,000.00 DEMO** · **$0.00 REAL** |
| **Admin** (`Brabicana`) | `/brabicana` | `admin@tradeitx.com` | `BrabicanaAdmin123!` | — |

The trader account is seeded with the historical failed **$16.00** M-Pesa row (`ws_CO_25102026153901329717702563`) for
fidelity with the reference platform. `/admin` returns a hard 404 for everyone; the management portal lives at
`/brabicana`.

> Rotate these before exposing the app publicly. They are development seeds, not production secrets.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, Tailwind CSS, lucide-react |
| Charting | lightweight-charts 4.2.3 — area/candlestick, 22 indicators, drawing tools |
| API | Fastify 5, JWT httpOnly cookie auth, Zod validation |
| Realtime | Socket.io 4 — prices, trades, support chat, admin events, `ai:telemetry` |
| Data | Prisma 6 → SQLite (dev) / PostgreSQL (production) |
| Payments | PalPluss (M-Pesa STK + B2C) · NOWPayments (crypto, HMAC-SHA512 IPN) |
| Ops | PM2, Nginx, Let's Encrypt — see [DEPLOYMENT.md](DEPLOYMENT.md) |

---

## Architecture

```
tradeitx-platform/
├── prisma/
│   ├── schema.prisma        Profile, Balance, Transaction, Trade, Instrument,
│   │                        AiStrategy, AutoTradeConfig, CopyTrader,
│   │                        UserCopySubscription, CryptoDepositInvoice,
│   │                        SupportTicket/Message, TelegramEvent, AppSetting
│   └── seed.ts              trader + admin + 4 strategies + 5 copy traders + 6 instruments
├── server/
│   ├── index.ts             Fastify bootstrap, raw-body webhooks, CORS, cookies
│   ├── auth.ts              JWT cookie, requireUser / requireAdmin
│   ├── market.ts            price simulator, candle aggregation, history
│   ├── engine.ts            settlement, auto-trade, copy-trade, ai:telemetry
│   ├── realtime.ts          Socket.io rooms (user / admin / ticket / market / ai)
│   ├── telegram.ts          Bot API send + callback_query long-polling
│   ├── services/            treasury, deposits, gateway settings
│   └── routes/              auth, trading, payments, admin
├── src/
│   ├── app/(app)/           terminal and trader routes
│   ├── app/brabicana/       management portal
│   ├── app/admin/           hard 404
│   ├── components/          shell, chart, copy drawer, gateway panel, UI kit
│   ├── lib/indicators.ts    22 technical indicators (pure functions)
│   └── services/            PalPluss + NOWPayments clients
├── scripts/                 smoke, audit, webhook tests, demo reset
└── ecosystem.config.js      PM2 process definition
```

---

## Routes

| Route | Purpose |
|---|---|
| `/auth` | Sign in / sign up |
| `/dashboard` | Terminal: 105 px header, area/candle chart, 22 indicators, drawing tools, social feed, SELL/BUY ticket, R/D switcher |
| `/auto-trade` | DB-backed strategies, config, `ai:telemetry` stream, radial gauges, history |
| `/finances` | Balances, deposit/withdraw, recent activity |
| `/transactions` | Filters + CSV export |
| `/deposit-options` | Amount, 13-currency FX, cards / mobile money / crypto |
| `/payment-methods` | Method minimums and SLAs |
| `/withdrawal` | Request + stage timeline + cancel-while-pending |
| `/mpesa-status` | STK polling screen |
| `/profile` | Personal + Finances tabs |
| `/support` | New / Current / Past tickets, live chat |
| `/brabicana` | Users, balances, flags, deposit queue, withdrawal approvals, instruments, gateways, support desk, Telegram |
| `/admin` | 404 |

---

## Features

### Terminal
- lightweight-charts with **zero attribution** (no TradingView branding in the DOM).
- **22 indicators**, all computed client-side from the live candle series:
  - *Overlays*: EMA 20, SMA 50, SMA 200, Bollinger Bands, Ichimoku Cloud, Parabolic SAR, VWAP, SuperTrend, Donchian Channels.
  - *Sub-panes*: RSI 14, MACD (with histogram), Stochastic, CCI, Williams %R, Momentum, ROC, Ultimate Oscillator, ATR, ADX (+DI/−DI), OBV, MFI, Aroon.
- Drawing tools: trendline, horizontal line, ray, Fibonacci retracement, clear.
- Simulated social trade markers, live price badges, symmetric `SELL 82%` / `BUY 82%` ticket, $1 stake stepping, 5 s → 5 m durations.
- Real ⇄ Demo account switcher; demo starts at $10,000.

### Auto-trading
- Strategies stored in **`AiStrategy`** (`Alpha Scalper AI`, `Neural Forex Grid`, `Crypto Momentum v4`, `Gold Volatility Hunter`).
- Users create custom strategies (persisted with `isCustom` + owner) and toggle any strategy on/off.
- Server-side execution loop resolves the strategy's `configJson` (symbol, duration) and settles against the shared price stream.
- **`ai:telemetry`** socket worker pushes running state, signal, win rate / P&L and execution logs every 2 s; the Signals tab renders a live terminal drawer and two radial gauges.

### Payments
- **PalPluss** — Basic auth with any `pp_live_…` / `pp_test_…` key (no prefix validation), STK Push, B2C payouts, service-wallet balance/top-up, channel CRUD. Exact contract and path corrections: [docs/palpluss.md](docs/palpluss.md).
- **NOWPayments** — invoice creation, status polling, HMAC-SHA512 IPN.
- Webhooks: `/api/webhooks/palpluss/stk`, `/api/webhooks/palpluss/b2c`, `/api/webhooks/nowpayments` — idempotent on `transaction.id` / `payment_id`.
- Withdrawals are a real maker-checker flow: `PENDING_REVIEW → PROCESSING → COMPLETED / DECLINED`, user-visible, cancellable, auto-refund on decline.
- `ENABLE_LIVE_PAYMENTS=false` disables all real money movement; without gateway keys the M-Pesa and crypto flows fall back to a clearly labelled simulator.

### Admin & Telegram
- `/brabicana`: user search, credit/debit, freeze, KYC flag, deposit queue, withdrawal approvals (approve / complete / decline with codes), instrument parameters, support desk.
- **Gateways**: PalPluss key + Live/Sandbox, deposit/withdraw rates, wallet balance + top-up, channel manager, connection test; NOWPayments key, IPN secret, coin toggles, test.
- **Telegram**: outbound alerts with inline Approve / Decline / Mark completed / Confirm received, long-polling callbacks, and a broadcast composer with `📡 Broadcast`. Without a token the same events render in the in-app mirror feed.

---

## Local development

```bash
npm install
npm run setup        # prisma db push + seed
npm run dev          # API :4000 + web :3000
```

Production build locally:

```bash
npm run build
npm start
```

---

## Testing

```bash
npm run audit          # full diagnostic (static + DB + API + headless UI) → AUDIT.md
npm run smoke          # 25 API assertions
npm run test:palpluss  # 14 PalPluss webhook / key assertions
node scripts/test-webhook.mjs   # NOWPayments HMAC IPN
npm run db:reset       # restore seeded demo ledger
```

The audit covers charting, indicators, telemetry, payments, admin guards and the Telegram feed. Latest run:
**41 PASS · 1 PARTIAL · 0 GAP** (the partial was the indicator suite, now implemented — re-run `npm run audit` for the current number).

---

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite file (dev) or PostgreSQL URL (prod) |
| `JWT_SECRET` | Session signing key — generate with `openssl rand -hex 32` |
| `API_PORT` / `API_URL` | Fastify port / origin used by Next rewrites |
| `PUBLIC_URL` | Public HTTPS base used in payment callbacks |
| `ENABLE_LIVE_PAYMENTS` | Master switch for real deposits/withdrawals |
| `PALPLUSS_API_KEY` / `PALPLUSS_ENV` | M-Pesa gateway (or configure in `/brabicana → Gateways`) |
| `NOWPAYMENTS_API_KEY` / `NOWPAYMENTS_IPN_SECRET` | Crypto gateway |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ADMIN_CHAT_ID` | Admin bot |

---

## Production

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for Ubuntu 24.04 provisioning, PostgreSQL, Redis, PM2, Nginx, SSL, backups and
the go-live checklist.

---

## Limitations

- Market data is simulated (labelled in the footer); swap `server/market.ts` for a real feed.
- Card/wallet acquirers are placeholders; PalPluss M-Pesa and NOWPayments are the wired rails.
- Volume-based indicators (VWAP, OBV, MFI) use candle range as a volume proxy until a feed provides volume.
- Single-currency ledger in USD; the FX converter is display-only.
