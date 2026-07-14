import type { RevenueRepository } from '../../src/domain/ports/revenue-repository.port.js';
import type { DateRange } from '../../src/domain/value-objects/date-range.js';
import { CanonicalPaymentStatus } from '../../src/domain/value-objects/payment-status.js';
import type { ProviderId } from '../../src/domain/value-objects/provider.js';
import type {
  RevenueAggregationQuery,
  RevenueBucket,
  UnknownStatusWarning,
} from '../../src/domain/value-objects/revenue.js';

export interface FakePaymentRow {
  provider: ProviderId;
  rawStatus: string;
  canonicalStatus: CanonicalPaymentStatus;
  amountMinor: number;
  currency: string;
  occurredAt: Date;
}

function bucketBounds(
  date: Date,
  granularity: RevenueAggregationQuery['granularity'],
  rangeStart: Date,
  rangeEnd: Date,
) {
  if (granularity === 'total') return { start: rangeStart, end: rangeEnd };
  if (granularity === 'day') {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
  }
  if (granularity === 'month') {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
    return { start, end };
  }
  // week: Monday-start bucket
  const day = date.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - diffToMonday),
  );
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { start, end };
}

/** In-memory stand-in for the Prisma-backed RevenueRepository, used to unit-test
 * RevenueCalculator's bucketing/allow-list/warning logic without a database. */
export class InMemoryRevenueRepository implements RevenueRepository {
  constructor(private readonly rows: FakePaymentRow[]) {}

  async aggregate(query: RevenueAggregationQuery): Promise<RevenueBucket[]> {
    const inRange = this.rows.filter(
      (row) =>
        query.range.contains(row.occurredAt) &&
        query.collectedStatuses.includes(row.canonicalStatus),
    );

    const buckets = new Map<string, RevenueBucket>();
    for (const row of inRange) {
      const { start, end } = bucketBounds(
        row.occurredAt,
        query.granularity,
        query.range.start,
        query.range.end,
      );
      const bucketKey = start.toISOString();
      let bucket = buckets.get(bucketKey);
      if (!bucket) {
        bucket = { bucketStart: start, bucketEnd: end, amounts: [] };
        buckets.set(bucketKey, bucket);
      }
      let currencyAmount = bucket.amounts.find((a) => a.currency === row.currency);
      if (!currencyAmount) {
        currencyAmount = { currency: row.currency, amountMinor: 0, paymentCount: 0 };
        bucket.amounts.push(currencyAmount);
      }
      currencyAmount.amountMinor += row.amountMinor;
      currencyAmount.paymentCount += 1;
    }

    return [...buckets.values()].sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime());
  }

  async findUnknownStatuses(range: DateRange): Promise<UnknownStatusWarning[]> {
    const unknownRows = this.rows.filter(
      (row) =>
        range.contains(row.occurredAt) && row.canonicalStatus === CanonicalPaymentStatus.UNKNOWN,
    );
    const counts = new Map<string, UnknownStatusWarning>();
    for (const row of unknownRows) {
      const key = `${row.provider}:${row.rawStatus}`;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { provider: row.provider, rawStatus: row.rawStatus, count: 1 });
      }
    }
    return [...counts.values()];
  }
}
