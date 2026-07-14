import type { FastifyInstance } from 'fastify';
import type { CompositionRoot } from '../../composition-root.js';

/** Prometheus scrape endpoint. Left unauthenticated (consistent with standard Prometheus
 * deployments, which reach exporters over a private network) — see README for the tradeoff of
 * adding `requireApiKey` here if this is ever reachable from the public internet in production. */
export async function metricsRoutes(
  fastify: FastifyInstance,
  opts: { root: CompositionRoot },
): Promise<void> {
  fastify.get('/metrics', async (_request, reply) => {
    void reply.header('content-type', opts.root.metrics.registry.contentType);
    return opts.root.metrics.registry.metrics();
  });
}
