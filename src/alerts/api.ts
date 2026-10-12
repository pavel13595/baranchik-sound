import type { AlertRecord } from '../alerts';
import type { VenueConfig } from '../types';
import { redactSensitiveText } from '../log';

export interface ActiveAlertsResponse {
  alerts: AlertRecord[];
  meta?: { last_updated_at?: string | null };
  notModified?: boolean;
}

export type AlertApiFailure =
  | 'missing-token'
  | 'server-token-missing'
  | 'invalid-token'
  | 'forbidden'
  | 'rate-limited'
  | 'cors'
  | 'network'
  | 'timeout'
  | 'proxy-unavailable'
  | 'proxy-url'
  | 'non-json'
  | 'invalid-json'
  | 'invalid-response'
  | 'upstream'
  | 'server';

export interface AlertApiDiagnostics {
  cause: AlertApiFailure;
  status: number | null;
  contentType: string | null;
  bodyPreview: string;
  path: string;
}

function emptyDiagnostics(cause: AlertApiFailure, path = ''): AlertApiDiagnostics {
  return { cause, status: null, contentType: null, bodyPreview: '', path };
}

function bodyPreview(body: string): string {
  const redacted = redactSensitiveText(body)
    .replace(/(\btoken["']?\s*[:=]\s*["']?)[^&\s"'<>},]+/gi, '$1***')
    .replace(/\s+/g, ' ')
    .trim();
  return redacted.slice(0, 80);
}

function responseDiagnostics(
  cause: AlertApiFailure,
  status: number | null,
  contentType: string | null,
  body: string,
  path: string,
): AlertApiDiagnostics {
  return { cause, status, contentType, bodyPreview: bodyPreview(body), path };
}

export class AlertApiError extends Error {
  readonly diagnostics: AlertApiDiagnostics;

  constructor(message: string, diagnostics: AlertApiDiagnostics) {
    super(message);
    this.diagnostics = diagnostics;
  }
}

export class AlertRequestLimitError extends AlertApiError {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number, diagnostics = emptyDiagnostics('rate-limited')) {
    super('Ліміт запитів до API; повторіть пізніше', diagnostics);
    this.name = 'AlertRequestLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class AlertRequestLimiter {
  private readonly requestTimes: number[] = [];
  private blockedUntil = 0;

  acquire(now = Date.now()): void {
    while (this.requestTimes.length > 0 && now - this.requestTimes[0] >= 60_000) {
      this.requestTimes.shift();
    }
    if (now < this.blockedUntil) {
      throw new AlertRequestLimitError(this.blockedUntil - now);
    }
    if (this.requestTimes.length >= 8) {
      throw new AlertRequestLimitError(this.requestTimes[0] + 60_000 - now);
    }
    this.requestTimes.push(now);
  }

  defer(milliseconds: number, now = Date.now()): void {
    this.blockedUntil = Math.max(this.blockedUntil, now + Math.max(0, milliseconds));
  }

  getRequestCount(now = Date.now()): number {
    while (this.requestTimes.length > 0 && now - this.requestTimes[0] >= 60_000) {
      this.requestTimes.shift();
    }
    return this.requestTimes.length;
  }
}

export type AlertFetcher = (input: string, init: RequestInit) => Promise<Response>;

export class MissingAlertsTokenError extends Error {
  constructor() {
    super('Вставте токен');
    this.name = 'MissingAlertsTokenError';
  }
}

export class MissingServerAlertsTokenError extends AlertApiError {
  constructor(diagnostics: AlertApiDiagnostics) {
    super('На сервері не задано ALERTS_TOKEN (.env.local).', diagnostics);
    this.name = 'MissingServerAlertsTokenError';
  }
}

export class InvalidProxyUrlError extends AlertApiError {
  constructor(diagnostics: AlertApiDiagnostics) {
    super('Адреса proxyUrl некоректна. Перевірте шлях у venue.json.', diagnostics);
    this.name = 'InvalidProxyUrlError';
  }
}

