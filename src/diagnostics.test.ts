import { describe, expect, it } from 'vitest';
import { clockSkewSeconds, isStale, parseApiTimestamp } from './diagnostics';

describe('parseApiTimestamp', () => {
  it('parses the API slash format with a numeric UTC offset', () => {
    expect(parseApiTimestamp('2025/01/02 03:04:05 +0000')).toEqual(
      new Date(Date.UTC(2025, 0, 2, 3, 4, 5)),
    );
  });

  it('parses ISO 8601 UTC timestamps', () => {
    expect(parseApiTimestamp('2025-01-02T03:04:05Z')).toEqual(
      new Date(Date.UTC(2025, 0, 2, 3, 4, 5)),
    );
  });

  it('parses ISO 8601 with a positive timezone offset', () => {
    expect(parseApiTimestamp('2025-01-02T03:04:05+02:30')).toEqual(
      new Date(Date.UTC(2025, 0, 2, 0, 34, 5)),
    );
  });

  it('parses ISO 8601 with a negative compact offset and milliseconds', () => {
    expect(parseApiTimestamp('2025-01-02T03:04:05.125-0330')).toEqual(
      new Date(Date.UTC(2025, 0, 2, 6, 34, 5, 125)),
    );
  });

  it.each([
    'not a date',
    '2025-02-30T12:00:00Z',
    '2025-01-02T25:00:00Z',
    '2025-01-02T03:04:05+25:00',
    '2025/01/02 03:04:05',
  ])('returns null for invalid input %s', (value) => {
    expect(parseApiTimestamp(value)).toBeNull();
  });
});

describe('isStale', () => {
  const now = new Date(Date.UTC(2025, 0, 2, 3, 5, 5));

  it('returns true only when the age exceeds the threshold', () => {
    expect(isStale(new Date(now.getTime() - 61_000), now, 60)).toBe(true);
    expect(isStale(new Date(now.getTime() - 60_000), now, 60)).toBe(false);
  });

  it('does not consider unparseable or future timestamps stale', () => {
    expect(isStale(null, now, 60)).toBe(false);
    expect(isStale(new Date(now.getTime() + 1000), now, 60)).toBe(false);
  });
});

describe('clockSkewSeconds', () => {
  it('returns server time minus local time in seconds', () => {
    const localNow = new Date(Date.UTC(2025, 0, 2, 3, 3, 5));
    expect(clockSkewSeconds('Thu, 02 Jan 2025 03:04:05 GMT', localNow)).toBe(60);
  });

  it('returns null for an invalid HTTP Date header', () => {
    expect(clockSkewSeconds('invalid', new Date(Date.UTC(2025, 0, 2)))).toBeNull();
  });
});
