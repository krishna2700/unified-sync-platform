import { Prisma, type PrismaClient } from '@prisma/client';
import type { RevenueRepository } from '../../domain/ports/revenue-repository.port.js';
import type { DateRange } from '../../domain/value-objects/date-range.js';
import type {
  RevenueAggregationQuery,
  RevenueBucket,
  UnknownStatusWarning,
} from '../../domain/value-objects/revenue.js';
import { CanonicalPaymentStatus } from '../../domain/value-objects/payment-status.js';
import { isProviderId } from '../../domain/value-objects/provider.js';

interface AggregateRow {
  bucket_start: Date | null;
  currency: string;
  total_minor: bigint;
  payment_count: bigint;
}

/**
 * Aggregation happens in SQL (SUM/GROUP BY), not by pulling every payment row into Node — the
 * only way this scales to millions of rows. This class contains zero business rules: which
 * statuses count is entirely decided by the caller (`RevenueCalculator`) via `collectedStatuses`;
 * this repository just filters on whatever list it's handed. See the dependency-cruiser rule
 * "only-revenue-calculator-touches-revenue-repository" for the structural guarantee that this
 * stays the only path to payment aggregates.
 */
export class PrismaRevenueRepository implements RevenueRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async aggregate(query: RevenueAggregationQuery): Promise<RevenueBucket[]> {
    const statuses = [...query.collectedStatuses];
    if (statuses.length === 0) return [];

    const truncUnit = granularityToTruncUnit(query.granularity);
    const bucketExpr =
      truncUnit === null
        ? Prisma.sql`NULL::timestamp`
        : Prisma.sql`date_trunc(${truncUnit}, occurred_at)`;

    const rows = await this.prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
      SELECT
        ${bucketExpr} AS bucket_start,
        currency,
        SUM(amount_minor) AS total_minor,
        COUNT(*) AS payment_count
      FROM canonical_payments
      WHERE occurred_at >= ${query.range.start}
        AND occurred_at < ${query.range.end}
        AND canonical_status = ANY(${statuses})
      GROUP BY bucket_start, currency
      ORDER BY bucket_start ASC NULLS FIRST, currency ASC
    `);

    const buckets = new Map<string, RevenueBucket>();
    for (const row of rows) {
      const bucketStart = row.bucket_start ?? query.range.start;
      const bucketEnd = computeBucketEnd(bucketStart, query.granularity, query.range.end);
      const key = bucketStart.toISOString();
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { bucketStart, bucketEnd, amounts: [] };
        buckets.set(key, bucket);
      }
      bucket.amounts.push({
        currency: row.currency,
        amountMinor: Number(row.total_minor),
        paymentCount: Number(row.payment_count),
      });
    }

    return [...buckets.values()].sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime());
  }

  async findUnknownStatuses(range: DateRange): Promise<UnknownStatusWarning[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ provider: string; raw_status: string; cnt: bigint }>
    >(Prisma.sql`
      SELECT provider, raw_status, COUNT(*) AS cnt
      FROM canonical_payments
      WHERE occurred_at >= ${range.start}
        AND occurred_at < ${range.end}
        AND canonical_status = ${CanonicalPaymentStatus.UNKNOWN}
      GROUP BY provider, raw_status
      ORDER BY cnt DESC
    `);

    return rows.map((row) => {
      if (!isProviderId(row.provider)) {
        throw new Error(`Unknown provider in canonical_payments row: ${row.provider}`);
      }
      return { provider: row.provider, rawStatus: row.raw_status, count: Number(row.cnt) };
    });
  }
}

function granularityToTruncUnit(
  granularity: RevenueAggregationQuery['granularity'],
): string | null {
  switch (granularity) {
    case 'day':
      return 'day';
    case 'week':
      return 'week';
    case 'month':
      return 'month';
    case 'total':
      return null;
  }
}

function computeBucketEnd(
  bucketStart: Date,
  granularity: RevenueAggregationQuery['granularity'],
  rangeEnd: Date,
): Date {
  switch (granularity) {
    case 'day':
      return new Date(bucketStart.getTime() + 24 * 60 * 60 * 1000);
    case 'week':
      return new Date(bucketStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    case 'month':
      return new Date(Date.UTC(bucketStart.getUTCFullYear(), bucketStart.getUTCMonth() + 1, 1));
    case 'total':
      return rangeEnd;
  }
}
