import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type {
  FailureLabels,
  Metrics,
  ProviderLabels,
  RetryLabels,
  SyncDurationLabels,
  WebhookOutcomeLabels,
} from '../../domain/ports/metrics.port.js';

export class PrometheusMetrics implements Metrics {
  readonly registry = new Registry();

  private readonly syncDuration = new Histogram({
    name: 'sync_duration_seconds',
    help: 'Duration of a sync run, one observation per (provider, entityType, mode, outcome)',
    labelNames: ['provider', 'entity_type', 'mode', 'outcome'],
    buckets: [0.1, 0.5, 1, 5, 15, 30, 60, 120, 300, 900],
    registers: [this.registry],
  });

  private readonly retryTotal = new Counter({
    name: 'sync_retry_total',
    help: 'Number of retried provider requests, by provider/entityType/operation',
    labelNames: ['provider', 'entity_type', 'operation'],
    registers: [this.registry],
  });

  private readonly failureTotal = new Counter({
    name: 'sync_failure_total',
    help: 'Number of sync failures, by provider/entityType/errorCode',
    labelNames: ['provider', 'entity_type', 'error_code'],
    registers: [this.registry],
  });

  private readonly webhookDuplicateTotal = new Counter({
    name: 'webhook_duplicate_total',
    help: 'Number of webhook deliveries recognized and skipped as duplicates, by provider',
    labelNames: ['provider'],
    registers: [this.registry],
  });

  private readonly webhookProcessedTotal = new Counter({
    name: 'webhook_processed_total',
    help: 'Number of webhook deliveries that ran processing, by provider and outcome',
    labelNames: ['provider', 'outcome'],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  recordSyncDuration(labels: SyncDurationLabels, seconds: number): void {
    this.syncDuration.observe(
      {
        provider: labels.provider,
        entity_type: labels.entityType,
        mode: labels.mode,
        outcome: labels.outcome,
      },
      seconds,
    );
  }

  incrementRetry(labels: RetryLabels): void {
    this.retryTotal.inc({
      provider: labels.provider,
      entity_type: labels.entityType,
      operation: labels.operation,
    });
  }

  incrementFailure(labels: FailureLabels): void {
    this.failureTotal.inc({
      provider: labels.provider,
      entity_type: labels.entityType,
      error_code: labels.errorCode,
    });
  }

  incrementWebhookDuplicate(labels: ProviderLabels): void {
    this.webhookDuplicateTotal.inc({ provider: labels.provider });
  }

  incrementWebhookProcessed(labels: WebhookOutcomeLabels): void {
    this.webhookProcessedTotal.inc({ provider: labels.provider, outcome: labels.outcome });
  }
}
