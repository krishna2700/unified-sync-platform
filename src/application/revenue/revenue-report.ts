import type {
  RevenueAmountByCurrency,
  RevenueGranularity,
  UnknownStatusWarning,
} from '../../domain/value-objects/revenue.js';

export interface RevenueReportBucket {
  bucketStart: Date;
  bucketEnd: Date;
  totalsByCurrency: RevenueAmountByCurrency[];
}

export interface RevenueReport {
  range: { start: Date; end: Date };
  granularity: RevenueGranularity;
  buckets: RevenueReportBucket[];
  /** Non-empty whenever payments existed in range whose raw status has no configured mapping.
   * These are always excluded from `buckets` — surfacing them here is what makes that exclusion
   * observable instead of silent. */
  warnings: UnknownStatusWarning[];
}
