# ADR 0002: Database schema design decisions

## Status

Accepted

## Context

The schema must support idempotent multi-provider sync, incremental + full backfill, webhook
dedup, audit trails, and a revenue engine that scales to millions of rows — while staying easy to
extend with new providers.

## Decisions

### `provider` is `TEXT` + FK to a `providers` reference table, not a Postgres enum

A native enum requires an `ALTER TYPE ... ADD VALUE` migration (and in older Postgres versions,
outside a transaction) every time a new provider is onboarded. A reference table turns "add a
provider" into a single `INSERT` — no migration, no deploy. `entity_type` stays a plain
`TEXT` + CHECK on a small, genuinely fixed vocabulary (contact/deal/event/payment) because adding
a new _kind_ of entity always requires new canonical-entity code anyway, so a migration is
proportionate there.

### Every canonical table has `UNIQUE(provider, source_id)`

This is the actual idempotency mechanism — not the sync engine's bookkeeping, which is only
descriptive. Two concurrent writers, a retried job, or a replayed webhook all converge on the same
row because the database — not application logic — refuses a second row for the same source
record. `docs/adr/0003` explains why this must be paired with atomic cursor advancement.

### Money is `amount_minor BIGINT` + `currency CHAR(3)`, never `NUMERIC`/`FLOAT`

Floating point cannot represent currency exactly; even Postgres's arbitrary-precision `NUMERIC`
adds needless complexity here since integer minor units (cents) are simpler and exactly what every
payment provider's API already returns. `Money` (src/domain/value-objects/money.ts) is the single
choke point enforcing this.

### CHECK constraints are hand-added SQL, not PSL

Prisma Schema Language has no native CHECK constraint syntax as of Prisma 6. Rather than skip
constraints or duplicate them only in application code, `prisma migrate dev --create-only` is used
to generate the base DDL, and the CHECK statements are appended by hand to the resulting
`migration.sql` (see `prisma/migrations/20260713152316_init/migration.sql`). This keeps the schema
file as the structural source of truth while the migration is the constraint source of truth — a
documented one-time cost, not a recurring one, since future models can follow the same pattern.

### `sync_metadata` (current-state) is separate from `job_history` (append-only log)

A provider-health dashboard needs "what's the status right now" in O(1) without scanning history;
an audit trail needs every run ever recorded. Overloading one table for both would mean either
scanning history for a dashboard query or losing history to keep the dashboard table small.

### `sync_locks` is a lease-based row, not a Postgres advisory lock

See ADR 0006.

### `webhook_events` and `idempotency_keys` are two separate tables

`webhook_events` is specific to inbound provider deliveries (keyed by a provider-derived
idempotency key, storing the full payload for replay/debugging). `idempotency_keys` is generic,
usable by any client-initiated mutating endpoint (used today by `POST /sync/trigger`'s
`Idempotency-Key` header support). Merging them would force one schema to serve two different
audit/replay needs.

### `canonical_record_audit` records every create/update, separate from `raw` JSONB columns

Each canonical table already stores the untouched provider payload in a `raw` JSONB column for
debugging a single record. `canonical_record_audit` is the append-only _history_ of normalized
snapshots over time — the "what did this record look like when it changed" trail, which the
per-row `raw` column alone can't answer once a later sync overwrites it.

## Consequences

- Every canonical table repeats a similar shape (`provider`, `source_id`, `source_created_at`,
  `source_updated_at`, `synced_at`, `raw`). This is deliberate repetition over a premature "generic
  entity" abstraction — four concrete Prisma models are easier to reason about, index, and query
  than one polymorphic table with a JSON blob for type-specific fields.
- Adding a genuinely new canonical entity kind (e.g. "invoices") still requires a migration plus a
  new domain entity, port implementation, and repository method — an accepted, proportionate cost.
