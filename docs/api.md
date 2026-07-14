# API reference

Interactive OpenAPI docs are served at `GET /docs` (Swagger UI) on any running instance. This page
is the quick-reference version; a matching Postman collection is at
[`postman/unified-sync-platform.postman_collection.json`](../postman/unified-sync-platform.postman_collection.json).

All responses include a `correlationId` (also echoed as the `x-correlation-id` response header) —
pass your own `x-correlation-id` request header to thread a trace across your own systems.

## Health & readiness

| Method | Path                | Auth | Notes                                                                   |
| ------ | ------------------- | ---- | ----------------------------------------------------------------------- |
| GET    | `/health`           | none | Liveness — always 200 once the process is up. Never touches the DB.     |
| GET    | `/ready`            | none | Readiness — runs `SELECT 1`; 503 if the database is unreachable.        |
| GET    | `/providers/health` | none | Calls `.health()` on every registered provider adapter (real API ping). |
| GET    | `/metrics`          | none | Prometheus text exposition format.                                      |

## Revenue metrics

All four share one query contract and one implementation (`RevenueCalculator.calculate`; see
[ADR 0007](adr/0007-revenue-single-source-of-truth-enforcement.md)).

| Method | Path                       | Query params                                                   |
| ------ | -------------------------- | -------------------------------------------------------------- |
| GET    | `/metrics/revenue`         | `from`, `to` (ISO 8601, both optional — default: last 30 days) |
| GET    | `/metrics/revenue/daily`   | same, bucketed by day                                          |
| GET    | `/metrics/revenue/weekly`  | same, bucketed by ISO week                                     |
| GET    | `/metrics/revenue/monthly` | same, bucketed by calendar month                               |

Example:

```
GET /metrics/revenue/daily?from=2026-01-01&to=2026-02-01
```

```json
{
  "range": { "start": "2026-01-01T00:00:00.000Z", "end": "2026-02-01T00:00:00.000Z" },
  "granularity": "day",
  "buckets": [
    {
      "bucketStart": "2026-01-05T00:00:00.000Z",
      "bucketEnd": "2026-01-06T00:00:00.000Z",
      "totalsByCurrency": [{ "currency": "USD", "amountMinor": 250000, "paymentCount": 3 }]
    }
  ],
  "warnings": [{ "provider": "hubspot", "rawStatus": "chargeback_pending_review", "count": 2 }]
}
```

`warnings` lists raw provider statuses with no configured mapping — these are **never** included
in `totalsByCurrency`.

## Sync control

| Method | Path             | Auth               | Notes                                                                                                                                                                                  |
| ------ | ---------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/sync/trigger`  | `x-api-key` header | Body: `{ "provider"?: string, "entityType"?: string }` (both optional — omit to sync every registered provider). Optional `Idempotency-Key` header makes retried client requests safe. |
| GET    | `/sync/status`   | none               | Current `sync_metadata` snapshot per provider/entityType.                                                                                                                              |
| GET    | `/sync/jobs`     | none               | Recent `job_history` rows. `?limit=` (default 50).                                                                                                                                     |
| GET    | `/sync/failures` | none               | Recent `failure_logs` rows. `?limit=` (default 50).                                                                                                                                    |

```
POST /sync/trigger
x-api-key: <ADMIN_API_KEY>
Idempotency-Key: 2026-07-13-manual-trigger-1
Content-Type: application/json

{ "provider": "stripe" }
```

## Webhooks

| Method | Path                        | Verification                                                                                                                               |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/webhooks/stripe`          | `Stripe-Signature` header, HMAC over the raw body (`STRIPE_WEBHOOK_SECRET`).                                                               |
| POST   | `/webhooks/hubspot`         | `X-HubSpot-Signature-v3` + `X-HubSpot-Request-Timestamp` headers (`HUBSPOT_WEBHOOK_CLIENT_SECRET`), rejects requests older than 5 minutes. |
| POST   | `/webhooks/google-calendar` | `X-Goog-Channel-Token` header must match `GOOGLE_WEBHOOK_CHANNEL_TOKEN`.                                                                   |

Every webhook route always returns `200` once signature verification passes (even on internal
processing failure) — the provider's own retry semantics are respected via the
duplicate/idempotency ledger instead of relying on HTTP status to signal "try again"; see
`WebhookIngestionService` and [ADR 0005](adr/0005-stripe-incremental-strategy.md).

## Error responses

Every error follows the same shape:

```json
{ "error": "validation_error", "message": "Request validation failed", "correlationId": "01H..." }
```

| `error`            | Status | Meaning                                                                       |
| ------------------ | ------ | ----------------------------------------------------------------------------- |
| `validation_error` | 400    | Zod schema or query/body validation failed.                                   |
| `request_error`    | varies | Domain-level `HttpError` (e.g. unknown provider filter).                      |
| `not_found`        | 404    | Unknown route.                                                                |
| `internal_error`   | 500    | Unexpected error — message is redacted in production (`NODE_ENV=production`). |
