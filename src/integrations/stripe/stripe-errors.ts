import type { SyncProviderError } from '../../domain/errors/sync-errors.js';
import type { EntityType } from '../../domain/value-objects/entity-type.js';
import { ProviderId } from '../../domain/value-objects/provider.js';
import { mapHttpStatusToSyncError } from '../shared/http-status-error-mapper.js';

interface StripeErrorLike {
  message: string;
  statusCode?: number;
  headers?: Record<string, string>;
}

function isStripeErrorLike(error: unknown): error is StripeErrorLike {
  return typeof error === 'object' && error !== null && 'message' in error && 'statusCode' in error;
}

export function mapStripeError(error: unknown, entityType: EntityType): SyncProviderError {
  if (isStripeErrorLike(error)) {
    const retryAfterHeader = error.headers?.['retry-after'];
    return mapHttpStatusToSyncError({
      status: error.statusCode,
      providerId: ProviderId.STRIPE,
      entityType,
      message: error.message,
      retryAfterMs: retryAfterHeader ? Number(retryAfterHeader) * 1000 : null,
      cause: error,
    });
  }
  return mapHttpStatusToSyncError({
    status: undefined,
    providerId: ProviderId.STRIPE,
    entityType,
    message: error instanceof Error ? error.message : 'Unknown Stripe error',
    cause: error,
  });
}
