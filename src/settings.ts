export function getToken(proxyUrl = ''): string | null {
  if (proxyUrl.trim().length > 0) {
    return null;
  }
  try {
    const token = localStorage.getItem('alertsApiToken');
    return token && token.trim().length > 0 ? token.trim() : null;
  } catch {
    return null;
  }
}

export type TokenHashImportResult = 'none' | 'saved' | 'failed';

export function importTokenFromHash(
  hash: string,
  saveToken: (token: string) => boolean,
  clearHash: () => void,
): TokenHashImportResult {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('t');
  if (!token || token.trim().length === 0) {
    return 'none';
  }

  const saved = saveToken(token.trim());
  clearHash();
  return saved ? 'saved' : 'failed';
}

export function saveAlertsToken(token: string): boolean {
  try {
    if (token.trim().length === 0) {
      localStorage.removeItem('alertsApiToken');
      return true;
    }
    localStorage.setItem('alertsApiToken', token.trim());
    return true;
  } catch {
    return false;
  }
}

export function getSelectedLocation(): string | null {
  try {
    const uid = localStorage.getItem('locationUid');
    if (uid && uid.trim().length > 0) {
      return uid.trim();
    }
  } catch {
    return null;
  }
  return null;
}

export function saveSelectedLocation(uid: string): boolean {
  const selected = uid.trim();
  try {
    const previous = localStorage.getItem('locationUid');
    if (previous === selected || (!previous && selected.length === 0)) {
      return true;
    }
    if (selected.length === 0) {
      localStorage.removeItem('locationUid');
    } else {
      localStorage.setItem('locationUid', selected);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('locationchanged'));
    }
    return true;
  } catch {
    return false;
  }
}

export function getMusicSyncStart(defaultValue: string): string {
  try {
    const value = localStorage.getItem('musicSyncStart');
    if (value && /^([01]?\d|2[0-3]):[0-5]\d$/.test(value)) {
      return value;
    }
  } catch {
    return defaultValue;
  }
  return defaultValue;
}

export function saveMusicSyncStart(value: string): boolean {
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(value)) {
    return false;
  }
  try {
    localStorage.setItem('musicSyncStart', value);
    return true;
  } catch {
    return false;
  }
}

export function removeAlertsToken(): boolean {
  try {
    localStorage.removeItem('alertsApiToken');
    return true;
  } catch {
    return false;
  }
}
