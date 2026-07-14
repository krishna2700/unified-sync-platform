import { CanonicalPaymentStatus } from '../../domain/value-objects/payment-status.js';
import type { ProviderId } from '../../domain/value-objects/provider.js';
import type { PaymentStatusMapper } from '../../domain/ports/payment-status-mapper.port.js';
import type { PaymentStatusMappingRepository } from '../../domain/ports/payment-status-mapping-repository.port.js';

function cacheKey(provider: ProviderId, rawStatus: string): string {
  return `${provider}:${rawStatus.trim().toLowerCase()}`;
}

/**
 * Strategy implementation of `PaymentStatusMapper` backed by the `payment_status_mappings`
 * table. `map()` must stay synchronous (it's called from a provider adapter's `normalize()`,
 * which the `SyncProvider` port defines as sync), so the table is loaded into an in-memory cache
 * up front via `refresh()` and re-read from there on every call. Call `refresh()` at process
 * startup and whenever an operator edits the mapping table (e.g. from an admin endpoint).
 */
export class ConfigurablePaymentStatusMapper implements PaymentStatusMapper {
  private cache = new Map<string, CanonicalPaymentStatus>();

  constructor(private readonly repository: PaymentStatusMappingRepository) {}

  async refresh(): Promise<void> {
    const rows = await this.repository.listAll();
    const next = new Map<string, CanonicalPaymentStatus>();
    for (const row of rows) {
      next.set(cacheKey(row.provider, row.rawStatus), row.canonicalStatus);
    }
    this.cache = next;
  }

  map(provider: ProviderId, rawStatus: string): CanonicalPaymentStatus {
    return this.cache.get(cacheKey(provider, rawStatus)) ?? CanonicalPaymentStatus.UNKNOWN;
  }
}
