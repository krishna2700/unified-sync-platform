# Sequence diagrams

## 1. Incremental sync, happy path

```mermaid
sequenceDiagram
    participant Trigger as Worker tick / POST /sync/trigger
    participant Engine as SyncEngine
    participant Lock as SyncLockPort
    participant Cursor as CursorRepository
    participant Provider as SyncProvider (e.g. Stripe)
    participant Retry as RetryPolicy
    participant Persist as SyncPersistencePort

    Trigger->>Engine: run(provider)
    Engine->>Lock: tryAcquire(provider, entityType)
    Lock-->>Engine: true
    Engine->>Cursor: get(provider, entityType)
    Cursor-->>Engine: cursor (not stale)
    Engine->>Retry: execute(fetchIncremental)
    Retry->>Provider: fetchIncremental(cursor, pageToken)
    Provider-->>Retry: { records, nextCursor, hasMore }
    Retry-->>Engine: fetch result
    Engine->>Engine: normalize() + validate() each record
    Engine->>Persist: persistBatch(records, newCursor)
    Note over Persist: single DB transaction —<br/>records + cursor commit atomically
    Persist-->>Engine: { created, updated, unchanged }
    Engine->>Engine: record job history + metadata + metrics
    Engine->>Lock: release(provider, entityType)
    Engine-->>Trigger: SyncRunResult { outcome: success }
```

## 2. Stale/rejected cursor → automatic full-backfill fallback

```mermaid
sequenceDiagram
    participant Engine as SyncEngine
    participant Provider as SyncProvider (Google Calendar)
    participant Cursor as CursorRepository

    Note over Engine: Proactive path
    Engine->>Engine: cursor.isStale(staleAfterMs)?
    alt cursor stale by policy
        Engine->>Engine: mode = FULL (skip fetchIncremental entirely)
    else cursor looks fresh
        Engine->>Provider: fetchIncremental(cursor, pageToken)
        Note over Provider: Reactive path
        Provider--xEngine: throws InvalidCursorError (HTTP 410 Gone)
        Engine->>Cursor: clear(provider, entityType)
        Engine->>Engine: mode = FULL, fellBackToFull = true
        Engine->>Provider: fetchFull(pageToken)
    end
    Provider-->>Engine: full-backfill records + eventual nextCursor
    Engine->>Engine: persist batch, cursor now rebuilt for next run
```

## 3. Webhook delivery: duplicate-safe processing

```mermaid
sequenceDiagram
    participant Stripe
    participant Route as POST /webhooks/stripe
    participant Ingest as WebhookIngestionService
    participant Events as WebhookEventRepository
    participant Persist as SyncPersistencePort

    Stripe->>Route: event (signed)
    Route->>Route: verify Stripe-Signature (raw body HMAC)
    Route->>Ingest: ingest({ idempotencyKey: "stripe:evt_123", process })
    Ingest->>Events: recordIfNew(event)
    Events-->>Ingest: 'inserted' (first delivery)
    Ingest->>Ingest: process() → normalize + persist
    Ingest->>Persist: persistBatch([payment], null)
    Ingest->>Events: markProcessed('processed')
    Ingest-->>Route: { outcome: 'processed' }
    Route-->>Stripe: 200 OK

    Note over Stripe,Route: Stripe redelivers the same event (network blip, retry policy)
    Stripe->>Route: same event again
    Route->>Ingest: ingest({ idempotencyKey: "stripe:evt_123", process })
    Ingest->>Events: recordIfNew(event)
    Events-->>Ingest: 'duplicate' (UNIQUE constraint hit)
    Ingest->>Events: getProcessingStatus("stripe:evt_123")
    Events-->>Ingest: 'processed'
    Ingest-->>Route: { outcome: 'duplicate_skipped' } — process() never runs again
    Route-->>Stripe: 200 OK
```

## 4. Revenue query — the same method behind every endpoint

```mermaid
sequenceDiagram
    participant Client
    participant Route as GET /metrics/revenue/{total,daily,weekly,monthly}
    participant Calc as RevenueCalculator
    participant Repo as RevenueRepository (Prisma, raw SQL)

    Client->>Route: GET /metrics/revenue/daily?from=...&to=...
    Route->>Route: parse+validate query → DateRange
    Route->>Calc: calculate(range, granularity='day')
    Calc->>Repo: aggregate({ range, granularity, collectedStatuses: [COLLECTED] })
    Repo-->>Calc: buckets (SUM/GROUP BY date_trunc, per currency)
    Calc->>Repo: findUnknownStatuses(range)
    Repo-->>Calc: warnings (unmapped raw statuses, never counted)
    Calc-->>Route: RevenueReport { buckets, warnings }
    Route-->>Client: 200 { range, granularity, buckets, warnings }
```
