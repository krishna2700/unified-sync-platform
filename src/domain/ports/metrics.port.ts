export interface SyncDurationLabels {
  provider: string;
  entityType: string;
  mode: string;
  outcome: string;
}

export interface ProviderEntityLabels {
  provider: string;
  entityType: string;
}

export interface RetryLabels extends ProviderEntityLabels {
  operation: string;
}

export interface FailureLabels extends ProviderEntityLabels {
  errorCode: string;
}

export interface ProviderLabels {
  provider: string;
}

export interface WebhookOutcomeLabels extends ProviderLabels {
  outcome: string;
}

/**
 * Observability ability the application layer depends on without knowing it's Prometheus
 * underneath (src/infrastructure/observability/prometheus-metrics.ts). Every method is a pure
 * side effect with no return value, so a no-op implementation (used by default in tests) is
 * always a safe substitute.
 */
export interface Metrics {
  recordSyncDuration(labels: SyncDurationLabels, seconds: number): void;
  incrementRetry(labels: RetryLabels): void;
  incrementFailure(labels: FailureLabels): void;
  incrementWebhookDuplicate(labels: ProviderLabels): void;
  incrementWebhookProcessed(labels: WebhookOutcomeLabels): void;
}

export class NoopMetrics implements Metrics {
  recordSyncDuration(): void {}
  incrementRetry(): void {}
  incrementFailure(): void {}
  incrementWebhookDuplicate(): void {}
  incrementWebhookProcessed(): void {}
}
