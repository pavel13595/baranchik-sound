import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWakeLockController,
  installGlobalErrorHandlers,
  type WakeLockSentinelLike,
} from './reliability';
import { getRecentEvents } from './log';

afterEach(() => {
  vi.restoreAllMocks();
});

class MockWakeLockSentinel extends EventTarget implements WakeLockSentinelLike {
  released = false;
  readonly release = vi.fn(async (): Promise<void> => {
    this.released = true;
    this.dispatchEvent(new Event('release'));
  });
}

class MockDocument extends EventTarget {
  hidden = false;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createWakeLockController', () => {
  it('requests one screen lock on start and reacquires after visibility changes', async () => {
    const document = new MockDocument();
    const first = new MockWakeLockSentinel();
    const second = new MockWakeLockSentinel();
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const controller = createWakeLockController({
      navigator: { wakeLock: { request } },
      document: document as unknown as Document,
      onFallback: vi.fn(),
    });

    controller.start();
    await flushPromises();
    expect(request).toHaveBeenCalledOnce();

    first.dispatchEvent(new Event('release'));
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(2);

    controller.destroy();
    expect(second.release).toHaveBeenCalledOnce();
  });

  it('shows fallback once when Wake Lock is not supported', () => {
    const fallback = vi.fn();
    const controller = createWakeLockController({
      navigator: {},
      document: new MockDocument() as unknown as Document,
      onFallback: fallback,
    });

    controller.start();
    controller.start();
    expect(controller.isSupported()).toBe(false);
    expect(fallback).toHaveBeenCalledOnce();
    controller.destroy();
  });

  it('releases while hidden and requests a fresh lock when visible again', async () => {
    const document = new MockDocument();
    const first = new MockWakeLockSentinel();
    const second = new MockWakeLockSentinel();
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const controller = createWakeLockController({
      navigator: { wakeLock: { request } },
      document: document as unknown as Document,
      onFallback: vi.fn(),
    });
    controller.start();
    await flushPromises();

    document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(first.release).toHaveBeenCalledOnce();

    document.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(2);
    expect(second.released).toBe(false);
    controller.destroy();
  });

  it('releases a late Wake Lock grant received after the page became hidden', async () => {
    const document = new MockDocument();
    const first = new MockWakeLockSentinel();
    const second = new MockWakeLockSentinel();
    let resolveFirst: (value: WakeLockSentinelLike) => void = () => undefined;
    const pendingFirst = new Promise<WakeLockSentinelLike>((resolve) => {
      resolveFirst = resolve;
    });
    const request = vi.fn().mockReturnValueOnce(pendingFirst).mockResolvedValueOnce(second);
    const controller = createWakeLockController({
      navigator: { wakeLock: { request } },
      document: document as unknown as Document,
      onFallback: vi.fn(),
    });

    controller.start();
    await flushPromises();
    document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    resolveFirst(first);
    await flushPromises();
    expect(first.release).toHaveBeenCalledOnce();

    document.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(2);
    controller.destroy();
  });

  it('does not accumulate visibility handlers across start/destroy cycles', async () => {
    const document = new MockDocument();
    const request = vi.fn().mockResolvedValue(new MockWakeLockSentinel());
    const controller = createWakeLockController({
      navigator: { wakeLock: { request } },
      document: document as unknown as Document,
      onFallback: vi.fn(),
    });

    controller.start();
    await flushPromises();
    const requestCount = request.mock.calls.length;
    controller.destroy();
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(requestCount);
  });
});

describe('installGlobalErrorHandlers', () => {
  it('installs idempotent unhandled rejection diagnostics and does not block the event', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const target = new EventTarget() as Window;
    installGlobalErrorHandlers(target);
    installGlobalErrorHandlers(target);
    const event = new Event('unhandledrejection');
    Object.defineProperty(event, 'reason', { value: new Error('runtime failure') });

    const allowed = target.dispatchEvent(event);
    const matching = getRecentEvents().filter(
      (entry) => entry.message.indexOf('Unhandled rejection') === 0,
    );

    expect(allowed).toBe(true);
    expect(matching).toHaveLength(1);
    expect(matching[0].message).toContain('runtime failure');
  });

  it('logs window.onerror and returns false so browser error handling continues', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const target = new EventTarget() as Window;
    installGlobalErrorHandlers(target);
    const handler = target.onerror;

    expect(handler).not.toBeNull();
    const result = handler ? handler('script failure', 'app.js', 4, 2, new Error('failure')) : true;

    expect(result).toBe(false);
    expect(getRecentEvents().some((entry) => entry.message.indexOf('Global error:') === 0)).toBe(
      true,
    );
  });
});
