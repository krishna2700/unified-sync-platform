import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.string().default('*'),
  ADMIN_API_KEY: z.string().min(1),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  HUBSPOT_ACCESS_TOKEN: z.string().min(1).optional(),

  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_REDIRECT_URI: z.string().min(1).optional(),
  GOOGLE_REFRESH_TOKEN: z.string().min(1).optional(),
  GOOGLE_CALENDAR_ID: z.string().min(1).default('primary'),

  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  HUBSPOT_WEBHOOK_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_WEBHOOK_CHANNEL_TOKEN: z.string().min(1).optional(),

  SYNC_CURSOR_STALE_AFTER_HOURS: z.coerce.number().positive().default(24),
  SYNC_MAX_RETRY_ATTEMPTS: z.coerce.number().int().positive().default(5),
  SYNC_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(1000),
  SYNC_JOB_CONCURRENCY: z.coerce.number().int().positive().default(3),
  SYNC_SCHEDULE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Parsed once, memoized, and fails fast at startup rather than crashing deep in a request
 * handler with an undefined config value. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }
  cached = result.data;
  return cached;
}

export function resetEnvCacheForTests(): void {
  cached = undefined;
}
