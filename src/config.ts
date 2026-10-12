import type { VenueConfig } from './types';

export const MUSIC_MEMORY_COPY_LIMIT = 150 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isActiveHours(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  return (
    isRecord(value) &&
    typeof value.start === 'string' &&
    typeof value.end === 'string' &&
    /^\d{2}:\d{2}$/.test(value.start) &&
    /^\d{2}:\d{2}$/.test(value.end)
  );
}

function isRelativeAssetPath(value: string): boolean {
  return value === '' || !/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(value);
}

export type VenueConfigWarning = (message: string) => void;

export function validateVenueConfig(input: unknown, onWarning?: VenueConfigWarning): VenueConfig {
  if (
    !isRecord(input) ||
    !isRecord(input.alerts) ||
    !isRecord(input.signals) ||
    !isRecord(input.gamarjos) ||
    (input.music !== undefined && !isRecord(input.music)) ||
    (input.theme !== undefined && !isRecord(input.theme))
  ) {
    throw new Error('venue.json має некоректну структуру');
  }

  const alerts = input.alerts;
  const signals = input.signals;
  const gamarjos = input.gamarjos;
  const music = input.music || { syncStart: '11:30', dayRolloverHour: 5 };
  const theme = input.theme || { heroImage: '' };

  if (
    typeof input.venueName !== 'string' ||
    (input.tagline !== undefined && typeof input.tagline !== 'string') ||
    typeof input.logo !== 'string' ||
    (input.pollIntervalSec !== undefined &&
      (typeof input.pollIntervalSec !== 'number' || !Number.isFinite(input.pollIntervalSec))) ||
    typeof input.staleAfterSec !== 'number' ||
    !Number.isFinite(input.staleAfterSec) ||
    input.staleAfterSec < 0 ||
    (alerts.auth !== undefined && alerts.auth !== 'query' && alerts.auth !== 'bearer') ||
    typeof alerts.clearConfirmPolls !== 'number' ||
    !Number.isInteger(alerts.clearConfirmPolls) ||
    alerts.clearConfirmPolls < 1 ||
    typeof signals.yellow !== 'string' ||
    typeof signals.red !== 'string' ||
    typeof signals.clear !== 'string' ||
    !isActiveHours(signals.activeHours) ||
    typeof music.syncStart !== 'string' ||
    !/^([01]?\d|2[0-3]):[0-5]\d$/.test(music.syncStart) ||
    typeof music.dayRolloverHour !== 'number' ||
    !Number.isInteger(music.dayRolloverHour) ||
    music.dayRolloverHour < 0 ||
    music.dayRolloverHour > 23 ||
    typeof gamarjos.dir !== 'string' ||
    (theme.heroImage !== undefined &&
      (typeof theme.heroImage !== 'string' || !isRelativeAssetPath(theme.heroImage))) ||
    typeof input.proxyUrl !== 'string'
  ) {
    throw new Error('venue.json містить некоректні значення');
  }

  const config = {
    ...input,
    pollIntervalSec:
      typeof input.pollIntervalSec === 'number' ? Math.max(10, input.pollIntervalSec) : 12,
    alerts: { ...alerts, auth: alerts.auth || 'query' },
    music: { ...music },
    tagline: typeof input.tagline === 'string' ? input.tagline : '',
    theme: { heroImage: typeof theme.heroImage === 'string' ? theme.heroImage : '' },
  } as Record<string, unknown>;
  if (isRecord(config.alerts)) {
    delete config.alerts.locationUid;
  }
  if (typeof input.pollIntervalSec === 'number' && input.pollIntervalSec < 10 && onWarning) {
    onWarning('pollIntervalSec нижче 10; використовується мінімум 10 секунд');
  }
  return config as unknown as VenueConfig;
}

export async function loadVenueConfig(
  fetcher: typeof fetch = fetch,
  onWarning?: VenueConfigWarning,
): Promise<VenueConfig> {
  try {
    const response = await fetcher('./venue.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const input: unknown = await response.json();
    return validateVenueConfig(input, onWarning);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Не вдалося завантажити конфігурацію закладу: ${error.message}`);
    }
    throw new Error('Не вдалося завантажити конфігурацію закладу');
  }
}
