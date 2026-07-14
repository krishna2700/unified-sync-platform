import type { EntityType } from '../../domain/value-objects/entity-type.js';
import type { ProviderId } from '../../domain/value-objects/provider.js';
import type { SyncMode, SyncRunStatus } from '../../domain/ports/sync-metadata-repository.port.js';

export interface SyncRunResult {
  provider: ProviderId;
  entityType: EntityType;
  jobId: string;
  mode: SyncMode;
  outcome: Exclude<SyncRunStatus, 'in_progress'> | 'skipped';
  recordsFetched: number;
  recordsUpserted: number;
  recordsFailed: number;
  fellBackToFull: boolean;
  startedAt: Date;
  finishedAt: Date;
  error: string | null;
}
