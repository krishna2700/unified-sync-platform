export const SYNC_QUEUE_NAME = 'sync-jobs';
export const SYNC_ALL_JOB_NAME = 'sync-all';
export const SYNC_SCHEDULER_ID = 'sync-all-providers-schedule';

/** The job carries no provider-specific data — the worker always re-reads the current
 * ProviderRegistry, so adding/removing a provider never requires touching queued jobs. */
export interface SyncAllJobData {
  triggeredBy: 'schedule' | 'manual';
}
