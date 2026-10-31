# PalPluss integration notes

Read from `docs.palpluss.com` (llms-full.txt + openapi.yaml) on 2026-10-31.
This file records the **published** contract, the deviations from the integration
brief, and how the platform maps onto it.

## Base URLs

| Environment | Base |
|---|---|
| Live | `https://api.palpluss.com/v1` |
| Sandbox | `https://sandbox.palpluss.com/v1` |

## Authentication

HTTP Basic with the API key as username and an **empty password**:

```
Authorization: Basic base64("<API_KEY>:")
```

Keys issued by `console.palpluss.com` are `pp_live_…` / `pp_test_…`.
Some static snippets on the docs site still show `pk_live_…` — that is stale.
`src/services/palplussService.ts` performs **no prefix validation**: any
non-empty trimmed key is accepted and sent verbatim.

## Endpoints used

| Purpose | Method & path |
|---|---|
| STK Push | `POST /payments/stk` |
| Get transaction | `GET /transactions/{id}` |
| List transactions | `GET /transactions?limit&cursor&status&type` |
| B2C payout | `POST /b2c/payouts` |
| Service wallet balance | `GET /wallets/service/balance` |
| Service wallet top-up | `POST /wallets/service/topups` |
| List channels | `GET /payment-wallet/channels` |
| Create channel | `POST /payment-wallet/channels` |
| Get channel | `GET /payment-wallet/channels/{id}` |
| Update channel | `PATCH /payment-wallet/channels/{id}` |
| Delete channel | `DELETE /payment-wallet/channels/{id}` |

### Corrections to the integration brief

| Brief said | Docs say | Used here |
|---|---|---|
| `GET/POST/PATCH/DELETE /v1/channels` | `/v1/payment-wallet/channels` | **docs** |
| `POST /v1/wallets/service/topup` | `/v1/wallets/service/topups` | **docs** |
| `POST /v1/b2c/payout` | `/v1/b2c/payouts` | **docs** |
| `POST /v1/payment` (NOWPayments) | `POST /v1/payment` | docs ✓ (NOWPayments) |

### Request fields that matter

**STK** — required: `amount` (KES), `phone`, `accountReference` (≤12 chars),
`transactionDesc` (≤13 chars), `callbackUrl`. Optional: `channelId`,
`credential_id` (BYOC). A channel is mandatory — omit it and the account
default is used; with no channels you get `NO_PAYMENT_CHANNELS`, with no
default `NO_DEFAULT_CHANNEL`.

**B2C** — required: `amount` (KES, min 10), `phone`, `reference`.
Optional: `currency` (KES only), `description`, `channelId`, `callbackUrl`.

**Channel** — `name`, `type` (`PAYBILL` \| `TILL_NUMBER` \| `SEND_MONEY`),
`shortcode`, optional `accountNumber`, `isDefault`.

**Top-up** — `amount` (KES), `phone`, optional `accountReference`,
`transactionDesc`; supports `Idempotency-Key`.

## Webhooks

Per-request `callbackUrl` (no global webhook setting). Payload:

```json
{
  "event": "transaction.updated",
  "event_type": "transaction.success",
  "transaction": {
    "id": "…", "type": "STK", "status": "SUCCESS",
    "amount": 1000, "currency": "KES", "phone_number": "2547…",
    "mpesa_receipt": "LGR019G3J2", "result_code": "0",
    "result_desc": "…", "provider_request_id": "…", "provider_checkout_id": "…"
  }
}
```

`event_type` ∈ `transaction.success` · `transaction.failed` · `transaction.cancelled` · `transaction.expired`.

There is **no signature header** — the payload is validated by matching
`transaction.id` against our own record. Delivery is retried 5× (10 s, 30 s,
1 m, 2 m, 5 m), so the handler is idempotent on `transaction.id` and returns
`200` before any settlement work completes.

## Our mapping

| Platform action | PalPluss call |
|---|---|
| Deposit (M-Pesa) | `POST /payments/stk` with `amount = usd × depositRate` |
| Deposit status fallback | `GET /transactions/{providerTransactionId}` (throttled to 10 s) |
| Withdrawal approval | `POST /b2c/payouts` with `amount = usd × withdrawRate` |
| Withdrawal settled | `transaction.success` → `COMPLETED` + `mpesa_receipt` |
| Withdrawal failed | `transaction.failed`/`reversed` → `DECLINED` + auto-refund |
| Admin wallet widget | `GET /wallets/service/balance` |
| Admin top-up | `POST /wallets/service/topups` |
| Channels manager | `/payment-wallet/channels` CRUD |

Ledger stays in USD. KES amounts are stored per transaction in
`gatewayAmount`/`gatewayCurrency`, and the exchange rate is admin-editable.

## Operational limits

- 60 requests/minute per key (`x-ratelimit-*` headers, `Retry-After` on 429).
- Fees are charged from the service wallet at initiation and are not refunded
  when a payment fails.
- B2C requires KYC approval (`403 KYC_NOT_VERIFIED`).
- Callback URLs must be public HTTPS — use ngrok/tunnel in local development
  and set `PUBLIC_URL`.
- PalPluss states it has no sandbox in the Going Live guide, but the OpenAPI
  spec publishes a sandbox host; the Live/Sandbox toggle switches between them.
