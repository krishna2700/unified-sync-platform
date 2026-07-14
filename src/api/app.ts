import Fastify, { type FastifyInstance, type FastifyBaseLogger } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ulid } from 'ulid';
import { PinoLogger } from '../infrastructure/logging/pino-logger.js';
import type { CompositionRoot } from './composition-root.js';
import securityPlugin from './http/plugins/security.plugin.js';
import correlationIdPlugin from './http/plugins/correlation-id.plugin.js';
import errorHandlerPlugin from './http/plugins/error-handler.plugin.js';
import { healthRoutes } from './http/routes/health.routes.js';
import { revenueRoutes } from './http/routes/revenue.routes.js';
import { syncRoutes } from './http/routes/sync.routes.js';
import { webhookRoutes } from './http/routes/webhooks.routes.js';
import { metricsRoutes } from './http/routes/metrics.routes.js';

export async function buildApp(root: CompositionRoot): Promise<FastifyInstance> {
  // Fastify's own request logger shares the composition root's pino instance when it's a
  // PinoLogger (real app), so app logs and per-request access logs share one hierarchy. Falls
  // back to Fastify's default logger for any other Logger implementation (e.g. test doubles).
  const fastify =
    root.logger instanceof PinoLogger
      ? Fastify({
          loggerInstance: root.logger.raw as unknown as FastifyBaseLogger,
          genReqId: () => ulid(),
          trustProxy: true,
        })
      : Fastify({ logger: true, genReqId: () => ulid(), trustProxy: true });

  await fastify.register(errorHandlerPlugin);
  await fastify.register(correlationIdPlugin);
  await fastify.register(securityPlugin, { env: root.env });

  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Unified Sync Platform API',
        description: 'Multi-provider synchronization pipeline and revenue metrics service.',
        version: '0.1.0',
      },
    },
  });
  await fastify.register(swaggerUi, { routePrefix: '/docs' });

  await fastify.register(healthRoutes, { root });
  await fastify.register(revenueRoutes, { root });
  await fastify.register(syncRoutes, { root });
  await fastify.register(webhookRoutes, { root });
  await fastify.register(metricsRoutes, { root });

  return fastify;
}
