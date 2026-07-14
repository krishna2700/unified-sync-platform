import { createHmac, timingSafeEqual } from 'node:crypto';
import Stripe from 'stripe';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../errors/http-error.js';
import { EntityType } from '../../../domain/value-objects/entity-type.js';
import { ProviderId } from '../../../domain/value-objects/provider.js';
import { HubSpotContactProvider } from '../../../integrations/hubspot/hubspot-contact-provider.js';
import { HubSpotDealProvider } from '../../../integrations/hubspot/hubspot-deal-provider.js';
import type { CompositionRoot } from '../../composition-root.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

const HUBSPOT_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Three webhook endpoints, one per provider, each doing: (1) verify authenticity, (2) route
 * through WebhookIngestionService for duplicate-safe processing, (3) always ACK quickly.
 *
 * JSON parsing is overridden *within this plugin's encapsulated scope only* (Fastify scopes
 * content-type parsers to the registering plugin) to retain the raw byte buffer — Stripe's and
 * HubSpot's signatures are computed over the exact raw body, not the re-serialized JSON, which
 * can differ in whitespace/key order.
 */
export async function webhookRoutes(
  fastify: FastifyInstance,
  opts: { root: CompositionRoot },
): Promise<void> {
  const { root } = opts;

  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    const buffer = body as Buffer;
    request.rawBody = buffer;
    if (buffer.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(buffer.toString('utf8')) as unknown);
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  fastify.post('/webhooks/stripe', async (request, reply) => {
    const signature = request.headers['stripe-signature'];
    if (typeof signature !== 'string' || !root.env.STRIPE_WEBHOOK_SECRET) {
      throw new HttpError(400, 'Missing Stripe signature header or webhook secret not configured');
    }

    let event: Stripe.Event;
    try {
      event = Stripe.webhooks.constructEvent(
        request.rawBody ?? Buffer.alloc(0),
        signature,
        root.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (error) {
      request.appLogger.warn('Stripe webhook signature verification failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpError(400, 'Invalid Stripe webhook signature');
    }

    const result = await root.webhookIngestionService.ingest({
      idempotencyKey: `${ProviderId.STRIPE}:${event.id}`,
      provider: ProviderId.STRIPE,
      eventType: event.type,
      payload: event as unknown as Record<string, unknown>,
      process: async () => {
        if (!event.type.startsWith('payment_intent.')) return;
        const provider = root.providerRegistry.get(ProviderId.STRIPE, EntityType.PAYMENT);
        if (!provider) {
          await recordProviderNotConfigured(root, ProviderId.STRIPE, EntityType.PAYMENT, event.id);
          return;
        }
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const normalized = provider.normalize(paymentIntent);
        // The webhook fires precisely when the status changed; that moment is a more accurate
        // "last updated" signal than the PaymentIntent's own immutable `created` timestamp.
        normalized.sourceUpdatedAt = new Date(event.created * 1000);
        await root.syncPersistence.persistBatch({
          provider: ProviderId.STRIPE,
          entityType: EntityType.PAYMENT,
          records: [normalized],
          newCursor: null,
        });
      },
    });

    return reply.status(200).send({ received: true, outcome: result.outcome });
  });

  fastify.post('/webhooks/hubspot', async (request, reply) => {
    const signature = request.headers['x-hubspot-signature-v3'];
    const timestampHeader = request.headers['x-hubspot-request-timestamp'];
    if (
      typeof signature !== 'string' ||
      typeof timestampHeader !== 'string' ||
      !root.env.HUBSPOT_WEBHOOK_CLIENT_SECRET
    ) {
      throw new HttpError(
        400,
        'Missing HubSpot signature headers or webhook secret not configured',
      );
    }
    const timestamp = Number(timestampHeader);
    if (!Number.isFinite(timestamp) || Date.now() - timestamp > HUBSPOT_SIGNATURE_MAX_AGE_MS) {
      throw new HttpError(400, 'HubSpot webhook timestamp is missing or too old (possible replay)');
    }

    // HubSpot signs {method}{fully-qualified request URL}{raw body}{timestamp}. Reconstructing
    // the URL relies on `trustProxy` correctly deriving protocol/host from forwarded headers —
    // verify this against a live deployment, since a proxy rewriting the path would break it.
    const fullUrl = `${request.protocol}://${request.hostname}${request.url}`;
    const sourceString = `${request.method}${fullUrl}${(request.rawBody ?? Buffer.alloc(0)).toString('utf8')}${timestampHeader}`;
    const expected = createHmac('sha256', root.env.HUBSPOT_WEBHOOK_CLIENT_SECRET)
      .update(sourceString)
      .digest('base64');
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(signature);
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      request.appLogger.warn('HubSpot webhook signature verification failed');
      throw new HttpError(400, 'Invalid HubSpot webhook signature');
    }

    const events = Array.isArray(request.body) ? (request.body as HubSpotWebhookEvent[]) : [];
    const results = await Promise.all(
      events.map((event) =>
        root.webhookIngestionService.ingest({
          idempotencyKey: `${ProviderId.HUBSPOT}:${event.subscriptionId}:${event.eventId}`,
          provider: ProviderId.HUBSPOT,
          eventType: event.subscriptionType,
          payload: event as unknown as Record<string, unknown>,
          process: () => processHubSpotEvent(root, event),
        }),
      ),
    );

    return reply.status(200).send({ received: true, count: results.length });
  });

  fastify.post('/webhooks/google-calendar', async (request, reply) => {
    const channelToken = request.headers['x-goog-channel-token'];
    if (
      root.env.GOOGLE_WEBHOOK_CHANNEL_TOKEN &&
      channelToken !== root.env.GOOGLE_WEBHOOK_CHANNEL_TOKEN
    ) {
      throw new HttpError(400, 'Invalid Google Calendar channel token');
    }
    const resourceState = request.headers['x-goog-resource-state'];
    const channelId = request.headers['x-goog-channel-id'];
    const resourceId = request.headers['x-goog-resource-id'];
    const messageNumber = request.headers['x-goog-message-number'];

    // The initial "sync" verification ping carries no actionable change — ack it without work.
    if (resourceState === 'sync') {
      return reply.status(200).send({ received: true, outcome: 'sync_handshake' });
    }

    const result = await root.webhookIngestionService.ingest({
      idempotencyKey: `${ProviderId.GOOGLE_CALENDAR}:${channelId}:${resourceId}:${messageNumber}`,
      provider: ProviderId.GOOGLE_CALENDAR,
      eventType: typeof resourceState === 'string' ? resourceState : 'unknown',
      payload: { channelId, resourceId, messageNumber, resourceState },
      process: async () => {
        // Google's push notification carries no payload — it's a "something changed, go look"
        // poke. The actual data + cursor advancement happen through the same incremental sync
        // path polling already uses, so there is exactly one code path that writes calendar data.
        const provider = root.providerRegistry.get(ProviderId.GOOGLE_CALENDAR, EntityType.EVENT);
        if (!provider) {
          await recordProviderNotConfigured(
            root,
            ProviderId.GOOGLE_CALENDAR,
            EntityType.EVENT,
            `${channelId}:${resourceId}`,
          );
          return;
        }
        await root.syncEngine.run(provider);
      },
    });

    return reply.status(200).send({ received: true, outcome: result.outcome });
  });
}

interface HubSpotWebhookEvent {
  eventId: number;
  subscriptionId: number;
  subscriptionType: string;
  objectId: number;
}

async function processHubSpotEvent(
  root: CompositionRoot,
  event: HubSpotWebhookEvent,
): Promise<void> {
  const objectId = String(event.objectId);

  if (event.subscriptionType.startsWith('contact.')) {
    const provider = root.providerRegistry.get(ProviderId.HUBSPOT, EntityType.CONTACT);
    if (!(provider instanceof HubSpotContactProvider)) {
      await recordProviderNotConfigured(root, ProviderId.HUBSPOT, EntityType.CONTACT, objectId);
      return;
    }
    const raw = await provider.fetchOne(objectId);
    const normalized = provider.normalize(raw);
    await root.syncPersistence.persistBatch({
      provider: ProviderId.HUBSPOT,
      entityType: EntityType.CONTACT,
      records: [normalized],
      newCursor: null,
    });
    return;
  }

  if (event.subscriptionType.startsWith('deal.')) {
    const provider = root.providerRegistry.get(ProviderId.HUBSPOT, EntityType.DEAL);
    if (!(provider instanceof HubSpotDealProvider)) {
      await recordProviderNotConfigured(root, ProviderId.HUBSPOT, EntityType.DEAL, objectId);
      return;
    }
    const raw = await provider.fetchOne(objectId);
    const normalized = provider.normalize(raw);
    await root.syncPersistence.persistBatch({
      provider: ProviderId.HUBSPOT,
      entityType: EntityType.DEAL,
      records: [normalized],
      newCursor: null,
    });
  }
}

/**
 * A webhook arriving for a provider that isn't registered (missing credentials) isn't a
 * transient failure to retry — it's a configuration gap an operator needs to see. Recorded
 * through the same failure log the sync engine uses, so it surfaces on `/sync/failures`
 * alongside every other failure mode instead of only appearing in stdout logs.
 */
async function recordProviderNotConfigured(
  root: CompositionRoot,
  provider: ProviderId,
  entityType: EntityType,
  context: string,
): Promise<void> {
  const message = `Webhook received for ${provider}/${entityType} but that provider is not configured (missing credentials); event for "${context}" was acknowledged but not persisted`;
  root.logger.warn(message);
  await root.failureLogRepository.record({
    provider,
    entityType,
    jobId: null,
    errorCode: 'PROVIDER_NOT_CONFIGURED',
    message,
    context: { source: context },
    occurredAt: new Date(),
  });
}
