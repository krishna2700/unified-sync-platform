import { describe, expect, it, vi } from 'vitest';
import type { calendar_v3 } from 'googleapis';
import { GoogleCalendarEventProvider } from '../../../src/integrations/google-calendar/google-calendar-event-provider.js';
import { SyncCursor } from '../../../src/domain/value-objects/sync-cursor.js';
import { InvalidCursorError } from '../../../src/domain/errors/sync-errors.js';

function buildFakeCalendar(
  list: (...args: unknown[]) => Promise<{ data: calendar_v3.Schema$Events }>,
): calendar_v3.Calendar {
  return { events: { list }, calendars: { get: vi.fn() } } as unknown as calendar_v3.Calendar;
}

const CONFIG = {
  clientId: 'x',
  clientSecret: 'y',
  redirectUri: 'z',
  refreshToken: 'r',
  calendarId: 'primary',
};

describe('GoogleCalendarEventProvider', () => {
  it('normalizes a confirmed timed event', () => {
    const provider = new GoogleCalendarEventProvider(CONFIG, buildFakeCalendar(vi.fn()));
    const normalized = provider.normalize({
      id: 'evt1',
      summary: 'Standup',
      status: 'confirmed',
      start: { dateTime: '2026-01-01T09:00:00Z', timeZone: 'UTC' },
      end: { dateTime: '2026-01-01T09:30:00Z' },
      attendees: [{ email: 'a@x.com', responseStatus: 'accepted' }],
    });

    expect(normalized.title).toBe('Standup');
    expect(normalized.status).toBe('confirmed');
    expect(normalized.start.toISOString()).toBe('2026-01-01T09:00:00.000Z');
    expect(normalized.attendees).toEqual([{ email: 'a@x.com', responseStatus: 'accepted' }]);
  });

  it('falls back to originalStartTime for a sparse cancelled-instance notification', () => {
    const provider = new GoogleCalendarEventProvider(CONFIG, buildFakeCalendar(vi.fn()));
    const normalized = provider.normalize({
      id: 'evt2',
      status: 'cancelled',
      recurringEventId: 'series1',
      originalStartTime: { dateTime: '2026-02-01T10:00:00Z' },
    });

    expect(normalized.status).toBe('cancelled');
    expect(normalized.start.toISOString()).toBe('2026-02-01T10:00:00.000Z');
    const result = provider.validate(normalized);
    expect(result.valid).toBe(true);
  });

  it('fails validation when an event has no start/end/originalStartTime at all', () => {
    const provider = new GoogleCalendarEventProvider(CONFIG, buildFakeCalendar(vi.fn()));
    const normalized = provider.normalize({ id: 'evt3', status: 'cancelled' });
    const result = provider.validate(normalized);
    expect(result.valid).toBe(false);
  });

  it('emits nextCursor from nextSyncToken only on the final page', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        data: { items: [{ id: '1', status: 'confirmed' }], nextPageToken: 'p2' },
      })
      .mockResolvedValueOnce({
        data: { items: [{ id: '2', status: 'confirmed' }], nextSyncToken: 'sync-1' },
      });
    const provider = new GoogleCalendarEventProvider(CONFIG, buildFakeCalendar(list));
    const cursor = SyncCursor.issue('old-token');

    const page1 = await provider.fetchIncremental(cursor, null);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeNull();

    const page2 = await provider.fetchIncremental(cursor, 'p2');
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor?.token).toBe('sync-1');
  });

  it('maps a 410 Gone response to InvalidCursorError, triggering the engine fallback', async () => {
    const list = vi
      .fn()
      .mockRejectedValue({ message: 'Sync token is no longer valid', response: { status: 410 } });
    const provider = new GoogleCalendarEventProvider(CONFIG, buildFakeCalendar(list));

    await expect(
      provider.fetchIncremental(SyncCursor.issue('expired'), null),
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });
});
