import 'dotenv/config';
import { google } from 'googleapis';

/**
 * Seeds the configured Google Calendar with realistic sample events: a mix of past (already
 * happened) and future events, an all-day event, a recurring event, and one explicitly cancelled
 * event — exercising the same event-status vocabulary the sync adapter normalizes.
 */
async function main(): Promise<void> {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  const redirectUri = process.env['GOOGLE_REDIRECT_URI'];
  const refreshToken = process.env['GOOGLE_REFRESH_TOKEN'];
  const calendarId = process.env['GOOGLE_CALENDAR_ID'] ?? 'primary';

  if (!clientId || !clientSecret || !redirectUri || !refreshToken) {
    console.error('Google OAuth env vars are not fully set — nothing to seed. See .env.example.');
    process.exitCode = 1;
    return;
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  auth.setCredentials({ refresh_token: refreshToken });
  const calendar = google.calendar({ version: 'v3', auth });

  const now = new Date();
  const inDays = (days: number): Date => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const events = [
    {
      summary: 'Quarterly Business Review',
      description: 'Sample seeded event: past meeting.',
      start: { dateTime: inDays(-14).toISOString() },
      end: { dateTime: new Date(inDays(-14).getTime() + 60 * 60 * 1000).toISOString() },
    },
    {
      summary: 'Customer Onboarding Call',
      description: 'Sample seeded event: upcoming meeting.',
      start: { dateTime: inDays(2).toISOString() },
      end: { dateTime: new Date(inDays(2).getTime() + 30 * 60 * 1000).toISOString() },
    },
    {
      summary: 'Product Roadmap Planning',
      description: 'Sample seeded event: all-day.',
      start: { date: inDays(5).toISOString().slice(0, 10) },
      end: { date: inDays(6).toISOString().slice(0, 10) },
    },
    {
      summary: 'Weekly Team Sync',
      description: 'Sample seeded event: recurring.',
      start: { dateTime: inDays(1).toISOString() },
      end: { dateTime: new Date(inDays(1).getTime() + 30 * 60 * 1000).toISOString() },
      recurrence: ['RRULE:FREQ=WEEKLY;COUNT=4'],
    },
    {
      summary: 'Cancelled Demo',
      description:
        'Sample seeded event: created then cancelled to exercise status=cancelled handling.',
      start: { dateTime: inDays(3).toISOString() },
      end: { dateTime: new Date(inDays(3).getTime() + 30 * 60 * 1000).toISOString() },
      status: 'cancelled',
    },
  ];

  for (const event of events) {
    const response = await calendar.events.insert({ calendarId, requestBody: event });
    console.log(`Created event: ${event.summary} (${response.data.id})`);
  }

  console.log(`Seeded ${events.length} events in Google Calendar (${calendarId}).`);
}

main().catch((error: unknown) => {
  console.error('Google Calendar seed failed:', error);
  process.exitCode = 1;
});
