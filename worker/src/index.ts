interface Env {
  ALERTS_TOKEN: string;
  ALLOWED_ORIGIN: string;
}

interface CacheBinding {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

interface WorkerCaches {
  default: CacheBinding;
}

const UPSTREAM_URL = 'https://api.alerts.in.ua/v1/alerts/active.json';
const CACHE_SECONDS = 5;
const UPSTREAM_TIMEOUT_MS = 8000;

function jsonResponse(
  payload: unknown,
  status: number,
  allowedOrigin: string | null,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('Vary', 'Origin');
  if (allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', allowedOrigin);
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

function isAlertsPayload(value: unknown): value is { alerts: unknown[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'alerts' in value &&
    Array.isArray((value as { alerts?: unknown }).alerts)
  );
}

function cacheBinding(): CacheBinding | null {
  try {
    const workerCaches = caches as unknown as WorkerCaches;
    return workerCaches.default;
  } catch {
    return null;
  }
}

async function cachedResponse(cache: CacheBinding | null, key: Request): Promise<Response | null> {
  if (!cache) {
    return null;
  }
  try {
    return (await cache.match(key)) || null;
  } catch {
    return null;
  }
}

function scheduleCacheWrite(
  cache: CacheBinding | null,
  key: Request,
  body: string,
  context: ExecutionContext,
): void {
  if (!cache) {
    return;
  }
  const stored = new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
    },
  });
  try {
    context.waitUntil(cache.put(key, stored));
  } catch {
    // Помилка кешу не повинна перетворювати успішну відповідь API на помилку.
  }
}

async function fetchUpstream(token: string): Promise<unknown> {
  const url = new URL(UPSTREAM_URL);
  url.searchParams.set('token', token);
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, UPSTREAM_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch {
      if (timedOut) {
        throw new Error('upstream-timeout');
      }
      throw new Error('upstream-network-error');
    }

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('upstream-rate-limited');
      }
      throw new Error('upstream-http-error');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (timedOut) {
        throw new Error('upstream-timeout');
      }
      throw new Error('upstream-invalid-json');
    }
    if (!isAlertsPayload(payload)) {
      throw new Error('upstream-invalid-payload');
    }
    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function handleRequest(
  request: Request,
  env: Env,
  context: ExecutionContext,
): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (!env.ALLOWED_ORIGIN) {
    return jsonResponse({ error: 'Worker origin is not configured' }, 500, null);
  }
  if (!origin || origin !== env.ALLOWED_ORIGIN) {
    return jsonResponse({ error: 'Origin is not allowed' }, 403, null);
  }

  const corsHeaders = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
  };
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname !== '/alerts') {
    return jsonResponse({ error: 'Not found' }, 404, env.ALLOWED_ORIGIN);
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: new Headers({
        ...corsHeaders,
        'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
        Vary: 'Origin',
      }),
    });
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, env.ALLOWED_ORIGIN, {
      Allow: 'GET, OPTIONS',
    });
  }
  if (!env.ALERTS_TOKEN) {
    return jsonResponse({ error: 'Worker secret is not configured' }, 500, env.ALLOWED_ORIGIN);
  }

  const key = new Request(`${requestUrl.origin}/alerts`, { method: 'GET' });
  const cache = cacheBinding();
  const hit = await cachedResponse(cache, key);
  if (hit) {
    try {
      const payload: unknown = await hit.json();
      if (isAlertsPayload(payload)) {
        return jsonResponse(payload, 200, env.ALLOWED_ORIGIN, {
          ...corsHeaders,
          'X-Proxy-Cache': 'HIT',
        });
      }
    } catch {
      // Пошкоджений кеш ігноруємо й отримуємо свіжу відповідь від API.
    }
  }

  try {
    const payload = await fetchUpstream(env.ALERTS_TOKEN);
    const body = JSON.stringify(payload);
    scheduleCacheWrite(cache, key, body, context);
    return new Response(body, {
      status: 200,
      headers: new Headers({
        ...corsHeaders,
        'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        Vary: 'Origin',
        'X-Proxy-Cache': 'MISS',
      }),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'upstream-timeout') {
      return jsonResponse({ error: 'Alerts API timed out' }, 504, env.ALLOWED_ORIGIN, corsHeaders);
    }
    if (code === 'upstream-rate-limited') {
      return jsonResponse(
        { error: 'Alerts API rate limit reached' },
        503,
        env.ALLOWED_ORIGIN,
        corsHeaders,
      );
    }
    return jsonResponse(
      { error: 'Alerts API is temporarily unavailable' },
      502,
      env.ALLOWED_ORIGIN,
      corsHeaders,
    );
  }
}

export default {
  fetch: handleRequest,
};
