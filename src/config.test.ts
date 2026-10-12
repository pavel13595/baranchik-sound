import { describe, expect, it, vi } from 'vitest';
import { loadVenueConfig, validateVenueConfig } from './config';
import type { VenueConfig } from './types';

function venue(): VenueConfig {
  return {
    venueName: 'Venue',
    tagline: 'Restaurant',
    logo: '',
    pollIntervalSec: 10,
    staleAfterSec: 600,
    alerts: {
      clearConfirmPolls: 2,
    },
    music: { syncStart: '11:30', dayRolloverHour: 5 },
    theme: { heroImage: 'images/hero.jpeg' },
    signals: { yellow: 'y.mp3', red: 'r.mp3', clear: 'c.mp3', activeHours: null },
    gamarjos: { dir: 'gamarjos' },
    proxyUrl: '',
  };
}

describe('validateVenueConfig', () => {
  it('accepts a valid config', () => {
    expect(validateVenueConfig(venue())).toMatchObject({
      venueName: 'Venue',
      tagline: 'Restaurant',
      alerts: { auth: 'query' },
      theme: { heroImage: 'images/hero.jpeg' },
    });
  });

  it('defaults polling to 12 seconds and clamps values below 10 with a warning', () => {
    const warning = vi.fn();
    const withoutInterval = { ...venue() } as Record<string, unknown>;
    delete withoutInterval.pollIntervalSec;
    expect(validateVenueConfig(withoutInterval).pollIntervalSec).toBe(12);
    expect(validateVenueConfig({ ...venue(), pollIntervalSec: 7 }, warning).pollIntervalSec).toBe(
      10,
    );
    expect(warning).toHaveBeenCalledWith(
      'pollIntervalSec нижче 10; використовується мінімум 10 секунд',
    );
  });

  it('accepts bearer mode and rejects unknown authentication modes', () => {
    expect(
      validateVenueConfig({
        ...venue(),
        alerts: { ...venue().alerts, auth: 'bearer' },
      }).alerts.auth,
    ).toBe('bearer');
    expect(() =>
      validateVenueConfig({
        ...venue(),
        alerts: { ...venue().alerts, auth: 'basic' },
      }),
    ).toThrow(/некоректні значення/);
  });

  it('clamps a zero polling interval and rejects malformed active hours', () => {
    expect(validateVenueConfig({ ...venue(), pollIntervalSec: 0 }).pollIntervalSec).toBe(10);
    expect(() =>
      validateVenueConfig({
        ...venue(),
        signals: { ...venue().signals, activeHours: { start: '8:00', end: '18:00' } },
      }),
    ).toThrow(/некоректні значення/);
  });

  it('defaults music synchronization settings and strips legacy location defaults', () => {
    const input: Record<string, unknown> = {
      ...venue(),
      alerts: { ...venue().alerts, locationUid: '1088' },
    };
    delete input.music;
    const result = validateVenueConfig(input);
    expect(result.music).toEqual({ syncStart: '11:30', dayRolloverHour: 5 });
    expect(result.alerts).not.toHaveProperty('locationUid');
  });

  it('rejects invalid music synchronization values', () => {
    expect(() =>
      validateVenueConfig({ ...venue(), music: { syncStart: '25:00', dayRolloverHour: 5 } }),
    ).toThrow(/некоректні значення/);
  });

  it('defaults optional branding fields and rejects invalid values', () => {
    const input = { ...venue() } as Record<string, unknown>;
    delete input.tagline;
    delete input.theme;
    expect(validateVenueConfig(input)).toMatchObject({ tagline: '', theme: { heroImage: '' } });
    expect(() => validateVenueConfig({ ...venue(), tagline: 12 })).toThrow(/некоректні значення/);
    expect(() => validateVenueConfig({ ...venue(), theme: { heroImage: 12 } })).toThrow(
      /некоректні значення/,
    );
    expect(() =>
      validateVenueConfig({ ...venue(), theme: { heroImage: 'https://example.test/hero.jpeg' } }),
    ).toThrow(/некоректні значення/);
  });
});

describe('loadVenueConfig', () => {
  it('fetches same-origin config without cache', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => venue() }) as Response);
    await loadVenueConfig(fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith('./venue.json', { cache: 'no-store' });
  });

  it('reports an HTTP failure in a readable error', async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 503 }) as Response);
    await expect(loadVenueConfig(fetcher as typeof fetch)).rejects.toThrow('HTTP 503');
  });
});
