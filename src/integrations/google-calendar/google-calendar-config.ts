export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Long-lived refresh token obtained once via the offline-consent OAuth2 flow
   * (scripts/google-oauth-init.ts); the adapter exchanges it for access tokens as needed. */
  refreshToken: string;
  calendarId: string;
}
