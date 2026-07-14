import { SystemClock } from '../domain/ports/clock.port.js';
import type { Logger } from '../domain/ports/logger.port.js';
import { loadEnv, type Env } from '../infrastructure/config/env.js';
import { PinoLogger } from '../infrastructure/logging/pino-logger.js';
import { getPrismaClient } from '../infrastructure/db/prisma-client.js';
import { PrismaCursorRepository } from '../infrastructure/repositories/prisma-cursor.repository.js';
import { PrismaSyncPersistence } from '../infrastructure/repositories/prisma-sync-persistence.repository.js';
import { PrismaSyncMetadataRepository } from '../infrastructure/repositories/prisma-sync-metadata.repository.js';
import { PrismaJobHistoryRepository } from '../infrastructure/repositories/prisma-job-history.repository.js';
import { PrismaFailureLogRepository } from '../infrastructure/repositories/prisma-failure-log.repository.js';
import { PrismaWebhookEventRepository } from '../infrastructure/repositories/prisma-webhook-event.repository.js';
import { PrismaIdempotencyKeyRepository } from '../infrastructure/repositories/prisma-idempotency-key.repository.js';
import { PrismaPaymentStatusMappingRepository } from '../infrastructure/repositories/prisma-payment-status-mapping.repository.js';
import { PrismaRevenueRepository } from '../infrastructure/repositories/prisma-revenue.repository.js';
import { PrismaSyncLock } from '../infrastructure/repositories/prisma-sync-lock.js';
import { RetryPolicy } from '../application/sync/retry-policy.js';
import { SyncEngine } from '../application/sync/sync-engine.js';
import { ProviderRegistry } from '../application/sync/provider-registry.js';
import { RevenueCalculator } from '../application/revenue/revenue-calculator.js';
import { ConfigurablePaymentStatusMapper } from '../application/revenue/configurable-payment-status-mapper.js';
import { WebhookIngestionService } from '../application/webhooks/webhook-ingestion.service.js';
import { PrometheusMetrics } from '../infrastructure/observability/prometheus-metrics.js';
import { HubSpotContactProvider } from '../integrations/hubspot/hubspot-contact-provider.js';
import { HubSpotDealProvider } from '../integrations/hubspot/hubspot-deal-provider.js';
import { GoogleCalendarEventProvider } from '../integrations/google-calendar/google-calendar-event-provider.js';
import { StripePaymentProvider } from '../integrations/stripe/stripe-payment-provider.js';
import type { JobHistoryRepository } from '../domain/ports/job-history-repository.port.js';
import type { SyncMetadataRepository } from '../domain/ports/sync-metadata-repository.port.js';
import type { FailureLogRepository } from '../domain/ports/failure-log-repository.port.js';
import type { WebhookEventRepository } from '../domain/ports/webhook-event-repository.port.js';
import type { IdempotencyKeyRepository } from '../domain/ports/idempotency-key-repository.port.js';
import type { CursorRepository } from '../domain/ports/cursor-repository.port.js';
import type { SyncPersistencePort } from '../domain/ports/sync-persistence.port.js';
import type { PrismaClient } from '@prisma/client';

export interface CompositionRoot {
  env: Env;
  logger: Logger;
  prisma: PrismaClient;
  syncEngine: SyncEngine;
  providerRegistry: ProviderRegistry;
  revenueCalculator: RevenueCalculator;
  statusMapper: ConfigurablePaymentStatusMapper;
  cursorRepository: CursorRepository;
  jobHistoryRepository: JobHistoryRepository;
  syncMetadataRepository: SyncMetadataRepository;
  failureLogRepository: FailureLogRepository;
  webhookEventRepository: WebhookEventRepository;
  idempotencyKeyRepository: IdempotencyKeyRepository;
  syncPersistence: SyncPersistencePort;
  webhookIngestionService: WebhookIngestionService;
  metrics: PrometheusMetrics;
}

/**
 * The one place concrete adapters get wired to the ports the application/domain layers depend
 * on. Everything above this file (sync engine, revenue calculator, routes) only ever sees
 * interfaces; everything below it (Prisma, HubSpot/Google/Stripe SDKs) is invisible past here.
 *
 * A provider is registered only if its required env vars are present — a missing credential for
 * one provider degrades that provider gracefully (it's simply absent from the registry, and the
 * sync engine/health endpoints report it as unconfigured) rather than crashing the whole app.
 */
