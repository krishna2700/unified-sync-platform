import { ulid } from 'ulid';
import type { CanonicalRecord } from '../../domain/entities/index.js';
import {
  isSyncProviderError,
  MalformedResponseError,
  type SyncProviderError,
} from '../../domain/errors/sync-errors.js';
import type { Clock } from '../../domain/ports/clock.port.js';
import type { CursorRepository } from '../../domain/ports/cursor-repository.port.js';
import type { FailureLogRepository } from '../../domain/ports/failure-log-repository.port.js';
import type { JobHistoryRepository } from '../../domain/ports/job-history-repository.port.js';
import type { Logger } from '../../domain/ports/logger.port.js';
import { type Metrics, NoopMetrics } from '../../domain/ports/metrics.port.js';
import type { ProviderFetchResult, SyncProvider } from '../../domain/ports/sync-provider.port.js';
import type { SyncLockPort } from '../../domain/ports/sync-lock.port.js';
import type {
  SyncMetadataRepository,
  SyncMode,
} from '../../domain/ports/sync-metadata-repository.port.js';
import {
  SyncMode as SyncModeEnum,
  SyncRunStatus,
} from '../../domain/ports/sync-metadata-repository.port.js';
import type { SyncPersistencePort } from '../../domain/ports/sync-persistence.port.js';
import type { SyncCursor } from '../../domain/value-objects/sync-cursor.js';
import type { RetryPolicy } from './retry-policy.js';
import type { SyncRunResult } from './sync-run-result.js';

export interface SyncEngineConfig {
  /** A cursor untouched longer than this is treated as stale even if the provider hasn't said so. */
  cursorStaleAfterMs: number;
  /** Safety cap on pages drained per run, so a provider bug returning hasMore:true forever can
   * never hang a job indefinitely. */
  maxPagesPerRun: number;
}

export interface SyncEngineDeps {
  cursorRepository: CursorRepository;
  syncPersistence: SyncPersistencePort;
  syncMetadataRepository: SyncMetadataRepository;
  jobHistoryRepository: JobHistoryRepository;
  failureLogRepository: FailureLogRepository;
  syncLock: SyncLockPort;
  retryPolicy: RetryPolicy;
  clock: Clock;
  logger: Logger;
  config: SyncEngineConfig;
  idGenerator?: () => string;
  metrics?: Metrics;
}

/**
 * Orchestrates one (provider, entityType) sync run end to end: decides incremental vs. full,
 * paginates, normalizes/validates each record, persists atomically with the cursor, and records
 * job history / sync metadata / failure logs. It knows nothing about HubSpot, Google, or Stripe —
 * everything provider-specific is behind the `SyncProvider` port.
 *
 * Never throws out of `run()` — every failure mode (provider error, normalize bug, persistence
 * error) is caught, logged, and turned into a `SyncRunResult`, because one provider's outage must
 * never stop the others (see `runMany`).
 */
export class SyncEngine {
  private readonly deps: SyncEngineDeps;
  private readonly metrics: Metrics;

  constructor(deps: SyncEngineDeps) {
    this.deps = deps;
    this.metrics = deps.metrics ?? new NoopMetrics();
  }

  async runMany(providers: SyncProvider[]): Promise<SyncRunResult[]> {
    const results: SyncRunResult[] = [];
    for (const provider of providers) {
      // Sequential by design: providers are independent, but running them one at a time keeps
      // resource usage and provider rate-limit exposure predictable on a free-tier deployment.
      // Concurrency across providers can be added later by mapping with p-limit; nothing about
      // this loop's isolation guarantee depends on being sequential.
      results.push(await this.run(provider));
    }
    return results;
  }

