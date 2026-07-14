import { describe, expect, it } from 'vitest';
import { ConfigurablePaymentStatusMapper } from '../../../../src/application/revenue/configurable-payment-status-mapper.js';
import type { PaymentStatusMappingRepository } from '../../../../src/domain/ports/payment-status-mapping-repository.port.js';
import { CanonicalPaymentStatus } from '../../../../src/domain/value-objects/payment-status.js';
import { ProviderId } from '../../../../src/domain/value-objects/provider.js';

function fakeRepository(
  rows: Array<{ provider: ProviderId; rawStatus: string; canonicalStatus: CanonicalPaymentStatus }>,
): PaymentStatusMappingRepository {
  return {
    listAll: async () => rows,
    upsert: async () => undefined,
  };
}

describe('ConfigurablePaymentStatusMapper', () => {
  it('maps a known raw status after refresh()', async () => {
    const mapper = new ConfigurablePaymentStatusMapper(
      fakeRepository([
        {
          provider: ProviderId.STRIPE,
          rawStatus: 'succeeded',
          canonicalStatus: CanonicalPaymentStatus.COLLECTED,
        },
      ]),
    );
    await mapper.refresh();
    expect(mapper.map(ProviderId.STRIPE, 'succeeded')).toBe(CanonicalPaymentStatus.COLLECTED);
  });

  it('resolves an unmapped status to UNKNOWN rather than throwing or guessing', async () => {
    const mapper = new ConfigurablePaymentStatusMapper(fakeRepository([]));
    await mapper.refresh();
    expect(mapper.map(ProviderId.STRIPE, 'some_brand_new_status')).toBe(
      CanonicalPaymentStatus.UNKNOWN,
    );
  });

  it('resolves to UNKNOWN before refresh() has ever been called (fails safe, not fails open)', () => {
    const mapper = new ConfigurablePaymentStatusMapper(
      fakeRepository([
        {
          provider: ProviderId.STRIPE,
          rawStatus: 'succeeded',
          canonicalStatus: CanonicalPaymentStatus.COLLECTED,
        },
      ]),
    );
    expect(mapper.map(ProviderId.STRIPE, 'succeeded')).toBe(CanonicalPaymentStatus.UNKNOWN);
  });

  it('is case-insensitive on the raw status', async () => {
    const mapper = new ConfigurablePaymentStatusMapper(
      fakeRepository([
        {
          provider: ProviderId.STRIPE,
          rawStatus: 'succeeded',
          canonicalStatus: CanonicalPaymentStatus.COLLECTED,
        },
      ]),
    );
    await mapper.refresh();
    expect(mapper.map(ProviderId.STRIPE, 'SUCCEEDED')).toBe(CanonicalPaymentStatus.COLLECTED);
  });

  it('scopes mappings per provider: the same raw status can mean different things for different providers', async () => {
    const mapper = new ConfigurablePaymentStatusMapper(
      fakeRepository([
        {
          provider: ProviderId.STRIPE,
          rawStatus: 'completed',
          canonicalStatus: CanonicalPaymentStatus.COLLECTED,
        },
      ]),
    );
    await mapper.refresh();
    expect(mapper.map(ProviderId.STRIPE, 'completed')).toBe(CanonicalPaymentStatus.COLLECTED);
    expect(mapper.map(ProviderId.HUBSPOT, 'completed')).toBe(CanonicalPaymentStatus.UNKNOWN);
  });
});
