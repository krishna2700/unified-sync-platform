import type { SyncProviderError } from '../../domain/errors/sync-errors.js';
import type { EntityType } from '../../domain/value-objects/entity-type.js';
import { ProviderId } from '../../domain/value-objects/provider.js';
import { mapHttpStatusToSyncError } from '../shared/http-status-error-mapper.js';

interface GaxiosErrorLike {
  message: string;
  response?: {
    status?: number;
    headers?: Record<string, string>;
  };
}

function isGaxiosErrorLike(error: unknown): error is GaxiosErrorLike {
  return typeof error === 'object' && error !== null && 'message' in error;
}

export function mapGoogleCalendarError(error: unknown, entityType: EntityType): SyncProviderError {
  if (isGaxiosErrorLike(error)) {
    const status = error.response?.status;
    const retryAfterHeader = error.response?.headers?.['retry-after'];
    return mapHttpStatusToSyncError({
      status,
      providerId: ProviderId.GOOGLE_CALENDAR,
      entityType,
      message: error.message,
      retryAfterMs: retryAfterHeader ? Number(retryAfterHeader) * 1000 : null,
      cause: error,
    });
  }
  return mapHttpStatusToSyncError({
    status: undefined,
    providerId: ProviderId.GOOGLE_CALENDAR,
    entityType,
    message: error instanceof Error ? error.message : 'Unknown Google Calendar error',
    cause: error,
  });
}
