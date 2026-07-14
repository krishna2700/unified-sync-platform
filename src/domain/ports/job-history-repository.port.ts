import type { EntityType } from '../value-objects/entity-type.js';
import type { ProviderId } from '../value-objects/provider.js';
import type { SyncMode, SyncRunStatus } from './sync-metadata-repository.port.js';

export interface JobHistoryStart {
  jobId: string;
  provider: ProviderId;
  entityType: EntityType;
  mode: SyncMode;
  startedAt: Date;
}

export interface JobHistoryFinish {
  jobId: string;
  outcome: Exclude<SyncRunStatus, 'in_progress'>;
  finishedAt: Date;
  recordsFetched: number;
  recordsUpserted: number;
  recordsFailed: number;
  errorSummary: string | null;
}

export interface JobHistoryEntry extends JobHistoryStart, Partial<Omit<JobHistoryFinish, 'jobId'>> {
  id: string;
}

/** Append-only audit trail of every sync job execution — the source of truth for "job history". */
export interface JobHistoryRepository {
  start(entry: JobHistoryStart): Promise<void>;
  finish(result: JobHistoryFinish): Promise<void>;
  list(filter?: {
    provider?: ProviderId;
    entityType?: EntityType;
    limit?: number;
  }): Promise<JobHistoryEntry[]>;
}
