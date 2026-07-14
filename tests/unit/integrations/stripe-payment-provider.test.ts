import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { StripePaymentProvider } from '../../../src/integrations/stripe/stripe-payment-provider.js';
import { SyncCursor } from '../../../src/domain/value-objects/sync-cursor.js';
import { CanonicalPaymentStatus } from '../../../src/domain/value-objects/payment-status.js';
import type { PaymentStatusMapper } from '../../../src/domain/ports/payment-status-mapper.port.js';
import { ProviderUnavailableError } from '../../../src/domain/errors/sync-errors.js';

function buildFakeStripe(
  list: (...args: unknown[]) => Promise<{ data: unknown[]; has_more: boolean }>,
): Stripe {
  return { paymentIntents: { list } } as unknown as Stripe;
}

function fakeIntent(
  id: string,
  created: number,
  status: string,
  amount = 1000,
): Stripe.PaymentIntent {
  return {
    id,
    created,
    status,
    amount,
    currency: 'usd',
    customer: null,
    description: null,
  } as unknown as Stripe.PaymentIntent;
}

const allowListMapper: PaymentStatusMapper = {
  map: (_provider, rawStatus) =>
    rawStatus === 'succeeded' ? CanonicalPaymentStatus.COLLECTED : CanonicalPaymentStatus.UNKNOWN,
};

describe('StripePaymentProvider', () => {
  it('normalizes a succeeded PaymentIntent and resolves canonical status via the injected mapper', () => {
    const provider = new StripePaymentProvider(
      { secretKey: 'sk_test' },
      allowListMapper,
      buildFakeStripe(vi.fn()),
    );
    const normalized = provider.normalize(fakeIntent('pi_1', 1735689600, 'succeeded', 2500));

    expect(normalized.canonicalStatus).toBe(CanonicalPaymentStatus.COLLECTED);
    expect(normalized.amount.amountMinor).toBe(2500);
    expect(normalized.amount.currency).toBe('USD');
  });

  it('an unrecognized raw status resolves to UNKNOWN, never to collected', () => {
    const provider = new StripePaymentProvider(
      { secretKey: 'sk_test' },
      allowListMapper,
      buildFakeStripe(vi.fn()),
    );
    const normalized = provider.normalize(
      fakeIntent('pi_2', 1735689600, 'some_future_status_we_dont_know'),
    );
    expect(normalized.canonicalStatus).toBe(CanonicalPaymentStatus.UNKNOWN);
  });

  it('tracks a running max-created watermark across pages, emitting it only on the final page', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data: [fakeIntent('pi_1', 100, 'succeeded')], has_more: true })
      .mockResolvedValueOnce({ data: [fakeIntent('pi_2', 200, 'succeeded')], has_more: false });
    const provider = new StripePaymentProvider(
      { secretKey: 'sk_test' },
      allowListMapper,
      buildFakeStripe(list),
    );
    const cursor = SyncCursor.issue('0');

    const page1 = await provider.fetchIncremental(cursor, null);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeNull();
    expect(page1.nextPageToken).not.toBeNull();

    const page2 = await provider.fetchIncremental(cursor, page1.nextPageToken);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor?.token).toBe('200');
  });

  it('maps a 500 response to a retryable ProviderUnavailableError', async () => {
    const list = vi.fn().mockRejectedValue({ statusCode: 500, message: 'internal error' });
    const provider = new StripePaymentProvider(
      { secretKey: 'sk_test' },
      allowListMapper,
      buildFakeStripe(list),
    );

    await expect(provider.fetchFull(null)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});
