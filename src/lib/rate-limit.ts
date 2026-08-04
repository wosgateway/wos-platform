// lib/rate-limit.ts
//
// Rate limiting for public, unauthenticated endpoints (currently:
// POST /api/orders). Uses Upstash Redis because it works from
// Vercel's serverless/edge functions — a plain in-memory counter
// does NOT work reliably on Vercel, since each invocation can land
// on a different instance with its own memory, so the count never
// adds up.
//
// Setup required before this works:
//   1. npm install @upstash/ratelimit @upstash/redis
//   2. Create a free Redis DB at https://console.upstash.com
//   3. Add to Vercel env vars (and .env.local for dev):
//        UPSTASH_REDIS_REST_URL=...
//        UPSTASH_REDIS_REST_TOKEN=...
//
// ---------------------------------------------------------------
// Simpler alternative, zero code: Vercel's own Firewall has a
// built-in rate-limiting rule you can attach to a path (e.g.
// /api/orders) entirely from the dashboard — Project → Firewall →
// Rate Limiting. No package install, no Redis to provision. Good
// enough if you just need "block an IP hammering this route" and
// don't need the limit tied to anything app-specific (like phone
// number). Use the code below instead if you want that extra
// specificity, or want the 429 body to say something custom.
// ---------------------------------------------------------------

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// 5 requests per phone-scoped identity per 10 minutes. Adjust to
// taste — this is a starting point, not a business-reviewed number
// (same caveat as the deposit percentages: confirm with the team
// before relying on a specific threshold).
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, '10 m'),
  analytics: true,
  prefix: 'ratelimit:orders',
});

export async function checkOrderRateLimit(identifier: string) {
  const { success, limit, remaining, reset } = await ratelimit.limit(identifier);
  return { success, limit, remaining, reset };
}
