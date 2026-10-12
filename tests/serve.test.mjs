import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createServeServer, parseEnvFile } from '../scripts/serve.mjs';

const testDirs = [];

async function startServer({ distRoot, env, fetchImpl }) {
  const server = createServeServer({ distRoot, env, fetchImpl });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

afterEach(() => {
  for (const dir of testDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('serve proxy', () => {
  it('parses ALERTS_TOKEN from .env.local without VITE_ prefix', () => {
    expect(parseEnvFile('ALERTS_TOKEN=abc123\nOTHER=value\n')).toEqual({
      ALERTS_TOKEN: 'abc123',
      OTHER: 'value',
    });
  });

  it('returns a 503 error without token and never leaks the secret in the response', async () => {
    const server = await startServer({
      distRoot: new URL('../dist', import.meta.url).pathname,
      env: { ALERTS_TOKEN: '' },
      fetchImpl: async () => new Response(JSON.stringify({ alerts: [] }), { status: 200 }),
    });

    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/alerts`);

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).not.toContain('secret-token');

    server.close();
  });

  it('caches the API response for 5 seconds and serves static Range requests', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'serve-proxy-'));
    testDirs.push(tempDir);
    writeFileSync(path.join(tempDir, 'sample.txt'), '0123456789');
    writeFileSync(path.join(tempDir, 'styles.css'), '.topbar { display: flex; }');

    let calls = 0;
    const server = await startServer({
      distRoot: tempDir,
      env: { ALERTS_TOKEN: 'secret-token' },
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ alerts: [{ id: 'x' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    const port = server.address().port;
    const first = await fetch(`http://127.0.0.1:${port}/api/alerts`);
    const second = await fetch(`http://127.0.0.1:${port}/api/alerts`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(calls).toBe(1);

    const rangeResponse = await fetch(`http://127.0.0.1:${port}/sample.txt`, {
      headers: { Range: 'bytes=2-5' },
    });
    expect(rangeResponse.status).toBe(206);
    expect(await rangeResponse.text()).toBe('2345');
    expect(rangeResponse.headers.get('Cache-Control')).toBe('public, max-age=86400');

    const stylesheetResponse = await fetch(`http://127.0.0.1:${port}/styles.css`);
    expect(stylesheetResponse.status).toBe(200);
    expect(stylesheetResponse.headers.get('Cache-Control')).toBe('no-cache');

    server.close();
  });

  it('returns 404 for an unknown static path and 429 for rate limit hits', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'serve-proxy-'));
    testDirs.push(tempDir);
    const server = await startServer({
      distRoot: tempDir,
      env: { ALERTS_TOKEN: 'secret-token' },
      fetchImpl: async () =>
        new Response(JSON.stringify({ alerts: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    const port = server.address().port;
    const missing = await fetch(`http://127.0.0.1:${port}/missing.txt`);
    expect(missing.status).toBe(404);

    const requests = [];
    for (let index = 0; index < 31; index += 1) {
      requests.push(fetch(`http://127.0.0.1:${port}/api/alerts`));
    }
    const responses = await Promise.all(requests);
    expect(responses.some((response) => response.status === 429)).toBe(true);
    const limited = responses.find((response) => response.status === 429);
    expect(limited.headers.get('Retry-After')).toBeTruthy();

    server.close();
  });

  it('returns JSON 404 for unknown API paths instead of the SPA index', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'serve-api-not-found-'));
    testDirs.push(tempDir);
    writeFileSync(path.join(tempDir, 'index.html'), '<!doctype html><title>SPA</title>');
    const server = await startServer({
      distRoot: tempDir,
      env: { ALERTS_TOKEN: '' },
      fetchImpl: async () => new Response('{}', { status: 200 }),
    });

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/unknown`);
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(body).toContain('API route not found');
    expect(body).not.toContain('<!doctype html>');
    server.close();
  });
});
