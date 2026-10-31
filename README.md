# TradeitX Platform

A full-stack, **transparent** rebuild of the TradeitX/Netapal trading terminal: Next.js 15 + Fastify + Prisma + Socket.io.

Built from the recon in `../recon/REPORT-AUTHENTICATED.md`, with three deliberate departures from the reference product:

| Reference behaviour | This build |
|---|---|
| Withdrawal held invisibly behind a fabricated "MPC batch" pipeline | Real maker-checker: `PENDING_REVIEW → PROCESSING → COMPLETED / DECLINED`, visible to the user, cancellable while pending |
| Per-user `customWinRateBias` house edge | Removed. Every trade settles against the same server price stream |
| "Simulate blockchain confirmation" shown to depositors | Removed from user UI. Webhook-driven settlement + `scripts/test-webhook.mjs`; sandbox trigger lives only in `/brabicana` and is disabled when `NODE_ENV=production` |

---

## Quick start

```bash
cd tradeitx-platform
npm install
npm run setup      # prisma db push + seed
npm run dev        # API :4000 + web :3000
```

Production:

```bash
npm run build
npm start
```

### Seeded logins

| Role | Email | Password |
|---|---|---|
| Trader (Blvd) | `wildpharmtech9@gmail.com` | `TraderDemo123!` |
| Admin | `admin@tradeitx.com` | `BrabicanaAdmin123!` |

Seeded state mirrors the recon: demo **$10,000**, real **$0**, one failed **$16 M-Pesa** transaction (`ws_CO_25102026153901329717702563`).

---

## Stack

```
tradeitx-platform/
├── prisma/schema.prisma     9 models (Profile, Balance, Transaction, Trade,
│                            AutoTradeConfig, CopyTrader, UserCopySubscription,
│                            CryptoDepositInvoice, SupportTicket/Message, TelegramEvent)
├── prisma/seed.ts
├── server/
│   ├── index.ts             Fastify bootstrap, cookie auth, CORS, raw-body webhooks
│   ├── auth.ts              JWT cookie + requireUser / requireAdmin
│   ├── market.ts            price simulator, candle aggregation, history
│   ├── engine.ts            settlement loop, auto-trade loop, copy-trade loop
│   ├── realtime.ts          Socket.io rooms (user, admin, ticket, market)
│   ├── telegram.ts          Bot API delivery + callback_query long-polling
│   ├── services/            treasury.ts (withdrawals), deposits.ts (M-Pesa/crypto)
│   └── routes/              auth, trading, payments, admin
├── src/app/(app)/           dashboard, auto-trade, finances, transactions,
│                            deposit-options, payment-methods, withdrawal,
│                            mpesa-status, profile, support
├── src/app/brabicana/       management portal (own login)
├── src/app/admin/           hard 404 for non-admins
└── scripts/                 smoke.ts, test-webhook.mjs
```

**Why two processes:** Next handles the UI and rewrites `/api/*` to Fastify; Socket.io runs on `:4000`. Cookies are host-scoped, so the session works across the rewrite with no token in localStorage.

---

## Routes

| Route | Notes |
|---|---|
| `/auth` | Sign in / sign up |
| `/dashboard` | 105 px double header, area/candle chart, drawing tools, 22-indicator modal, social feed markers, R/D switcher, `SELL 82%` / `BUY 82%` ticket |
| `/auto-trade` | DB-backed `AiStrategy` cards (4 seeded + custom), Config, live `ai:telemetry` stream, SVG radial gauges, history |
| `/finances` | Balance card with eye mask, deposit/withdraw, recent activity |
| `/transactions` | Totals, 3 filters, CSV export, stage badges |
| `/deposit-options` | Amount, risk warning, 13-currency FX, cards / mobile money / crypto |
| `/payment-methods` | Deposit/withdraw methods with minimums |
| `/withdrawal` | Request form, stage timeline, cancel-while-pending |
| `/mpesa-status` | STK polling screen |
| `/profile` | Personal + Finances tabs |
| `/support` | New / Current / Past tickets, live socket chat, DB-backed (no 403s) |
| `/brabicana` | Management portal (users, balances, flags, deposits, withdrawals, instruments, support, Telegram feed) |
| `/admin` | `notFound()` — matches the reference |

---

## Auto-trading internals

- **Strategies live in `AiStrategy`** (`strat_alpha`, `strat_neural`, `strat_crypto`, `strat_gold`), seeded by `prisma/seed.ts`.
  Users can create custom strategies (`POST /ai-strategies/custom`) which persist with `isCustom` + `createdByUserId`
  and are added to their active set.
- **`ai:telemetry`**: the engine pushes a payload every 2 s to every socket that emitted `ai:subscribe` —
  running state, resolved strategy, signal snapshot, win rate / P&L, and the last 14 execution log lines.
  The Signals tab renders those lines in a terminal drawer. REST (`GET /auto-trade/signals`) is only the initial paint.
- **Execution** uses the strategy's `configJson` (symbol, duration) and settles against the shared price stream.

## Payment gateways

### PalPluss (M-Pesa)

Exact contract and path corrections: **[docs/palpluss.md](docs/palpluss.md)**.

