import type { PrismaClient } from '@prisma/client';
import type {
  SyncMetadataRepository,
  SyncMetadataSnapshot,
  SyncMode,
  SyncRunStatus,
} from '../../domain/ports/sync-metadata-repository.port.js';
import type { EntityType } from '../../domain/value-objects/entity-type.js';
import { isProviderId, type ProviderId } from '../../domain/value-objects/provider.js';

export class PrismaSyncMetadataRepository implements SyncMetadataRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(provider: ProviderId, entityType: EntityType): Promise<SyncMetadataSnapshot | null> {
    const row = await this.prisma.syncMetadata.findUnique({
      where: { provider_entityType: { provider, entityType } },
    });
    return row ? toSnapshot(row) : null;
  }

  async upsert(snapshot: SyncMetadataSnapshot): Promise<void> {
    const data = {
      lastSyncStatus: snapshot.lastSyncStatus,
      lastSyncMode: snapshot.lastSyncMode,
      lastSyncStartedAt: snapshot.lastSyncStartedAt,
      lastSyncCompletedAt: snapshot.lastSyncCompletedAt,
      lastSuccessfulSyncAt: snapshot.lastSuccessfulSyncAt,
      consecutiveFailureCount: snapshot.consecutiveFailureCount,
      recordsProcessedLastRun: snapshot.recordsProcessedLastRun,
    };
    await this.prisma.syncMetadata.upsert({
      where: {
        provider_entityType: { provider: snapshot.provider, entityType: snapshot.entityType },
      },
      create: { provider: snapshot.provider, entityType: snapshot.entityType, ...data },
      update: data,
    });
  }

  async listAll(): Promise<SyncMetadataSnapshot[]> {
    const rows = await this.prisma.syncMetadata.findMany();
    return rows.map(toSnapshot);
  }
}

function toSnapshot(row: {
  provider: string;
  entityType: string;
  lastSyncStatus: string;
  lastSyncMode: string;
  lastSyncStartedAt: Date | null;
  lastSyncCompletedAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
  consecutiveFailureCount: number;
  recordsProcessedLastRun: number;
}): SyncMetadataSnapshot {
  if (!isProviderId(row.provider)) {
    throw new Error(`Unknown provider in sync_metadata row: ${row.provider}`);
  }
  return {
    provider: row.provider,
    entityType: row.entityType as EntityType,
    lastSyncStatus: row.lastSyncStatus as SyncRunStatus,
    lastSyncMode: row.lastSyncMode as SyncMode,
    lastSyncStartedAt: row.lastSyncStartedAt,
    lastSyncCompletedAt: row.lastSyncCompletedAt,
    lastSuccessfulSyncAt: row.lastSuccessfulSyncAt,
    consecutiveFailureCount: row.consecutiveFailureCount,
    recordsProcessedLastRun: row.recordsProcessedLastRun,
  };
}
