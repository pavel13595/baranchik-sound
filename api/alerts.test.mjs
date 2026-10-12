import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from './alerts.js';

function createResponse() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: '',
    setHeader(name, value) {
      headers.set(name.toLowerCase(), String(value));
    },
    getHeader(name) {
      return headers.get(name.toLowerCase());
    },
    end(body) {
      this.body = String(body || '');
    },
  };
}

function createRequest(ip, overrides = {}) {
  return {
    method: 'GET',
    headers: {
      host: 'baranchik-sound.vercel.app',
      'x-forwarded-for': ip,
      ...overrides,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Vercel alerts function', () => {
  it('requires ALERTS_TOKEN in the server environment without exposing it', async () => {
    vi.stubEnv('ALERTS_TOKEN', '');
    const response = createResponse();

    await handler(createRequest('test-missing-token'), response);

    expect(response.statusCode).toBe(503);
    expect(response.getHeader('cache-control')).toBe('no-store');
    expect(response.body).toContain('ALERTS_TOKEN');
    expect(response.body).not.toContain('secret');
  });

  it('uses the server token as a bearer credential and returns only alert JSON', async () => {
    vi.stubEnv('ALERTS_TOKEN', 'test-only-token');
    const fetchMock = vi.fn(async (_url, init) => {
      expect(init.headers.Authorization).toBe('Bearer test-only-token');
      return new Response(JSON.stringify({ alerts: [{ id: 'test-alert' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = createResponse();

    await handler(createRequest('test-valid-token'), response);

    expect(response.statusCode).toBe(200);
    expect(response.getHeader('cache-control')).toBe('no-store');
    expect(JSON.parse(response.body)).toEqual({ alerts: [{ id: 'test-alert' }] });
    expect(response.body).not.toContain('test-only-token');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects unsupported methods and foreign browser origins', async () => {
    vi.stubEnv('ALERTS_TOKEN', 'test-only-token');
    const methodResponse = createResponse();
    await handler({ ...createRequest('test-method'), method: 'POST' }, methodResponse);
    expect(methodResponse.statusCode).toBe(405);

    const originResponse = createResponse();
    await handler(
      createRequest('test-origin', { origin: 'https://attacker.example' }),
      originResponse,
    );
    expect(originResponse.statusCode).toBe(403);
  });
});
