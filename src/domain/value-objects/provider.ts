/**
 * A SourceSystem is a category of external system (what data it represents).
 * Multiple concrete providers can implement the same SourceSystem — e.g. today only
 * HubSpot implements CRM, but Salesforce or Pipedrive could be added later without
 * touching the sync engine, the canonical schema, or any downstream consumer.
 */
export const SourceSystem = {
  CRM: 'crm',
  PAYMENTS: 'payments',
  CALENDAR: 'calendar',
} as const;
export type SourceSystem = (typeof SourceSystem)[keyof typeof SourceSystem];

/**
 * Concrete provider identifiers. Adding a new provider means adding one entry here
 * plus one adapter under src/integrations — nothing in domain/application changes.
 */
export const ProviderId = {
  HUBSPOT: 'hubspot',
  GOOGLE_CALENDAR: 'google_calendar',
  STRIPE: 'stripe',
} as const;
export type ProviderId = (typeof ProviderId)[keyof typeof ProviderId];

export const PROVIDER_SOURCE_SYSTEM: Record<ProviderId, SourceSystem> = {
  [ProviderId.HUBSPOT]: SourceSystem.CRM,
  [ProviderId.GOOGLE_CALENDAR]: SourceSystem.CALENDAR,
  [ProviderId.STRIPE]: SourceSystem.PAYMENTS,
};

export function sourceSystemOf(providerId: ProviderId): SourceSystem {
  return PROVIDER_SOURCE_SYSTEM[providerId];
}

export function isProviderId(value: string): value is ProviderId {
  return Object.values(ProviderId).includes(value as ProviderId);
}
