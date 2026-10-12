import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index';

const allowedOrigin = 'https://restaurant.example';
const env = { ALERTS_TOKEN: 'secret-worker-token', ALLOWED_ORIGIN: allowedOrigin };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeContext(tasks: Promise<unknown>[]): never {
  return {
    waitUntil(promise: Promise<unknown>) {
      tasks.push(promise);
    },
  } as never;
}

function makeUpstreamResponse(): Response {
  return new Response(
    JSON.stringify({ alerts: [{ alert_type: 'air_raid', location_title: 'Кременчук' }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('Cloudflare alerts worker', () => {
  it('rejects unknown origins without CORS permission or upstream request', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const tasks: Promise<unknown>[] = [];
    const response = await worker.fetch(
      new Request('https://proxy.example/alerts', { headers: { Origin: 'https://evil.example' } }),
      env,
      makeContext(tasks),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(upstream).not.toHaveBeenCalled();
  });

  it('adds the secret upstream and returns CORS only for the configured origin', async () => {
    const upstream = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('token=secret-worker-token');
      return makeUpstreamResponse();
    });
    const cache = { match: vi.fn(async () => undefined), put: vi.fn(async () => undefined) };
    vi.stubGlobal('fetch', upstream);
    vi.stubGlobal('caches', { default: cache });
    const tasks: Promise<unknown>[] = [];
    const response = await worker.fetch(
      new Request('https://proxy.example/alerts', { headers: { Origin: allowedOrigin } }),
      env,
      makeContext(tasks),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(allowedOrigin);
    expect(response.headers.get('X-Proxy-Cache')).toBe('MISS');
    expect(body).not.toContain('secret-worker-token');
    expect(upstream).toHaveBeenCalledOnce();
    await Promise.all(tasks);
    expect(cache.put).toHaveBeenCalledOnce();
  });

  it('serves a second allowed device from the five-second cache', async () => {
    let stored: Response | undefined;
    const cache = {
      match: vi.fn(async () => (stored ? stored.clone() : undefined)),
      put: vi.fn(async (_request: Request, response: Response) => {
        stored = response.clone();
      }),
    };
    const upstream = vi.fn(async () => makeUpstreamResponse());
    vi.stubGlobal('fetch', upstream);
    vi.stubGlobal('caches', { default: cache });
    const tasks: Promise<unknown>[] = [];

    const first = await worker.fetch(
      new Request('https://proxy.example/alerts', { headers: { Origin: allowedOrigin } }),
      env,
      makeContext(tasks),
    );
    await Promise.all(tasks);
    const second = await worker.fetch(
      new Request('https://proxy.example/alerts', { headers: { Origin: allowedOrigin } }),
      env,
      makeContext([]),
    );

    expect(first.headers.get('X-Proxy-Cache')).toBe('MISS');
    expect(second.headers.get('X-Proxy-Cache')).toBe('HIT');
    expect(upstream).toHaveBeenCalledOnce();
    expect(cache.put.mock.calls[0][1].headers.get('Cache-Control')).toBe('public, max-age=5');
  });

  it('returns method and path errors with useful statuses', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const context = makeContext([]);
    const wrongMethod = await worker.fetch(
      new Request('https://proxy.example/alerts', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
      }),
      env,
      context,
    );
    const wrongPath = await worker.fetch(
      new Request('https://proxy.example/other', { headers: { Origin: allowedOrigin } }),
      env,
      context,
    );

    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('Allow')).toBe('GET, OPTIONS');
    expect(wrongPath.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});
