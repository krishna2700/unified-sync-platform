import type { DateRange } from './date-range.js';
import type { CanonicalPaymentStatus } from './payment-status.js';
import type { ProviderId } from './provider.js';

/**
 * Pure vocabulary shared by RevenueCalculator, its RevenueRepository port, the Prisma
 * implementation, and route handlers. Deliberately kept out of revenue-repository.port.ts so
 * that referencing "what a granularity/bucket/warning is" isn't confused with "being allowed to
 * query payment aggregates" — only the latter is restricted (see
 * .dependency-cruiser.cjs: only-revenue-calculator-touches-revenue-repository).
 */
export const RevenueGranularity = {
  TOTAL: 'total',
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
} as const;
export type RevenueGranularity = (typeof RevenueGranularity)[keyof typeof RevenueGranularity];

export interface RevenueAmountByCurrency {
  currency: string;
  amountMinor: number;
  paymentCount: number;
}

export interface RevenueBucket {
  bucketStart: Date;
  bucketEnd: Date;
  amounts: RevenueAmountByCurrency[];
}

export interface RevenueAggregationQuery {
  range: DateRange;
  granularity: RevenueGranularity;
  /** Supplied by the caller (RevenueCalculator) from the domain allow-list — the repository
   * never hardcodes which statuses count, it just filters on whatever it's given. This keeps
   * the business rule in exactly one place while letting SQL do the heavy aggregation. */
  collectedStatuses: readonly CanonicalPaymentStatus[];
}

export interface UnknownStatusWarning {
  provider: ProviderId;
  rawStatus: string;
  count: number;
}
