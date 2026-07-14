import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  IdempotencyClaimResult,
  IdempotencyKeyRepository,
} from '../../domain/ports/idempotency-key-repository.port.js';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

export class PrismaIdempotencyKeyRepository implements IdempotencyKeyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async claim(key: string, scope: string): Promise<IdempotencyClaimResult> {
    try {
      await this.prisma.idempotencyKey.create({ data: { key, scope, status: 'claimed' } });
      return { status: 'claimed' };
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw error;
      }
      const existing = await this.prisma.idempotencyKey.findUniqueOrThrow({
        where: { key_scope: { key, scope } },
      });
      if (existing.status === 'completed') {
        return { status: 'completed', storedResult: existing.result };
      }
      return { status: 'in_progress' };
    }
  }

  async complete(key: string, scope: string, result: unknown): Promise<void> {
    await this.prisma.idempotencyKey.update({
      where: { key_scope: { key, scope } },
      data: {
        status: 'completed',
        result: result as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
  }

  async release(key: string, scope: string): Promise<void> {
    await this.prisma.idempotencyKey.deleteMany({ where: { key, scope } });
  }
}
