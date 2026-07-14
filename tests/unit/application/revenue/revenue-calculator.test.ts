import { describe, expect, it } from 'vitest';
import { RevenueCalculator } from '../../../../src/application/revenue/revenue-calculator.js';
import {
  InMemoryRevenueRepository,
  type FakePaymentRow,
} from '../../../fixtures/in-memory-revenue-repository.js';
import { createSilentLogger } from '../../../fixtures/silent-logger.js';
import { DateRange } from '../../../../src/domain/value-objects/date-range.js';
import { CanonicalPaymentStatus } from '../../../../src/domain/value-objects/payment-status.js';
import { RevenueGranularity } from '../../../../src/domain/value-objects/revenue.js';
import { ProviderId } from '../../../../src/domain/value-objects/provider.js';

function payment(overrides: Partial<FakePaymentRow>): FakePaymentRow {
  return {
    provider: ProviderId.STRIPE,
    rawStatus: 'succeeded',
    canonicalStatus: CanonicalPaymentStatus.COLLECTED,
    amountMinor: 1000,
    currency: 'USD',
    occurredAt: new Date('2026-01-15T12:00:00Z'),
    ...overrides,
  };
}

describe('RevenueCalculator', () => {
  it('sums only allow-listed (collected) statuses, per the assignment vocabulary', async () => {
    const rows: FakePaymentRow[] = [
      payment({
        rawStatus: 'succeeded',
        canonicalStatus: CanonicalPaymentStatus.COLLECTED,
        amountMinor: 1000,
      }),
      payment({
        rawStatus: 'completed',
        canonicalStatus: CanonicalPaymentStatus.COLLECTED,
        amountMinor: 2000,
      }),
      payment({
        rawStatus: 'pending',
        canonicalStatus: CanonicalPaymentStatus.PENDING,
        amountMinor: 500,
      }),
      payment({
        rawStatus: 'failed',
        canonicalStatus: CanonicalPaymentStatus.FAILED,
        amountMinor: 750,
      }),
      payment({
        rawStatus: 'refunded',
        canonicalStatus: CanonicalPaymentStatus.REFUNDED,
        amountMinor: 300,
      }),
      payment({
        rawStatus: 'cancelled',
        canonicalStatus: CanonicalPaymentStatus.CANCELLED,
        amountMinor: 400,
      }),
    ];
    const calculator = new RevenueCalculator(
      new InMemoryRevenueRepository(rows),
      createSilentLogger(),
    );
    const range = DateRange.of(new Date('2026-01-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'));

    const report = await calculator.calculate(range, RevenueGranularity.TOTAL);

    expect(report.buckets).toHaveLength(1);
    expect(report.buckets[0]?.totalsByCurrency).toEqual([
      { currency: 'USD', amountMinor: 3000, paymentCount: 2 },
    ]);
  });

  it('never counts unknown statuses as revenue and surfaces them as warnings instead', async () => {
    const rows: FakePaymentRow[] = [
      payment({
        rawStatus: 'succeeded',
        canonicalStatus: CanonicalPaymentStatus.COLLECTED,
        amountMinor: 1000,
      }),
      payment({
        provider: ProviderId.HUBSPOT,
        rawStatus: 'some_new_provider_status',
        canonicalStatus: CanonicalPaymentStatus.UNKNOWN,
        amountMinor: 99999,
      }),
    ];
    const calculator = new RevenueCalculator(
      new InMemoryRevenueRepository(rows),
      createSilentLogger(),
    );
    const range = DateRange.of(new Date('2026-01-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'));

    const report = await calculator.calculate(range, RevenueGranularity.TOTAL);

    expect(report.buckets[0]?.totalsByCurrency[0]?.amountMinor).toBe(1000);
    expect(report.warnings).toEqual([
      { provider: ProviderId.HUBSPOT, rawStatus: 'some_new_provider_status', count: 1 },
    ]);
  });

  it('respects arbitrary date ranges, excluding payments outside the window', async () => {
    const rows: FakePaymentRow[] = [
      payment({ occurredAt: new Date('2025-12-31T23:59:59Z'), amountMinor: 500 }),
      payment({ occurredAt: new Date('2026-01-15T00:00:00Z'), amountMinor: 700 }),
      payment({ occurredAt: new Date('2026-02-01T00:00:00Z'), amountMinor: 900 }),
    ];
    const calculator = new RevenueCalculator(
      new InMemoryRevenueRepository(rows),
      createSilentLogger(),
    );
    const range = DateRange.of(new Date('2026-01-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'));

    const report = await calculator.calculate(range, RevenueGranularity.TOTAL);

    expect(report.buckets[0]?.totalsByCurrency[0]?.amountMinor).toBe(700);
  });

  it('buckets multi-currency payments separately rather than summing across currencies', async () => {
    const rows: FakePaymentRow[] = [
      payment({ currency: 'USD', amountMinor: 1000 }),
      payment({ currency: 'EUR', amountMinor: 850 }),
    ];
    const calculator = new RevenueCalculator(
      new InMemoryRevenueRepository(rows),
      createSilentLogger(),
    );
    const range = DateRange.of(new Date('2026-01-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'));

    const report = await calculator.calculate(range, RevenueGranularity.TOTAL);
    const byCurrency = Object.fromEntries(
      report.buckets[0]?.totalsByCurrency.map((t) => [t.currency, t.amountMinor]) ?? [],
    );

    expect(byCurrency).toEqual({ USD: 1000, EUR: 850 });
  });

  it('produces one bucket per day for daily granularity across a multi-day range', async () => {
    const rows: FakePaymentRow[] = [
      payment({ occurredAt: new Date('2026-01-01T08:00:00Z'), amountMinor: 100 }),
      payment({ occurredAt: new Date('2026-01-01T20:00:00Z'), amountMinor: 200 }),
      payment({ occurredAt: new Date('2026-01-02T08:00:00Z'), amountMinor: 300 }),
    ];
    const calculator = new RevenueCalculator(
      new InMemoryRevenueRepository(rows),
      createSilentLogger(),
    );
    const range = DateRange.of(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-03T00:00:00Z'));

    const report = await calculator.calculate(range, RevenueGranularity.DAY);

    expect(report.buckets).toHaveLength(2);
    expect(report.buckets[0]?.totalsByCurrency[0]?.amountMinor).toBe(300);
    expect(report.buckets[1]?.totalsByCurrency[0]?.amountMinor).toBe(300);
  });

  it('the same calculate() method backs every granularity — daily/weekly/monthly/total are just parameters, not separate logic', async () => {
    const rows: FakePaymentRow[] = [payment({ amountMinor: 1234 })];
    const calculator = new RevenueCalculator(
      new InMemoryRevenueRepository(rows),
      createSilentLogger(),
    );
    const range = DateRange.of(new Date('2026-01-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'));

    const [total, daily, weekly, monthly] = await Promise.all([
      calculator.calculate(range, RevenueGranularity.TOTAL),
      calculator.calculate(range, RevenueGranularity.DAY),
      calculator.calculate(range, RevenueGranularity.WEEK),
      calculator.calculate(range, RevenueGranularity.MONTH),
    ]);

    const sum = (report: { buckets: { totalsByCurrency: { amountMinor: number }[] }[] }) =>
      report.buckets.reduce(
        (acc, b) => acc + b.totalsByCurrency.reduce((a, t) => a + t.amountMinor, 0),
        0,
      );

    expect(sum(total)).toBe(1234);
    expect(sum(daily)).toBe(1234);
    expect(sum(weekly)).toBe(1234);
    expect(sum(monthly)).toBe(1234);
  });
});
