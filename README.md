# Unified Sync Platform

A multi-provider synchronization pipeline (CRM, Payments, Calendar) and a revenue metrics service
with one canonical, structurally-enforced business definition of "collected revenue" —
built with Clean/Hexagonal Architecture, TypeScript, Fastify, Prisma, and Postgres.

- **Live deployment:** https://unified-sync-platform-api.onrender.com ([`/health`](https://unified-sync-platform-api.onrender.com/health) · [`/docs`](https://unified-sync-platform-api.onrender.com/docs) · [`/metrics/revenue`](https://unified-sync-platform-api.onrender.com/metrics/revenue))
- **Demo video:** _add your walkthrough link here_
- **API docs:** `GET /docs` on any running instance (Swagger UI), or [docs/api.md](docs/api.md)
- **Final requirement-by-requirement audit:** [docs/final-audit.md](docs/final-audit.md)

## Table of contents

- [What this is](#what-this-is)
- [Architecture](#architecture)
- [Local setup](#local-setup)
- [Provider setup (HubSpot / Google Calendar / Stripe)](#provider-setup)
- [Running](#running)
- [Testing](#testing)
- [Deployment](#deployment)
- [Tradeoffs](#tradeoffs)
- [Future improvements](#future-improvements)
- [Sources and references](#sources-and-references)
- [AI usage disclosure](#ai-usage-disclosure)
- [Final audit](docs/final-audit.md) — every assignment requirement, mapped to what's implemented

## What this is

Two problem statements, one codebase:

1. **A sync pipeline** that pulls Contacts + Deals from HubSpot (CRM), Events from Google Calendar,
   and Payments from Stripe, normalizes every provider's shape into one canonical schema, and
   supports incremental sync, full backfill, automatic fallback on stale/expired cursors, and
   duplicate-safe webhook ingestion — without ever losing data or crashing the whole pipeline
   because one provider is down.
2. **A revenue metrics service** that computes "Total Revenue Collected" from an allow-list of
   canonical payment statuses (never an exclusion list), exposed through four endpoints that all
   share the exact same calculation code — enforced by an automated architecture test, not just a
   comment (see [ADR 0007](docs/adr/0007-revenue-single-source-of-truth-enforcement.md)).

## Architecture

Full write-up: [docs/architecture.md](docs/architecture.md) · Database: [docs/database.md](docs/database.md) ·
Sequence diagrams: [docs/sequence-diagrams.md](docs/sequence-diagrams.md) · Decision records: [docs/adr/](docs/adr/)

```
src/
  domain/          # entities, value objects, ports (interfaces) — zero dependencies
  application/      # SyncEngine, RevenueCalculator, WebhookIngestionService — depend on ports only
  infrastructure/    # Prisma repositories, Pino logger, Prometheus metrics, env config
  integrations/       # HubSpot, Google Calendar, Stripe adapters — implement domain ports
  api/                 # Fastify app, routes, plugins, composition root (the only place everything meets)
  workers/               # BullMQ background worker (scheduled sync)
tests/
  unit/ integration/ architecture/ golden-datasets/
prisma/               # schema.prisma, migrations, reference-data seed
scripts/              # HubSpot/Google/Stripe sample-data seed scripts, Google OAuth helper
docs/                  # architecture, database, sequence diagrams, API reference, ADRs, deployment
postman/               # Postman collection matching docs/api.md
```

A dependency-cruiser rule set (`.dependency-cruiser.cjs`) enforces the layering — it runs as part
of `npm test`, not just as documentation. See [docs/architecture.md](docs/architecture.md) for the
exact rules and why each one exists.

## Local setup

Prerequisites: Node.js 22+, a Postgres instance (local via `docker compose`, or a free
[Supabase](https://supabase.com) project), Redis (only needed for the background worker).

```bash
git clone <this-repo>
cd unified-sync-platform
npm install
cp .env.example .env
# edit .env: at minimum set DATABASE_URL/DIRECT_URL to a real Postgres instance
# and ADMIN_API_KEY to any secret string.

npm run prisma:migrate      # creates tables + applies CHECK constraints
npm run prisma:seed         # seeds the `providers` reference table + default Stripe status map

npm run dev                 # starts the API on http://localhost:3000
```

Or with Docker Compose (spins up Postgres + Redis + the API + the worker together):

```bash
docker compose up
```

Verify it's alive:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/ready
```

## Provider setup

Every provider is optional at startup — the app logs a warning and simply doesn't register that
provider if its credentials are missing, rather than crashing. Add credentials incrementally.

### HubSpot (CRM)

1. Create a free [HubSpot Developer](https://developers.hubspot.com/) test account.
2. **Settings → Integrations → Private Apps** → create an app with scopes
   `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.objects.deals.read`,
   `crm.objects.deals.write`.
3. Copy the access token into `HUBSPOT_ACCESS_TOKEN`.
4. Seed sample data: `npm run seed:hubspot`.

### Google Calendar

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/), enable the
   **Google Calendar API**, and create an OAuth 2.0 Client ID (type: Web application) with
   `http://localhost:3000/oauth/google/callback` as an authorized redirect URI.
2. Put the client ID/secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` /
   `GOOGLE_REDIRECT_URI` in `.env`.
3. Run the one-time OAuth helper to obtain a refresh token:
   ```bash
   npm run google:oauth-init
   ```
   Follow the printed URL, approve access, then copy the printed `GOOGLE_REFRESH_TOKEN` into `.env`.
4. Seed sample events: `npm run seed:google-calendar`.

### Stripe (Payment Processor)

1. Create a free [Stripe](https://dashboard.stripe.com/register) account (test mode requires no
   real business details).
2. Copy the **test-mode** secret key into `STRIPE_SECRET_KEY`.
3. Seed sample payments (a mix of succeeded/pending/canceled, deliberately, to exercise the
   revenue allow-list): `npm run seed:stripe`.
4. For webhooks: `stripe listen --forward-to localhost:3000/webhooks/stripe` locally (the Stripe
   CLI prints a webhook signing secret — put it in `STRIPE_WEBHOOK_SECRET`), or configure a real
   endpoint pointing at your deployed URL.

Then seed everything in one go (skips whichever providers aren't configured):

```bash
npm run seed
```

## Running

```bash
npm run dev            # API, hot-reload
npm run worker:dev      # background worker (scheduled sync), hot-reload — needs Redis
npm run build && npm start   # production build
```

Trigger a manual sync:

```bash
curl -X POST http://localhost:3000/sync/trigger \
  -H "x-api-key: $ADMIN_API_KEY" -H "Content-Type: application/json" -d '{}'
```

Query revenue:

```bash
curl "http://localhost:3000/metrics/revenue/monthly?from=2026-01-01&to=2026-07-01"
```

## Testing

```bash
npm test                 # unit + architecture + golden-dataset + integration tests
npm run test:unit
npm run test:integration  # needs a real Postgres reachable via DATABASE_URL
npm run test:architecture
npm run test:coverage
npm run arch:check        # dependency-cruiser CLI directly (same rules test:architecture asserts)
```

78 tests across unit, integration (against a real Postgres instance, not mocks), architecture
(dependency-cruiser rules + a grep-based check that no file outside `RevenueCalculator`
duplicates revenue logic — both verified during development to actually fail on a real
violation, not just pass vacuously), and a golden dataset (hand-computed expected revenue totals
across providers/currencies/statuses/a month boundary). See
["Testing strategy and coverage"](#testing-strategy-and-coverage) below for what's deliberately
excluded and why.

### Testing strategy and coverage

Coverage thresholds in `vitest.config.ts` are set to reflect genuinely meaningful coverage
(currently ~68% lines, ~76% branches, ~72% functions), not an arbitrary round number padded with
low-value tests. Deliberately under-tested by design:

- **Thin Prisma repository CRUD wrappers** with no branching logic — validated instead through
  integration tests against a real database for the ones with actual logic (upsert
  idempotency/atomicity, the hand-written revenue SQL, the lease-based lock's expiry behavior) and
  through the many live end-to-end smoke tests performed during development (every endpoint, every
  webhook path, the worker's scheduled tick — all exercised against a real running server and a
  real Postgres instance while building this).
- **Pure-interface config files** (`*-config.ts`) — zero executable statements, excluded from
  coverage entirely rather than padding the denominator.
- **`composition-root.ts`'s provider-registration branches** — exercised indirectly by every
  integration test (which calls `buildCompositionRoot()`), but not exhaustively for every
  combination of present/absent credentials.

## Deployment

Full guide: [docs/deployment.md](docs/deployment.md) (Supabase Postgres + Render, both free tier).

## Tradeoffs

The single biggest tradeoff across this project: **breadth vs. depth under a real time budget.**
Given the choice between (a) fully productionizing every corner (e.g. multi-currency HubSpot
deals, deal-to-contact associations, a reconciliation-pass safety net for Stripe webhook outages)
and (b) building the entire pipeline end-to-end with correct architecture and genuinely tested
behavior at every layer, this project chose (b) and documented every (a)-shaped gap explicitly
rather than silently cutting corners. Each specific tradeoff is written where the decision was
made, not centralized in a generic list, because the reasoning only makes sense with the
surrounding context:

- [ADR 0001](docs/adr/0001-tech-stack-and-architecture-style.md) — Fastify vs NestJS, Prisma vs
  raw SQL, why Hexagonal Architecture.
- [ADR 0002](docs/adr/0002-database-schema.md) — provider-as-reference-table vs enum, money as
  integer minor units, hand-appended CHECK constraints (Prisma has no native support).
- [ADR 0003](docs/adr/0003-cursor-persistence-ownership.md) — why cursor persistence isn't part of
  the `SyncProvider` interface.
- [ADR 0004](docs/adr/0004-hubspot-deal-currency-and-associations.md) — USD-only deal amounts, no
  deal-to-contact associations (documented limitation, not silently wrong).
- [ADR 0005](docs/adr/0005-stripe-incremental-strategy.md) — why Stripe sync _requires_ webhooks,
  not just benefits from them.
- [ADR 0006](docs/adr/0006-lease-based-sync-lock.md) — lease-based lock over Postgres advisory
  locks (connection-pooling incompatibility).
- [ADR 0007](docs/adr/0007-revenue-single-source-of-truth-enforcement.md) — the two independent
  automated mechanisms that make "one revenue implementation" a testable guarantee.
- [Testing strategy](#testing-strategy-and-coverage) above — what's deliberately under-tested and why.

## Future improvements

- **Multi-currency HubSpot deals** (read `deal_currency_code` instead of assuming USD) and
  **deal-to-contact associations** as a dedicated relationship sync path — see ADR 0004.
- **A periodic full-reconciliation pass** (e.g. nightly) as a safety net for extended Stripe
  webhook outages, on top of the existing incremental-polling + webhook combination — see ADR 0005.
- **Per-provider concurrency** in `SyncEngine.runMany` (currently sequential by design for
  predictable resource usage on a free-tier deployment — trivially parallelizable with `p-limit`
  if a deployment's provider count and API rate limits warrant it).
- **A small operator dashboard** (sync status, job history, failure logs, revenue charts) — the
  API already exposes everything a dashboard needs (`/sync/status`, `/sync/jobs`,
  `/sync/failures`, `/metrics/revenue/*`); this project prioritized backend correctness over a UI,
  per the assignment's own "UI must be secondary to backend quality" instruction.
- **Protecting `/metrics` and read-only `/sync/*` endpoints** behind the admin API key (or network
  policy) once deployed somewhere the Prometheus scrape endpoint shouldn't be fully public.
- **A `providers` admin CRUD API** so onboarding a new provider's reference row and status
  mappings doesn't require direct database access.

## Sources and references

- [HubSpot CRM API docs](https://developers.hubspot.com/docs/api/crm/understanding-the-crm) —
  Contacts/Deals object shape, Search API filtering, webhook signature v3 spec.
- [Google Calendar API docs](https://developers.google.com/calendar/api/guides/overview) —
  `events.list`, incremental sync via `syncToken`, push notifications.
- [Stripe API docs](https://stripe.com/docs/api) and
  [Stripe webhook signing docs](https://stripe.com/docs/webhooks/signatures) — PaymentIntents,
  webhook `constructEvent` verification.
- [Prisma docs](https://www.prisma.io/docs) — schema design, `$transaction`, raw SQL via
  `Prisma.sql`.
- [Fastify docs](https://fastify.dev/docs/latest/) — plugin encapsulation (used for the
  webhook routes' scoped raw-body content-type parser), lifecycle hooks.
- [BullMQ docs](https://docs.bullmq.io/) — job schedulers (`upsertJobScheduler`), worker
  concurrency.
- [dependency-cruiser docs](https://github.com/sverweij/dependency-cruiser) — rule configuration
  for enforcing the hexagonal layering.
- The assignment's own problem statements, taken as the specification.

## AI usage disclosure

This entire project — architecture, code, tests, documentation, and this README — was built with
**Claude Sonnet 5 (Claude Code)** as the primary author, working iteratively phase-by-phase (domain
layer → database → sync engine → provider adapters → revenue engine → API → webhooks → workers →
observability → testing → documentation), with each phase verified against a real running server,
real Postgres database, and real HubSpot/Google/Stripe SDK type definitions rather than assumed
API shapes. Specific instances worth noting:

- Real bugs were found and fixed _during_ development by tests written in the same session — not
  hypothetical examples: a millisecond-precision rounding bug in the lease-based lock's SQL (caught
  by an integration test with a short test lease), and a dead validation branch in the HubSpot deal
  provider (`validate()` checked for an empty `dealName` that `normalize()` had already defaulted
  away, making the check unreachable — removed rather than left as misleading dead code).
- Every "graceful degradation" claim in this README (missing credentials don't crash the app,
  webhooks ACK correctly, duplicate deliveries are skipped) was verified by actually starting the
  server and making real HTTP requests against it during development, not just asserted in tests.
- No claims in this README, the ADRs, or the code comments describe behavior that wasn't actually
  implemented and observed working.
