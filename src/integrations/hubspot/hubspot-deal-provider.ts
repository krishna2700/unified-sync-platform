import { Client } from '@hubspot/api-client';
import type { CanonicalDeal } from '../../domain/entities/canonical-deal.js';
import type {
  ProviderFetchResult,
  ProviderHealth,
  SyncProvider,
  ValidationResult,
} from '../../domain/ports/sync-provider.port.js';
import { EntityType } from '../../domain/value-objects/entity-type.js';
import { Money } from '../../domain/value-objects/money.js';
import { ProviderId } from '../../domain/value-objects/provider.js';
import { SyncCursor } from '../../domain/value-objects/sync-cursor.js';
import { decodePageToken, encodePageToken } from '../shared/page-token-codec.js';
import type { HubSpotConfig } from './hubspot-config.js';
import { mapHubSpotError } from './hubspot-errors.js';

export interface HubSpotDealRaw {
  id: string;
  properties: Record<string, string | null>;
  createdAt: Date;
  updatedAt: Date;
}

interface FullSyncPageToken {
  after: string | null;
  maxLastModifiedIso: string;
}

const DEAL_PROPERTIES = [
  'dealname',
  'dealstage',
  'amount',
  'pipeline',
  'closedate',
  'createdate',
  'hs_lastmodifieddate',
];
const PAGE_SIZE = 100;
const EPOCH = new Date(0).toISOString();
// HubSpot's default portal currency for deal `amount`. Multi-currency portals expose a separate
// `deal_currency_code` property; wiring that through is a documented future improvement rather
// than in scope here (see docs/adr/0004-hubspot-deal-currency.md).
const DEFAULT_DEAL_CURRENCY = 'USD';

// See the matching note in hubspot-contact-provider.ts: derived structurally from `Client`
// instead of deep-importing the SDK's internal (and NodeNext-unresolvable) Filter module.
type DealSearchRequest = Parameters<Client['crm']['deals']['searchApi']['doSearch']>[0];

export class HubSpotDealProvider implements SyncProvider<HubSpotDealRaw> {
  readonly providerId = ProviderId.HUBSPOT;
  readonly entityType = EntityType.DEAL;

  private readonly client: Client;

  constructor(config: HubSpotConfig, client?: Client) {
    this.client = client ?? new Client({ accessToken: config.accessToken });
  }

  async fetchIncremental(
    cursor: SyncCursor,
    pageToken: string | null,
  ): Promise<ProviderFetchResult<HubSpotDealRaw>> {
    try {
      const request: DealSearchRequest = {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'hs_lastmodifieddate',
                operator: 'GTE',
                value: cursor.token,
              } as never,
            ],
          },
        ],
        sorts: ['hs_lastmodifieddate'],
        limit: PAGE_SIZE,
        after: pageToken ?? undefined,
        properties: DEAL_PROPERTIES,
      };
      const response = await this.client.crm.deals.searchApi.doSearch(request);

      const records = response.results as unknown as HubSpotDealRaw[];
      const nextAfter = response.paging?.next?.after ?? null;
      const hasMore = nextAfter !== null;
      const lastRecord = records[records.length - 1];
      const nextCursor =
        !hasMore && lastRecord
          ? SyncCursor.issue(lastRecord.properties['hs_lastmodifieddate'] ?? cursor.token)
          : null;

      return { records, nextPageToken: hasMore ? nextAfter : null, nextCursor, hasMore };
    } catch (error) {
      throw mapHubSpotError(error, this.entityType);
    }
  }

  /** See the matching note on HubSpotContactProvider.fetchOne — webhook payloads only carry an
   * objectId, so the webhook route re-fetches the full deal and normalizes that. */
  async fetchOne(objectId: string): Promise<HubSpotDealRaw> {
    try {
      const response = await this.client.crm.deals.basicApi.getById(objectId, DEAL_PROPERTIES);
      return response as unknown as HubSpotDealRaw;
    } catch (error) {
      throw mapHubSpotError(error, this.entityType);
    }
  }

  async fetchFull(pageToken: string | null): Promise<ProviderFetchResult<HubSpotDealRaw>> {
    try {
      const decoded = decodePageToken<FullSyncPageToken>(pageToken) ?? {
        after: null,
        maxLastModifiedIso: EPOCH,
      };
      const response = await this.client.crm.deals.basicApi.getPage(
        PAGE_SIZE,
        decoded.after ?? undefined,
        DEAL_PROPERTIES,
      );

      const records = response.results as unknown as HubSpotDealRaw[];
      const maxLastModifiedIso = records.reduce((max, record) => {
        const value = record.properties['hs_lastmodifieddate'];
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

  normalize(raw: HubSpotDealRaw): CanonicalDeal {
    const props = raw.properties;
    const amountRaw = props['amount'];
    const amount =
      amountRaw !== null && amountRaw !== undefined && amountRaw !== ''
        ? Money.of(Math.round(Number.parseFloat(amountRaw) * 100), DEFAULT_DEAL_CURRENCY)
        : null;

    return {
      kind: 'deal',
      id: null,
      provider: this.providerId,
      sourceId: raw.id,
      dealName: props['dealname'] ?? '(untitled deal)',
      stage: props['dealstage'] ?? 'unknown',
      amount,
      pipeline: props['pipeline'] ?? null,
      closeDate: props['closedate'] ? new Date(props['closedate']) : null,
      // Associations require a separate per-record API call the search endpoint doesn't
      // return; left null rather than populated inconsistently between full and incremental
      // sync. See docs/adr/0004-hubspot-deal-currency.md for the tradeoff writeup.
      primaryContactSourceId: null,
      sourceCreatedAt: props['createdate']
        ? new Date(props['createdate'])
        : new Date(raw.createdAt),
      sourceUpdatedAt: props['hs_lastmodifieddate']
        ? new Date(props['hs_lastmodifieddate'])
        : new Date(raw.updatedAt),
      syncedAt: null,
      raw: { ...props, id: raw.id },
    };
  }

  validate(record: CanonicalDeal): ValidationResult {
    // dealName has no check here: normalize() always defaults a missing name to a placeholder
    // rather than reject the record — we'd rather sync a deal with a blank name than drop real
    // pipeline data over it, so there is no "dealName required" case left for validate() to catch.
    const issues: ValidationResult['issues'] = [];
    if (!record.sourceId) issues.push({ field: 'sourceId', message: 'sourceId is required' });
    return { valid: issues.length === 0, issues };
  }

  async health(): Promise<ProviderHealth> {
    try {
      await this.client.crm.deals.basicApi.getPage(1);
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
