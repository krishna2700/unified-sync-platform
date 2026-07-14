import fp from 'fastify-plugin';
import { ulid } from 'ulid';
import type { FastifyInstance } from 'fastify';
import type { Logger as Pino } from 'pino';
import { PinoLogger } from '../../../infrastructure/logging/pino-logger.js';
import type { Logger } from '../../../domain/ports/logger.port.js';

const CORRELATION_HEADER = 'x-correlation-id';

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
    appLogger: Logger;
  }
}

/**
 * Every request gets (or keeps, if the caller supplied one) a correlation id, echoed back in the
 * response header and bound into a child logger for the lifetime of the request — every log line
 * for a request can be grepped out of the aggregate log stream by that one id.
 */
async function correlationIdPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorateRequest('correlationId', '');
  fastify.decorateRequest('appLogger', null as unknown as Logger);

  fastify.addHook('onRequest', async (request, reply) => {
    const incoming = request.headers[CORRELATION_HEADER];
    const correlationId = typeof incoming === 'string' && incoming.length > 0 ? incoming : ulid();
    request.correlationId = correlationId;
    request.appLogger = PinoLogger.fromPino(
      request.log.child({ correlationId }) as unknown as Pino,
    );
    void reply.header(CORRELATION_HEADER, correlationId);
  });
}

export default fp(correlationIdPlugin, { name: 'correlation-id-plugin' });
