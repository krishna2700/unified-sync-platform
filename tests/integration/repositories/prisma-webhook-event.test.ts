import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrismaClient, disconnectPrisma } from '../../../src/infrastructure/db/prisma-client.js';
import { PrismaWebhookEventRepository } from '../../../src/infrastructure/repositories/prisma-webhook-event.repository.js';
import { ProviderId } from '../../../src/domain/value-objects/provider.js';

const prisma = getPrismaClient();
const KEY_PREFIX = 'test-integration-webhook-';

describe('PrismaWebhookEventRepository (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.webhookEvent.deleteMany({ where: { idempotencyKey: { startsWith: KEY_PREFIX } } });
  });

  afterAll(async () => {
    await prisma.webhookEvent.deleteMany({ where: { idempotencyKey: { startsWith: KEY_PREFIX } } });
    await disconnectPrisma();
  });

  it('relies on the UNIQUE(idempotency_key) constraint: a second insert with the same key is reported as duplicate, not a second row', async () => {
    const repository = new PrismaWebhookEventRepository(prisma);
    const idempotencyKey = `${KEY_PREFIX}duplicate-detection`;
    const event = {
      idempotencyKey,
      provider: ProviderId.STRIPE,
      eventType: 'payment_intent.succeeded',
      payload: { hello: 'world' },
      receivedAt: new Date(),
    };

    const first = await repository.recordIfNew(event);
    const second = await repository.recordIfNew(event);

    expect(first).toBe('inserted');
    expect(second).toBe('duplicate');

    const rows = await prisma.webhookEvent.findMany({ where: { idempotencyKey } });
    expect(rows).toHaveLength(1);
  });

  it('distinguishes a processed delivery from one still pending/failed via getProcessingStatus', async () => {
    const repository = new PrismaWebhookEventRepository(prisma);
    const idempotencyKey = `${KEY_PREFIX}status-tracking`;
    await repository.recordIfNew({
      idempotencyKey,
      provider: ProviderId.STRIPE,
      eventType: 'payment_intent.succeeded',
      payload: {},
      receivedAt: new Date(),
    });

    expect(await repository.getProcessingStatus(idempotencyKey)).toBe('received');

    await repository.markProcessed(idempotencyKey, 'failed', 'simulated failure');
    expect(await repository.getProcessingStatus(idempotencyKey)).toBe('failed');

    await repository.markProcessed(idempotencyKey, 'processed');
    expect(await repository.getProcessingStatus(idempotencyKey)).toBe('processed');
  });
});
