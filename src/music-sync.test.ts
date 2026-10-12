import { describe, expect, it } from 'vitest';
import { formatDurationLabel, targetOffset } from './music-sync';

describe('music-sync', () => {
  it('formats duration labels in H:MM:SS and M:SS', () => {
    expect(formatDurationLabel(90 * 60)).toBe('1:30:00');
    expect(formatDurationLabel(11 * 60 + 42.28)).toBe('11:42');
  });

  it('matches 13:00 after 11:30 start', () => {
    const result = targetOffset(new Date('2026-10-11T13:00:00'), '11:30', 5, 11 * 60 * 60);
    expect(result.state).toBe('ready');
    expect(result.offsetSec).toBe(90 * 60);
    expect(result.label).toBe('1:30:00');
  });

  it('returns zero at exact sync time', () => {
    const result = targetOffset(new Date('2026-10-11T11:30:00'), '11:30', 5, 11 * 60 * 60);
    expect(result.state).toBe('ready');
    expect(result.offsetSec).toBe(0);
  });

  it('reports before-start when the day has not reached the sync time', () => {
    const result = targetOffset(new Date('2026-10-11T09:00:00'), '11:30', 5, 11 * 60 * 60);
    expect(result.state).toBe('before-start');
    expect(result.label).toContain('11:30');
  });

  it('uses the previous day when the current time is before the sync time but still in the early day', () => {
    const result = targetOffset(new Date('2026-10-11T00:30:00'), '11:30', 5, 11 * 60 * 60);
    expect(result.state).toBe('ready');
    expect(result.offsetSec).toBe(2 * 60 * 60);
  });

  it('wraps the offset when elapsed exceeds the duration', () => {
    const result = targetOffset(new Date('2026-10-11T13:00:00'), '11:30', 5, 60);
    expect(result.state).toBe('ready');
    expect(result.offsetSec).toBe(0);
  });

  it('marks the sync target as no-duration without metadata', () => {
    const result = targetOffset(new Date('2026-10-11T13:00:00'), '11:30', 5, null);
    expect(result.state).toBe('no-duration');
    expect(result.offsetSec).toBe(90 * 60);
  });
});
