import type { PrismaClient } from '@prisma/client';
import type { CursorRepository } from '../../domain/ports/cursor-repository.port.js';
import type { EntityType } from '../../domain/value-objects/entity-type.js';
import type { ProviderId } from '../../domain/value-objects/provider.js';
import { SyncCursor } from '../../domain/value-objects/sync-cursor.js';

export class PrismaCursorRepository implements CursorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(provider: ProviderId, entityType: EntityType): Promise<SyncCursor | null> {
    const row = await this.prisma.syncCursor.findUnique({
      where: { provider_entityType: { provider, entityType } },
    });
    if (!row) return null;
    return SyncCursor.rehydrate({
      token: row.token,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
    });
  }

  async save(provider: ProviderId, entityType: EntityType, cursor: SyncCursor): Promise<void> {
    await this.prisma.syncCursor.upsert({
      where: { provider_entityType: { provider, entityType } },
      create: {
        provider,
        entityType,
        token: cursor.token,
        issuedAt: cursor.issuedAt,
        expiresAt: cursor.expiresAt,
      },
      update: { token: cursor.token, issuedAt: cursor.issuedAt, expiresAt: cursor.expiresAt },
    });
  }

  async clear(provider: ProviderId, entityType: EntityType): Promise<void> {
    await this.prisma.syncCursor.deleteMany({ where: { provider, entityType } });
  }
}
