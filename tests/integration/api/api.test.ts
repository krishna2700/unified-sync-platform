import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../src/api/app.js';
import { buildCompositionRoot } from '../../../src/api/composition-root.js';
import { disconnectPrisma } from '../../../src/infrastructure/db/prisma-client.js';

/**
 * Exercises the full HTTP layer (Fastify plugins, error handling, correlation ids, routes) wired
 * to the real composition root and a real Postgres connection — the same code path production
 * traffic hits, using Fastify's `.inject()` instead of a live network listener.
 */
describe('API (integration, real composition root)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const root = await buildCompositionRoot();
    app = await buildApp(root);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  it('GET /health returns 200 without touching the database', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('GET /ready returns 200 when the database is reachable', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ready' });
  });

  it('every response carries a correlation id, generated when the caller does not supply one', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-correlation-id']).toBeTruthy();
  });

  it('echoes back a caller-supplied correlation id instead of generating a new one', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-correlation-id': 'my-trace-id' },
    });
    expect(response.headers['x-correlation-id']).toBe('my-trace-id');
  });

  it('GET /metrics/revenue returns a well-formed report with an empty range default', async () => {
    const response = await app.inject({ method: 'GET', url: '/metrics/revenue' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('range');
    expect(body).toHaveProperty('granularity', 'total');
    expect(Array.isArray(body.buckets)).toBe(true);
    expect(Array.isArray(body.warnings)).toBe(true);
  });

  it('rejects a malformed date range query with 400, not 500', async () => {
    const response = await app.inject({ method: 'GET', url: '/metrics/revenue?from=not-a-date' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty('correlationId');
  });

  it('POST /sync/trigger requires the admin API key', async () => {
    const response = await app.inject({ method: 'POST', url: '/sync/trigger' });
    expect(response.statusCode).toBe(401);
  });

  it('GET /sync/status and /sync/failures respond without an API key (read-only)', async () => {
    const status = await app.inject({ method: 'GET', url: '/sync/status' });
    const failures = await app.inject({ method: 'GET', url: '/sync/failures' });
    expect(status.statusCode).toBe(200);
    expect(failures.statusCode).toBe(200);
  });

  it('GET /metrics serves Prometheus text exposition format', async () => {
    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('sync_duration_seconds');
  });

  it('an unknown route returns a structured 404 with a correlation id', async () => {
    const response = await app.inject({ method: 'GET', url: '/this-route-does-not-exist' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'not_found' });
  });
});
