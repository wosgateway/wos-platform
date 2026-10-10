import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fromEnv: vi.fn(),
  slidingWindow: vi.fn(),
  limit: vi.fn(),
  instances: [] as Array<{ options: Record<string, unknown> }>,
}));

vi.mock('@upstash/redis', () => ({
  Redis: {
    fromEnv: mocks.fromEnv,
  },
}));

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    options: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
      this.options = options;
      mocks.instances.push({ options });
    }

    static slidingWindow = mocks.slidingWindow;

    async limit(key: string) {
      return mocks.limit(key);
    }
  },
}));

import { simpleRateLimit } from './rate-limit';

const fakeRedis = { testClient: true };

describe('simpleRateLimit', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.instances.length = 0;

    mocks.fromEnv.mockReset().mockReturnValue(fakeRedis);
    mocks.slidingWindow
      .mockReset()
      .mockImplementation((limit: number, duration: string) => ({
        limit,
        duration,
      }));
    mocks.limit.mockReset().mockResolvedValue({
      success: true,
      remaining: 1,
      reset: 123456789,
    });
  });

  it('configures the requested limit and sliding window', async () => {
    const result = await simpleRateLimit('test-key', 2, 2000);

    expect(mocks.slidingWindow).toHaveBeenCalledWith(2, '2 s');
    expect(mocks.instances[0].options).toMatchObject({
      redis: fakeRedis,
      prefix: 'wos:ratelimit',
    });
    expect(mocks.limit).toHaveBeenCalledWith('test-key');
    expect(result).toEqual({
      allowed: true,
      remaining: 1,
      resetAt: 123456789,
    });
  });

  it('returns denied status when the limiter rejects a request', async () => {
    mocks.limit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: 987654321,
    });

    await expect(simpleRateLimit('blocked-key', 2, 2000)).resolves.toEqual({
      allowed: false,
      remaining: 0,
      resetAt: 987654321,
    });
  });

  it('rounds a partial second up to a whole second', async () => {
    await simpleRateLimit('rounding-key', 3, 1001);

    expect(mocks.slidingWindow).toHaveBeenCalledWith(3, '2 s');
  });

  it('uses at least a one-second window', async () => {
    await simpleRateLimit('minimum-window-key', 3, 0);

    expect(mocks.slidingWindow).toHaveBeenCalledWith(3, '1 s');
  });

  it('passes different keys to the limiter unchanged', async () => {
    await simpleRateLimit('client-a', 2, 2000);
    await simpleRateLimit('client-b', 2, 2000);

    expect(mocks.limit).toHaveBeenNthCalledWith(1, 'client-a');
    expect(mocks.limit).toHaveBeenNthCalledWith(2, 'client-b');
  });

  it('propagates Redis errors to its caller', async () => {
    mocks.limit.mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(
      simpleRateLimit('error-key', 2, 2000),
    ).rejects.toThrow('redis unavailable');
  });
});
