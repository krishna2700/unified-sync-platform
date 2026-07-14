import { Prisma, type PrismaClient } from '@prisma/client';
import type { SyncLockPort } from '../../domain/ports/sync-lock.port.js';
import type { EntityType } from '../../domain/value-objects/entity-type.js';
import type { ProviderId } from '../../domain/value-objects/provider.js';

/**
 * Lease-based lock (see the schema comment on `SyncLock` for why this isn't a Postgres advisory
 * lock). `tryAcquire` is a single atomic INSERT .. ON CONFLICT DO UPDATE .. WHERE statement, so
 * it is race-safe under concurrent callers without needing a separate transaction: Postgres
 * evaluates the WHERE clause and performs the write atomically per row.
 */
export class PrismaSyncLock implements SyncLockPort {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly leaseDurationMs: number = 15 * 60 * 1000,
    private readonly ownerId: string = `${process.pid}`,
  ) {}

  async tryAcquire(provider: ProviderId, entityType: EntityType): Promise<boolean> {
    // Milliseconds, not seconds: rounding a short lease up to whole seconds would make it
    // outlive its configured duration (caught by an integration test using a 1ms test lease).
    const rows = await this.prisma.$queryRaw<Array<{ provider: string }>>(Prisma.sql`
      INSERT INTO sync_locks (provider, entity_type, locked_at, lock_owner)
      VALUES (${provider}, ${entityType}, now(), ${this.ownerId})
      ON CONFLICT (provider, entity_type)
      DO UPDATE SET locked_at = now(), lock_owner = ${this.ownerId}
      WHERE sync_locks.locked_at < now() - (${this.leaseDurationMs} * interval '1 millisecond')
      RETURNING provider
    `);
    return rows.length > 0;
  }

  async release(provider: ProviderId, entityType: EntityType): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM sync_locks WHERE provider = ${provider} AND entity_type = ${entityType}
    `);
  }
}
