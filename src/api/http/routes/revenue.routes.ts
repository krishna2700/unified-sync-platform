import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { RevenueGranularity } from '../../../domain/value-objects/revenue.js';
import { dateRangeQuerySchema, resolveDateRange } from '../schemas/date-range.schema.js';
import type { CompositionRoot } from '../../composition-root.js';

/**
 * All four routes are thin: parse the query, resolve a DateRange, call the one
 * RevenueCalculator.calculate() method with a fixed granularity, return its report untouched.
 * None of them contains — or is permitted to contain — any revenue arithmetic; see
 * src/application/revenue/revenue-calculator.ts and
 * tests/architecture/revenue-single-source-of-truth.test.ts.
 */
export async function revenueRoutes(
  fastify: FastifyInstance,
  opts: { root: CompositionRoot },
): Promise<void> {
  const { revenueCalculator } = opts.root;

  const makeHandler =
    (granularity: RevenueGranularity) => async (request: FastifyRequest, _reply: FastifyReply) => {
      const query = dateRangeQuerySchema.parse(request.query);
      const range = resolveDateRange(query);
      return revenueCalculator.calculate(range, granularity);
    };

  fastify.get('/metrics/revenue', makeHandler(RevenueGranularity.TOTAL));
  fastify.get('/metrics/revenue/daily', makeHandler(RevenueGranularity.DAY));
  fastify.get('/metrics/revenue/weekly', makeHandler(RevenueGranularity.WEEK));
  fastify.get('/metrics/revenue/monthly', makeHandler(RevenueGranularity.MONTH));
}
