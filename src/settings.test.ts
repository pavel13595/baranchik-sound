import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSelectedLocation,
  getMusicSyncStart,
  getToken,
  importTokenFromHash,
  removeAlertsToken,
  saveAlertsToken,
  saveSelectedLocation,
  saveMusicSyncStart,
} from './settings';
import { getRecentEvents } from './log';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('alerts token settings', () => {
  it('trims and saves a token without logging or exposing it elsewhere', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) || null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });

    expect(saveAlertsToken(' secret-token ')).toBe(true);
    expect(getToken()).toBe('secret-token');
  });

  it('reads only a non-empty localStorage token', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => ' local-secret ',
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    expect(getToken()).toBe('local-secret');
  });

  it('returns no token for empty localStorage, with or without a proxy', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => '  ',
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    expect(getToken()).toBeNull();
    expect(getToken('https://worker.example/alerts')).toBeNull();
  });

  it('does not expose a local token when proxy mode is configured', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => 'local-secret',
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    expect(getToken(' https://worker.example/alerts ')).toBeNull();
  });

  it('returns no token when localStorage access throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });

    expect(getToken()).toBeNull();
    expect(saveAlertsToken('token')).toBe(false);
    expect(removeAlertsToken()).toBe(false);
  });

  it('returns no token when localStorage is empty', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });

    expect(getToken()).toBeNull();
    expect(saveAlertsToken('token')).toBe(false);
    expect(removeAlertsToken()).toBe(false);
  });

  it('saves an imported hash token and requests hash cleanup', () => {
    const save = vi.fn(() => true);
    const clearHash = vi.fn();
    const eventsBefore = getRecentEvents().length;

    expect(importTokenFromHash('#t=hash-secret', save, clearHash)).toBe('saved');
    expect(save).toHaveBeenCalledWith('hash-secret');
    expect(clearHash).toHaveBeenCalledOnce();
    expect(getRecentEvents()).toHaveLength(eventsBefore);
  });

  it('does nothing when the hash contains no token', () => {
    const save = vi.fn(() => true);
    const clearHash = vi.fn();

    expect(importTokenFromHash('#sim=1', save, clearHash)).toBe('none');
    expect(save).not.toHaveBeenCalled();
    expect(clearHash).not.toHaveBeenCalled();
  });

  it('clears the hash even if localStorage refuses the imported token', () => {
    const clearHash = vi.fn();

    expect(importTokenFromHash('#t=hash-secret', () => false, clearHash)).toBe('failed');
    expect(clearHash).toHaveBeenCalledOnce();
  });

  it('reads and persists the selected location without a configured default', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) || null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });

    const eventTarget = new EventTarget();
    const changed = vi.fn();
    eventTarget.addEventListener('locationchanged', changed);
    vi.stubGlobal('window', eventTarget);

    expect(getSelectedLocation()).toBeNull();
    expect(saveSelectedLocation(' 107 ')).toBe(true);
    expect(getSelectedLocation()).toBe('107');
    expect(changed).toHaveBeenCalledOnce();
    expect(saveSelectedLocation('107')).toBe(true);
    expect(changed).toHaveBeenCalledOnce();
    expect(getSelectedLocation()).toBe('107');
  });

  it('uses the configured sync start until a valid local override is saved', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) || null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });

    expect(getMusicSyncStart('11:30')).toBe('11:30');
    expect(saveMusicSyncStart('12:15')).toBe(true);
    expect(getMusicSyncStart('11:30')).toBe('12:15');
    expect(saveMusicSyncStart('25:00')).toBe(false);
  });
});
