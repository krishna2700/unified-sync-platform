import type { EntityType } from '../value-objects/entity-type.js';
import type { ProviderId } from '../value-objects/provider.js';

export const SyncRunStatus = {
  SUCCESS: 'success',
  PARTIAL_FAILURE: 'partial_failure',
  FAILED: 'failed',
  IN_PROGRESS: 'in_progress',
} as const;
export type SyncRunStatus = (typeof SyncRunStatus)[keyof typeof SyncRunStatus];

export const SyncMode = {
  INCREMENTAL: 'incremental',
  FULL: 'full',
} as const;
export type SyncMode = (typeof SyncMode)[keyof typeof SyncMode];

/**
 * Current-state snapshot per (provider, entityType), updated in place. This is distinct from
 * JobHistoryRepository (an append-only log of every run): SyncMetadataRepository answers
 * "what's the health of this provider right now" in O(1) without scanning history, which is
 * what a provider-health dashboard needs.
 */
export interface SyncMetadataSnapshot {
  provider: ProviderId;
  entityType: EntityType;
  lastSyncStatus: SyncRunStatus;
  lastSyncMode: SyncMode;
  lastSyncStartedAt: Date | null;
  lastSyncCompletedAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
  consecutiveFailureCount: number;
  recordsProcessedLastRun: number;
}

export interface SyncMetadataRepository {
  get(provider: ProviderId, entityType: EntityType): Promise<SyncMetadataSnapshot | null>;
  upsert(snapshot: SyncMetadataSnapshot): Promise<void>;
  listAll(): Promise<SyncMetadataSnapshot[]>;
}
