import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  FailureLogEntry,
  FailureLogRepository,
} from '../../domain/ports/failure-log-repository.port.js';
import { isProviderId } from '../../domain/value-objects/provider.js';
import type { EntityType } from '../../domain/value-objects/entity-type.js';

export class PrismaFailureLogRepository implements FailureLogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(entry: FailureLogEntry): Promise<void> {
    await this.prisma.failureLog.create({
      data: {
        provider: entry.provider,
        entityType: entry.entityType,
        jobId: entry.jobId,
        errorCode: entry.errorCode,
        message: entry.message,
        context: entry.context as Prisma.InputJsonValue,
        occurredAt: entry.occurredAt,
      },
    });
  }

  async listRecent(limit: number): Promise<FailureLogEntry[]> {
    const rows = await this.prisma.failureLog.findMany({
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => {
      if (!isProviderId(row.provider)) {
        throw new Error(`Unknown provider in failure_logs row: ${row.provider}`);
      }
      return {
        id: row.id,
        provider: row.provider,
        entityType: row.entityType as EntityType | null,
        jobId: row.jobId,
        errorCode: row.errorCode,
        message: row.message,
        context: row.context as Record<string, unknown>,
        occurredAt: row.occurredAt,
      };
    });
  }
}