export class NonJsonAlertResponseError extends AlertApiError {
  constructor(diagnostics: AlertApiDiagnostics) {
    const status = diagnostics.status === null ? '' : ` HTTP ${diagnostics.status}.`;
    super(
      `Сервер повернув не JSON. Схоже, запущено не проксі-сервер (npm start) або адреса /api/alerts недоступна.${status}`,
      diagnostics,
    );
    this.name = 'NonJsonAlertResponseError';
  }
}

export class InvalidJsonAlertResponseError extends AlertApiError {
  constructor(diagnostics: AlertApiDiagnostics) {
    const status = diagnostics.status === null ? '' : ` HTTP ${diagnostics.status}.`;
    super(`Сервер повернув некоректний JSON.${status}`, diagnostics);
    this.name = 'InvalidJsonAlertResponseError';
  }
}

export class AlertNetworkError extends AlertApiError {
  constructor(diagnostics: AlertApiDiagnostics) {
    super('Не вдалося отримати відповідь від proxy-сервера.', diagnostics);
    this.name = 'AlertNetworkError';
  }
}

export class AlertHttpError extends AlertApiError {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(
    status: number,
    retryAfterMs: number | null = null,
    diagnostics = responseDiagnostics(
      status === 404
        ? 'proxy-unavailable'
        : status === 401
          ? 'invalid-token'
          : status === 403
            ? 'forbidden'
            : status === 429
              ? 'rate-limited'
              : status === 502 || status === 504
                ? 'upstream'
                : 'server',
      status,
      null,
      '',
      '',
    ),
  ) {
    super(getHttpFailureMessage(status), diagnostics);
    this.name = 'AlertHttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export class AlertTimeoutError extends AlertApiError {
  constructor(diagnostics = emptyDiagnostics('timeout')) {
    super('Час очікування відповіді API вичерпано.', diagnostics);
    this.name = 'AlertTimeoutError';
  }
}

export class InvalidAlertResponseError extends AlertApiError {
  constructor(diagnostics = emptyDiagnostics('invalid-response')) {
    super('API повернув JSON без списку alerts.', diagnostics);
    this.name = 'InvalidAlertResponseError';
  }
}

function getHttpFailureMessage(status: number): string {
  if (status === 404) return 'Проксі недоступний. Запустіть npm start. HTTP 404.';
  if (status === 401) return 'API відхилив токен (HTTP 401). Перевірте токен на сервері.';
  if (status === 403) return 'API заборонив запит (HTTP 403). Перевірте доступ для IP або країни.';
  if (status === 429) return 'Перевищено ліміт API (HTTP 429). Дотримуйтеся Retry-After.';
  if (status === 502) return 'Upstream API недоступний (HTTP 502). Перевірте мережу сервера.';
  if (status === 504) return 'Upstream API не відповів вчасно (HTTP 504).';
  return `Сервер повернув помилку HTTP ${status}.`;
}

export function classifyAlertApiError(error: unknown, online: boolean): AlertApiFailure {
  if (error instanceof MissingAlertsTokenError) {
    return 'missing-token';
  }
  if (error instanceof AlertHttpError) {
    if (error.status === 401 || error.status === 403) return 'invalid-token';
    return error.diagnostics.cause;
  }
  if (error instanceof AlertApiError) {
    if (error.diagnostics.cause === 'network' && online) return 'cors';
    if (error.diagnostics.cause === 'timeout') return 'network';
    return error.diagnostics.cause;
  }
  if (error instanceof TypeError) {
    return online ? 'cors' : 'network';
  }
  if (error instanceof AlertTimeoutError) {
    return 'network';
  }
  return 'server';
}

export function getAlertApiFailureMessage(error: unknown, online: boolean): string {
  if (error instanceof MissingAlertsTokenError) return 'Введіть API-токен у налаштуваннях.';
  if (error instanceof MissingServerAlertsTokenError) return error.message;
  if (error instanceof AlertHttpError) return error.message;
  if (error instanceof NonJsonAlertResponseError) return error.message;
  if (error instanceof InvalidJsonAlertResponseError) return error.message;
  if (error instanceof InvalidProxyUrlError) return error.message;
  if (error instanceof InvalidAlertResponseError) return error.message;
  if (error instanceof AlertTimeoutError) {
    return 'Час очікування вичерпано. Перевірте зв’язок із proxy-сервером.';
  }
  if (error instanceof AlertRequestLimitError) return error.message;
  if (error instanceof AlertNetworkError) {
    return online
      ? 'Запит заблоковано браузером або мережею (CORS). Відкрийте застосунок через npm start.'
      : 'Пристрій офлайн. Перевірте Wi-Fi або мобільну мережу.';
  }
  if (error instanceof TypeError) {
    return online
      ? 'Запит заблоковано браузером або мережею (CORS). Відкрийте застосунок через npm start.'
      : 'Пристрій офлайн. Перевірте Wi-Fi або мобільну мережу.';
  }
  if (error instanceof Error) {
    return 'Не вдалося виконати запит до API. Перевірте адресу proxy-сервера та журнал помилок.';
  }
  return 'Не вдалося виконати запит до API.';
}

export function formatAlertApiDiagnostics(error: unknown, online = true): string {
  let diagnostics: AlertApiDiagnostics;
  if (error instanceof AlertApiError) {
    diagnostics = error.diagnostics;
  } else if (error instanceof MissingAlertsTokenError) {
    diagnostics = emptyDiagnostics('missing-token', '/v1/alerts/active.json');
  } else {
    diagnostics = emptyDiagnostics(classifyAlertApiError(error, online));
  }
  const cause = diagnostics.cause === 'network' && online ? 'cors' : diagnostics.cause;
  const className = error instanceof Error ? error.name : 'UnknownError';
  const status = diagnostics.status === null ? '—' : String(diagnostics.status);
  const contentType = diagnostics.contentType || '—';
  const path = diagnostics.path || '—';
  const preview = diagnostics.bodyPreview || '—';
  return `Клас: ${className}; причина: ${cause}; HTTP: ${status}; Content-Type: ${contentType}; шлях: ${path}; тіло: ${preview}`;
}

function isActiveAlertsResponse(value: unknown): value is ActiveAlertsResponse {
  if (typeof value !== 'object' || value === null || !('alerts' in value)) {
    return false;
  }
  return Array.isArray((value as { alerts?: unknown }).alerts);
}

function currentDocumentBase(): string {
  if (typeof document !== 'undefined' && document.baseURI) {
    return document.baseURI;
  }
  return 'http://localhost/';
}

export function resolveAlertProxyUrl(proxyUrl: string, baseUrl = currentDocumentBase()): string {
  const normalizedInput = proxyUrl.trim().replace(/^\/{2,}/, '/');
  const url = new URL(normalizedInput, baseUrl);
  url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
  const tokenParameters: string[] = [];
  url.searchParams.forEach((_value, key) => {
    if (key.toLowerCase() === 'token') tokenParameters.push(key);
  });
  tokenParameters.forEach((key) => url.searchParams.delete(key));
  url.hash = '';
  return url.toString();
}

function requestPath(requestUrl: string): string {
  try {
    return new URL(requestUrl, currentDocumentBase()).pathname;
  } catch {
    return requestUrl.split(/[?#]/)[0] || '/';
  }
}

function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(';')[0].trim().toLowerCase();
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

function retryAfterMilliseconds(response: Response, limiter?: AlertRequestLimiter): number | null {
  const retryAfter = response.headers ? response.headers.get('Retry-After') : null;
  const retrySeconds = retryAfter ? Number(retryAfter) : NaN;
  const retryAfterMs =
    Number.isFinite(retrySeconds) && retrySeconds >= 0 ? retrySeconds * 1000 : null;
  if (response.status === 429 && limiter) limiter.defer(retryAfterMs || 60_000);
  return retryAfterMs;
}

export async function fetchActiveAlerts(
  config: VenueConfig,
  token: string | null,
  fetcher: AlertFetcher,
  timeoutMs = 8000,
  limiter?: AlertRequestLimiter,
): Promise<ActiveAlertsResponse> {
  const proxyUrl = config.proxyUrl.trim();
  if (proxyUrl.length === 0 && (!token || token.trim().length === 0)) {
    throw new MissingAlertsTokenError();
  }

  const useBearer = proxyUrl.length === 0 && config.alerts.auth === 'bearer';
  let url: string;
  try {
    url = proxyUrl
      ? resolveAlertProxyUrl(proxyUrl)
      : useBearer
        ? 'https://api.alerts.in.ua/v1/alerts/active.json'
        : `https://api.alerts.in.ua/v1/alerts/active.json?token=${encodeURIComponent(token || '')}`;
  } catch {
    const path = proxyUrl.split(/[?#]/)[0] || '/';
    throw new InvalidProxyUrlError(emptyDiagnostics('proxy-url', path));
  }
  const path = requestPath(url);
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const requestInit: RequestInit = {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    };
    if (useBearer) {
      requestInit.headers = { Authorization: `Bearer ${token || ''}` };
    }
    if (limiter) {
      try {
        limiter.acquire();
      } catch (error) {
        if (error instanceof AlertRequestLimitError) {
          throw new AlertRequestLimitError(
            error.retryAfterMs,
            emptyDiagnostics('rate-limited', path),
          );
        }
        throw error;
      }
    }
    const response = await fetcher(url, requestInit);
    if (response.status === 304) {
      return { alerts: [], notModified: true };
    }

    const contentType = response.headers ? response.headers.get('Content-Type') : null;
    const text = await response.text();
    const status = response.status;
    const retryAfterMs = retryAfterMilliseconds(response, limiter);
    const cause: AlertApiFailure =
      status === 404
        ? 'proxy-unavailable'
        : status === 401
          ? 'invalid-token'
          : status === 403
            ? 'forbidden'
            : status === 429
              ? 'rate-limited'
              : status === 502 || status === 504
                ? 'upstream'
                : 'server';
    const diagnostics = responseDiagnostics(cause, status, contentType, text, path);

    if (status === 404) {
      throw new AlertHttpError(status, retryAfterMs, diagnostics);
    }
    if (status === 503 && /ALERTS_TOKEN/i.test(text)) {
      throw new MissingServerAlertsTokenError(diagnostics);
    }
    if ([401, 403, 429, 502, 504].indexOf(status) >= 0) {
      throw new AlertHttpError(status, retryAfterMs, diagnostics);
    }

    const trimmedText = text.trim();
    if (
      !isJsonContentType(contentType) ||
      !(trimmedText.startsWith('{') || trimmedText.startsWith('['))
    ) {
      throw new NonJsonAlertResponseError(diagnostics);
    }
    if (!response.ok) {
      throw new AlertHttpError(status, retryAfterMs, diagnostics);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(trimmedText);
    } catch {
      throw new InvalidJsonAlertResponseError(
        responseDiagnostics('invalid-json', status, contentType, text, path),
      );
    }
    if (!isActiveAlertsResponse(payload)) {
      throw new InvalidAlertResponseError(
        responseDiagnostics('invalid-response', status, contentType, text, path),
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof AlertApiError) {
      throw error;
    }
    if (timedOut) {
      throw new AlertTimeoutError(emptyDiagnostics('timeout', path));
    }
    if (error instanceof TypeError) {
      throw new AlertNetworkError(emptyDiagnostics('network', path));
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
