import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@hubspot/api-client';
import { HubSpotContactProvider } from '../../../src/integrations/hubspot/hubspot-contact-provider.js';
import { SyncCursor } from '../../../src/domain/value-objects/sync-cursor.js';
import {
  ProviderRateLimitError,
  ProviderAuthenticationError,
} from '../../../src/domain/errors/sync-errors.js';

function buildFakeClient(overrides: {
  doSearch?: (req: unknown) => Promise<unknown>;
  getPage?: (...args: unknown[]) => Promise<unknown>;
}): Client {
  return {
    crm: {
      contacts: {
        searchApi: { doSearch: overrides.doSearch ?? vi.fn() },
        basicApi: { getPage: overrides.getPage ?? vi.fn() },
      },
    },
  } as unknown as Client;
}

function rawContact(id: string, email: string, lastmodifieddate: string) {
  return {
    id,
    properties: {
      email,
      firstname: 'Ada',
      lastname: 'Lovelace',
      lastmodifieddate,
      createdate: lastmodifieddate,
    },
    createdAt: new Date(lastmodifieddate),
    updatedAt: new Date(lastmodifieddate),
  };
}

describe('HubSpotContactProvider', () => {
  it('normalizes a raw contact into a CanonicalContact', () => {
    const provider = new HubSpotContactProvider({ accessToken: 'x' }, buildFakeClient({}));
    const normalized = provider.normalize(
      rawContact('1', 'ada@example.com', '2026-01-01T00:00:00.000Z'),
    );

    expect(normalized.kind).toBe('contact');
    expect(normalized.sourceId).toBe('1');
    expect(normalized.email).toBe('ada@example.com');
    expect(normalized.firstName).toBe('Ada');
  });

  it('flags an invalid email as a validation issue', () => {
    const provider = new HubSpotContactProvider({ accessToken: 'x' }, buildFakeClient({}));
    const normalized = provider.normalize(
      rawContact('1', 'not-an-email', '2026-01-01T00:00:00.000Z'),
    );
    const result = provider.validate(normalized);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.field).toBe('email');
  });

  it('sets nextCursor only on the final page of an incremental fetch', async () => {
    const doSearch = vi
      .fn()
      .mockResolvedValueOnce({
        results: [rawContact('1', 'a@x.com', '2026-01-01T00:00:00.000Z')],
        paging: { next: { after: 'page2' } },
      })
      .mockResolvedValueOnce({
        results: [rawContact('2', 'b@x.com', '2026-01-02T00:00:00.000Z')],
        paging: undefined,
      });
    const provider = new HubSpotContactProvider(
      { accessToken: 'x' },
      buildFakeClient({ doSearch }),
    );
    const cursor = SyncCursor.issue('2025-01-01T00:00:00.000Z');

    const page1 = await provider.fetchIncremental(cursor, null);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeNull();
    expect(page1.nextPageToken).toBe('page2');

    const page2 = await provider.fetchIncremental(cursor, 'page2');
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor?.token).toBe('2026-01-02T00:00:00.000Z');
  });

  it('maps a 429 response to a retryable ProviderRateLimitError', async () => {
    const doSearch = vi
      .fn()
      .mockRejectedValue({ code: 429, message: 'rate limited', headers: { 'retry-after': '2' } });
    const provider = new HubSpotContactProvider(
      { accessToken: 'x' },
      buildFakeClient({ doSearch }),
    );

    await expect(
      provider.fetchIncremental(SyncCursor.issue('2025-01-01T00:00:00.000Z'), null),
    ).rejects.toBeInstanceOf(ProviderRateLimitError);
  });

  it('maps a 401 response to a fatal ProviderAuthenticationError', async () => {
    const doSearch = vi.fn().mockRejectedValue({ code: 401, message: 'token expired' });
    const provider = new HubSpotContactProvider(
      { accessToken: 'x' },
      buildFakeClient({ doSearch }),
    );

    await expect(
      provider.fetchIncremental(SyncCursor.issue('2025-01-01T00:00:00.000Z'), null),
    ).rejects.toBeInstanceOf(ProviderAuthenticationError);
  });
});
