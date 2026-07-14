import { z } from 'zod';
import { DateRange } from '../../../domain/value-objects/date-range.js';

export const dateRangeQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>;

const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Arbitrary date ranges, per the assignment: `to` defaults to now and `from` defaults to 30
 * days before `to` when omitted, so the endpoints are usable with zero query params. */
export function resolveDateRange(query: DateRangeQuery, now: Date = new Date()): DateRange {
  const to = query.to ?? now;
  const from = query.from ?? new Date(to.getTime() - DEFAULT_WINDOW_MS);
  return DateRange.of(from, to);
}