export async function buildCompositionRoot(): Promise<CompositionRoot> {
  const env = loadEnv();
  const logger = PinoLogger.create(env.LOG_LEVEL);
  const prisma = getPrismaClient();

  const cursorRepository = new PrismaCursorRepository(prisma);
  const syncPersistence = new PrismaSyncPersistence(prisma);
  const syncMetadataRepository = new PrismaSyncMetadataRepository(prisma);
  const jobHistoryRepository = new PrismaJobHistoryRepository(prisma);
  const failureLogRepository = new PrismaFailureLogRepository(prisma);
  const webhookEventRepository = new PrismaWebhookEventRepository(prisma);
  const idempotencyKeyRepository = new PrismaIdempotencyKeyRepository(prisma);
  const paymentStatusMappingRepository = new PrismaPaymentStatusMappingRepository(prisma);
  const revenueRepository = new PrismaRevenueRepository(prisma);
  const syncLock = new PrismaSyncLock(prisma);

  const statusMapper = new ConfigurablePaymentStatusMapper(paymentStatusMappingRepository);
  await statusMapper.refresh();

  const metrics = new PrometheusMetrics();

  const retryPolicy = new RetryPolicy(
    {
      maxAttempts: env.SYNC_MAX_RETRY_ATTEMPTS,
      baseDelayMs: env.SYNC_RETRY_BASE_DELAY_MS,
      maxDelayMs: 30_000,
    },
    logger,
    new SystemClock(),
    undefined,
    metrics,
  );

  const syncEngine = new SyncEngine({
    cursorRepository,
    syncPersistence,
    syncMetadataRepository,
    jobHistoryRepository,
    failureLogRepository,
    syncLock,
    retryPolicy,
    clock: new SystemClock(),
    logger,
    config: {
      cursorStaleAfterMs: env.SYNC_CURSOR_STALE_AFTER_HOURS * 60 * 60 * 1000,
      maxPagesPerRun: 1000,
    },
    metrics,
  });

  const providerRegistry = new ProviderRegistry();

  if (env.HUBSPOT_ACCESS_TOKEN) {
    providerRegistry.register(
      new HubSpotContactProvider({ accessToken: env.HUBSPOT_ACCESS_TOKEN }),
    );
    providerRegistry.register(new HubSpotDealProvider({ accessToken: env.HUBSPOT_ACCESS_TOKEN }));
  } else {
    logger.warn('HubSpot not configured (HUBSPOT_ACCESS_TOKEN missing) — CRM sync disabled');
  }

  if (
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET &&
    env.GOOGLE_REDIRECT_URI &&
    env.GOOGLE_REFRESH_TOKEN
  ) {
    providerRegistry.register(
      new GoogleCalendarEventProvider({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        redirectUri: env.GOOGLE_REDIRECT_URI,
        refreshToken: env.GOOGLE_REFRESH_TOKEN,
        calendarId: env.GOOGLE_CALENDAR_ID,
      }),
    );
  } else {
    logger.warn('Google Calendar not configured (missing OAuth env vars) — Calendar sync disabled');
  }

  if (env.STRIPE_SECRET_KEY) {
    providerRegistry.register(
      new StripePaymentProvider({ secretKey: env.STRIPE_SECRET_KEY }, statusMapper),
    );
  } else {
    logger.warn('Stripe not configured (STRIPE_SECRET_KEY missing) — Payments sync disabled');
  }

  const revenueCalculator = new RevenueCalculator(revenueRepository, logger);
  const webhookIngestionService = new WebhookIngestionService(
    webhookEventRepository,
    logger,
    metrics,
  );

  return {
    env,
    logger,
    prisma,
    syncEngine,
    providerRegistry,
    revenueCalculator,
    statusMapper,
    cursorRepository,
    jobHistoryRepository,
    syncMetadataRepository,
    failureLogRepository,
    webhookEventRepository,
    idempotencyKeyRepository,
    syncPersistence,
    webhookIngestionService,
    metrics,
  };
}
