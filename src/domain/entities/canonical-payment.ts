import type { CanonicalRecordBase } from './canonical-record.base.js';
import type { Money } from '../value-objects/money.js';
import type { CanonicalPaymentStatus } from '../value-objects/payment-status.js';

export interface CanonicalPayment extends CanonicalRecordBase {
  kind: 'payment';
  amount: Money;
  /** The provider's own status string, preserved verbatim ("succeeded", "captured", ...). */
  rawStatus: string;
  /** rawStatus resolved through the configurable provider status map. UNKNOWN if unmapped. */
  canonicalStatus: CanonicalPaymentStatus;
  customerRef: string | null;
  /** Timestamp the revenue engine buckets on for daily/weekly/monthly aggregation. */
  occurredAt: Date;
  description: string | null;
}
