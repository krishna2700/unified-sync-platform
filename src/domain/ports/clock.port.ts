/** Injected time source so every time-dependent rule (cursor staleness, revenue buckets, retry
 * backoff) is deterministically testable without faking global Date. */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
