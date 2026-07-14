import { describe, expect, it } from 'vitest';
import { RevenueCalculator } from '../../src/application/revenue/revenue-calculator.js';
import {
  InMemoryRevenueRepository,
  type FakePaymentRow,
} from '../fixtures/in-memory-revenue-repository.js';
import { createSilentLogger } from '../fixtures/silent-logger.js';
import { DateRange } from '../../src/domain/value-objects/date-range.js';
import { CanonicalPaymentStatus } from '../../src/domain/value-objects/payment-status.js';
import { RevenueGranularity } from '../../src/domain/value-objects/revenue.js';
import { ProviderId } from '../../src/domain/value-objects/provider.js';

/**
 * A fixed, hand-computed dataset spanning multiple providers, currencies, statuses, and a month
 * boundary (Jan 28 - Mar 3). Expected totals below were computed by hand from this exact list,
 * independently of RevenueCalculator's implementation — this is what makes it a golden-dataset
 * test rather than a restatement of the code under test. If a future change to bucketing or the
 * allow-list silently shifts a total, this is the test that catches it.
 */
const GOLDEN_PAYMENTS: FakePaymentRow[] = [
  // January — collected, various raw vocabularies mapped to COLLECTED
  {
    provider: ProviderId.STRIPE,
    rawStatus: 'succeeded',
    canonicalStatus: CanonicalPaymentStatus.COLLECTED,
    amountMinor: 5000,
    currency: 'USD',
    occurredAt: new Date('2026-01-28T10:00:00Z'),
  },
  {
    provider: ProviderId.STRIPE,
    rawStatus: 'succeeded',
    canonicalStatus: CanonicalPaymentStatus.COLLECTED,
    amountMinor: 2500,
    currency: 'USD',
    occurredAt: new Date('2026-01-28T14:00:00Z'),
  },
  {
    provider: ProviderId.HUBSPOT,
    rawStatus: 'completed',
    canonicalStatus: CanonicalPaymentStatus.COLLECTED,
    amountMinor: 10000,
    currency: 'USD',
    occurredAt: new Date('2026-01-30T09:00:00Z'),
  },
  {
    provider: ProviderId.HUBSPOT,
    rawStatus: 'paid',
    canonicalStatus: CanonicalPaymentStatus.COLLECTED,
    amountMinor: 3000,
    currency: 'EUR',
    occurredAt: new Date('2026-01-30T09:30:00Z'),
  },
  // Non-collected statuses that must NOT count
  {
    provider: ProviderId.STRIPE,
    rawStatus: 'pending',
    canonicalStatus: CanonicalPaymentStatus.PENDING,
    amountMinor: 99999,
    currency: 'USD',
    occurredAt: new Date('2026-01-29T00:00:00Z'),
  },
  {
    provider: ProviderId.STRIPE,
    rawStatus: 'failed',
    canonicalStatus: CanonicalPaymentStatus.FAILED,
    amountMinor: 88888,
    currency: 'USD',
    occurredAt: new Date('2026-01-29T01:00:00Z'),
  },
  {
    provider: ProviderId.STRIPE,
    rawStatus: 'refunded',
    canonicalStatus: CanonicalPaymentStatus.REFUNDED,
    amountMinor: 4000,
    currency: 'USD',
    occurredAt: new Date('2026-02-02T00:00:00Z'),
  },
  {
    provider: ProviderId.HUBSPOT,
    rawStatus: 'voided',
    canonicalStatus: CanonicalPaymentStatus.CANCELLED,
    amountMinor: 1500,
    currency: 'USD',
    occurredAt: new Date('2026-02-02T01:00:00Z'),
  },
  // February — collected via "captured" vocabulary
  {
    provider: ProviderId.STRIPE,
    rawStatus: 'captured',
    canonicalStatus: CanonicalPaymentStatus.COLLECTED,
    amountMinor: 7500,
    currency: 'USD',
    occurredAt: new Date('2026-02-14T12:00:00Z'),
  },
  // Unknown statuses — never counted, must surface as warnings
  {
    provider: ProviderId.HUBSPOT,
    rawStatus: 'chargeback_pending_review',
    canonicalStatus: CanonicalPaymentStatus.UNKNOWN,
    amountMinor: 123456,
    currency: 'USD',
    occurredAt: new Date('2026-02-20T00:00:00Z'),
  },
  {
    provider: ProviderId.HUBSPOT,
    rawStatus: 'chargeback_pending_review',
    canonicalStatus: CanonicalPaymentStatus.UNKNOWN,
    amountMinor: 654321,
    currency: 'USD',
    occurredAt: new Date('2026-02-21T00:00:00Z'),
  },
  // Just past the test's range end — must be excluded entirely
  {
    provider: ProviderId.STRIPE,
    rawStatus: 'succeeded',
    canonicalStatus: CanonicalPaymentStatus.COLLECTED,
    amountMinor: 1_000_000,
    currency: 'USD',
    occurredAt: new Date('2026-03-03T00:00:00Z'),
  },
];

