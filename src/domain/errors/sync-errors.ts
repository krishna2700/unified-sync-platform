import type { EntityType } from '../value-objects/entity-type.js';
import type { ProviderId } from '../value-objects/provider.js';

export interface SyncErrorFlags {
  /** Safe to retry the same request (transient: network blip, timeout, rate limit, 5xx). */
  retryable: boolean;
  /**
   * The cursor can no longer be trusted (expired, revoked, provider returned 410 Gone,
   * or the cursor format is unrecognized). The engine must fall back to a full backfill.
   */
  requiresFullResync: boolean;
  /**
   * The provider cannot make any progress this run (e.g. OAuth token expired/revoked).
   * The engine marks the provider unhealthy and moves on to the next provider —
   * it must never let this abort the overall pipeline run.
   */
  isFatalForThisRun: boolean;
}

export abstract class SyncProviderError extends Error {
  abstract readonly code: string;
  abstract readonly flags: SyncErrorFlags;

  constructor(
    message: string,
    public readonly providerId: ProviderId,
    public readonly entityType: EntityType,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }

  toLogContext(): Record<string, unknown> {
    return {
      code: this.code,
      providerId: this.providerId,
      entityType: this.entityType,
      retryable: this.flags.retryable,
      requiresFullResync: this.flags.requiresFullResync,
      isFatalForThisRun: this.flags.isFatalForThisRun,
      cause: this.cause instanceof Error ? this.cause.message : this.cause,
    };
  }
}

export class StaleCursorError extends SyncProviderError {
  readonly code = 'STALE_CURSOR';
  readonly flags: SyncErrorFlags = {
    retryable: false,
    requiresFullResync: true,
    isFatalForThisRun: false,
  };
}

export class InvalidCursorError extends SyncProviderError {
  readonly code = 'INVALID_CURSOR';
  readonly flags: SyncErrorFlags = {
    retryable: false,
    requiresFullResync: true,
    isFatalForThisRun: false,
  };
}

export class ProviderRateLimitError extends SyncProviderError {
  readonly code = 'RATE_LIMITED';
  readonly flags: SyncErrorFlags = {
    retryable: true,
    requiresFullResync: false,
    isFatalForThisRun: false,
  };

  constructor(
    message: string,
    providerId: ProviderId,
    entityType: EntityType,
    public readonly retryAfterMs: number | null,
    cause?: unknown,
  ) {
    super(message, providerId, entityType, cause);
  }
}

export class ProviderTimeoutError extends SyncProviderError {
  readonly code = 'PROVIDER_TIMEOUT';
  readonly flags: SyncErrorFlags = {
    retryable: true,
    requiresFullResync: false,
    isFatalForThisRun: false,
  };
}

export class ProviderUnavailableError extends SyncProviderError {
  readonly code = 'PROVIDER_UNAVAILABLE';
  readonly flags: SyncErrorFlags = {
    retryable: true,
    requiresFullResync: false,
    isFatalForThisRun: false,
  };
}

export class ProviderAuthenticationError extends SyncProviderError {
  readonly code = 'AUTHENTICATION_EXPIRED';
  readonly flags: SyncErrorFlags = {
    retryable: false,
    requiresFullResync: false,
    isFatalForThisRun: true,
  };
}

export class MalformedResponseError extends SyncProviderError {
  readonly code = 'MALFORMED_RESPONSE';
  readonly flags: SyncErrorFlags = {
    retryable: false,
    requiresFullResync: false,
    isFatalForThisRun: false,
  };
}

export function isSyncProviderError(error: unknown): error is SyncProviderError {
  return error instanceof SyncProviderError;
}
