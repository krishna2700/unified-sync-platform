import type { FastifyInstance } from 'fastify';
import type { CompositionRoot } from '../../composition-root.js';

export async function healthRoutes(
  fastify: FastifyInstance,
  opts: { root: CompositionRoot },
): Promise<void> {
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  fastify.get('/ready', async (request, reply) => {
    try {
      await opts.root.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', timestamp: new Date().toISOString() };
    } catch (error) {
      request.appLogger.error('Readiness check failed: database unreachable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return reply.status(503).send({ status: 'not_ready', timestamp: new Date().toISOString() });
    }
  });

  fastify.get('/providers/health', async () => {
    const providers = opts.root.providerRegistry.all();
    const results = await Promise.all(
      providers.map(async (provider) => ({
        provider: provider.providerId,
        entityType: provider.entityType,
        ...(await provider.health()),
      })),
    );
    return { providers: results };
  });
}
