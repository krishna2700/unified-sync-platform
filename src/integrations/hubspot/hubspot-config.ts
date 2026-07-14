export interface HubSpotConfig {
  /** Private App access token from a HubSpot Developer test account (Settings > Integrations >
   * Private Apps). Chosen over full OAuth for HubSpot because it needs no refresh-token dance —
   * Google Calendar demonstrates the OAuth2 + refresh-token pattern instead, so both auth styles
   * are represented across the three providers. */
  accessToken: string;
}
