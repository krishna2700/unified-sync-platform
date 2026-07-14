import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrismaClient, disconnectPrisma } from '../../../src/infrastructure/db/prisma-client.js';
import { PrismaSyncLock } from '../../../src/infrastructure/repositories/prisma-sync-lock.js';
import { ProviderId } from '../../../src/domain/value-objects/provider.js';
import { EntityType } from '../../../src/domain/value-objects/entity-type.js';

const prisma = getPrismaClient();

describe('PrismaSyncLock (integration, real Postgres)', () => {
  beforeEach(async () => {
    await prisma.syncLock.deleteMany({
      where: { provider: ProviderId.STRIPE, entityType: EntityType.PAYMENT },
    });
  });

  afterAll(async () => {
    await prisma.syncLock.deleteMany({
      where: { provider: ProviderId.STRIPE, entityType: EntityType.PAYMENT },
    });
    await disconnectPrisma();
  });

  it('grants the lock to the first caller and denies a concurrent second caller', async () => {
    const lockA = new PrismaSyncLock(prisma, 15 * 60 * 1000, 'owner-a');
    const lockB = new PrismaSyncLock(prisma, 15 * 60 * 1000, 'owner-b');

    const acquiredA = await lockA.tryAcquire(ProviderId.STRIPE, EntityType.PAYMENT);
    const acquiredB = await lockB.tryAcquire(ProviderId.STRIPE, EntityType.PAYMENT);

    expect(acquiredA).toBe(true);
    expect(acquiredB).toBe(false);
  });

  it('allows re-acquisition after release', async () => {
    const lock = new PrismaSyncLock(prisma, 15 * 60 * 1000, 'owner-a');
    await lock.tryAcquire(ProviderId.STRIPE, EntityType.PAYMENT);
    await lock.release(ProviderId.STRIPE, EntityType.PAYMENT);

    const reacquired = await lock.tryAcquire(ProviderId.STRIPE, EntityType.PAYMENT);
    expect(reacquired).toBe(true);
  });

  it('allows a new holder to take over once the lease has expired, so a crashed process never deadlocks future runs', async () => {
    // The lease duration is a property of whoever is *checking* expiry, not stored per-row —
    // in production every process shares the same configured value, so both sides here use the
    // same short lease to model "enough real time passed", not "two processes disagreeing".
    const shortLeaseMs = 20;
    const crashedHolder = new PrismaSyncLock(prisma, shortLeaseMs, 'owner-crashed');
    await crashedHolder.tryAcquire(ProviderId.STRIPE, EntityType.PAYMENT);

    await new Promise((resolve) => setTimeout(resolve, shortLeaseMs * 3));

    const newHolder = new PrismaSyncLock(prisma, shortLeaseMs, 'owner-new');
    const acquired = await newHolder.tryAcquire(ProviderId.STRIPE, EntityType.PAYMENT);
    expect(acquired).toBe(true);
  });
});
