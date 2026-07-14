/**
 * Canonical payment status vocabulary. Every provider's raw status string (HubSpot-esque "paid",
 * a hypothetical Provider B "completed", Stripe "succeeded", another gateway's "captured", etc.)
 * is mapped into exactly one of these before it ever reaches the revenue engine.
 */
export const CanonicalPaymentStatus = {
  COLLECTED: 'collected',
  PENDING: 'pending',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled',
  /** Mapping table had no entry for the provider's raw status. Never treated as revenue. */
  UNKNOWN: 'unknown',
} as const;
export type CanonicalPaymentStatus =
  (typeof CanonicalPaymentStatus)[keyof typeof CanonicalPaymentStatus];

/**
 * THE single allow-list that defines "collected revenue" for the entire system.
 * This is intentionally the only place that decides what counts — per requirement, we never
 * derive "counts as revenue" by excluding failed/pending/refunded/etc; a status counts only if
 * it is explicitly listed here. Adding a new provider can never accidentally inflate revenue,
 * because an unmapped/new raw status resolves to UNKNOWN, which is not in this set.
 */
export const REVENUE_COLLECTED_STATUSES: ReadonlySet<CanonicalPaymentStatus> = new Set([
  CanonicalPaymentStatus.COLLECTED,
]);

export function countsAsCollectedRevenue(status: CanonicalPaymentStatus): boolean {
  return REVENUE_COLLECTED_STATUSES.has(status);
}

export function isCanonicalPaymentStatus(value: string): value is CanonicalPaymentStatus {
  return Object.values(CanonicalPaymentStatus).includes(value as CanonicalPaymentStatus);
}
