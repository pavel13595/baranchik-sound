import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRecentEvents, logError, logEvent, redactSensitiveText } from './log';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runtime event log', () => {
  it('keeps only the latest 20 entries in memory', () => {
    for (let index = 0; index < 24; index += 1) {
      logEvent('info', `bounded-${index}`);
    }

    const events = getRecentEvents().filter((event) => event.message.indexOf('bounded-') === 0);
    expect(events).toHaveLength(20);
    expect(events[0].message).toBe('bounded-4');
    expect(events[19].message).toBe('bounded-23');
  });

  it('masks API tokens in displayed URLs and persisted/in-memory log messages', () => {
    logEvent('error', 'Request failed: https://example.test/api?token=secret-value');
    const latest = getRecentEvents()[getRecentEvents().length - 1];

    expect(latest.message).not.toContain('secret-value');
    expect(latest.message).toContain('token=***');
    expect(redactSensitiveText('/alerts?region=one&token=secret-value&mode=full')).toBe(
      '/alerts?region=one&token=***&mode=full',
    );
    expect(redactSensitiveText('Body preview: token=secret-value')).toBe('Body preview: token=***');
    expect(redactSensitiveText('{"token":"secret-value"}')).toBe('{"token":"***"}');

    logError('Request failed', new Error('GET https://example.test/api?token=another-secret'));
    const latestError = getRecentEvents()[getRecentEvents().length - 1];
    expect(latestError.message).toContain('token=***');
    expect(latestError.message).not.toContain('another-secret');
  });

  it('caps the persisted duplicate history at 50 entries', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) || null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });

    for (let index = 0; index < 55; index += 1) {
      logEvent('info', `persist-${index}`);
    }

    const saved = JSON.parse(storage.get('diagnosticEvents') || '[]') as Array<{ message: string }>;
    expect(saved).toHaveLength(50);
    expect(saved[0].message).toBe('persist-5');
    expect(saved[49].message).toBe('persist-54');
  });
});
