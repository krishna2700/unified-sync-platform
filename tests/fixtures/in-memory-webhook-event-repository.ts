import type {
  WebhookEventRecord,
  WebhookEventRepository,
  WebhookInsertOutcome,
  WebhookProcessingStatus,
} from '../../src/domain/ports/webhook-event-repository.port.js';

export class InMemoryWebhookEventRepository implements WebhookEventRepository {
  private readonly events = new Map<
    string,
    { record: WebhookEventRecord; status: WebhookProcessingStatus }
  >();

  async recordIfNew(event: WebhookEventRecord): Promise<WebhookInsertOutcome> {
    if (this.events.has(event.idempotencyKey)) return 'duplicate';
    this.events.set(event.idempotencyKey, { record: event, status: 'received' });
    return 'inserted';
  }

  async getProcessingStatus(idempotencyKey: string): Promise<WebhookProcessingStatus | null> {
    return this.events.get(idempotencyKey)?.status ?? null;
  }

  async markProcessed(idempotencyKey: string, status: 'processed' | 'failed'): Promise<void> {
    const existing = this.events.get(idempotencyKey);
    if (existing) existing.status = status;
  }
}
