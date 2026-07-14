# ADR 0003: Cursor persistence ownership

## Status

Accepted

## Context

A naive `SyncProvider` interface (as sketched informally in some spec drafts) includes a
`saveCursor()` method, implying the provider adapter itself writes the cursor. If a provider
adapter persists its own cursor independently of the record writes, a crash between "save
records" and "save cursor" can leave the cursor pointing past data that was never actually
persisted — the exact "silently lose data" failure mode the assignment explicitly forbids.

## Decision

`SyncProvider` (`src/domain/ports/sync-provider.port.ts`) has no `saveCursor` method at all.
Instead, `SyncPersistencePort.persistBatch()` accepts both the batch of canonical records _and_
the new cursor, and its Prisma implementation (`PrismaSyncPersistence`) wraps both writes in a
single `$transaction`. Either both the records and the new cursor commit, or neither does.

A retried run after a crash therefore either:

- re-processes the same batch against the _old_ cursor (safe: the `UNIQUE(provider, source_id)`
  constraint makes the re-upsert a no-op), or
- picks up the _new_ cursor with the records already durably saved (no work lost, no re-fetch
  needed).

There is no third case where the cursor advanced but the data didn't.

## Consequences

- The sync engine, not the adapter, owns when a cursor advances — adapters only report what a
  fetch call return (records + the cursor/page-token _candidates_), which keeps every adapter
  simpler and impossible to get this specific invariant wrong in.
- This does mean `SyncPersistencePort` is a slightly "thicker" port than a pure repository
  (it combines two concerns), which is a deliberate exception: the atomicity requirement can only
  be satisfied by combining them into one transactional unit.