const RANGE = DateRange.of(new Date('2026-01-01T00:00:00Z'), new Date('2026-03-01T00:00:00Z'));

function buildCalculator(): RevenueCalculator {
  return new RevenueCalculator(
    new InMemoryRevenueRepository(GOLDEN_PAYMENTS),
    createSilentLogger(),
  );
}

describe('Golden dataset: revenue collected across providers, currencies, and a month boundary', () => {
  it('totals exactly 25000 USD + 3000 EUR collected across Jan-Feb, excluding all non-collected and out-of-range rows', async () => {
    const report = await buildCalculator().calculate(RANGE, RevenueGranularity.TOTAL);
    const byCurrency = Object.fromEntries(
      report.buckets[0]?.totalsByCurrency.map((t) => [t.currency, t.amountMinor]) ?? [],
    );

    // 5000 + 2500 + 10000 (USD) + 7500 (USD, "captured") = 25000; 3000 EUR separately.
    expect(byCurrency).toEqual({ USD: 25000, EUR: 3000 });
  });

  it('surfaces exactly the two unknown-status payments as warnings, aggregated by provider+rawStatus', async () => {
    const report = await buildCalculator().calculate(RANGE, RevenueGranularity.TOTAL);
    expect(report.warnings).toEqual([
      { provider: ProviderId.HUBSPOT, rawStatus: 'chargeback_pending_review', count: 2 },
    ]);
  });

  it('splits January and February into separate monthly buckets with the correct per-month totals', async () => {
    const report = await buildCalculator().calculate(RANGE, RevenueGranularity.MONTH);
    const januaryBucket = report.buckets.find((b) => b.bucketStart.getUTCMonth() === 0);
    const februaryBucket = report.buckets.find((b) => b.bucketStart.getUTCMonth() === 1);

    const januaryUsd = januaryBucket?.totalsByCurrency.find(
      (t) => t.currency === 'USD',
    )?.amountMinor;
    const januaryEur = januaryBucket?.totalsByCurrency.find(
      (t) => t.currency === 'EUR',
    )?.amountMinor;
    const februaryUsd = februaryBucket?.totalsByCurrency.find(
      (t) => t.currency === 'USD',
    )?.amountMinor;

    expect(januaryUsd).toBe(17500); // 5000 + 2500 + 10000
    expect(januaryEur).toBe(3000);
    expect(februaryUsd).toBe(7500); // the "captured" payment on Feb 14
  });

  it('isolates a single day (Jan 28) to exactly 7500 USD collected, ignoring same-day non-collected rows', async () => {
    const report = await buildCalculator().calculate(RANGE, RevenueGranularity.DAY);
    const jan28 = report.buckets.find((b) => b.bucketStart.toISOString().startsWith('2026-01-28'));
    expect(jan28?.totalsByCurrency).toEqual([
      { currency: 'USD', amountMinor: 7500, paymentCount: 2 },
    ]);
  });
});
