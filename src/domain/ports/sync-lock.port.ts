import type { EntityType } from '../value-objects/entity-type.js';
import type { ProviderId } from '../value-objects/provider.js';

/**
 * Per (provider, entityType) mutual-exclusion lock so two overlapping triggers (a cron tick and
 * a manual "sync now", or two worker replicas) can never run the same provider+entity sync at
 * once and race on the same cursor. Implemented in infra via a Postgres advisory lock
 * (`pg_try_advisory_lock`), which is automatically released if the process crashes — no lock
 * ever gets stuck held forever by a dead process.
 */
export interface SyncLockPort {
  tryAcquire(provider: ProviderId, entityType: EntityType): Promise<boolean>;
  release(provider: ProviderId, entityType: EntityType): Promise<void>;
}
