import type { PrismaClient } from '@prisma/client';
import type {
  JobHistoryEntry,
  JobHistoryFinish,
  JobHistoryRepository,
  JobHistoryStart,
} from '../../domain/ports/job-history-repository.port.js';
import type { EntityType } from '../../domain/value-objects/entity-type.js';
import { isProviderId, type ProviderId } from '../../domain/value-objects/provider.js';

export class PrismaJobHistoryRepository implements JobHistoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async start(entry: JobHistoryStart): Promise<void> {
    await this.prisma.jobHistory.create({
      data: {
        id: entry.jobId,
        provider: entry.provider,
        entityType: entry.entityType,
        mode: entry.mode,
        startedAt: entry.startedAt,
      },
    });
  }

  async finish(result: JobHistoryFinish): Promise<void> {
    await this.prisma.jobHistory.update({
      where: { id: result.jobId },
      data: {
        outcome: result.outcome,
        finishedAt: result.finishedAt,
        recordsFetched: result.recordsFetched,
        recordsUpserted: result.recordsUpserted,
        recordsFailed: result.recordsFailed,
        errorSummary: result.errorSummary,
      },
    });
  }

  async list(filter?: {
    provider?: ProviderId;
    entityType?: EntityType;
    limit?: number;
  }): Promise<JobHistoryEntry[]> {
    const rows = await this.prisma.jobHistory.findMany({
      where: { provider: filter?.provider, entityType: filter?.entityType },
      orderBy: { startedAt: 'desc' },
      take: filter?.limit ?? 50,
    });
    return rows.map((row) => {
      if (!isProviderId(row.provider)) {
        throw new Error(`Unknown provider in job_history row: ${row.provider}`);
      }
      return {
        id: row.id,
        jobId: row.id,
        provider: row.provider,
        entityType: row.entityType as EntityType,
        mode: row.mode as JobHistoryEntry['mode'],
        outcome: (row.outcome ?? undefined) as JobHistoryEntry['outcome'],
        startedAt: row.startedAt,
        finishedAt: row.finishedAt ?? undefined,
        recordsFetched: row.recordsFetched,
        recordsUpserted: row.recordsUpserted,
        recordsFailed: row.recordsFailed,
        errorSummary: row.errorSummary ?? undefined,
      };
    });
  }
}
