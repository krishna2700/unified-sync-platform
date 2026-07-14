import type { Clock } from '../../domain/ports/clock.port.js';
import type { Logger } from '../../domain/ports/logger.port.js';
import { type Metrics, NoopMetrics } from '../../domain/ports/metrics.port.js';
import { isSyncProviderError, ProviderRateLimitError } from '../../domain/errors/sync-errors.js';

export interface RetryPolicyConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface RetryContext {
  provider: string;
  entityType: string;
  operation: string;
}

export type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executes an operation with exponential backoff + jitter, retrying only errors the domain has
 * explicitly flagged `retryable` (rate limits, timeouts, transient 5xx). Anything else —
 * including plain bugs — is rethrown immediately rather than retried into a longer outage.
 */
export class RetryPolicy {
  constructor(
    private readonly config: RetryPolicyConfig,
    private readonly logger: Logger,
    private readonly clock: Clock = { now: () => new Date() },
    private readonly sleep: SleepFn = defaultSleep,
    private readonly metrics: Metrics = new NoopMetrics(),
  ) {}

  async execute<T>(fn: () => Promise<T>, ctx: RetryContext): Promise<T> {
    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        return await fn();
      } catch (error) {
        if (!isSyncProviderError(error)) {
          throw error;
        }
        const attemptsExhausted = attempt >= this.config.maxAttempts;
        if (!error.flags.retryable || attemptsExhausted) {
          throw error;
        }
        const explicitDelay = error instanceof ProviderRateLimitError ? error.retryAfterMs : null;
        const delayMs = explicitDelay ?? this.computeBackoffMs(attempt);
        this.metrics.incrementRetry(ctx);
        this.logger.warn('Retrying after transient sync failure', {
          ...ctx,
          attempt,
          maxAttempts: this.config.maxAttempts,
          delayMs,
          error: error.toLogContext(),
          retriedAt: this.clock.now().toISOString(),
        });
        await this.sleep(delayMs);
      }
    }
  }

  private computeBackoffMs(attempt: number): number {
    const exponential = this.config.baseDelayMs * 2 ** (attempt - 1);
    const capped = Math.min(exponential, this.config.maxDelayMs);
    const jitterFactor = 0.8 + Math.random() * 0.4; // +/-20% jitter avoids synchronized retry storms
    return Math.round(capped * jitterFactor);
  }
}
