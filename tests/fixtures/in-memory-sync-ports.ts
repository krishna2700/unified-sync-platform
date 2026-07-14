import type { CanonicalRecord } from '../../src/domain/entities/index.js';
import type { CursorRepository } from '../../src/domain/ports/cursor-repository.port.js';
import type {
  FailureLogEntry,
  FailureLogRepository,
} from '../../src/domain/ports/failure-log-repository.port.js';
import type {
  JobHistoryEntry,
  JobHistoryFinish,
  JobHistoryRepository,
  JobHistoryStart,
} from '../../src/domain/ports/job-history-repository.port.js';
import type {
  SyncMetadataRepository,
  SyncMetadataSnapshot,
} from '../../src/domain/ports/sync-metadata-repository.port.js';
import type { SyncLockPort } from '../../src/domain/ports/sync-lock.port.js';
import type {
  SyncPersistencePort,
  UpsertSummary,
} from '../../src/domain/ports/sync-persistence.port.js';
import type { EntityType } from '../../src/domain/value-objects/entity-type.js';
import type { ProviderId } from '../../src/domain/value-objects/provider.js';
import type { SyncCursor } from '../../src/domain/value-objects/sync-cursor.js';

function cursorKey(provider: ProviderId, entityType: EntityType): string {
  return `${provider}::${entityType}`;
}

function recordKey(provider: ProviderId, entityType: EntityType, sourceId: string): string {
  return `${provider}::${entityType}::${sourceId}`;
}

export class InMemoryCursorRepository implements CursorRepository {
  private readonly cursors = new Map<string, SyncCursor>();

  async get(provider: ProviderId, entityType: EntityType): Promise<SyncCursor | null> {
    return this.cursors.get(cursorKey(provider, entityType)) ?? null;
  }

  async save(provider: ProviderId, entityType: EntityType, cursor: SyncCursor): Promise<void> {
    this.cursors.set(cursorKey(provider, entityType), cursor);
  }

  async clear(provider: ProviderId, entityType: EntityType): Promise<void> {
    this.cursors.delete(cursorKey(provider, entityType));
  }

  seed(provider: ProviderId, entityType: EntityType, cursor: SyncCursor): void {
    this.cursors.set(cursorKey(provider, entityType), cursor);
  }
}

/** Mirrors the real transactional guarantee: persisting a batch idempotently upserts records
 * keyed on (provider, entityType, sourceId) AND advances the cursor in the same "transaction". */
export class InMemorySyncPersistence implements SyncPersistencePort {
  readonly records = new Map<string, CanonicalRecord>();
  persistBatchCallCount = 0;

  constructor(private readonly cursorRepository: InMemoryCursorRepository) {}

  async persistBatch(params: {
    provider: ProviderId;
    entityType: EntityType;
    records: CanonicalRecord[];
    newCursor: SyncCursor | null;
  }): Promise<UpsertSummary> {
    this.persistBatchCallCount++;
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const record of params.records) {
      const key = recordKey(params.provider, params.entityType, record.sourceId);
      const existing = this.records.get(key);
      if (!existing) {
        created++;
      } else if (JSON.stringify(existing) === JSON.stringify(record)) {
        unchanged++;
      } else {
        updated++;
      }
      this.records.set(key, record);
    }

    if (params.newCursor) {
      await this.cursorRepository.save(params.provider, params.entityType, params.newCursor);
    }

    return { created, updated, unchanged };
  }
}

export class InMemorySyncMetadataRepository implements SyncMetadataRepository {
  private readonly snapshots = new Map<string, SyncMetadataSnapshot>();

  async get(provider: ProviderId, entityType: EntityType): Promise<SyncMetadataSnapshot | null> {
    return this.snapshots.get(cursorKey(provider, entityType)) ?? null;
  }

  async upsert(snapshot: SyncMetadataSnapshot): Promise<void> {
    this.snapshots.set(cursorKey(snapshot.provider, snapshot.entityType), snapshot);
  }

  async listAll(): Promise<SyncMetadataSnapshot[]> {
    return [...this.snapshots.values()];
  }
}

export class InMemoryJobHistoryRepository implements JobHistoryRepository {
  readonly entries: JobHistoryEntry[] = [];

  async start(entry: JobHistoryStart): Promise<void> {
    this.entries.push({ id: entry.jobId, ...entry });
  }

  async finish(result: JobHistoryFinish): Promise<void> {
    const index = this.entries.findIndex((e) => e.jobId === result.jobId);
    if (index === -1) return;
    this.entries[index] = { ...this.entries[index], ...result } as JobHistoryEntry;
  }

  async list(): Promise<JobHistoryEntry[]> {
    return this.entries;
  }
}

export class InMemoryFailureLogRepository implements FailureLogRepository {
  readonly entries: FailureLogEntry[] = [];

  async record(entry: FailureLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  async listRecent(limit: number): Promise<FailureLogEntry[]> {
    return this.entries.slice(-limit);
  }
}

export class InMemorySyncLock implements SyncLockPort {
  private readonly held = new Set<string>();

  async tryAcquire(provider: ProviderId, entityType: EntityType): Promise<boolean> {
    const key = cursorKey(provider, entityType);
    if (this.held.has(key)) return false;
    this.held.add(key);
    return true;
  }

  async release(provider: ProviderId, entityType: EntityType): Promise<void> {
    this.held.delete(cursorKey(provider, entityType));
  }

  isHeld(provider: ProviderId, entityType: EntityType): boolean {
    return this.held.has(cursorKey(provider, entityType));
  }
}
