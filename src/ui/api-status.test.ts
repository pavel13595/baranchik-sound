import { describe, expect, it } from 'vitest';
import { getApiStatusPresentation } from './api-status';

describe('API status presentation', () => {
  it('shows selected-location state before polling', () => {
    expect(getApiStatusPresentation('missing-location', null, null, null, false, 0)).toEqual({
      state: 'missing-location',
      text: '● API: оберіть місто',
    });
  });

  it('shows last successful request time', () => {
    expect(
      getApiStatusPresentation('ready', new Date(2026, 0, 1, 23, 45, 5), null, null, false, 0),
    ).toEqual({ state: 'online', text: "● API: на зв'язку · 23:45:05" });
  });

  it('shows the last successful response time while offline', () => {
    expect(
      getApiStatusPresentation(
        'offline',
        new Date(2026, 0, 1, 23, 46, 0),
        new Date(2026, 0, 1, 23, 45, 5),
        null,
        false,
        0,
      ),
    ).toEqual({
      state: 'offline',
      text: '● API: немає зв’язку · остання відповідь 23:45:05',
    });
  });

  it('maps authentication, access, proxy and rate-limit failures', () => {
    expect(getApiStatusPresentation('retrying', null, null, 401, false, 0).state).toBe(
      'invalid-token',
    );
    expect(getApiStatusPresentation('retrying', null, null, 403, false, 0).state).toBe('denied');
    expect(getApiStatusPresentation('retrying', null, null, 404, true, 0).state).toBe(
      'proxy-unavailable',
    );
    expect(getApiStatusPresentation('retrying', null, null, 429, false, 17).text).toContain('17 с');
  });
});
