import type { CanonicalRecord } from '../entities/index.js';
import type { EntityType } from '../value-objects/entity-type.js';
import type { ProviderId } from '../value-objects/provider.js';
import type { SyncCursor } from '../value-objects/sync-cursor.js';

export interface ProviderHealth {
  healthy: boolean;
  message?: string;
  checkedAt: Date;
}

export interface ProviderFetchResult<TRaw> {
  records: TRaw[];
  /**
   * Opaque token to pass back into the *same* fetch method to continue paginating within this
   * run. Distinct from `nextCursor`: a provider may need several pages to drain one incremental
   * catch-up or one full backfill, but only knows a durable resumable watermark once it reaches
   * the last page (e.g. Google Calendar hands back `nextPageToken` on every page but
   * `nextSyncToken` only on the final one).
   */
  nextPageToken: string | null;
  /**
   * Durable, resumable watermark for the *next run's* incremental sync. Null on any page where
   * the provider cannot yet vouch for a stable resume point (typically every page except the
   * last one in a paginated response).
   */
  nextCursor: SyncCursor | null;
  hasMore: boolean;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * The one interface the sync engine programs against. It is intentionally ignorant of
 * HubSpot/Google/Stripe — every provider-specific concept (pagination style, cursor format,
 * field names, rate-limit headers) is fully absorbed by the adapter that implements this.
 *
 * `saveCursor` is deliberately NOT part of this interface (unlike the naive sketch some specs
 * propose): persistence is a cross-cutting concern owned by the sync engine + repositories so
 * that cursor-write and record-write can be committed in one atomic transaction. A provider
 * adapter that persisted its own cursor could leave the cursor pointing past data that failed
 * to save — silent data loss. See docs/adr/0003-cursor-persistence-ownership.md.
 */
export interface SyncProvider<TRaw = unknown> {
  readonly providerId: ProviderId;
  readonly entityType: EntityType;

  /** `pageToken` is null on the first call of a run and thereafter is the previous
   * result's `nextPageToken`, so a single incremental catch-up can span multiple pages. */
  fetchIncremental(
    cursor: SyncCursor,
    pageToken: string | null,
  ): Promise<ProviderFetchResult<TRaw>>;
  fetchFull(pageToken: string | null): Promise<ProviderFetchResult<TRaw>>;
  normalize(raw: TRaw): CanonicalRecord;
  validate(record: CanonicalRecord): ValidationResult;
  health(): Promise<ProviderHealth>;
}
