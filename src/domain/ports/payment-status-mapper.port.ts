import type { CanonicalPaymentStatus } from '../value-objects/payment-status.js';
import type { ProviderId } from '../value-objects/provider.js';

/**
 * Strategy interface: turns a provider's raw status string ("paid", "completed", "succeeded",
 * "captured", ...) into the canonical vocabulary. Configurable per provider so onboarding a new
 * payment processor never means touching the RevenueCalculator or any endpoint — only adding a
 * mapping table entry. Anything absent from the map resolves to UNKNOWN by contract.
 */
export interface PaymentStatusMapper {
  map(provider: ProviderId, rawStatus: string): CanonicalPaymentStatus;
}
