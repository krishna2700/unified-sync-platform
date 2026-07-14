import type { ProviderId } from '../value-objects/provider.js';

/**
 * Fields every canonical entity carries regardless of source system. `sourceUpdatedAt` is what
 * incremental sync watermarks and conflict resolution key off; `raw` retains the untouched
 * provider payload for audit/debugging without polluting the typed canonical fields.
 */
export interface CanonicalRecordBase {
  /** Internal identity, assigned by the repository on first persistence. Null for a freshly normalized record. */
  id: string | null;
  provider: ProviderId;
  /** The id of this record inside the external system. Unique per (provider, entityType). */
  sourceId: string;
  sourceCreatedAt: Date | null;
  sourceUpdatedAt: Date | null;
  /** Set by the sync engine at persistence time, not by the provider adapter. */
  syncedAt: Date | null;
  raw: Record<string, unknown>;
}
