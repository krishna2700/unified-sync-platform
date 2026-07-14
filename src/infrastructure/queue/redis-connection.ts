export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: Record<string, never>;
  maxRetriesPerRequest: null;
}

/**
 * BullMQ bundles its own nested copy of ioredis, which TypeScript treats as structurally
 * incompatible with our top-level `ioredis` dependency (a duplicate-package type mismatch,
 * common in npm's node_modules layout). Passing plain connection options — rather than a
 * constructed ioredis instance — sidesteps that entirely: BullMQ builds its own client
 * internally from whichever ioredis copy it bundles.
 */
export function parseRedisConnectionOptions(url: string): RedisConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    // BullMQ's own retry/backoff logic conflicts with ioredis's default request-retry behavior.
    maxRetriesPerRequest: null,
  };
}
