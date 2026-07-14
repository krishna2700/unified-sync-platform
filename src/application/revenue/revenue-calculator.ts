import type { Logger } from '../../domain/ports/logger.port.js';
import type { RevenueRepository } from '../../domain/ports/revenue-repository.port.js';
import { REVENUE_COLLECTED_STATUSES } from '../../domain/value-objects/payment-status.js';
import type { RevenueGranularity } from '../../domain/value-objects/revenue.js';
import type { DateRange } from '../../domain/value-objects/date-range.js';
import type { RevenueReport } from './revenue-report.js';

/**
 * The single, reusable source of truth for "Total Revenue Collected". Every endpoint
 * (`/metrics/revenue`, `/daily`, `/weekly`, `/monthly`) calls exactly this method with a
 * different `granularity` — none of them may contain their own aggregation logic. This is
 * structurally enforced: `RevenueRepository` (the only port that can query payment amounts) may
 * only be imported by this file and its Prisma implementation — see
 * `.dependency-cruiser.cjs` ("only-revenue-calculator-touches-revenue-repository") and
 * `tests/architecture/revenue-single-source-of-truth.test.ts`, which greps the whole codebase to
 * catch anyone who tries to reimplement this logic elsewhere.
 *
 * The allow-list (`REVENUE_COLLECTED_STATUSES`) is read here and nowhere else that computes a
 * total: an unmapped/new provider status resolves to UNKNOWN upstream during normalization, and
 * UNKNOWN is never a member of the allow-list, so it can never inflate revenue — it only ever
 * shows up in `warnings`.
 */
export class RevenueCalculator {
  constructor(
    private readonly revenueRepository: RevenueRepository,
    private readonly logger: Logger,
  ) {}

  async calculate(range: DateRange, granularity: RevenueGranularity): Promise<RevenueReport> {
    const [buckets, unknownStatuses] = await Promise.all([
      this.revenueRepository.aggregate({
        range,
        granularity,
        collectedStatuses: [...REVENUE_COLLECTED_STATUSES],
      }),
      this.revenueRepository.findUnknownStatuses(range),
    ]);

    if (unknownStatuses.length > 0) {
      this.logger.warn(
        'Unknown payment statuses encountered while calculating revenue; excluded from totals',
        {
          range: range.toJSON(),
          unknownStatuses,
        },
      );
    }

    return {
      range: { start: range.start, end: range.end },
      granularity,
      buckets: buckets.map((bucket) => ({
        bucketStart: bucket.bucketStart,
        bucketEnd: bucket.bucketEnd,
        totalsByCurrency: bucket.amounts,
      })),
      warnings: unknownStatuses,
    };
  }
}
