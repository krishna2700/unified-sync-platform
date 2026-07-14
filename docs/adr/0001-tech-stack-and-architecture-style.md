# ADR 0001: Tech stack and architecture style

## Status

Accepted

## Context

The assignment asks for a production-quality sync pipeline and revenue engine that must be
correct, testable, observable, and extensible to new providers, deployable to a free-tier host.

## Decision

- **Fastify** over NestJS. NestJS's DI container and decorator-heavy style duplicate what Clean/
  Hexagonal architecture already gives us for free (constructor injection via a hand-written
  composition root). Fastify is faster, has a smaller footprint (matters on Render's free tier),
  and its plugin encapsulation model turned out to be exactly what the webhook routes needed
  (scoped content-type parsers for raw-body signature verification without affecting the rest of
  the app — see `src/api/http/routes/webhooks.routes.ts`).
- **Prisma** over Knex/Drizzle/raw `pg`. Type-safe queries, first-class migrations, and a schema
  file that doubles as living documentation. Its one real gap — no native `CHECK` constraint
  support in Prisma Schema Language — is handled by hand-appending SQL to the generated migration
  (see ADR 0002).
- **TypeScript strict mode + ESLint 9 flat config + Vitest** — the modern, actively maintained
  default for a 2026 Node service. `noUncheckedIndexedAccess` and `strict` catch a large class of
  null-handling bugs that matter a lot in a pipeline whose entire job is handling partial/missing
  provider data safely.
- **Clean/Hexagonal Architecture** (domain → application → infrastructure/integrations → api),
  enforced by dependency-cruiser rules that run as part of `npm test`, not just documented in
  prose. This is what makes "never crash because one provider fails" and "one canonical revenue
  calculation" _structural_ guarantees rather than conventions someone can quietly violate.
- **BullMQ + Redis** for the one genuinely async workload (scheduled background sync), rather than
  building a bespoke cron/queue mechanism. Redis is free-tier friendly (Upstash) and BullMQ's job
  scheduler API removed the need to hand-roll retry/backoff for the worker loop itself.

## Consequences

- Two moving infrastructure pieces (Postgres + Redis) instead of one. Mitigated by making Redis
  optional in spirit — the HTTP `/sync/trigger` endpoint works with zero Redis dependency; only
  the background worker process needs it.
- Fastify's ecosystem for admin/scaffolding tooling is smaller than NestJS's, but the project's
  actual admin surface (health, sync, revenue, webhooks) is simple enough that this cost never
  materialized.
