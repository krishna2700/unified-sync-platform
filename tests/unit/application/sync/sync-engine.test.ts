import { describe, expect, it } from 'vitest';
import { SyncEngine, type SyncEngineDeps } from '../../../../src/application/sync/sync-engine.js';
import { RetryPolicy } from '../../../../src/application/sync/retry-policy.js';
import {
  InMemoryCursorRepository,
  InMemoryFailureLogRepository,
  InMemoryJobHistoryRepository,
  InMemorySyncLock,
  InMemorySyncMetadataRepository,
  InMemorySyncPersistence,
} from '../../../fixtures/in-memory-sync-ports.js';
import { FakeSyncProvider, type RawFakeContact } from '../../../fixtures/fake-sync-provider.js';
import { createSilentLogger } from '../../../fixtures/silent-logger.js';
import { ManualClock } from '../../../fixtures/manual-clock.js';
import { ProviderId } from '../../../../src/domain/value-objects/provider.js';
import { EntityType } from '../../../../src/domain/value-objects/entity-type.js';
import { SyncCursor } from '../../../../src/domain/value-objects/sync-cursor.js';
import {
  StaleCursorError,
  ProviderRateLimitError,
} from '../../../../src/domain/errors/sync-errors.js';

function buildHarness(overrides?: { staleAfterMs?: number; maxAttempts?: number }) {
  const cursorRepository = new InMemoryCursorRepository();
  const syncPersistence = new InMemorySyncPersistence(cursorRepository);
  const syncMetadataRepository = new InMemorySyncMetadataRepository();
  const jobHistoryRepository = new InMemoryJobHistoryRepository();
  const failureLogRepository = new InMemoryFailureLogRepository();
  const syncLock = new InMemorySyncLock();
  const logger = createSilentLogger();
  const clock = new ManualClock(new Date('2026-01-01T00:00:00.000Z'));
  const retryPolicy = new RetryPolicy(
    { maxAttempts: overrides?.maxAttempts ?? 3, baseDelayMs: 1, maxDelayMs: 5 },
    logger,
    clock,
    async () => undefined, // no real sleeping in tests
  );

  let jobCounter = 0;
  const deps: SyncEngineDeps = {
    cursorRepository,
    syncPersistence,
    syncMetadataRepository,
    jobHistoryRepository,
    failureLogRepository,
    syncLock,
    retryPolicy,
    clock,
    logger,
    config: {
      cursorStaleAfterMs: overrides?.staleAfterMs ?? 24 * 60 * 60 * 1000,
      maxPagesPerRun: 50,
    },
    idGenerator: () => `job-${++jobCounter}`,
  };

  const engine = new SyncEngine(deps);
  return {
    engine,
    cursorRepository,
    syncPersistence,
    syncMetadataRepository,
    jobHistoryRepository,
    failureLogRepository,
    syncLock,
    clock,
  };
}

function contact(id: string, email: string, updatedAt: string): RawFakeContact {
  return { id, email, updatedAt };
}

