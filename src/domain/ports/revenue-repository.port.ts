import type { DateRange } from '../value-objects/date-range.js';
import type {
  RevenueAggregationQuery,
  RevenueBucket,
  UnknownStatusWarning,
} from '../value-objects/revenue.js';

/**
 * Pure data-access port: aggregates already-normalized payment rows. It contains no notion of
 * "what counts as revenue" — that policy is owned exclusively by RevenueCalculator
 * (src/application/revenue/revenue-calculator.ts), which is the only caller of this port.
 */
export interface RevenueRepository {
  aggregate(query: RevenueAggregationQuery): Promise<RevenueBucket[]>;
  findUnknownStatuses(range: DateRange): Promise<UnknownStatusWarning[]>;
}
