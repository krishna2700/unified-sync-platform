import { Queue, Worker } from 'bullmq';
import closeWithGrace from 'close-with-grace';
import { buildCompositionRoot } from '../api/composition-root.js';
import { disconnectPrisma } from '../infrastructure/db/prisma-client.js';
import { parseRedisConnectionOptions } from '../infrastructure/queue/redis-connection.js';
import {
  SYNC_ALL_JOB_NAME,
  SYNC_QUEUE_NAME,
  SYNC_SCHEDULER_ID,
  type SyncAllJobData,
} from '../infrastructure/queue/sync-queue.js';

/**
 * Standalone background worker process (run separately from the API: `npm run worker:dev` /
 * a second Render service in production). It owns the recurring "poll every provider" tick;
 * the API's `POST /sync/trigger` remains a synchronous on-demand path for manual/admin use.
 * Both ultimately call the same `SyncEngine.run`, so there is exactly one sync code path either
 * way — this file is scheduling plumbing, not business logic.
 */
async function main(): Promise<void> {
  const root = await buildCompositionRoot();
  const connection = parseRedisConnectionOptions(root.env.REDIS_URL);

  const queue = new Queue<SyncAllJobData>(SYNC_QUEUE_NAME, { connection });
  await queue.upsertJobScheduler(
    SYNC_SCHEDULER_ID,
    { every: root.env.SYNC_SCHEDULE_INTERVAL_MS },
    { name: SYNC_ALL_JOB_NAME, data: { triggeredBy: 'schedule' } },
  );

  const worker = new Worker<SyncAllJobData>(
    SYNC_QUEUE_NAME,
    async (job) => {
      const providers = root.providerRegistry.all();
      if (providers.length === 0) {
        root.logger.warn(
          'Background sync tick skipped: no providers registered (check credentials)',
        );
        return { results: [] };
      }

      root.logger.info('Background sync tick starting', {
        jobId: job.id,
        providerCount: providers.length,
      });
      const results = await root.syncEngine.runMany(providers);
      root.logger.info('Background sync tick finished', {
        jobId: job.id,
        outcomes: results.map((r) => ({
          provider: r.provider,
          entityType: r.entityType,
          outcome: r.outcome,
        })),
      });
      return { results };
    },
    { connection, concurrency: root.env.SYNC_JOB_CONCURRENCY },
  );

  worker.on('failed', (job, error) => {
    root.logger.error('Background sync job failed', { jobId: job?.id, error: error.message });
  });

  closeWithGrace({ delay: 10_000 }, async ({ err }) => {
    if (err) {
      root.logger.error('Worker shutting down due to unhandled error', { error: err.message });
    } else {
      root.logger.info('Worker shutting down gracefully');
    }
    await worker.close();
    await queue.close();
    await disconnectPrisma();
  });

  root.logger.info('Sync worker started', {
    queue: SYNC_QUEUE_NAME,
    intervalMs: root.env.SYNC_SCHEDULE_INTERVAL_MS,
    concurrency: root.env.SYNC_JOB_CONCURRENCY,
  });
}

main().catch((error: unknown) => {
  console.error('Fatal worker startup error:', error);
  process.exit(1);
});
