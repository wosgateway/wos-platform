// src/lib/rate-limit.ts
//
// Simple in-memory rate limiter. Good enough for a single-instance
// deployment (Vercel serverless functions share memory per warm instance,
// so this resets on cold start — acceptable for admin-triggered actions
// like sending quotations, not meant for high-traffic public endpoints).
// If this ever needs to survive cold starts / work across instances,
// swap the Map for a Redis-backed store (e.g. Upstash) — the function
// signature below wouldn't need to change.

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Checks and increments a rate-limit counter for `key`.
 * @param key Unique identifier for the thing being limited — e.g.
 *   `send-quotation:${ip}` or `send-quotation:${orderId}`.
 * @param limit Max allowed calls within the window. Default 5.
 * @param windowMs Window size in ms. Default 1 hour.
 */
export function simpleRateLimit(
  key: string,
  limit = 5,
  windowMs = 60 * 60 * 1000
): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}

// Periodic cleanup so the Map doesn't grow forever on a long-lived
// warm instance. Not critical — Vercel functions recycle often — but
// cheap insurance for local dev / long-running processes.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 10 * 60 * 1000).unref?.();
