import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrismaClient, disconnectPrisma } from '../../../src/infrastructure/db/prisma-client.js';
import { PrismaRevenueRepository } from '../../../src/infrastructure/repositories/prisma-revenue.repository.js';
import { ProviderId } from '../../../src/domain/value-objects/provider.js';
import { CanonicalPaymentStatus } from '../../../src/domain/value-objects/payment-status.js';
import { RevenueGranularity } from '../../../src/domain/value-objects/revenue.js';
import { DateRange } from '../../../src/domain/value-objects/date-range.js';

const prisma = getPrismaClient();
const SOURCE_ID_PREFIX = 'test-integration-revenue-';

/** Validates the hand-written raw SQL (date_trunc bucketing, ANY(collectedStatuses) filtering)
 * against a real Postgres instance — the in-memory fake used elsewhere can't catch a typo in
 * the actual SQL or a Postgres-specific date_trunc behavior mismatch. */
describe('PrismaRevenueRepository (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.canonicalPayment.deleteMany({
      where: { sourceId: { startsWith: SOURCE_ID_PREFIX } },
    });
    await prisma.canonicalPayment.createMany({
      data: [
        {
          provider: ProviderId.STRIPE,
          sourceId: `${SOURCE_ID_PREFIX}1`,
          amountMinor: 1000n,
          currency: 'USD',
          rawStatus: 'succeeded',
          canonicalStatus: CanonicalPaymentStatus.COLLECTED,
          occurredAt: new Date('2026-05-01T10:00:00Z'),
          raw: {},
        },
        {
          provider: ProviderId.STRIPE,
          sourceId: `${SOURCE_ID_PREFIX}2`,
          amountMinor: 2000n,
          currency: 'USD',
          rawStatus: 'succeeded',
          canonicalStatus: CanonicalPaymentStatus.COLLECTED,
          occurredAt: new Date('2026-05-02T10:00:00Z'),
          raw: {},
        },
        {
          provider: ProviderId.STRIPE,
          sourceId: `${SOURCE_ID_PREFIX}3`,
          amountMinor: 999999n,
          currency: 'USD',
          rawStatus: 'failed',
          canonicalStatus: CanonicalPaymentStatus.FAILED,
          occurredAt: new Date('2026-05-01T11:00:00Z'),
          raw: {},
        },
        {
          provider: ProviderId.HUBSPOT,
          sourceId: `${SOURCE_ID_PREFIX}4`,
          amountMinor: 42n,
          currency: 'USD',
          rawStatus: 'weird_unmapped_status',
          canonicalStatus: CanonicalPaymentStatus.UNKNOWN,
          occurredAt: new Date('2026-05-01T12:00:00Z'),
          raw: {},
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.canonicalPayment.deleteMany({
      where: { sourceId: { startsWith: SOURCE_ID_PREFIX } },
    });
    await disconnectPrisma();
  });

  it('aggregates only allow-listed statuses via SQL, excluding failed/unknown rows', async () => {
    const repository = new PrismaRevenueRepository(prisma);
    const buckets = await repository.aggregate({
      range: DateRange.of(new Date('2026-05-01T00:00:00Z'), new Date('2026-05-03T00:00:00Z')),
      granularity: RevenueGranularity.TOTAL,
      collectedStatuses: [CanonicalPaymentStatus.COLLECTED],
    });

    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.amounts).toEqual([{ currency: 'USD', amountMinor: 3000, paymentCount: 2 }]);
  });

  it('buckets by day using Postgres date_trunc, one bucket per calendar day', async () => {
    const repository = new PrismaRevenueRepository(prisma);
    const buckets = await repository.aggregate({
      range: DateRange.of(new Date('2026-05-01T00:00:00Z'), new Date('2026-05-03T00:00:00Z')),
      granularity: RevenueGranularity.DAY,
      collectedStatuses: [CanonicalPaymentStatus.COLLECTED],
    });

    expect(buckets).toHaveLength(2);
    expect(buckets[0]?.amounts[0]?.amountMinor).toBe(1000);
    expect(buckets[1]?.amounts[0]?.amountMinor).toBe(2000);
  });

  it('finds the unknown-status row and groups it by provider + raw status', async () => {
    const repository = new PrismaRevenueRepository(prisma);
    const warnings = await repository.findUnknownStatuses(
      DateRange.of(new Date('2026-05-01T00:00:00Z'), new Date('2026-05-03T00:00:00Z')),
    );
    expect(warnings).toEqual([
      { provider: ProviderId.HUBSPOT, rawStatus: 'weird_unmapped_status', count: 1 },
    ]);
  });
});