- **Keys:** `pp_live_…` / `pp_test_…`. No prefix validation anywhere — any
  non-empty key is accepted (the docs' `pk_live_…` snippets are stale).
- **Auth:** `Authorization: Basic base64("<key>:")`.
- **Environment:** Live → `api.palpluss.com/v1`, Sandbox → `sandbox.palpluss.com/v1`.
- **Configured in `/brabicana → Gateways`:** API key, environment, USD→KES
  deposit/withdraw rates, service wallet balance + top-up, full channel CRUD
  (Paybill/Till), connection test.
- **Webhooks:** `POST /api/webhooks/palpluss/stk` and `/b2c`, idempotent on
  `transaction.id`, storing `mpesa_receipt` and `requestId`. Public HTTPS only —
  set `PUBLIC_URL` (ngrok in dev).

Without a key the M-Pesa flow falls back to a clearly-labelled local simulation,
so the UI and ledger remain testable.

### NOWPayments (crypto)

- `POST /v1/payment`, `GET /v1/payment/{id}`, `GET /v1/status`.
- IPN at `POST /api/webhooks/nowpayments`, verified with HMAC-SHA512 over the
  sorted JSON body (`x-nowpayments-sig`).
- Coins: `btc`, `eth`, `usdttrc20`, `usdterc20`, `ltc` — toggled in the admin UI.
- No key → local sandbox invoices; no outbound calls.

## Money flows

**M-Pesa deposit** → `POST /api/deposits/mpesa` converts USD→KES at the admin rate and calls PalPluss STK (or simulates when unconfigured) → `/mpesa-status` polls our row, which reconciles against PalPluss every 10 s → the webhook settles it and stores the M-Pesa receipt. Admin "Confirm received" remains available as a manual fallback.

**Crypto deposit** → `POST /api/deposits/crypto` creates a NOWPayments payment (address + exact crypto amount) or a local sandbox invoice → QR + address shown → IPN webhook verifies **HMAC-SHA512 over the alphabetically sorted body** → invoice `FINISHED` + balance credit.

**Withdrawal** → funds move available → locked, row at `PENDING_REVIEW` → admin/Telegram **Approve** → `PROCESSING`; for M-Pesa a PalPluss B2C payout is queued automatically (KES at the withdraw rate) → `transaction.success` completes it with the M-Pesa receipt, `transaction.failed/reversed` declines it and refunds. **Decline** always refunds with a compliance code (`AML-402`, `MRG-108`, `KYC-301`, `PLP-…`). The user can cancel while pending.

**Telegram broadcast**: `/brabicana → Telegram bot` has a composer (title + body) and a `📡 Broadcast` button on every
feed card. Both call `POST /admin/broadcast`, which routes through `pushTelegramEvent` — delivered to the bot chat when
configured, always mirrored in-app.

**Telegram**: every deposit, withdrawal and ticket emits a formatted message to `TELEGRAM_ADMIN_CHAT_ID` with inline buttons. Without a token the same events appear in the in-app mirror feed at `/brabicana → Telegram bot`, and those buttons call the identical API actions. Callback data routes to one source of truth (`services/treasury.ts`).

---

## Testing

```bash
npm run audit                  # full diagnostic: static wiring + DB + API + headless UI → AUDIT.md
npm run db:reset               # restore seeded demo ledger (real $0 / demo $10,000)

npm run smoke                  # 25 API assertions: auth, trade settlement, deposits,
                               # crypto webhook, withdrawal maker-checker, support, admin
npm run test:palpluss          # 14 assertions: pp_test_ key accepted, STK settlement,
                               # duplicate delivery, B2C failure → refund
node scripts/test-webhook.mjs  # NOWPayments IPN: bad signature 401, good signature settles
```

Both pass against the seeded database.

---

## Configuration

| Var | Purpose |
|---|---|
| `ENABLE_LIVE_PAYMENTS` | Master switch. When `false`, deposit/withdraw endpoints return `LIVE_PAYMENTS_DISABLED` |
| `NOWPAYMENTS_SANDBOX` | `true` issues local invoices; `false` calls the NOWPayments API |
| `NOWPAYMENTS_IPN_SECRET` | HMAC-SHA512 webhook secret |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ADMIN_CHAT_ID` | Enables outbound bot delivery and inline approvals |
| `JWT_SECRET` | Session signing key |

---

## Going to production — checklist

1. **Licensing & KYC before real money.** `ENABLE_LIVE_PAYMENTS=false` until a regulated entity, a payments partner and KYC/AML are in place. The withdrawal review queue is already there; wire it to your compliance process.
2. **Postgres.** Change `datasource db.provider` to `postgresql` and set `DATABASE_URL`; the schema is provider-neutral apart from SQLite's text-JSON columns.
3. **Market data.** `server/market.ts` is a deterministic simulator for demo purposes. Swap `market.subscribe`/`price` for a real feed (they are the only integration points).
4. **Card acquirers.** Payhero / Visa / Skrill / Neteller tiles are present but return a "not configured" notice — connect an acquirer in `services/deposits.ts`.
5. **Hardening.** Rate limiting on auth, CSRF strategy for cookie writes, audit-log retention, and secret management.

---

## Known limitations

- Market prices are simulated (labelled in the footer).
- Card/wallet acquirers are placeholders; M-Pesa STK is a local simulation until Daraja credentials exist.
- Telegram requires a bot token; the mirror feed is the default.
- Single-currency ledger in USD (FX converter is display-only).
