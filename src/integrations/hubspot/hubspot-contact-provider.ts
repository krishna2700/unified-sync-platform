import { Client } from '@hubspot/api-client';
import type { CanonicalContact } from '../../domain/entities/canonical-contact.js';
import type {
  ProviderFetchResult,
  ProviderHealth,
  SyncProvider,
  ValidationResult,
} from '../../domain/ports/sync-provider.port.js';
import { EntityType } from '../../domain/value-objects/entity-type.js';
import { ProviderId } from '../../domain/value-objects/provider.js';
import { SyncCursor } from '../../domain/value-objects/sync-cursor.js';
import { decodePageToken, encodePageToken } from '../shared/page-token-codec.js';
import type { HubSpotConfig } from './hubspot-config.js';
import { mapHubSpotError } from './hubspot-errors.js';

export interface HubSpotContactRaw {
  id: string;
  properties: Record<string, string | null>;
  createdAt: Date;
  updatedAt: Date;
}

interface FullSyncPageToken {
  after: string | null;
  maxLastModifiedIso: string;
}

const CONTACT_PROPERTIES = [
  'email',
  'firstname',
  'lastname',
  'phone',
  'company',
  'lifecyclestage',
  'createdate',
  'lastmodifieddate',
];
const PAGE_SIZE = 100;
const EPOCH = new Date(0).toISOString();

/**
 * The generated `FilterOperatorEnum` type isn't re-exported from the package's public entry
 * point, and deep-importing its internal codegen module doesn't resolve cleanly under NodeNext
 * module resolution. Deriving the request type structurally from `Client` (which we already
 * import) avoids needing that import at all while still type-checking the request shape.
 */
type ContactSearchRequest = Parameters<Client['crm']['contacts']['searchApi']['doSearch']>[0];

/**
 * HubSpot CRM Contacts as the "CRM" provider. Incremental sync uses the CRM Search API filtered
 * on `lastmodifieddate >= watermark`, sorted ascending by the same property, so the last record
 * of the final page is always the new high-watermark cursor. Full sync uses the plain paged
 * listing endpoint (no filter, no guaranteed sort by lastmodifieddate), so it tracks a running
 * max-seen timestamp through the opaque pageToken to seed the following run's incremental cursor.
 */
export class HubSpotContactProvider implements SyncProvider<HubSpotContactRaw> {
  readonly providerId = ProviderId.HUBSPOT;
  readonly entityType = EntityType.CONTACT;

  private readonly client: Client;

  /** `client` is injectable so tests can pass a fake satisfying the same shape instead of
   * hitting the real HubSpot API; the composition root omits it and gets the real SDK client. */
  constructor(config: HubSpotConfig, client?: Client) {
    this.client = client ?? new Client({ accessToken: config.accessToken });
  }

  async fetchIncremental(
    cursor: SyncCursor,
    pageToken: string | null,
  ): Promise<ProviderFetchResult<HubSpotContactRaw>> {
    try {
      const request: ContactSearchRequest = {
        filterGroups: [
          {
            filters: [
              { propertyName: 'lastmodifieddate', operator: 'GTE', value: cursor.token } as never,
            ],
          },
        ],
        sorts: ['lastmodifieddate'],
        limit: PAGE_SIZE,
        after: pageToken ?? undefined,
        properties: CONTACT_PROPERTIES,
      };
      const response = await this.client.crm.contacts.searchApi.doSearch(request);

      const records = response.results as unknown as HubSpotContactRaw[];
      const nextAfter = response.paging?.next?.after ?? null;
      const hasMore = nextAfter !== null;
      const lastRecord = records[records.length - 1];
      // Only the final page yields a durable cursor: mid-run pages don't yet know the true
      // maximum lastmodifieddate across the whole incremental catch-up.
      const nextCursor =
        !hasMore && lastRecord
          ? SyncCursor.issue(lastRecord.properties['lastmodifieddate'] ?? cursor.token)
          : null;

      return { records, nextPageToken: hasMore ? nextAfter : null, nextCursor, hasMore };
    } catch (error) {
      throw mapHubSpotError(error, this.entityType);
    }
  }

  /**
   * Used by the webhook route: HubSpot's webhook payload is a lightweight change notification
   * (objectId + which property changed), not the full object, so processing one means fetching
   * the current full state by id and normalizing that — the same `normalize()` used by sync.
   */
  async fetchOne(objectId: string): Promise<HubSpotContactRaw> {
    try {
      const response = await this.client.crm.contacts.basicApi.getById(
        objectId,
        CONTACT_PROPERTIES,
      );
      return response as unknown as HubSpotContactRaw;
    } catch (error) {
      throw mapHubSpotError(error, this.entityType);
    }
  }

  async fetchFull(pageToken: string | null): Promise<ProviderFetchResult<HubSpotContactRaw>> {
    try {
      const decoded = decodePageToken<FullSyncPageToken>(pageToken) ?? {
        after: null,
        maxLastModifiedIso: EPOCH,
      };
      const response = await this.client.crm.contacts.basicApi.getPage(
        PAGE_SIZE,
        decoded.after ?? undefined,
        CONTACT_PROPERTIES,
      );

      const records = response.results as unknown as HubSpotContactRaw[];
      const maxLastModifiedIso = records.reduce((max, record) => {
        const value = record.properties['lastmodifieddate'];
        return value && value > max ? value : max;
      }, decoded.maxLastModifiedIso);

      const nextAfter = response.paging?.next?.after ?? null;
      const hasMore = nextAfter !== null;
      const nextPageToken = hasMore
        ? encodePageToken<FullSyncPageToken>({ after: nextAfter, maxLastModifiedIso })
        : null;
      const nextCursor = hasMore ? null : SyncCursor.issue(maxLastModifiedIso);

      return { records, nextPageToken, nextCursor, hasMore };
    } catch (error) {
      throw mapHubSpotError(error, this.entityType);
    }
  }

  normalize(raw: HubSpotContactRaw): CanonicalContact {
    const props = raw.properties;
    return {
      kind: 'contact',
      id: null,
      provider: this.providerId,
      sourceId: raw.id,
      email: props['email'] ?? null,
      firstName: props['firstname'] ?? null,
      lastName: props['lastname'] ?? null,
      phone: props['phone'] ?? null,
      company: props['company'] ?? null,
      lifecycleStage: props['lifecyclestage'] ?? null,
      sourceCreatedAt: props['createdate']
        ? new Date(props['createdate'])
        : new Date(raw.createdAt),
      sourceUpdatedAt: props['lastmodifieddate']
        ? new Date(props['lastmodifieddate'])
        : new Date(raw.updatedAt),
      syncedAt: null,
      raw: { ...props, id: raw.id },
    };
  }

  validate(record: CanonicalContact): ValidationResult {
    const issues: ValidationResult['issues'] = [];
    if (!record.sourceId) issues.push({ field: 'sourceId', message: 'sourceId is required' });
    if (record.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) {
      issues.push({ field: 'email', message: 'email is not a valid address' });
    }
    return { valid: issues.length === 0, issues };
  }

  async health(): Promise<ProviderHealth> {
    try {
      await this.client.crm.contacts.basicApi.getPage(1);
      return { healthy: true, checkedAt: new Date() };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        checkedAt: new Date(),
      };
    }
  }
}