  async run(provider: SyncProvider): Promise<SyncRunResult> {
    const { clock, logger, syncLock, jobHistoryRepository } = this.deps;
    const jobId = (this.deps.idGenerator ?? ulid)();
    const log = logger.child({
      jobId,
      provider: provider.providerId,
      entityType: provider.entityType,
    });
    const startedAt = clock.now();

    let mode: SyncMode = SyncModeEnum.INCREMENTAL;

    const acquired = await syncLock.tryAcquire(provider.providerId, provider.entityType);
    if (!acquired) {
      log.info('Skipping run: another sync for this provider/entity is already in progress');
      return {
        provider: provider.providerId,
        entityType: provider.entityType,
        jobId,
        mode: SyncModeEnum.INCREMENTAL,
        outcome: 'skipped',
        recordsFetched: 0,
        recordsUpserted: 0,
        recordsFailed: 0,
        fellBackToFull: false,
        startedAt,
        finishedAt: clock.now(),
        error: null,
      };
    }

    try {
      const existingCursor = await this.deps.cursorRepository.get(
        provider.providerId,
        provider.entityType,
      );
      const cursorUsable =
        existingCursor !== null &&
        !existingCursor.isStale(this.deps.config.cursorStaleAfterMs, startedAt);
      mode = cursorUsable ? SyncModeEnum.INCREMENTAL : SyncModeEnum.FULL;
      if (existingCursor && !cursorUsable) {
        log.warn('Cursor is stale or expired; falling back to full backfill', {
          issuedAt: existingCursor.issuedAt.toISOString(),
          expiresAt: existingCursor.expiresAt?.toISOString() ?? null,
        });
      }

      await jobHistoryRepository.start({
        jobId,
        provider: provider.providerId,
        entityType: provider.entityType,
        mode,
        startedAt,
      });

      const drainResult = await this.drain(provider, mode, existingCursor, log, jobId);

      const outcome: Exclude<SyncRunStatus, 'in_progress'> =
        drainResult.recordsFailed === 0
          ? SyncRunStatus.SUCCESS
          : drainResult.recordsUpserted > 0
            ? SyncRunStatus.PARTIAL_FAILURE
            : SyncRunStatus.FAILED;
      const finishedAt = clock.now();

      await jobHistoryRepository.finish({
        jobId,
        outcome,
        finishedAt,
        recordsFetched: drainResult.recordsFetched,
        recordsUpserted: drainResult.recordsUpserted,
        recordsFailed: drainResult.recordsFailed,
        errorSummary: null,
      });
      await this.upsertMetadataSnapshot(
        provider,
        mode,
        outcome,
        startedAt,
        finishedAt,
        drainResult.recordsUpserted,
      );

      log.info('Sync run finished', { outcome, ...drainResult, mode: drainResult.finalMode });
      this.metrics.recordSyncDuration(
        {
          provider: provider.providerId,
          entityType: provider.entityType,
          mode: drainResult.finalMode,
          outcome,
        },
        (finishedAt.getTime() - startedAt.getTime()) / 1000,
      );

      return {
        provider: provider.providerId,
        entityType: provider.entityType,
        jobId,
        mode: drainResult.finalMode,
        outcome,
        recordsFetched: drainResult.recordsFetched,
        recordsUpserted: drainResult.recordsUpserted,
        recordsFailed: drainResult.recordsFailed,
        fellBackToFull: drainResult.fellBackToFull,
        startedAt,
        finishedAt,
        error: null,
      };
    } catch (error) {
      // Last line of defense: whatever went wrong, this provider fails in isolation. The
      // pipeline as a whole (runMany) continues to the next provider unaffected.
      const finishedAt = clock.now();
      const message = error instanceof Error ? error.message : String(error);
      const errorCode = isSyncProviderError(error) ? error.code : 'UNEXPECTED_ERROR';
      log.error('Sync run failed', { error: message });

      await this.deps.failureLogRepository.record({
        provider: provider.providerId,
        entityType: provider.entityType,
        jobId,
        errorCode,
        message,
        context: isSyncProviderError(error) ? error.toLogContext() : {},
        occurredAt: finishedAt,
      });
      this.metrics.incrementFailure({
        provider: provider.providerId,
        entityType: provider.entityType,
        errorCode,
      });
      this.metrics.recordSyncDuration(
        {
          provider: provider.providerId,
          entityType: provider.entityType,
          mode,
          outcome: SyncRunStatus.FAILED,
        },
        (finishedAt.getTime() - startedAt.getTime()) / 1000,
      );
      await jobHistoryRepository.finish({
        jobId,
        outcome: SyncRunStatus.FAILED,
        finishedAt,
        recordsFetched: 0,
        recordsUpserted: 0,
        recordsFailed: 0,
        errorSummary: message,
      });
      await this.upsertMetadataSnapshot(
        provider,
        mode,
        SyncRunStatus.FAILED,
        startedAt,
        finishedAt,
        0,
      );

      return {
        provider: provider.providerId,
        entityType: provider.entityType,
        jobId,
        mode,
        outcome: SyncRunStatus.FAILED,
        recordsFetched: 0,
        recordsUpserted: 0,
        recordsFailed: 0,
        fellBackToFull: false,
        startedAt,
        finishedAt,
        error: message,
      };
    } finally {
      await syncLock.release(provider.providerId, provider.entityType);
    }
  }

