import { DomainValidationError } from '../errors/domain-validation-error.js';

/** Half-open interval [start, end) — the boundary an event lands exactly on `end` is excluded,
 * which is what makes adjacent buckets (daily/weekly/monthly) partition time without overlap or gaps. */
export class DateRange {
  private constructor(
    public readonly start: Date,
    public readonly end: Date,
  ) {}

  static of(start: Date, end: Date): DateRange {
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new DomainValidationError('DateRange requires valid dates');
    }
    if (start.getTime() >= end.getTime()) {
      throw new DomainValidationError('DateRange.start must be strictly before DateRange.end', {
        start: start.toISOString(),
        end: end.toISOString(),
      });
    }
    return new DateRange(start, end);
  }

  contains(date: Date): boolean {
    const t = date.getTime();
    return t >= this.start.getTime() && t < this.end.getTime();
  }

  durationMs(): number {
    return this.end.getTime() - this.start.getTime();
  }

  toJSON(): { start: string; end: string } {
    return { start: this.start.toISOString(), end: this.end.toISOString() };
  }
}
