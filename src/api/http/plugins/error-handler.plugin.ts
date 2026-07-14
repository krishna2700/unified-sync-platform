import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import type { FastifyError, FastifyInstance } from 'fastify';
import { DomainValidationError } from '../../../domain/errors/domain-validation-error.js';
import { HttpError } from '../errors/http-error.js';

interface FastifyValidationError extends Error {
  validation: unknown[];
}

function isFastifyValidationError(error: Error): error is FastifyValidationError {
  return 'validation' in error && Array.isArray((error as { validation?: unknown }).validation);
}

/**
 * The single place any thrown error becomes an HTTP response. Every response carries the
 * request's correlation id so a client-reported error can be found in the logs immediately, and
 * unexpected (non-domain) errors never leak internals (message/stack) once NODE_ENV=production.
 */
async function errorHandlerPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.setErrorHandler((error: FastifyError | Error, request, reply) => {
    const correlationId = request.correlationId;

    if (error instanceof ZodError) {
      request.appLogger.warn('Request validation failed', { issues: error.issues });
      void reply.status(400).send({
        error: 'validation_error',
        message: 'Request validation failed',
        issues: error.issues,
        correlationId,
      });
      return;
    }

    if (error instanceof DomainValidationError) {
      void reply.status(400).send({
        error: 'validation_error',
        message: error.message,
        details: error.details,
        correlationId,
      });
      return;
    }

    if (error instanceof HttpError) {
      void reply.status(error.statusCode).send({
        error: 'request_error',
        message: error.message,
        details: error.details,
        correlationId,
      });
      return;
    }

    if (isFastifyValidationError(error)) {
      void reply.status(400).send({
        error: 'validation_error',
        message: error.message,
        issues: error.validation,
        correlationId,
      });
      return;
    }

    request.appLogger.error('Unhandled request error', {
      error: error.message,
      stack: error.stack,
    });
    const isProd = process.env['NODE_ENV'] === 'production';
    void reply.status(500).send({
      error: 'internal_error',
      message: isProd ? 'Internal Server Error' : error.message,
      correlationId,
    });
  });

  fastify.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      error: 'not_found',
      message: `Route ${request.method} ${request.url} not found`,
      correlationId: request.correlationId,
    });
  });
}

export default fp(errorHandlerPlugin, { name: 'error-handler-plugin' });
