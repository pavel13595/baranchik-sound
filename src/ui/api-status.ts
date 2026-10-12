import type { PollStatus } from '../alerts/poller';

export type ApiConnectionState =
  | 'online'
  | 'offline'
  | 'rate-limited'
  | 'invalid-token'
  | 'denied'
  | 'proxy-unavailable'
  | 'missing-location';

export interface ApiStatusPresentation {
  state: ApiConnectionState;
  text: string;
}

function clockText(date: Date): string {
  const twoDigits = (value: number): string => (value < 10 ? `0${value}` : String(value));
  return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}:${twoDigits(date.getSeconds())}`;
}

export function getApiStatusPresentation(
  status: PollStatus,
  checkedAt: Date | null,
  lastResponseAt: Date | null,
  failureCode: number | null,
  proxyUnavailable: boolean,
  retryAfterSec: number,
): ApiStatusPresentation {
  const withLastResponse = (text: string): string =>
    lastResponseAt ? `${text} · остання відповідь ${clockText(lastResponseAt)}` : text;

  if (status === 'missing-location') {
    return { state: 'missing-location', text: '● API: оберіть місто' };
  }
  if (failureCode === 404 && proxyUnavailable) {
    return {
      state: 'proxy-unavailable',
      text: withLastResponse('● API: проксі недоступний'),
    };
  }
  if (failureCode === 401 || status === 'missing-token') {
    return { state: 'invalid-token', text: withLastResponse('● API: токен недійсний') };
  }
  if (failureCode === 403) {
    return { state: 'denied', text: withLastResponse('● API: доступ заборонено') };
  }
  if (failureCode === 429) {
    const seconds = Math.max(1, Math.ceil(retryAfterSec));
    return {
      state: 'rate-limited',
      text: withLastResponse(`● API: забагато запитів, повтор через ${seconds} с`),
    };
  }
  if ((status === 'ready' || status === 'stale') && checkedAt) {
    return { state: 'online', text: `● API: на зв'язку · ${clockText(checkedAt)}` };
  }
  return { state: 'offline', text: withLastResponse('● API: немає зв’язку') };
}