  private async drain(
    provider: SyncProvider,
    initialMode: SyncMode,
    initialCursor: SyncCursor | null,
    log: Logger,
    jobId: string,
  ): Promise<{
    recordsFetched: number;
    recordsUpserted: number;
    recordsFailed: number;
    fellBackToFull: boolean;
    finalMode: SyncMode;
  }> {
    let mode = initialMode;
    let cursor = initialMode === SyncModeEnum.INCREMENTAL ? initialCursor : null;
    let pageToken: string | null = null;
    let hasMore = true;
    let fellBackToFull = false;
    let recordsFetched = 0;
    let recordsUpserted = 0;
    let recordsFailed = 0;
    let pages = 0;

    while (hasMore && pages < this.deps.config.maxPagesPerRun) {
      pages++;
      let fetchResult: ProviderFetchResult<unknown>;
      try {
        fetchResult = await this.deps.retryPolicy.execute(
          () =>
            mode === SyncModeEnum.INCREMENTAL
              ? provider.fetchIncremental(cursor as SyncCursor, pageToken)
              : provider.fetchFull(pageToken),
          { provider: provider.providerId, entityType: provider.entityType, operation: 'fetch' },
        );
      } catch (error) {
        if (
          mode === SyncModeEnum.INCREMENTAL &&
          isSyncProviderError(error) &&
          error.flags.requiresFullResync
        ) {
          log.warn(
            'Incremental cursor rejected by provider; falling back to full backfill',
            error.toLogContext(),
          );
          await this.deps.cursorRepository.clear(provider.providerId, provider.entityType);
          mode = SyncModeEnum.FULL;
          cursor = null;
          pageToken = null;
          fellBackToFull = true;
          pages--; // this attempt produced no page; don't count it against the safety cap
          continue;
        }
        throw error;
      }

      recordsFetched += fetchResult.records.length;
      const { valid, failed } = this.normalizeAndValidate(
        provider,
        fetchResult.records,
        log,
        jobId,
      );
      recordsFailed += failed;

      const summary = await this.deps.syncPersistence.persistBatch({
        provider: provider.providerId,
        entityType: provider.entityType,
        records: valid,
        newCursor: fetchResult.nextCursor,
      });
      recordsUpserted += summary.created + summary.updated;

      hasMore = fetchResult.hasMore;
      pageToken = fetchResult.nextPageToken;
      if (mode === SyncModeEnum.INCREMENTAL && fetchResult.nextCursor) {
        cursor = fetchResult.nextCursor;
      }
    }

    return { recordsFetched, recordsUpserted, recordsFailed, fellBackToFull, finalMode: mode };
  }

  private normalizeAndValidate(
    provider: SyncProvider,
    rawRecords: unknown[],
    log: Logger,
    jobId: string,
  ): { valid: CanonicalRecord[]; failed: number } {
    const valid: CanonicalRecord[] = [];
    let failed = 0;

    for (const raw of rawRecords) {
      let normalized: CanonicalRecord;
      try {
        normalized = provider.normalize(raw);
      } catch (error) {
        failed++;
        const malformed = new MalformedResponseError(
          error instanceof Error ? error.message : 'Failed to normalize provider record',
          provider.providerId,
          provider.entityType,
          error,
        );
        this.recordFailureFireAndForget(malformed, jobId, log, { raw });
        continue;
      }

      const validation = provider.validate(normalized);
      if (!validation.valid) {
        failed++;
        this.recordFailureFireAndForget(
          new MalformedResponseError(
            `Validation failed: ${validation.issues.map((i) => `${i.field}: ${i.message}`).join('; ')}`,
            provider.providerId,
            provider.entityType,
          ),
          jobId,
          log,
          { sourceId: normalized.sourceId, issues: validation.issues },
        );
        continue;
      }

      valid.push(normalized);
    }

    return { valid, failed };
  }

  /** Record-level failures must never abort the batch — logged best-effort, loop continues. */
  private recordFailureFireAndForget(
    error: SyncProviderError,
    jobId: string,
    log: Logger,
    extraContext: Record<string, unknown>,
  ): void {
    log.warn('Record-level failure during sync', { ...error.toLogContext(), ...extraContext });
    this.metrics.incrementFailure({
      provider: error.providerId,
      entityType: error.entityType,
      errorCode: error.code,
    });
    void this.deps.failureLogRepository
      .record({
        provider: error.providerId,
        entityType: error.entityType,
        jobId,
        errorCode: error.code,
        message: error.message,
        context: { ...error.toLogContext(), ...extraContext },
        occurredAt: this.deps.clock.now(),
      })
      .catch((persistError: unknown) => {
        log.error('Failed to persist failure log entry', {
          error: persistError instanceof Error ? persistError.message : String(persistError),
        });
      });
  }

  private async upsertMetadataSnapshot(
    provider: SyncProvider,
    mode: SyncMode,
    outcome: Exclude<SyncRunStatus, 'in_progress'>,
    startedAt: Date,
    finishedAt: Date,
    recordsProcessed: number,
  ): Promise<void> {
    const existing = await this.deps.syncMetadataRepository.get(
      provider.providerId,
      provider.entityType,
    );
    const consecutiveFailureCount =
      outcome === SyncRunStatus.SUCCESS ? 0 : (existing?.consecutiveFailureCount ?? 0) + 1;

    await this.deps.syncMetadataRepository.upsert({
      provider: provider.providerId,
      entityType: provider.entityType,
      lastSyncStatus: outcome,
      lastSyncMode: mode,
      lastSyncStartedAt: startedAt,
      lastSyncCompletedAt: finishedAt,
      lastSuccessfulSyncAt:
        outcome === SyncRunStatus.SUCCESS ? finishedAt : (existing?.lastSuccessfulSyncAt ?? null),
      consecutiveFailureCount,
      recordsProcessedLastRun: recordsProcessed,
    });
  }
}
