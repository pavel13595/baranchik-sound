import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AlertHttpError,
  AlertRequestLimitError,
  AlertRequestLimiter,
  AlertTimeoutError,
  classifyAlertApiError,
  formatAlertApiDiagnostics,
  fetchActiveAlerts,
  InvalidJsonAlertResponseError,
  InvalidProxyUrlError,
  MissingAlertsTokenError,
  NonJsonAlertResponseError,
  resolveAlertProxyUrl,
  type AlertFetcher,
} from './api';
import type { VenueConfig } from '../types';

const venueConfig: VenueConfig = {
  venueName: 'Venue',
  logo: '',
  pollIntervalSec: 10,
  staleAfterSec: 600,
  alerts: {
    clearConfirmPolls: 2,
  },
  signals: { yellow: 'y.mp3', red: 'r.mp3', clear: 'c.mp3', activeHours: null },
  gamarjos: { dir: 'gamarjos' },
  proxyUrl: '',
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

describe('fetchActiveAlerts', () => {
  it('classifies missing token, invalid token, CORS and offline failures', () => {
    expect(classifyAlertApiError(new MissingAlertsTokenError(), true)).toBe('missing-token');
    expect(classifyAlertApiError(new AlertHttpError(401), true)).toBe('invalid-token');
    expect(classifyAlertApiError(new AlertHttpError(403), true)).toBe('invalid-token');
    expect(classifyAlertApiError(new TypeError('Failed to fetch'), true)).toBe('cors');
    expect(classifyAlertApiError(new TypeError('Failed to fetch'), false)).toBe('network');
    expect(classifyAlertApiError(new AlertTimeoutError(), true)).toBe('network');
    expect(formatAlertApiDiagnostics(new MissingAlertsTokenError())).toContain(
      'причина: missing-token',
    );
  });

  it('encodes the token and requests uncached JSON', async () => {
    const fetcher: AlertFetcher = vi.fn(async () => jsonResponse({ alerts: [] }));

    await fetchActiveAlerts(venueConfig, 'secret token', fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.alerts.in.ua/v1/alerts/active.json?token=secret%20token',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
  });

  it('parses the response text and never calls response.json()', async () => {
    const json = vi.fn(() => Promise.reject(new Error('response.json must not run')));
    const fetcher: AlertFetcher = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: async () => '{"alerts":[]}',
          json,
        }) as unknown as Response,
    );

    await expect(fetchActiveAlerts(venueConfig, 'test-token', fetcher)).resolves.toEqual({
      alerts: [],
    });
    expect(json).not.toHaveBeenCalled();
  });

  it('uses Authorization Bearer when explicitly configured for a direct request', async () => {
    const fetcher: AlertFetcher = vi.fn(async () => jsonResponse({ alerts: [] }));
    const config = {
      ...venueConfig,
      alerts: { ...venueConfig.alerts, auth: 'bearer' as const },
    };

    await fetchActiveAlerts(config, 'test-token', fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.alerts.in.ua/v1/alerts/active.json',
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    );
  });

  it('resolves relative proxy URLs and drops token query parameters', async () => {
    vi.stubGlobal('document', { baseURI: 'https://restaurant.test/index.html' });
    const fetcher: AlertFetcher = vi.fn(async () => jsonResponse({ alerts: [] }));

    await fetchActiveAlerts(
      { ...venueConfig, proxyUrl: 'api//alerts?token=never-send&region=west' },
      'ignored-token',
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      'https://restaurant.test/api/alerts?region=west',
      expect.not.objectContaining({ headers: expect.anything() }),
    );
  });

  it('keeps an empty proxy URL on the direct-token path', async () => {
    const fetcher: AlertFetcher = vi.fn(async () => jsonResponse({ alerts: [] }));

    await expect(fetchActiveAlerts(venueConfig, 'direct-token', fetcher)).resolves.toMatchObject({
      alerts: [],
    });
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('token=direct-token'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('turns an HTML 200 response into a useful non-JSON error', async () => {
    const fetcher: AlertFetcher = vi.fn(
      async () =>
        new Response('<!doctype html><html>fallback</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
    );

    await expect(
      fetchActiveAlerts({ ...venueConfig, proxyUrl: '/api/alerts' }, null, fetcher),
    ).rejects.toMatchObject({
      name: 'NonJsonAlertResponseError',
      message: expect.stringContaining('Сервер повернув не JSON'),
      diagnostics: {
        status: 200,
        contentType: 'text/html',
        path: '/api/alerts',
      },
    });
  });

  it('classifies an empty response body as non-JSON', async () => {
    const fetcher: AlertFetcher = vi.fn(async () => new Response('', { status: 200 }));

    await expect(
      fetchActiveAlerts({ ...venueConfig, proxyUrl: '/api/alerts' }, null, fetcher),
    ).rejects.toBeInstanceOf(NonJsonAlertResponseError);
  });

  it('classifies a proxy 404 and includes a query-free diagnostic path', async () => {
    const fetcher: AlertFetcher = vi.fn(async () => jsonResponse({ message: 'Not found' }, 404));

    await expect(
      fetchActiveAlerts({ ...venueConfig, proxyUrl: '/api/alerts?region=west' }, null, fetcher),
    ).rejects.toMatchObject({
      name: 'AlertHttpError',
      message: expect.stringContaining('Проксі недоступний. Запустіть npm start.'),
      diagnostics: {
        status: 404,
        path: '/api/alerts',
        contentType: 'application/json; charset=utf-8',
      },
    });
  });

  it('explains a missing server ALERTS_TOKEN without exposing any token', async () => {
    const fetcher: AlertFetcher = vi.fn(async () =>
      jsonResponse({ message: 'На сервері не задано ALERTS_TOKEN' }, 503),
    );

    await expect(
      fetchActiveAlerts({ ...venueConfig, proxyUrl: '/api/alerts' }, null, fetcher),
    ).rejects.toMatchObject({
      name: 'MissingServerAlertsTokenError',
      message:
        'На сервері не задано ALERTS_TOKEN. Для локального запуску задайте його в .env.local; для Vercel — у Project Settings → Environment Variables і створіть новий deployment.',
      diagnostics: { status: 503 },
    });
  });

  it('classifies malformed JSON separately and redacts token text from diagnostics', async () => {
    const fetcher: AlertFetcher = vi.fn(
      async () =>
        new Response('{"alerts": broken token=secret-value', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    let captured: unknown;
    try {
      await fetchActiveAlerts(
        { ...venueConfig, proxyUrl: '/api/alerts?token=url-secret' },
        null,
        fetcher,
      );
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(InvalidJsonAlertResponseError);
    const diagnostic = formatAlertApiDiagnostics(captured);
    expect(diagnostic).toContain('HTTP: 200');
    expect(diagnostic).toContain('Content-Type: application/json');
    expect(diagnostic).toContain('шлях: /api/alerts');
    expect(diagnostic).toContain('token=***');
    expect(diagnostic).not.toContain('secret-value');
    expect(diagnostic).not.toContain('url-secret');
  });

  it('catches invalid proxy URL construction before calling fetch', async () => {
    const fetcher: AlertFetcher = vi.fn(async () => jsonResponse({ alerts: [] }));

    await expect(
      fetchActiveAlerts({ ...venueConfig, proxyUrl: 'http://[' }, null, fetcher),
    ).rejects.toBeInstanceOf(InvalidProxyUrlError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('resolves proxy paths against document.baseURI', () => {
    expect(resolveAlertProxyUrl('api/alerts', 'https://restaurant.test/index.html')).toBe(
      'https://restaurant.test/api/alerts',
    );
    expect(resolveAlertProxyUrl('//api//alerts', 'https://restaurant.test/index.html')).toBe(
      'https://restaurant.test/api/alerts',
    );
  });

  it('preserves HTTP status for the caller', async () => {
    const fetcher: AlertFetcher = vi.fn(async () => jsonResponse({ message: 'gateway' }, 502));
    await expect(fetchActiveAlerts(venueConfig, 'token', fetcher)).rejects.toBeInstanceOf(
      AlertHttpError,
    );
  });

  it('accepts unchanged 304 responses without trying to parse a body', async () => {
    const fetcher: AlertFetcher = vi.fn(
      async () =>
        ({ status: 304, ok: false, headers: new Headers(), text: vi.fn() }) as unknown as Response,
    );
    await expect(fetchActiveAlerts(venueConfig, 'token', fetcher)).resolves.toEqual({
      alerts: [],
      notModified: true,
    });
  });

  it('limits requests to eight in a rolling minute and honors a retry block', () => {
    const limiter = new AlertRequestLimiter();
    for (let index = 0; index < 8; index += 1) limiter.acquire(1000);
    expect(() => limiter.acquire(1000)).toThrow(AlertRequestLimitError);
    limiter.defer(60_000, 1000);
    expect(() => limiter.acquire(60_999)).toThrow(AlertRequestLimitError);
    expect(() => limiter.acquire(61_000)).not.toThrow();
  });

  it('aborts after the requested timeout, including response body parsing', async () => {
    vi.useFakeTimers();
    const fetcher: AlertFetcher = vi.fn(async (_url, init) => {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () =>
          new Promise((_resolve, reject) => {
            if (init.signal) {
              init.signal.addEventListener('abort', () => reject(new Error('aborted')));
            }
          }),
      } as Response;
    });

    const request = fetchActiveAlerts(venueConfig, 'token', fetcher, 8000);
    const timeoutAssertion = expect(request).rejects.toBeInstanceOf(AlertTimeoutError);
    await vi.advanceTimersByTimeAsync(8000);
    await timeoutAssertion;
  });
});
