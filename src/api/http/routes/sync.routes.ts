import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../errors/http-error.js';
import { requireApiKey } from '../middleware/require-api-key.js';
import { isEntityType } from '../../../domain/value-objects/entity-type.js';
import { isProviderId } from '../../../domain/value-objects/provider.js';
import type { CompositionRoot } from '../../composition-root.js';

const IDEMPOTENCY_HEADER = 'idempotency-key';
const IDEMPOTENCY_SCOPE = 'sync-trigger';

const triggerBodySchema = z.object({
  provider: z.string().optional(),
  entityType: z.string().optional(),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(50),
});

export async function syncRoutes(
  fastify: FastifyInstance,
  opts: { root: CompositionRoot },
): Promise<void> {
  const { root } = opts;

  fastify.post('/sync/trigger', { preHandler: requireApiKey(root.env) }, async (request) => {
    const body = triggerBodySchema.parse(request.body ?? {});
    if (body.provider && !isProviderId(body.provider)) {
      throw new HttpError(400, `Unknown provider "${body.provider}"`);
    }
    if (body.entityType && !isEntityType(body.entityType)) {
      throw new HttpError(400, `Unknown entityType "${body.entityType}"`);
    }

    const runTrigger = async () => {
      const providers = root.providerRegistry
        .all()
        .filter(
          (p) =>
            (!body.provider || p.providerId === body.provider) &&
            (!body.entityType || p.entityType === body.entityType),
        );
      if (providers.length === 0) {
        throw new HttpError(
          404,
          'No registered providers match the given filter (check credentials are configured)',
        );
      }
      const results = await root.syncEngine.runMany(providers);
      return { triggeredAt: new Date().toISOString(), results };
    };

    const idempotencyKey = request.headers[IDEMPOTENCY_HEADER];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
      return runTrigger();
    }

    const claim = await root.idempotencyKeyRepository.claim(idempotencyKey, IDEMPOTENCY_SCOPE);
    if (claim.status === 'completed') return claim.storedResult;
    if (claim.status === 'in_progress') {
      throw new HttpError(409, 'A sync trigger with this idempotency key is already in progress');
    }

    try {
      const result = await runTrigger();
      await root.idempotencyKeyRepository.complete(idempotencyKey, IDEMPOTENCY_SCOPE, result);
      return result;
    } catch (error) {
      await root.idempotencyKeyRepository.release(idempotencyKey, IDEMPOTENCY_SCOPE);
      throw error;
    }
  });

  fastify.get('/sync/status', async () => ({
    providers: await root.syncMetadataRepository.listAll(),
  }));

  fastify.get('/sync/jobs', async (request) => {
    const query = listQuerySchema.parse(request.query);
    return { jobs: await root.jobHistoryRepository.list({ limit: query.limit }) };
  });

  fastify.get('/sync/failures', async (request) => {
    const query = listQuerySchema.parse(request.query);
    return { failures: await root.failureLogRepository.listRecent(query.limit) };
  });
}
