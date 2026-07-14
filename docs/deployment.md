# Deployment guide (Supabase + Render, both free tier)

## 1. Supabase Postgres

1. Create a free project at [supabase.com](https://supabase.com).
2. **Settings → Database → Connection string**: copy both the **pooled** connection (port 6543,
   `?pgbouncer=true&connection_limit=1`) and the **direct** connection (port 5432).
   - `DATABASE_URL` = the pooled connection (used by the running app).
   - `DIRECT_URL` = the direct connection (used only by Prisma Migrate, which needs a session-mode
     connection to run `CREATE`/`ALTER` statements — pgbouncer's transaction pooling mode doesn't
     support them).
3. Run migrations against Supabase from your machine once, before first deploy:
   ```bash
   DATABASE_URL="<pooled>" DIRECT_URL="<direct>" npx prisma migrate deploy
   DATABASE_URL="<pooled>" DIRECT_URL="<direct>" npx tsx prisma/seed.ts
   ```

## 2. Redis (only needed for the background worker)

The API and `/sync/trigger` work with zero Redis dependency. The scheduled background worker
needs one — [Upstash](https://upstash.com) has a free Redis tier with a `rediss://` TLS URL that
drops straight into `REDIS_URL`.

## 3. Render

Two services from the same repo:

### Web service (API)

- **Build command**: `npm ci && npm run prisma:generate && npm run build`
- **Start command**: `npm start`
- **Health check path**: `/health`
- **Environment**: copy every variable from `.env.example`, using your real Supabase/provider
  values. Set `NODE_ENV=production`.

### Background worker

- **Build command**: same as above.
- **Start command**: `npm run worker:start`
- Same environment variables as the web service, plus a working `REDIS_URL`.
- No public URL / health check needed — it's a worker, not an HTTP service.

Render's free tier spins down web services after inactivity; the first request after idle will be
slow (cold start + Prisma connecting) — this is a free-tier tradeoff, not a bug.

## 4. Provider credentials (see the README's "Provider setup" section for the full walkthrough)

Set these once real accounts exist; each provider degrades gracefully to "not configured" if its
variables are absent (see `src/api/composition-root.ts`) rather than crashing the app:

- `HUBSPOT_ACCESS_TOKEN` — HubSpot Private App token.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` / `GOOGLE_REDIRECT_URI` —
  Google Cloud OAuth2 client + a refresh token from the one-time offline-consent flow.
- `STRIPE_SECRET_KEY` — Stripe test-mode secret key.
- `STRIPE_WEBHOOK_SECRET`, `HUBSPOT_WEBHOOK_CLIENT_SECRET`, `GOOGLE_WEBHOOK_CHANNEL_TOKEN` — set
  these to register real webhook endpoints pointing at
  `https://<your-render-app>.onrender.com/webhooks/{stripe,hubspot,google-calendar}`.

## 5. Post-deploy smoke test

```bash
curl https://<your-app>.onrender.com/health
curl https://<your-app>.onrender.com/ready
curl https://<your-app>.onrender.com/providers/health
curl https://<your-app>.onrender.com/metrics/revenue
```

## Tradeoffs of this deployment shape

- **Two Render services** (web + worker) instead of one, because Render's free tier doesn't run a
  long-lived background process alongside a web service in one dyno the way some PaaS's do. This
  is the standard, supported pattern on Render itself.
- **No managed Redis on Render's free tier** — Upstash fills that gap; it also means the worker is
  the only component with an external dependency beyond Postgres, so the API stays fully
  functional (manual sync via `/sync/trigger`, all read endpoints) even if Redis/the worker is
  ever unavailable.
