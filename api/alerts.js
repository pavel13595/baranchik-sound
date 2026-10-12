const UPSTREAM_URL = 'https://api.alerts.in.ua/v1/alerts/active.json';
const REQUEST_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;
const CACHE_TTL_MS = 5_000;
const UPSTREAM_TIMEOUT_MS = 8_000;
const requestWindows = new Map();

let cachedPayload = null;
let cacheExpiresAt = 0;

function sendJson(response, statusCode, payload, headers = {}) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  Object.keys(headers).forEach((name) => response.setHeader(name, headers[name]));
  response.end(JSON.stringify(payload));
}

function requestIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]).trim() || 'unknown';
  }
  return 'unknown';
}

function originMatchesHost(request) {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !origin) return true;
  const forwardedHost = request.headers['x-forwarded-host'];
  const host =
    typeof forwardedHost === 'string' && forwardedHost ? forwardedHost : request.headers.host;
  if (typeof host !== 'string' || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.split(',')[0].trim().toLowerCase();
  } catch {
    return false;
  }
}

function takeRateLimit(ip, now) {
  const requestTimes = requestWindows.get(ip) || [];
  while (requestTimes.length > 0 && now - requestTimes[0] >= REQUEST_WINDOW_MS) {
    requestTimes.shift();
  }
  if (requestTimes.length >= MAX_REQUESTS_PER_WINDOW) {
    return Math.max(1, Math.ceil((requestTimes[0] + REQUEST_WINDOW_MS - now) / 1000));
  }
  requestTimes.push(now);
  requestWindows.set(ip, requestTimes);
  return 0;
}

function isAlertsPayload(value) {
  return typeof value === 'object' && value !== null && Array.isArray(value.alerts);
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    sendJson(response, 405, { message: 'Method not allowed' }, { Allow: 'GET' });
    return;
  }

  if (!originMatchesHost(request)) {
    sendJson(response, 403, { message: 'Origin not allowed' });
    return;
  }

  const retryAfter = takeRateLimit(requestIp(request), Date.now());
  if (retryAfter > 0) {
    sendJson(
      response,
      429,
      { message: 'Too many requests' },
      { 'Retry-After': String(retryAfter) },
    );
    return;
  }

  const token = String(process.env.ALERTS_TOKEN || '').trim();
  if (!token) {
    sendJson(response, 503, { message: 'На сервері Vercel не задано ALERTS_TOKEN' });
    return;
  }

  if (cachedPayload && cacheExpiresAt > Date.now()) {
    sendJson(response, 200, cachedPayload);
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(UPSTREAM_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });

    if (upstream.status === 304) {
      const payload = { alerts: [] };
      cachedPayload = payload;
      cacheExpiresAt = Date.now() + CACHE_TTL_MS;
      sendJson(response, 200, payload);
      return;
    }
    if (upstream.status === 429) {
      const retry = upstream.headers.get('Retry-After');
      const headers = retry ? { 'Retry-After': retry } : {};
      sendJson(response, 429, { message: 'Alerts API rate limit reached' }, headers);
      return;
    }
    if (upstream.status === 401 || upstream.status === 403) {
      sendJson(response, upstream.status, { message: 'Alerts API authorization failed' });
      return;
    }
    if (!upstream.ok) {
      sendJson(response, 502, { message: 'Alerts API is temporarily unavailable' });
      return;
    }

    let payload;
    try {
      payload = await upstream.json();
    } catch {
      sendJson(response, 502, { message: 'Alerts API returned invalid JSON' });
      return;
    }
    if (!isAlertsPayload(payload)) {
      sendJson(response, 502, { message: 'Alerts API returned an invalid payload' });
      return;
    }

    cachedPayload = payload;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    sendJson(response, 200, payload);
  } catch {
    sendJson(response, controller.signal.aborted ? 504 : 502, {
      message: controller.signal.aborted
        ? 'Alerts API timed out'
        : 'Alerts API is temporarily unavailable',
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
