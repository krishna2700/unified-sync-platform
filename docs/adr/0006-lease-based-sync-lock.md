# ADR 0006: Lease-based lock instead of Postgres advisory locks

## Status

Accepted

## Context

The assignment requires safe concurrent execution: two overlapping triggers for the same
(provider, entityType) — a scheduled tick and a manual `/sync/trigger` call, or two worker
replicas — must never race on the same cursor. Postgres advisory locks
(`pg_advisory_lock`/`pg_try_advisory_lock`) are the textbook tool for this, but they are
**session-scoped**: the lock is tied to the specific database connection that acquired it. Prisma
manages a connection pool, so a `tryAcquire()` call and a later `release()` call are not
guaranteed to run on the same underlying connection — a lock acquired on connection A could never
be released by a `release()` that happens to run on connection B, since Postgres correctly refuses
to unlock a session-scoped lock it doesn't hold.

Wrapping the entire acquire → sync-work → release sequence in one long-lived `$transaction`
(to guarantee connection affinity, using transaction-scoped `pg_try_advisory_xact_lock`) would
hold a database transaction open for the full duration of external API calls — potentially
minutes — which risks connection-pool exhaustion and idle-in-transaction timeouts.

## Decision

Use a plain row + expiring lease instead (`sync_locks` table), acquired via a single atomic
`INSERT ... ON CONFLICT (provider, entity_type) DO UPDATE ... WHERE locked_at < now() - lease
RETURNING provider`. This is a standard compare-and-swap pattern that works correctly regardless
of which pooled connection executes it, because the "who holds the lock" state lives in a row, not
in Postgres session state.

A lease also solves a second problem for free: if the process holding the lock crashes without
calling `release()`, a session-scoped advisory lock would stay held until that connection closes
(which may never happen cleanly in a crash), deadlocking all future syncs for that
(provider, entityType) forever. A lease simply expires.

## Consequences

- Lease duration is a property of whoever _checks_ expiry, not stored per-row. Every
  `PrismaSyncLock` instance in one deployment is constructed with the same configured duration, so
  this never causes disagreement in practice — but it's worth knowing this is a caller-side
  parameter, not encoded in the lock row itself (caught by an integration test during development;
  see the test file's comments for the scenario that revealed this).
- A lease that's too short could theoretically let two syncs overlap if one run legitimately takes
  longer than the configured lease; the default (15 minutes) is chosen to comfortably exceed any
  expected single-provider sync duration on the data volumes this project targets.
