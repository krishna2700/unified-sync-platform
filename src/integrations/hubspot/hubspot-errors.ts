import type { SyncProviderError } from '../../domain/errors/sync-errors.js';
import type { EntityType } from '../../domain/value-objects/entity-type.js';
import { ProviderId } from '../../domain/value-objects/provider.js';
import { mapHttpStatusToSyncError } from '../shared/http-status-error-mapper.js';

interface HubSpotApiExceptionLike {
  code?: number;
  message: string;
  headers?: Record<string, string>;
}

function isHubSpotApiException(error: unknown): error is HubSpotApiExceptionLike {
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
}

export function mapHubSpotError(error: unknown, entityType: EntityType): SyncProviderError {
  if (isHubSpotApiException(error)) {
    const retryAfterHeader = error.headers?.['retry-after'];
    return mapHttpStatusToSyncError({
      status: error.code,
      providerId: ProviderId.HUBSPOT,
      entityType,
      message: error.message,
      retryAfterMs: retryAfterHeader ? Number(retryAfterHeader) * 1000 : null,
      cause: error,
    });
  }
  return mapHttpStatusToSyncError({
    status: undefined,
    providerId: ProviderId.HUBSPOT,
    entityType,
    message: error instanceof Error ? error.message : 'Unknown HubSpot error',
    cause: error,
  });
}
