import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  simpleRateLimit: vi.fn(),
  runWosAI: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  simpleRateLimit: mocks.simpleRateLimit,
}));

vi.mock('@/lib/ai/core', () => ({
  runWosAI: mocks.runWosAI,
}));

import { POST } from './route';

describe('POST /api/ai/chat rate limit handling', () => {
  const originalEnv = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    WOS_AI_REGRESSION_TOKEN: process.env.WOS_AI_REGRESSION_TOKEN,
  };

  beforeEach(() => {
    process.env.VERCEL_ENV = 'preview';
    process.env.WOS_AI_REGRESSION_TOKEN = 'unit-test-token';

    mocks.simpleRateLimit.mockReset().mockResolvedValue({
      allowed: true,
      remaining: 49,
      resetAt: Date.now() + 600000,
    });
    mocks.runWosAI.mockReset();
  });

  afterEach(() => {
    if (originalEnv.VERCEL_ENV === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = originalEnv.VERCEL_ENV;
    }

    if (originalEnv.WOS_AI_REGRESSION_TOKEN === undefined) {
      delete process.env.WOS_AI_REGRESSION_TOKEN;
    } else {
      process.env.WOS_AI_REGRESSION_TOKEN =
        originalEnv.WOS_AI_REGRESSION_TOKEN;
    }

    vi.restoreAllMocks();
  });

  it('uses the dedicated Preview regression bucket for a valid token', async () => {
    const request = new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-wos-ai-regression-token': 'unit-test-token',
        'x-forwarded-for': '198.18.0.42',
      },
      body: '{',
    });

    const response = await POST(request);

    expect(mocks.simpleRateLimit).toHaveBeenCalledWith(
      'ai-chat-regression:preview',
      50,
      600000,
    );
    expect(response.status).toBe(400);
    expect(mocks.runWosAI).not.toHaveBeenCalled();
  });

  it('returns 429 when the rate limiter denies the request', async () => {
    mocks.simpleRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 600000,
    });

    const request = new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-wos-ai-regression-token': 'unit-test-token',
      },
      body: '{',
    });

    const response = await POST(request);

    expect(response.status).toBe(429);
    expect(mocks.runWosAI).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid token", "wrong-token"],
    ["missing token", null],
  ])("uses the normal rate-limit bucket with a %s", async (_label, token) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-forwarded-for": "198.18.0.42",
    };

    if (token !== null) {
      headers["x-wos-ai-regression-token"] = token;
    }

    const request = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers,
      body: "{",
    });

    const response = await POST(request);

    expect(mocks.simpleRateLimit).toHaveBeenCalledWith(
      "ai-chat:198.18.0.42",
      20,
      600000,
    );
    expect(response.status).toBe(400);
    expect(mocks.runWosAI).not.toHaveBeenCalled();
  });
  it('fails open on rate limiter errors and continues request validation', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.simpleRateLimit.mockRejectedValueOnce(
      new Error('simulated Redis outage'),
    );

    const request = new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-wos-ai-regression-token': 'unit-test-token',
      },
      body: '{',
    });

    const response = await POST(request);

    expect(errorSpy).toHaveBeenCalledWith(
      '[AI_CHAT_RATE_LIMIT_ERROR]',
      'simulated Redis outage',
    );
    expect(response.status).toBe(400);
    expect(mocks.runWosAI).not.toHaveBeenCalled();
  });
});
