import { DomainValidationError } from '../errors/domain-validation-error.js';

const ISO_CURRENCY_RE = /^[A-Z]{3}$/;

/**
 * Money is always represented as an integer minor unit (cents) + ISO-4217 currency.
 * Floating point is never used for money anywhere in the system — this is the single
 * choke point that enforces that invariant.
 */
export class Money {
  private constructor(
    public readonly amountMinor: number,
    public readonly currency: string,
  ) {}

  static of(amountMinor: number, currency: string): Money {
    if (!Number.isInteger(amountMinor)) {
      throw new DomainValidationError(`Money.amountMinor must be an integer, got ${amountMinor}`);
    }
    if (amountMinor < 0) {
      throw new DomainValidationError(`Money.amountMinor must be >= 0, got ${amountMinor}`);
    }
    const normalizedCurrency = currency.trim().toUpperCase();
    if (!ISO_CURRENCY_RE.test(normalizedCurrency)) {
      throw new DomainValidationError(`Money.currency must be an ISO-4217 code, got "${currency}"`);
    }
    return new Money(amountMinor, normalizedCurrency);
  }

  static zero(currency: string): Money {
    return Money.of(0, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amountMinor + other.amountMinor, this.currency);
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new DomainValidationError(
        `Cannot combine amounts in different currencies: ${this.currency} vs ${other.currency}`,
      );
    }
  }

  toMajorUnits(): number {
    return this.amountMinor / 100;
  }

  toJSON(): { amountMinor: number; currency: string } {
    return { amountMinor: this.amountMinor, currency: this.currency };
  }
}
