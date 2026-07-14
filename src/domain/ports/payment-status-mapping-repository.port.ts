import type { CanonicalPaymentStatus } from '../value-objects/payment-status.js';
import type { ProviderId } from '../value-objects/provider.js';

export interface PaymentStatusMappingRow {
  provider: ProviderId;
  rawStatus: string;
  canonicalStatus: CanonicalPaymentStatus;
}

/** Backs the configurable status-mapping table so a new provider's status vocabulary can be
 * onboarded with a data insert, never a code change. Distinct from `PaymentStatusMapper` (the
 * synchronous strategy adapters call during `normalize()`), which caches these rows in memory. */
export interface PaymentStatusMappingRepository {
  listAll(): Promise<PaymentStatusMappingRow[]>;
  upsert(row: PaymentStatusMappingRow): Promise<void>;
}
