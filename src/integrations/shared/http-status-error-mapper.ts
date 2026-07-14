import {
  InvalidCursorError,
  MalformedResponseError,
  ProviderAuthenticationError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  type SyncProviderError,
} from '../../domain/errors/sync-errors.js';
import type { EntityType } from '../../domain/value-objects/entity-type.js';
import type { ProviderId } from '../../domain/value-objects/provider.js';

export interface MapHttpStatusParams {
  status: number | undefined;
  providerId: ProviderId;
  entityType: EntityType;
  message: string;
  retryAfterMs?: number | null;
  cause?: unknown;
}

/**
 * Shared HTTP-status -> domain-error translation used by every adapter, so "401 means the
 * integration is broken until re-authorized" / "429 means back off" / "5xx means try again
 * later" is decided in exactly one place instead of being re-implemented per provider.
 */
export function mapHttpStatusToSyncError(params: MapHttpStatusParams): SyncProviderError {
  const { status, providerId, entityType, message, retryAfterMs, cause } = params;

  if (status === 401 || status === 403) {
    return new ProviderAuthenticationError(message, providerId, entityType, cause);
  }
  if (status === 410) {
    return new InvalidCursorError(message, providerId, entityType, cause);
  }
  if (status === 429) {
    return new ProviderRateLimitError(message, providerId, entityType, retryAfterMs ?? null, cause);
  }
  if (status !== undefined && status >= 500) {
    return new ProviderUnavailableError(message, providerId, entityType, cause);
  }
  if (status !== undefined && status >= 400) {
    return new MalformedResponseError(message, providerId, entityType, cause);
  }
  // No status code at all typically means a network failure/timeout rather than an API response.
  return new ProviderTimeoutError(message, providerId, entityType, cause);
}
