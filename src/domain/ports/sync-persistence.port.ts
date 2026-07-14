import type { CanonicalRecord } from '../entities/index.js';
import type { EntityType } from '../value-objects/entity-type.js';
import type { ProviderId } from '../value-objects/provider.js';
import type { SyncCursor } from '../value-objects/sync-cursor.js';

export interface UpsertSummary {
  created: number;
  updated: number;
  unchanged: number;
}

/**
 * Persists a fetched batch and advances the cursor atomically. This is the idempotency and
 * data-safety boundary of the whole pipeline: the infra implementation wraps both operations in
 * a single DB transaction so a crash between "save records" and "save cursor" is impossible —
 * either both happen or neither does, so a retried run either re-processes the same batch
 * (safe, because upserts are keyed on (provider, entityType, sourceId)) or picks up the new
 * cursor with the records already durably saved.
 */
export interface SyncPersistencePort {
  persistBatch(params: {
    provider: ProviderId;
    entityType: EntityType;
    records: CanonicalRecord[];
    newCursor: SyncCursor | null;
  }): Promise<UpsertSummary>;
}
