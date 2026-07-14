import type { CanonicalContact } from '../../src/domain/entities/canonical-contact.js';
import type {
  ProviderFetchResult,
  ProviderHealth,
  SyncProvider,
  ValidationResult,
} from '../../src/domain/ports/sync-provider.port.js';
import type { EntityType } from '../../src/domain/value-objects/entity-type.js';
import type { ProviderId } from '../../src/domain/value-objects/provider.js';
import type { SyncCursor } from '../../src/domain/value-objects/sync-cursor.js';

export interface RawFakeContact {
  id: string;
  email: string;
  updatedAt: string;
}

/**
 * A fully scriptable SyncProvider test double. Each test wires `fetchIncrementalImpl` /
 * `fetchFullImpl` to whatever sequence of responses/errors it wants to assert against, without
 * needing HubSpot/Google/Stripe credentials or network access.
 */
export class FakeSyncProvider implements SyncProvider<RawFakeContact> {
  fetchIncrementalImpl: (
    cursor: SyncCursor,
    pageToken: string | null,
  ) => Promise<ProviderFetchResult<RawFakeContact>>;
  fetchFullImpl: (pageToken: string | null) => Promise<ProviderFetchResult<RawFakeContact>>;
  healthImpl: () => Promise<ProviderHealth>;
  validateImpl: (record: CanonicalContact) => ValidationResult;

  readonly fetchIncrementalCalls: Array<{ cursor: SyncCursor; pageToken: string | null }> = [];
  readonly fetchFullCalls: Array<{ pageToken: string | null }> = [];

  constructor(
    public readonly providerId: ProviderId,
    public readonly entityType: EntityType,
  ) {
    this.fetchIncrementalImpl = async () => ({
      records: [],
      nextPageToken: null,
      nextCursor: null,
      hasMore: false,
    });
    this.fetchFullImpl = async () => ({
      records: [],
      nextPageToken: null,
      nextCursor: null,
      hasMore: false,
    });
    this.healthImpl = async () => ({ healthy: true, checkedAt: new Date() });
    this.validateImpl = () => ({ valid: true, issues: [] });
  }

  async fetchIncremental(
    cursor: SyncCursor,
    pageToken: string | null,
  ): Promise<ProviderFetchResult<RawFakeContact>> {
    this.fetchIncrementalCalls.push({ cursor, pageToken });
    return this.fetchIncrementalImpl(cursor, pageToken);
  }

  async fetchFull(pageToken: string | null): Promise<ProviderFetchResult<RawFakeContact>> {
    this.fetchFullCalls.push({ pageToken });
    return this.fetchFullImpl(pageToken);
  }

  normalize(raw: RawFakeContact): CanonicalContact {
    return {
      kind: 'contact',
      id: null,
      provider: this.providerId,
      sourceId: raw.id,
      email: raw.email,
      firstName: null,
      lastName: null,
      phone: null,
      company: null,
      lifecycleStage: null,
      sourceCreatedAt: null,
      sourceUpdatedAt: new Date(raw.updatedAt),
      syncedAt: null,
      raw: { ...raw },
    };
  }

  validate(record: CanonicalContact): ValidationResult {
    return this.validateImpl(record);
  }

  async health(): Promise<ProviderHealth> {
    return this.healthImpl();
  }
}
