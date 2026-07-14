import { describe, expect, it } from 'vitest';
import { WebhookIngestionService } from '../../../../src/application/webhooks/webhook-ingestion.service.js';
import { InMemoryWebhookEventRepository } from '../../../fixtures/in-memory-webhook-event-repository.js';
import { createSilentLogger } from '../../../fixtures/silent-logger.js';
import { ProviderId } from '../../../../src/domain/value-objects/provider.js';

function buildService() {
  const repository = new InMemoryWebhookEventRepository();
  const service = new WebhookIngestionService(repository, createSilentLogger());
  return { service, repository };
}

describe('WebhookIngestionService', () => {
  it('processes a first-time delivery exactly once', async () => {
    const { service } = buildService();
    let calls = 0;
    const result = await service.ingest({
      idempotencyKey: 'stripe:evt_1',
      provider: ProviderId.STRIPE,
      eventType: 'payment_intent.succeeded',
      payload: {},
      process: async () => {
        calls++;
      },
    });
    expect(result.outcome).toBe('processed');
    expect(calls).toBe(1);
  });

  it('skips a duplicate delivery of an already-processed event without reprocessing', async () => {
    const { service } = buildService();
    let calls = 0;
    const params = {
      idempotencyKey: 'stripe:evt_2',
      provider: ProviderId.STRIPE,
      eventType: 'payment_intent.succeeded',
      payload: {},
      process: async () => {
        calls++;
      },
    };

    await service.ingest(params);
    const second = await service.ingest(params);

    expect(second.outcome).toBe('duplicate_skipped');
    expect(calls).toBe(1);
  });

  it('retries processing on redelivery when the first attempt failed, instead of skipping it as a duplicate', async () => {
    const { service } = buildService();
    let calls = 0;
    const params = {
      idempotencyKey: 'stripe:evt_3',
      provider: ProviderId.STRIPE,
      eventType: 'payment_intent.succeeded',
      payload: {},
      process: async () => {
        calls++;
        if (calls === 1) throw new Error('transient failure on first attempt');
      },
    };

    const first = await service.ingest(params);
    expect(first.outcome).toBe('failed');

    const second = await service.ingest(params);
    expect(second.outcome).toBe('processed');
    expect(calls).toBe(2); // proves the redelivery actually reran process(), not skipped
  });

  it('reports failure without throwing when process() rejects, so the route can still ACK', async () => {
    const { service } = buildService();
    const result = await service.ingest({
      idempotencyKey: 'stripe:evt_4',
      provider: ProviderId.STRIPE,
      eventType: 'payment_intent.succeeded',
      payload: {},
      process: async () => {
        throw new Error('boom');
      },
    });
    expect(result.outcome).toBe('failed');
    expect(result.error).toContain('boom');
  });
});
