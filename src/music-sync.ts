export type MusicSyncState = 'ready' | 'before-start' | 'no-duration';

export interface MusicSyncTarget {
  state: MusicSyncState;
  offsetSec: number;
  label: string;
}

function twoDigits(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function formatDurationLabel(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}:${twoDigits(minutes)}:${twoDigits(seconds)}`;
  }
  return `${minutes}:${twoDigits(seconds)}`;
}

function parseSyncStart(value: string): { hour: number; minute: number } | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) {
    return null;
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function targetOffset(
  now: Date,
  syncStart: string,
  rolloverHour: number,
  durationSec: number | null,
): MusicSyncTarget {
  const start = parseSyncStart(syncStart);
  if (!start) {
    return { state: 'no-duration', offsetSec: 0, label: '0:00' };
  }

  const startMoment = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    start.hour,
    start.minute,
    0,
    0,
  );

  let candidate = startMoment;
  if (now < startMoment && now.getHours() < rolloverHour) {
    candidate = new Date(
      startMoment.getFullYear(),
      startMoment.getMonth(),
      startMoment.getDate() - 1,
      start.hour,
      start.minute,
      0,
      0,
    );
  }

  if (now < startMoment && now.getHours() >= rolloverHour) {
    return {
      state: 'before-start',
      offsetSec: 0,
      label: `${syncStart} ще не почався`,
    };
  }

  if (durationSec === null || !Number.isFinite(durationSec) || durationSec <= 0) {
    const offsetSec = Math.max(0, (now.getTime() - candidate.getTime()) / 1000);
    return {
      state: 'no-duration',
      offsetSec,
      label: formatDurationLabel(offsetSec),
    };
  }

  const elapsedSec = Math.max(0, (now.getTime() - candidate.getTime()) / 1000);
  const offsetSec = elapsedSec > durationSec ? elapsedSec % durationSec : elapsedSec;
  return {
    state: 'ready',
    offsetSec,
    label: formatDurationLabel(offsetSec),
  };
}

export function formatClock(value: Date): string {
  return `${twoDigits(value.getHours())}:${twoDigits(value.getMinutes())}`;
}
