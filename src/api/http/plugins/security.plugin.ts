import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../../../infrastructure/config/env.js';

export interface SecurityPluginOptions {
  env: Env;
}

async function securityPlugin(
  fastify: FastifyInstance,
  options: SecurityPluginOptions,
): Promise<void> {
  await fastify.register(helmet, { global: true });

  await fastify.register(cors, {
    origin:
      options.env.CORS_ORIGIN === '*'
        ? true
        : options.env.CORS_ORIGIN.split(',').map((o) => o.trim()),
  });

  // Rate-limit's default keyGenerator uses request.ip, which respects the server-level
  // `trustProxy` option (set in app.ts) — Render/other free-tier hosts sit behind a proxy.
  await fastify.register(rateLimit, {
    max: options.env.RATE_LIMIT_MAX,
    timeWindow: options.env.RATE_LIMIT_WINDOW_MS,
  });
}

export default fp(securityPlugin, { name: 'security-plugin' });
