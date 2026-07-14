import type { ProviderId } from '../value-objects/provider.js';

export interface WebhookEventRecord {
  /** Derived per-provider so retried/duplicate deliveries collide on a DB unique constraint:
   * Stripe -> event.id, HubSpot -> `${subscriptionId}:${eventId}`, Google -> `${channelId}:${resourceId}:${messageNumber}`. */
  idempotencyKey: string;
  provider: ProviderId;
  eventType: string;
  payload: Record<string, unknown>;
  receivedAt: Date;
}

export type WebhookInsertOutcome = 'inserted' | 'duplicate';
export type WebhookProcessingStatus = 'received' | 'processed' | 'failed';

export interface WebhookEventRepository {
  /** Atomic claim: relies on a UNIQUE(idempotency_key) constraint, not app-level locking, so it
   * is safe under concurrent duplicate deliveries across multiple process instances. */
  recordIfNew(event: WebhookEventRecord): Promise<WebhookInsertOutcome>;
  /**
   * Needed to distinguish two different situations that both surface as `recordIfNew` returning
   * 'duplicate': (a) a delivery that was already fully processed — a true duplicate, safe to
   * no-op — versus (b) a delivery whose *first* processing attempt crashed or is still in
   * flight, where the redelivery is exactly the retry we want to actually (re)process. Skipping
   * case (b) would silently drop data on the very first transient failure.
   */
  getProcessingStatus(idempotencyKey: string): Promise<WebhookProcessingStatus | null>;
  markProcessed(
    idempotencyKey: string,
    status: 'processed' | 'failed',
    error?: string,
  ): Promise<void>;
}
