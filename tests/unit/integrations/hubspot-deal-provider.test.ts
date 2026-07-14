import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@hubspot/api-client';
import { HubSpotDealProvider } from '../../../src/integrations/hubspot/hubspot-deal-provider.js';
import { SyncCursor } from '../../../src/domain/value-objects/sync-cursor.js';
import {
  ProviderUnavailableError,
  InvalidCursorError,
} from '../../../src/domain/errors/sync-errors.js';

function buildFakeClient(overrides: {
  doSearch?: (req: unknown) => Promise<unknown>;
  getPage?: (...args: unknown[]) => Promise<unknown>;
  getById?: (...args: unknown[]) => Promise<unknown>;
}): Client {
  return {
    crm: {
      deals: {
        searchApi: { doSearch: overrides.doSearch ?? vi.fn() },
        basicApi: { getPage: overrides.getPage ?? vi.fn(), getById: overrides.getById ?? vi.fn() },
      },
    },
  } as unknown as Client;
}

function rawDeal(id: string, dealname: string, amount: string | null, hsLastModified: string) {
  return {
    id,
    properties: {
      dealname,
      dealstage: 'appointmentscheduled',
      amount,
      pipeline: 'default',
      closedate: null,
      createdate: hsLastModified,
      hs_lastmodifieddate: hsLastModified,
    },
    createdAt: new Date(hsLastModified),
    updatedAt: new Date(hsLastModified),
  };
}

describe('HubSpotDealProvider', () => {
  it('normalizes a raw deal, parsing amount into integer minor units', () => {
    const provider = new HubSpotDealProvider({ accessToken: 'x' }, buildFakeClient({}));
    const normalized = provider.normalize(
      rawDeal('1', 'Big Deal', '1500.50', '2026-01-01T00:00:00.000Z'),
    );

    expect(normalized.kind).toBe('deal');
    expect(normalized.dealName).toBe('Big Deal');
    expect(normalized.amount?.amountMinor).toBe(150050);
    expect(normalized.amount?.currency).toBe('USD');
  });

  it('treats a missing amount as null rather than zero', () => {
    const provider = new HubSpotDealProvider({ accessToken: 'x' }, buildFakeClient({}));
    const normalized = provider.normalize(
      rawDeal('2', 'No Amount Deal', null, '2026-01-01T00:00:00.000Z'),
    );
    expect(normalized.amount).toBeNull();
  });

  it('defaults a missing dealName to a placeholder rather than rejecting the record (never lose data)', () => {
    const provider = new HubSpotDealProvider({ accessToken: 'x' }, buildFakeClient({}));
    const raw = rawDeal('3', '', null, '2026-01-01T00:00:00.000Z');
    raw.properties.dealname = null as unknown as string;
    const normalized = provider.normalize(raw);

    expect(normalized.dealName).toBe('(untitled deal)');
    expect(provider.validate(normalized).valid).toBe(true);
  });

  it('flags a missing sourceId as a validation issue', () => {
    const provider = new HubSpotDealProvider({ accessToken: 'x' }, buildFakeClient({}));
    const normalized = provider.normalize(
      rawDeal('', 'Some Deal', '100', '2026-01-01T00:00:00.000Z'),
    );
    const result = provider.validate(normalized);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.field).toBe('sourceId');
  });

  it('sets nextCursor only on the final page of an incremental fetch', async () => {
    const doSearch = vi
      .fn()
      .mockResolvedValueOnce({
        results: [rawDeal('1', 'Deal A', '100', '2026-01-01T00:00:00.000Z')],
        paging: { next: { after: 'page2' } },
      })
      .mockResolvedValueOnce({
        results: [rawDeal('2', 'Deal B', '200', '2026-01-02T00:00:00.000Z')],
        paging: undefined,
      });
    const provider = new HubSpotDealProvider({ accessToken: 'x' }, buildFakeClient({ doSearch }));
    const cursor = SyncCursor.issue('2025-01-01T00:00:00.000Z');

    const page1 = await provider.fetchIncremental(cursor, null);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeNull();

    const page2 = await provider.fetchIncremental(cursor, 'page2');
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor?.token).toBe('2026-01-02T00:00:00.000Z');
  });

  it('tracks a running max-lastmodified watermark across full-sync pages', async () => {
    const getPage = vi
      .fn()
      .mockResolvedValueOnce({
        results: [rawDeal('1', 'Deal A', '100', '2026-01-05T00:00:00.000Z')],
        paging: { next: { after: 'page2' } },
      })
      .mockResolvedValueOnce({
        results: [rawDeal('2', 'Deal B', '200', '2026-01-01T00:00:00.000Z')], // older than page 1
        paging: undefined,
      });
    const provider = new HubSpotDealProvider({ accessToken: 'x' }, buildFakeClient({ getPage }));

    const page1 = await provider.fetchFull(null);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeNull();

    const page2 = await provider.fetchFull(page1.nextPageToken);
    expect(page2.hasMore).toBe(false);
    // max(2026-01-05, 2026-01-01) = 2026-01-05, correctly retained despite the older page-2 record
    expect(page2.nextCursor?.token).toBe('2026-01-05T00:00:00.000Z');
  });

  it('fetches a single deal by id for webhook-triggered re-normalization', async () => {
    const getById = vi
      .fn()
      .mockResolvedValue(rawDeal('42', 'Webhook Deal', '999', '2026-01-01T00:00:00.000Z'));
    const provider = new HubSpotDealProvider({ accessToken: 'x' }, buildFakeClient({ getById }));

    const raw = await provider.fetchOne('42');
    expect(raw.id).toBe('42');
    expect(getById).toHaveBeenCalledWith('42', expect.any(Array));
  });

  it('maps a 410 response to InvalidCursorError', async () => {
    const doSearch = vi.fn().mockRejectedValue({ code: 410, message: 'gone' });
    const provider = new HubSpotDealProvider({ accessToken: 'x' }, buildFakeClient({ doSearch }));

    await expect(
      provider.fetchIncremental(SyncCursor.issue('2025-01-01T00:00:00.000Z'), null),
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });

  it('maps a 500 response to a retryable ProviderUnavailableError', async () => {
    const getPage = vi.fn().mockRejectedValue({ code: 500, message: 'internal error' });
    const provider = new HubSpotDealProvider({ accessToken: 'x' }, buildFakeClient({ getPage }));

    await expect(provider.fetchFull(null)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('health() reports unhealthy on a failing request instead of throwing', async () => {
    const getPage = vi.fn().mockRejectedValue({ code: 500, message: 'down' });
    const provider = new HubSpotDealProvider({ accessToken: 'x' }, buildFakeClient({ getPage }));

    const health = await provider.health();
    expect(health.healthy).toBe(false);
  });
});
