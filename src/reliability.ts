import { logError } from './log';

export interface WakeLockSentinelLike {
  released: boolean;
  addEventListener(type: 'release', listener: EventListener): void;
  removeEventListener(type: 'release', listener: EventListener): void;
  release(): Promise<void>;
}

export interface WakeLockManagerLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

export interface WakeLockNavigatorLike {
  wakeLock?: WakeLockManagerLike;
}

export interface WakeLockControllerOptions {
  navigator: WakeLockNavigatorLike;
  document: Document;
  onFallback: () => void;
  onEvent?: (message: string) => void;
}

export interface WakeLockController {
  start(): void;
  destroy(): void;
  isSupported(): boolean;
}

export function createWakeLockController(options: WakeLockControllerOptions): WakeLockController {
  let active = false;
  let requestPending = false;
  let fallbackShown = false;
  let sentinel: WakeLockSentinelLike | null = null;
  let releaseHandler: EventListener | null = null;
  let visibilityHandler: EventListener | null = null;

  function writeEvent(message: string): void {
    if (options.onEvent) {
      options.onEvent(message);
    }
  }

  function showFallback(): void {
    if (fallbackShown) {
      return;
    }
    fallbackShown = true;
    options.onFallback();
  }

  async function acquire(): Promise<void> {
    const manager = options.navigator.wakeLock;
    if (!active || requestPending || sentinel !== null || options.document.hidden) {
      return;
    }
    if (!manager) {
      showFallback();
      return;
    }

    requestPending = true;
    let retryAfterRequest = false;
    try {
      const nextSentinel = await manager.request('screen');
      if (!active || options.document.hidden) {
        await nextSentinel.release();
        retryAfterRequest = active && !options.document.hidden;
        return;
      }
      sentinel = nextSentinel;
      releaseHandler = () => {
        if (sentinel === nextSentinel) {
          nextSentinel.removeEventListener('release', releaseHandler as EventListener);
          sentinel = null;
          releaseHandler = null;
          writeEvent('Wake Lock released');
          if (active && !options.document.hidden) {
            void acquire();
          }
        }
      };
      nextSentinel.addEventListener('release', releaseHandler);
      writeEvent('Wake Lock active');
    } catch {
      showFallback();
      writeEvent('Wake Lock request failed');
    } finally {
      requestPending = false;
      if (retryAfterRequest) {
        void acquire();
      }
    }
  }

  function onVisibilityChange(): void {
    if (!active) {
      return;
    }
    if (options.document.hidden) {
      if (sentinel) {
        const oldSentinel = sentinel;
        if (releaseHandler) {
          oldSentinel.removeEventListener('release', releaseHandler);
        }
        sentinel = null;
        releaseHandler = null;
        void oldSentinel.release().catch(() => undefined);
      }
      return;
    }
    void acquire();
  }

  function start(): void {
    if (active) {
      return;
    }
    active = true;
    visibilityHandler = onVisibilityChange;
    options.document.addEventListener('visibilitychange', visibilityHandler);
    if (!options.navigator.wakeLock) {
      showFallback();
      return;
    }
    void acquire();
  }

  function destroy(): void {
    active = false;
    if (visibilityHandler) {
      options.document.removeEventListener('visibilitychange', visibilityHandler);
      visibilityHandler = null;
    }
    if (sentinel) {
      if (releaseHandler) {
        sentinel.removeEventListener('release', releaseHandler);
      }
      const oldSentinel = sentinel;
      sentinel = null;
      releaseHandler = null;
      void oldSentinel.release().catch(() => undefined);
    }
  }

  return {
    start,
    destroy,
    isSupported: () => Boolean(options.navigator.wakeLock),
  };
}

const installedWindows = new WeakSet<Window>();

export function installGlobalErrorHandlers(target: Window): void {
  if (installedWindows.has(target)) {
    return;
  }
  installedWindows.add(target);

  target.onerror = (message, source, line, column) => {
    const details = [String(message), source || '', line || 0, column || 0].join(' ');
    logError('Global error', details);
    return false;
  };

  target.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    logError('Unhandled rejection', message);
  });
}
