// src/lib/rate-limit.ts
//
// Redis-backed rate limiter using Upstash Ratelimit.
// Shared across Vercel serverless instances and survives cold starts.
//
// Requires:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
//
// NOTE: simpleRateLimit() is async because it makes a network call.
// Redis client is created lazily (first call, not module load) so a
// missing/invalid env var doesn't crash `next build`'s page-data
// collection step for every route that imports this file.

import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

let redis: Redis | null = null;
function getRedis(): Redis {
  if (!redis) {
    redis = Redis.fromEnv();
  }
  return redis;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export async function simpleRateLimit(
  key: string,
  limit = 5,
  windowMs = 60 * 60 * 1000
): Promise<RateLimitResult> {
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));

  const ratelimit = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    prefix: 'wos:ratelimit',
  });

  const result = await ratelimit.limit(key);

  return {
    allowed: result.success,
    remaining: result.remaining,
    resetAt: result.reset,
  };
}
