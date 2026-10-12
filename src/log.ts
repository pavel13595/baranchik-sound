export interface RuntimeLogEntry {
  time: string;
  level: 'info' | 'warning' | 'error';
  message: string;
}

const runtimeEvents: RuntimeLogEntry[] = [];
const RING_LIMIT = 20;
const STORAGE_LIMIT = 50;
const STORAGE_KEY = 'diagnosticEvents';

export function redactSensitiveText(value: string): string {
  return value
    .replace(/([?&]token=)[^&\s"'<>]+/gi, '$1***')
    .replace(/(\btoken["']?\s*[:=]\s*["']?)[^&\s"'<>},]+/gi, '$1***');
}

function isRuntimeLogEntry(value: unknown): value is RuntimeLogEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Partial<RuntimeLogEntry>;
  return (
    typeof entry.time === 'string' &&
    (entry.level === 'info' || entry.level === 'warning' || entry.level === 'error') &&
    typeof entry.message === 'string'
  );
}

export function logEvent(level: RuntimeLogEntry['level'], message: string): void {
  const entry = {
    time: new Date().toISOString(),
    level,
    message: redactSensitiveText(message),
  };
  runtimeEvents.push(entry);
  if (runtimeEvents.length > RING_LIMIT) {
    runtimeEvents.shift();
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    const entries: RuntimeLogEntry[] = Array.isArray(parsed)
      ? parsed
          .filter(isRuntimeLogEntry)
          .map((item) => ({ ...item, message: redactSensitiveText(item.message) }))
      : [];
    entries.push(entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-STORAGE_LIMIT)));
  } catch {
    // Diagnostics remain available in memory when localStorage is unavailable.
  }
}

export function getRecentEvents(): RuntimeLogEntry[] {
  return runtimeEvents.slice();
}

export function logInfo(message: string): void {
  logEvent('info', message);
  try {
    console.info(redactSensitiveText(message));
  } catch {
    // Logging must not interrupt application work.
  }
}

export function logWarning(message: string): void {
  logEvent('warning', message);
  try {
    console.warn(redactSensitiveText(message));
  } catch {
    // Logging must not interrupt application work.
  }
}

export function logError(message: string, error?: unknown): void {
  const safeError =
    error instanceof Error ? error.message : error === undefined ? '' : String(error);
  const safeMessage = redactSensitiveText(
    safeError.length > 0 ? `${message}: ${safeError}` : message,
  );
  logEvent('error', safeMessage);
  try {
    console.error(safeMessage);
  } catch {
    // Logging must not interrupt application work.
  }
}
