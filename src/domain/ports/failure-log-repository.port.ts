import type { EntityType } from '../value-objects/entity-type.js';
import type { ProviderId } from '../value-objects/provider.js';

export interface FailureLogEntry {
  id?: string;
  provider: ProviderId;
  entityType: EntityType | null;
  jobId: string | null;
  errorCode: string;
  message: string;
  context: Record<string, unknown>;
  occurredAt: Date;
}

export interface FailureLogRepository {
  record(entry: FailureLogEntry): Promise<void>;
  listRecent(limit: number): Promise<FailureLogEntry[]>;
}
