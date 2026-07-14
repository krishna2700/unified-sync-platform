import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from '../errors/http-error.js';
import type { Env } from '../../../infrastructure/config/env.js';

const API_KEY_HEADER = 'x-api-key';

/** preHandler guard for mutating/admin endpoints (sync trigger, etc). Metrics/health endpoints
 * stay public since they expose no secrets and are read-only. */
export function requireApiKey(env: Env) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const provided = request.headers[API_KEY_HEADER];
    if (provided !== env.ADMIN_API_KEY) {
      throw new HttpError(401, 'Missing or invalid API key');
    }
  };
}
