import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrismaClient, disconnectPrisma } from '../../../src/infrastructure/db/prisma-client.js';
import { PrismaSyncPersistence } from '../../../src/infrastructure/repositories/prisma-sync-persistence.repository.js';
import { PrismaCursorRepository } from '../../../src/infrastructure/repositories/prisma-cursor.repository.js';
import { ProviderId } from '../../../src/domain/value-objects/provider.js';
import { EntityType } from '../../../src/domain/value-objects/entity-type.js';
import { SyncCursor } from '../../../src/domain/value-objects/sync-cursor.js';
import type { CanonicalPayment } from '../../../src/domain/entities/canonical-payment.js';
import { Money } from '../../../src/domain/value-objects/money.js';
import { CanonicalPaymentStatus } from '../../../src/domain/value-objects/payment-status.js';

const prisma = getPrismaClient();
const SOURCE_ID_PREFIX = 'test-integration-persistence-';

function payment(sourceId: string, amountMinor: number, sourceUpdatedAt: Date): CanonicalPayment {
  return {
    kind: 'payment',
    id: null,
    provider: ProviderId.STRIPE,
    sourceId,
    amount: Money.of(amountMinor, 'USD'),
    rawStatus: 'succeeded',
    canonicalStatus: CanonicalPaymentStatus.COLLECTED,
    customerRef: null,
    occurredAt: sourceUpdatedAt,
    description: 'integration test fixture',
    sourceCreatedAt: sourceUpdatedAt,
    sourceUpdatedAt,
    syncedAt: null,
    raw: {},
  };
}

describe('PrismaSyncPersistence (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.canonicalPayment.deleteMany({
      where: { sourceId: { startsWith: SOURCE_ID_PREFIX } },
    });
  });

  afterAll(async () => {
    await prisma.canonicalPayment.deleteMany({
      where: { sourceId: { startsWith: SOURCE_ID_PREFIX } },
    });
    await prisma.syncCursor.deleteMany({
      where: { provider: ProviderId.STRIPE, entityType: EntityType.PAYMENT },
    });
    await disconnectPrisma();
  });

  it('is idempotent: persisting the same record twice never creates a second row', async () => {
    const persistence = new PrismaSyncPersistence(prisma);
    const sourceId = `${SOURCE_ID_PREFIX}idempotent`;
    const record = payment(sourceId, 1000, new Date('2026-01-01T00:00:00Z'));

    const first = await persistence.persistBatch({
      provider: ProviderId.STRIPE,
      entityType: EntityType.PAYMENT,
      records: [record],
      newCursor: null,
    });
    const second = await persistence.persistBatch({
      provider: ProviderId.STRIPE,
      entityType: EntityType.PAYMENT,
      records: [record],
      newCursor: null,
    });

    expect(first.created).toBe(1);
    expect(second.unchanged).toBe(1);

    const rows = await prisma.canonicalPayment.findMany({ where: { sourceId } });
    expect(rows).toHaveLength(1);
  });

  it('commits the persisted records and the advanced cursor atomically in one call', async () => {
    const persistence = new PrismaSyncPersistence(prisma);
    const cursorRepository = new PrismaCursorRepository(prisma);
    const sourceId = `${SOURCE_ID_PREFIX}cursor-atomicity`;
    const record = payment(sourceId, 2500, new Date('2026-01-02T00:00:00Z'));
    const newCursor = SyncCursor.issue('1767225600'); // arbitrary unix-seconds watermark

    await persistence.persistBatch({
      provider: ProviderId.STRIPE,
      entityType: EntityType.PAYMENT,
      records: [record],
      newCursor,
    });

    const savedRow = await prisma.canonicalPayment.findUnique({
      where: { provider_source_id: { provider: ProviderId.STRIPE, sourceId } },
    });
    const savedCursor = await cursorRepository.get(ProviderId.STRIPE, EntityType.PAYMENT);

    expect(savedRow?.amountMinor).toBe(2500n);
    expect(savedCursor?.token).toBe('1767225600');
  });

  it('classifies a genuinely changed record as updated, not unchanged', async () => {
    const persistence = new PrismaSyncPersistence(prisma);
    const sourceId = `${SOURCE_ID_PREFIX}updated`;
    await persistence.persistBatch({
      provider: ProviderId.STRIPE,
      entityType: EntityType.PAYMENT,
      records: [payment(sourceId, 100, new Date('2026-01-03T00:00:00Z'))],
      newCursor: null,
    });

    const result = await persistence.persistBatch({
      provider: ProviderId.STRIPE,
      entityType: EntityType.PAYMENT,
      records: [payment(sourceId, 100, new Date('2026-01-04T00:00:00Z'))], // later sourceUpdatedAt
      newCursor: null,
    });

    expect(result.updated).toBe(1);
    const rows = await prisma.canonicalPayment.findMany({ where: { sourceId } });
    expect(rows).toHaveLength(1);
  });
});
