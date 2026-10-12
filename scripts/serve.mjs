import http from 'node:http';
import { readFileSync, statSync, createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultDistRoot = path.join(projectRoot, 'dist');
const upstreamUrl = 'https://api.alerts.in.ua/v1/alerts/active.json';
const requestWindowMs = 60_000;
const maxRequestsPerWindow = 30;
const cacheTtlMs = 5_000;
const timeoutMs = 8_000;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.mp4': 'audio/mp4',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.txt': 'text/plain; charset=utf-8',
};

export function parseEnvFile(contents) {
  const result = {};
  for (const rawLine of String(contents || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const index = line.indexOf('=');
    if (index <= 0) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    result[key] = value.replace(/^['"]|['"]$/g, '');
  }
  return result;
}

export function readLocalEnv(envPath = path.join(projectRoot, '.env.local')) {
  try {
    return parseEnvFile(readFileSync(envPath, 'utf8'));
  } catch {
    return {};
  }
}

export function resolveServerEnv(env = process.env) {
  return { ...readLocalEnv(), ...env };
}

export function getLanAddress() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(interfaces)) {
    for (const entry of interfaces[name] || []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        candidates.push(entry.address);
      }
    }
  }
  return candidates[0] || '127.0.0.1';
}

export function createServeServer({
  distRoot = defaultDistRoot,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const resolvedEnv = resolveServerEnv(env);
  const rateLimit = [];
  let cacheEntry = null;

  function sendJson(response, statusCode, message, extraHeaders = {}) {
    const payload = JSON.stringify({ message });
    response.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    });
    response.end(payload);
  }

  function getNetworkErrorMessage(error) {
    return error instanceof Error && error.name === 'AbortError'
      ? 'upstream-timeout'
      : 'upstream-network-error';
  }

  function getRangeHeader(rangeHeader, totalLength) {
    if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
      return null;
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match) {
      return null;
    }
    const startValue = match[1];
    const endValue = match[2];

    let start = 0;
    let end = totalLength - 1;
    if (startValue) {
      start = Number(startValue);
    }
    if (endValue) {
      end = Number(endValue);
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= totalLength) {
      return null;
    }
    return { start, end: Math.min(end, totalLength - 1) };
  }

  function serveStaticFile(request, response, pathname) {
    if (pathname === '/') {
      pathname = '/index.html';
    }
    const absolutePath = path.join(distRoot, pathname.replace(/^\/+/, ''));
    const normalized = path.normalize(absolutePath);
    if (!normalized.startsWith(path.normalize(distRoot))) {
      sendJson(response, 403, 'Forbidden');
      return;
    }

    try {
      const stat = statSync(normalized);
      if (!stat.isFile()) {
        sendJson(response, 404, 'Not found');
        return;
      }

      const ext = path.extname(normalized).toLowerCase();
      const mime = mimeTypes[ext] || 'application/octet-stream';
      const isIndexHtml = normalized.endsWith(path.join(distRoot, 'index.html'));
      const isStylesheet = path.basename(normalized) === 'styles.css';
      const ttlHeader = isIndexHtml || isStylesheet ? 'no-cache' : 'public, max-age=86400';
      const headers = {
        'Content-Type': mime,
        'Cache-Control': ttlHeader,
        'Accept-Ranges': 'bytes',
      };

      if (request.method === 'HEAD') {
        response.writeHead(200, headers);
        response.end();
        return;
      }

      const range = getRangeHeader(request.headers.range || '', stat.size);
      if (range) {
        response.writeHead(206, {
          ...headers,
          'Content-Length': String(range.end - range.start + 1),
          'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
        });
        createReadStream(normalized, { start: range.start, end: range.end }).pipe(response);
        return;
      }

      response.writeHead(200, {
        ...headers,
        'Content-Length': String(stat.size),
      });
      createReadStream(normalized).pipe(response);
    } catch {
      sendJson(response, 404, 'Not found');
    }
  }

  async function handleApiAlerts(request, response) {
    const now = Date.now();
    while (rateLimit.length > 0 && now - rateLimit[0] >= requestWindowMs) {
      rateLimit.shift();
    }
    if (rateLimit.length >= maxRequestsPerWindow) {
      const retryAfterMs = rateLimit[0] + requestWindowMs - now;
      const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      sendJson(response, 429, 'Too many requests', {
        'Retry-After': String(seconds),
      });
      return;
    }
    rateLimit.push(now);

    const token = String(resolvedEnv.ALERTS_TOKEN || '').trim();
    if (!token) {
      sendJson(response, 503, 'На сервері не задано ALERTS_TOKEN');
      return;
    }

    const cached = cacheEntry && cacheEntry.expiresAt > Date.now() ? cacheEntry.payload : null;
    if (cached) {
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify(cached));
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const upstreamResponse = await fetchImpl(upstreamUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      });

      if (upstreamResponse.status === 304) {
        const payload = { alerts: [] };
        cacheEntry = { expiresAt: Date.now() + cacheTtlMs, payload };
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end(JSON.stringify(payload));
        return;
      }

      if (
        upstreamResponse.status === 401 ||
        upstreamResponse.status === 403 ||
        upstreamResponse.status === 429
      ) {
        const body = { message: upstreamResponse.status === 429 ? 'Rate limited' : 'Unauthorized' };
        response.writeHead(upstreamResponse.status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          ...(upstreamResponse.headers.get('Retry-After')
            ? { 'Retry-After': upstreamResponse.headers.get('Retry-After') }
            : {}),
        });
        response.end(JSON.stringify(body));
        return;
      }

      if (!upstreamResponse.ok) {
        const statusCode = upstreamResponse.status >= 500 ? 502 : upstreamResponse.status || 502;
        sendJson(response, statusCode, 'Upstream API error');
        return;
      }

      const payload = await upstreamResponse.json();
      cacheEntry = { expiresAt: Date.now() + cacheTtlMs, payload };
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify(payload));
    } catch (error) {
      const message = getNetworkErrorMessage(error);
      const code = message === 'upstream-timeout' ? 504 : 502;
      sendJson(
        response,
        code,
        message === 'upstream-timeout' ? 'Request to API timed out' : 'Upstream network error',
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');

    if (url.pathname === '/api/alerts') {
      if (request.method && request.method !== 'GET') {
        sendJson(response, 405, 'Method not allowed');
        return;
      }
      await handleApiAlerts(request, response);
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      sendJson(response, 404, 'API route not found');
      return;
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      });
      response.end();
      return;
    }

    serveStaticFile(request, response, url.pathname);
  });
}

export function startServer({
  distRoot = defaultDistRoot,
  env = process.env,
  host = '0.0.0.0',
  port = Number(process.env.PORT || 4174),
  fetchImpl = fetch,
} = {}) {
  const server = createServeServer({ distRoot, env, fetchImpl });
  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const lanAddress = getLanAddress();
    console.log(`Local server running at http://0.0.0.0:${actualPort}`);
    console.log(`LAN URL for iPhone: http://${lanAddress}:${actualPort}`);
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
