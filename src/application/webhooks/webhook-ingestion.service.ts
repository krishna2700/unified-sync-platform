import type { Logger } from '../../domain/ports/logger.port.js';
import { type Metrics, NoopMetrics } from '../../domain/ports/metrics.port.js';
import type { WebhookEventRepository } from '../../domain/ports/webhook-event-repository.port.js';
import type { ProviderId } from '../../domain/value-objects/provider.js';

export interface WebhookIngestionParams {
  idempotencyKey: string;
  provider: ProviderId;
  eventType: string;
  payload: Record<string, unknown>;
  process: () => Promise<void>;
}

export type WebhookIngestionOutcome = 'processed' | 'duplicate_skipped' | 'failed';

export interface WebhookIngestionResult {
  outcome: WebhookIngestionOutcome;
  error?: string;
}

/**
 * Shared duplicate-safe processing pipeline for every webhook route (Stripe, HubSpot, Google).
 * `recordIfNew` returning 'duplicate' is not automatically a no-op: it only means *some* delivery
 * with this idempotency key was seen before. If that earlier attempt never reached 'processed'
 * (it crashed mid-flight, or genuinely failed), this redelivery is the retry that's supposed to
 * make progress — skipping it would silently lose the event. Only a delivery whose prior status
 * is already 'processed' is treated as a true duplicate and skipped.
 */
export class WebhookIngestionService {
  constructor(
    private readonly webhookEventRepository: WebhookEventRepository,
    private readonly logger: Logger,
    private readonly metrics: Metrics = new NoopMetrics(),
  ) {}

  async ingest(params: WebhookIngestionParams): Promise<WebhookIngestionResult> {
    const log = this.logger.child({
      idempotencyKey: params.idempotencyKey,
      provider: params.provider,
    });

    const insertOutcome = await this.webhookEventRepository.recordIfNew({
      idempotencyKey: params.idempotencyKey,
      provider: params.provider,
      eventType: params.eventType,
      payload: params.payload,
      receivedAt: new Date(),
    });

    if (insertOutcome === 'duplicate') {
      const priorStatus = await this.webhookEventRepository.getProcessingStatus(
        params.idempotencyKey,
      );
      if (priorStatus === 'processed') {
        log.info('Duplicate webhook delivery skipped: already processed');
        this.metrics.incrementWebhookDuplicate({ provider: params.provider });
        return { outcome: 'duplicate_skipped' };
      }
      log.info('Redelivery of a not-yet-successfully-processed webhook; reprocessing', {
        priorStatus,
      });
    }

    try {
      await params.process();
      await this.webhookEventRepository.markProcessed(params.idempotencyKey, 'processed');
      this.metrics.incrementWebhookProcessed({ provider: params.provider, outcome: 'processed' });
      return { outcome: 'processed' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.webhookEventRepository.markProcessed(params.idempotencyKey, 'failed', message);
      log.error('Webhook processing failed', { error: message });
      this.metrics.incrementWebhookProcessed({ provider: params.provider, outcome: 'failed' });
      return { outcome: 'failed', error: message };
    }
  }
}