describe('SyncEngine', () => {
  it('performs a full sync when no cursor exists, then persists a resumable cursor', async () => {
    const h = buildHarness();
    const provider = new FakeSyncProvider(ProviderId.HUBSPOT, EntityType.CONTACT);
    provider.fetchFullImpl = async (pageToken) => {
      expect(pageToken).toBeNull();
      return {
        records: [contact('1', 'a@x.com', '2026-01-01T00:00:00.000Z')],
        nextPageToken: null,
        nextCursor: SyncCursor.issue('watermark-1', h.clock.now()),
        hasMore: false,
      };
    };

    const result = await h.engine.run(provider);

    expect(result.outcome).toBe('success');
    expect(result.mode).toBe('full');
    expect(result.recordsUpserted).toBe(1);
    expect(provider.fetchFullCalls.length).toBe(1);
    expect(provider.fetchIncrementalCalls.length).toBe(0);

    const savedCursor = await h.cursorRepository.get(ProviderId.HUBSPOT, EntityType.CONTACT);
    expect(savedCursor?.token).toBe('watermark-1');
  });

  it('performs an incremental sync when a fresh cursor exists', async () => {
    const h = buildHarness();
    h.cursorRepository.seed(
      ProviderId.HUBSPOT,
      EntityType.CONTACT,
      SyncCursor.issue('cursor-a', h.clock.now()),
    );
    const provider = new FakeSyncProvider(ProviderId.HUBSPOT, EntityType.CONTACT);
    provider.fetchIncrementalImpl = async (cursor) => {
      expect(cursor.token).toBe('cursor-a');
      return {
        records: [contact('2', 'b@x.com', '2026-01-02T00:00:00.000Z')],
        nextPageToken: null,
        nextCursor: SyncCursor.issue('cursor-b', h.clock.now()),
        hasMore: false,
      };
    };

    const result = await h.engine.run(provider);

    expect(result.outcome).toBe('success');
    expect(result.mode).toBe('incremental');
    expect(provider.fetchFullCalls.length).toBe(0);
    expect((await h.cursorRepository.get(ProviderId.HUBSPOT, EntityType.CONTACT))?.token).toBe(
      'cursor-b',
    );
  });

  it('proactively falls back to full sync when the cursor is stale, without calling fetchIncremental', async () => {
    const h = buildHarness({ staleAfterMs: 1000 });
    h.cursorRepository.seed(
      ProviderId.HUBSPOT,
      EntityType.CONTACT,
      SyncCursor.issue('old-cursor', new Date('2025-01-01T00:00:00.000Z')),
    );
    const provider = new FakeSyncProvider(ProviderId.HUBSPOT, EntityType.CONTACT);
    provider.fetchFullImpl = async () => ({
      records: [contact('3', 'c@x.com', '2026-01-01T00:00:00.000Z')],
      nextPageToken: null,
      nextCursor: SyncCursor.issue('fresh-cursor', h.clock.now()),
      hasMore: false,
    });

    const result = await h.engine.run(provider);

    expect(result.mode).toBe('full');
    expect(provider.fetchIncrementalCalls.length).toBe(0);
    expect(provider.fetchFullCalls.length).toBe(1);
  });

  it('reactively falls back to full sync when the provider rejects the cursor mid-run', async () => {
    const h = buildHarness();
    h.cursorRepository.seed(
      ProviderId.HUBSPOT,
      EntityType.CONTACT,
      SyncCursor.issue('expired', h.clock.now()),
    );
    const provider = new FakeSyncProvider(ProviderId.HUBSPOT, EntityType.CONTACT);
    provider.fetchIncrementalImpl = async () => {
      throw new StaleCursorError('cursor expired upstream', ProviderId.HUBSPOT, EntityType.CONTACT);
    };
    provider.fetchFullImpl = async () => ({
      records: [contact('4', 'd@x.com', '2026-01-01T00:00:00.000Z')],
      nextPageToken: null,
      nextCursor: SyncCursor.issue('rebuilt-cursor', h.clock.now()),
      hasMore: false,
    });

    const result = await h.engine.run(provider);

    expect(result.outcome).toBe('success');
    expect(result.fellBackToFull).toBe(true);
    expect(result.mode).toBe('full');
    expect(provider.fetchFullCalls.length).toBe(1);
    expect((await h.cursorRepository.get(ProviderId.HUBSPOT, EntityType.CONTACT))?.token).toBe(
      'rebuilt-cursor',
    );
  });

  it('retries a transient rate-limit error and eventually succeeds', async () => {
    const h = buildHarness({ maxAttempts: 3 });
    const provider = new FakeSyncProvider(ProviderId.HUBSPOT, EntityType.CONTACT);
    let attempts = 0;
    provider.fetchFullImpl = async () => {
      attempts++;
      if (attempts < 3) {
        throw new ProviderRateLimitError('rate limited', ProviderId.HUBSPOT, EntityType.CONTACT, 1);
      }
      return {
        records: [contact('5', 'e@x.com', '2026-01-01T00:00:00.000Z')],
        nextPageToken: null,
        nextCursor: null,
        hasMore: false,
      };
    };

    const result = await h.engine.run(provider);

    expect(result.outcome).toBe('success');
    expect(attempts).toBe(3);
  });

  it('gives up after exhausting retries and reports failure without throwing', async () => {
    const h = buildHarness({ maxAttempts: 2 });
    const provider = new FakeSyncProvider(ProviderId.HUBSPOT, EntityType.CONTACT);
    provider.fetchFullImpl = async () => {
      throw new ProviderRateLimitError(
        'still rate limited',
        ProviderId.HUBSPOT,
        EntityType.CONTACT,
        1,
      );
    };

    const result = await h.engine.run(provider);

    expect(result.outcome).toBe('failed');
    expect(result.error).toContain('rate limited');
    expect(h.failureLogRepository.entries.length).toBe(1);
  });

  it('is idempotent: re-running the same batch does not create duplicate records', async () => {
    const h = buildHarness();
    const provider = new FakeSyncProvider(ProviderId.HUBSPOT, EntityType.CONTACT);
    provider.fetchFullImpl = async () => ({
      records: [contact('6', 'f@x.com', '2026-01-01T00:00:00.000Z')],
      nextPageToken: null,
      nextCursor: SyncCursor.issue('c1', h.clock.now()),
      hasMore: false,
    });

    const first = await h.engine.run(provider);
    // Force another full run (simulating a manual re-run / retried trigger) by clearing the cursor.
    await h.cursorRepository.clear(ProviderId.HUBSPOT, EntityType.CONTACT);
    const second = await h.engine.run(provider);

    expect(first.recordsUpserted).toBe(1);
    // Second run re-fetches the byte-identical record: correctly classified as "unchanged",
    // not re-counted as an upsert — this is what idempotency looks like, not a no-op bug.
    expect(second.recordsUpserted).toBe(0);
    expect(second.outcome).toBe('success');
    expect(h.syncPersistence.records.size).toBe(1); // still exactly one row, not two
  });

  it('isolates provider failures: one provider failing does not stop the others in runMany', async () => {
    const h = buildHarness();
    const failing = new FakeSyncProvider(ProviderId.HUBSPOT, EntityType.CONTACT);
    failing.fetchFullImpl = async () => {
      throw new Error('totally unexpected bug');
    };
    const healthy = new FakeSyncProvider(ProviderId.GOOGLE_CALENDAR, EntityType.EVENT);
    healthy.fetchFullImpl = async () => ({
      records: [],
      nextPageToken: null,
      nextCursor: null,
      hasMore: false,
    });

    const results = await h.engine.runMany([failing, healthy]);

    expect(results[0]?.outcome).toBe('failed');
    expect(results[1]?.outcome).toBe('success');
  });

  it('skips a run instead of racing when the same provider/entity is already in progress', async () => {
    const h = buildHarness();
    const provider = new FakeSyncProvider(ProviderId.HUBSPOT, EntityType.CONTACT);
    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    provider.fetchFullImpl = async () => {
      await gate;
      return { records: [], nextPageToken: null, nextCursor: null, hasMore: false };
    };

    const firstRun = h.engine.run(provider);
    // Give the first run a microtask tick to acquire the lock before starting the second.
    await Promise.resolve();
    const secondRun = await h.engine.run(provider);

    expect(secondRun.outcome).toBe('skipped');
    releaseFirst?.();
    const firstResult = await firstRun;
    expect(firstResult.outcome).toBe('success');
  });
});
