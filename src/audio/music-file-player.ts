import { getAudioMime, getFileExtension } from './files';

export type MusicFileStrategy = 'A' | 'B' | 'C' | 'D';

export interface MusicFileAttempt {
  strategy: MusicFileStrategy;
  size: number;
  fileType: string;
  mime: string;
  elapsedMs: number;
  errorCode: number | null;
  errorName: string;
  errorMessage: string;
  errorDescription: string;
  canPlayType: string;
  readyState: number;
  networkState: number;
  preload: string;
  playResult: string;
}

export interface MusicFilePlaybackResult {
  success: boolean;
  cancelled: boolean;
  src: string;
  strategy: MusicFileStrategy | null;
  error: unknown | null;
  message: string;
}

export interface MusicFileProbeResult {
  success: boolean;
  message: string;
}

export interface MusicFilePlayerOptions {
  memoryCopyLimit: number;
  onAttempt?: (attempt: MusicFileAttempt) => void;
  onProgress?: (percent: number) => void;
  onProbe?: (result: MusicFileProbeResult) => void;
  onLegacyFallbackReady?: () => void;
}

export interface MusicFilePlayer {
  selectFile(file: File | null): void;
  play(
    audio: HTMLAudioElement,
    offsetSec: number,
    isCurrent: () => boolean,
  ): Promise<MusicFilePlaybackResult>;
  check(audio: HTMLAudioElement, isCurrent: () => boolean): Promise<MusicFilePlaybackResult>;
  probe(file?: File | null): Promise<MusicFileProbeResult>;
  destroy(audio: HTMLAudioElement): void;
}

interface ReadOptions {
  timeoutMs: number;
  onProgress?: (percent: number) => void;
}

interface ReadResult {
  buffer: ArrayBuffer | null;
  error: Error | null;
}

interface DataUrlReadResult {
  dataUrl: string | null;
  error: Error | null;
}

interface MusicCandidate {
  url: string;
  mime: string;
  error: Error | null;
  readFailure?: boolean;
}

const PLAYBACK_TIMEOUT_MS = 20_000;
const PROBE_TIMEOUT_MS = 15_000;
const FULL_COPY_TIMEOUT_MS = 180_000;
const DATA_URL_TIMEOUT_MS = 90_000;
export const IOS12_DATA_URL_LIMIT = 32 * 1024 * 1024;
const PROBE_BYTES = 64 * 1024;

function isIOS12(): boolean {
  return (
    typeof navigator !== 'undefined' && /iP(?:hone|ad|od).*OS 12_[0-9_]+/i.test(navigator.userAgent)
  );
}

function errorDescription(code: number | null): string {
  if (code === 1) return 'відтворення перервано';
  if (code === 2) return 'помилка читання файлу';
  if (code === 3) return 'помилка декодування';
  if (code === 4) return 'формат або джерело не підтримується';
  return 'невідома помилка медіа';
}

function errorDetails(
  error: unknown,
  audio: HTMLAudioElement,
): {
  name: string;
  message: string;
} {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  if (audio.error) {
    return { name: 'MediaError', message: errorDescription(audio.error.code) };
  }
  return { name: 'Error', message: String(error || 'media error') };
}

function readBlob(blob: Blob, options: ReadOptions): Promise<ReadResult> {
  return new Promise((resolve) => {
    let reader: FileReader;
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      reader = new FileReader();
    } catch (error) {
      resolve({ buffer: null, error: error instanceof Error ? error : new Error(String(error)) });
      return;
    }

    const finish = (buffer: ArrayBuffer | null, error: Error | null): void => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
      reader.onprogress = null;
      resolve({ buffer, error });
    };

    reader.onload = () => {
      const result = reader.result;
      finish(result instanceof ArrayBuffer ? result : null, null);
    };
    reader.onerror = () => finish(null, reader.error || new Error('FileReader failed'));
    reader.onabort = () => finish(null, new Error('FileReader aborted'));
    reader.onprogress = (event) => {
      if (options.onProgress && event.lengthComputable && event.total > 0) {
        options.onProgress(
          Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))),
        );
      }
    };
    timeoutId = setTimeout(() => {
      try {
        reader.abort();
      } catch {
        finish(null, new Error('FileReader timed out'));
      }
      finish(null, new Error('FileReader timed out'));
    }, options.timeoutMs);

    try {
      reader.readAsArrayBuffer(blob);
    } catch (error) {
      finish(null, error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function readDataUrl(blob: Blob, options: ReadOptions): Promise<DataUrlReadResult> {
  return new Promise((resolve) => {
    let reader: FileReader;
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      reader = new FileReader();
    } catch (error) {
      resolve({ dataUrl: null, error: error instanceof Error ? error : new Error(String(error)) });
      return;
    }

    const finish = (dataUrl: string | null, error: Error | null): void => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
      reader.onprogress = null;
      resolve({ dataUrl, error });
    };

    reader.onload = () => {
      const result = reader.result;
      finish(typeof result === 'string' ? result : null, null);
    };
    reader.onerror = () => finish(null, reader.error || new Error('FileReader failed'));
    reader.onabort = () => finish(null, new Error('FileReader aborted'));
    reader.onprogress = (event) => {
      if (options.onProgress && event.lengthComputable && event.total > 0) {
        options.onProgress(
          Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))),
        );
      }
    };
    timeoutId = setTimeout(() => {
      try {
        reader.abort();
      } catch {
        finish(null, new Error('FileReader timed out'));
      }
      finish(null, new Error('FileReader timed out'));
    }, options.timeoutMs);

    try {
      reader.readAsDataURL(blob);
    } catch (error) {
      finish(null, error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function mimeForSlice(file: File): string {
  const extension = getFileExtension(file.name);
  const inferred = getAudioMime({ name: file.name, type: '' });
  if (inferred.indexOf('audio/') === 0) return inferred;
  if (file.type.indexOf('audio/') === 0) return file.type;
  if (extension === '.m4a' || extension === '.aac') return 'audio/mp4';
  return 'application/octet-stream';
}

function megabytes(size: number): string {
  return (size / (1024 * 1024)).toFixed(1);
}

function finalFailure(
  file: File,
  memoryCopyLimit: number,
  attempts: MusicFileAttempt[],
): MusicFilePlaybackResult {
  const unsupportedSource = attempts.some(
    (attempt) => attempt.errorCode === 4 || attempt.errorName === 'NotSupportedError',
  );
  const exceedsCopyLimit = file.size > memoryCopyLimit;
  const recommendedSize = Math.round(memoryCopyLimit / (1024 * 1024));
  const exceedsIOS12DataUrlLimit = isIOS12() && file.size > IOS12_DATA_URL_LIMIT;
  const message = unsupportedSource
    ? exceedsIOS12DataUrlLimit
      ? `Safari 12 відхилив джерело файлу ${megabytes(file.size)} МБ. Сумісний режим цього iPhone обмежений ${Math.round(IOS12_DATA_URL_LIMIT / (1024 * 1024))} МБ; виберіть менший локальний MP3.`
      : exceedsCopyLimit
        ? `Safari відхилив формат або джерело файлу ${megabytes(file.size)} МБ. Файл більший за ліміт резервного читання ${recommendedSize} МБ; спробуйте локальний MP3 (128 кбіт/с) до ${recommendedSize} МБ.`
        : 'Safari відхилив формат або джерело аудіо (NotSupportedError / media error 4). Перекодуйте файл у звичайний MP3 128 кбіт/с або перевірте, що це аудіофайл, а не потік чи плейлист.'
    : 'Не вдалося відтворити файл. Спробуйте інший локальний файл або перекодуйте його в MP3 128 кбіт/с.';
  const last = attempts.length > 0 ? attempts[attempts.length - 1] : null;
  return {
    success: false,
    cancelled: false,
    src: '',
    strategy: null,
    error: last ? new Error(`${last.errorName}: ${last.errorMessage}`) : new Error(message),
    message,
  };
}

export function createMusicFilePlayer(options: MusicFilePlayerOptions): MusicFilePlayer {
  let selectedFile: File | null = null;
  let selectedFileId = 0;
  let successfulStrategy: MusicFileStrategy | null = null;
  let successfulUrl = '';
  let chainFinished = false;
  let finalResult: MusicFilePlaybackResult | null = null;
  let legacyDataUrl = '';
  let legacyDataUrlPending = false;
  const ownedUrls = new Set<string>();

  function selectFile(file: File | null): void {
    selectedFile = file;
    selectedFileId += 1;
    successfulStrategy = null;
    successfulUrl = '';
    chainFinished = false;
    finalResult = null;
    legacyDataUrl = '';
    legacyDataUrlPending = false;
    if (file && isIOS12() && file.size <= IOS12_DATA_URL_LIMIT) {
      const generation = selectedFileId;
      legacyDataUrlPending = true;
      if (options.onProgress) options.onProgress(0);
      void readDataUrl(file, {
        timeoutMs: DATA_URL_TIMEOUT_MS,
        onProgress: options.onProgress,
      }).then((read) => {
        if (generation !== selectedFileId) return;
        legacyDataUrlPending = false;
        if (!read.error && read.dataUrl) {
          const separator = read.dataUrl.indexOf(',');
          if (separator >= 0) {
            legacyDataUrl = `data:${mimeForSlice(file)};base64,${read.dataUrl.slice(separator + 1)}`;
            if (options.onLegacyFallbackReady) options.onLegacyFallbackReady();
          }
        }
        if (options.onProgress) options.onProgress(-1);
      });
    }
  }

  function revokeReplacedUrls(activeUrl: string): void {
    Array.from(ownedUrls).forEach((url) => {
      if (url === activeUrl) return;
      try {
        URL.revokeObjectURL(url);
      } catch {
        // A URL cleanup failure must not interrupt source fallback.
      }
      ownedUrls.delete(url);
    });
  }

  function makeObjectUrl(value: Blob): string {
    const url = URL.createObjectURL(value);
    ownedUrls.add(url);
    return url;
  }

  function recordAttempt(
    file: File,
    strategy: MusicFileStrategy,
    mime: string,
    startedAt: number,
    audio: HTMLAudioElement,
    error: unknown | null,
    playResult: string,
    metadataElapsedMs: number,
  ): MusicFileAttempt {
    const code = audio.error ? audio.error.code : null;
    const details = error === null ? { name: '', message: '' } : errorDetails(error, audio);
    let canPlayType = 'unavailable';
    try {
      if (typeof audio.canPlayType === 'function') canPlayType = audio.canPlayType(mime);
    } catch {
      canPlayType = 'error';
    }
    const attempt: MusicFileAttempt = {
      strategy,
      size: file.size,
      fileType: file.type || '(порожній)',
      mime,
      elapsedMs: metadataElapsedMs >= 0 ? metadataElapsedMs : Math.max(0, Date.now() - startedAt),
      errorCode: code,
      errorName: details.name,
      errorMessage: details.message,
      errorDescription: errorDescription(code),
      canPlayType,
      readyState: audio.readyState,
      networkState: audio.networkState,
      preload: audio.preload,
      playResult,
    };
    if (options.onAttempt) options.onAttempt(attempt);
    return attempt;
  }

  function createCandidate(
    file: File,
    strategy: MusicFileStrategy,
  ): Promise<MusicCandidate> | MusicCandidate {
    const mime = mimeForSlice(file);
    try {
      if (strategy === 'A') {
        if (!file.type || file.type.indexOf('audio/') !== 0) {
          return { url: '', mime, error: new Error('A requires an audio/* File.type') };
        }
        return { url: makeObjectUrl(file), mime: file.type, error: null };
      }
      if (strategy === 'B') {
        const blob = file.slice(0, file.size, mime);
        return { url: makeObjectUrl(blob), mime, error: null };
      }
      if (strategy === 'D') {
        return legacyDataUrl
          ? { url: legacyDataUrl, mime, error: null }
          : { url: '', mime, error: new Error('iOS 12 data URL is not ready') };
      }
      return readBlob(file, {
        timeoutMs: FULL_COPY_TIMEOUT_MS,
        onProgress: options.onProgress,
      }).then((read) => {
        if (read.error || !read.buffer) {
          return {
            url: '',
            mime,
            error: read.error || new Error('File read failed'),
            readFailure: true,
          };
        }
        let buffer: ArrayBuffer | null = read.buffer;
        try {
          const blob = new Blob([buffer], { type: mime });
          buffer = null;
          read.buffer = null;
          return { url: makeObjectUrl(blob), mime, error: null };
        } catch (error) {
          buffer = null;
          read.buffer = null;
          return {
            url: '',
            mime,
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      });
    } catch (error) {
      return { url: '', mime, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  function runAttempt(
    audio: HTMLAudioElement,
    file: File,
    strategy: MusicFileStrategy,
    url: string,
    mime: string,
    offsetSec: number,
    isCurrent: () => boolean,
    muted: boolean,
    reuseSource: boolean,
  ): Promise<{
    success: boolean;
    cancelled: boolean;
    error: unknown | null;
    attempt: MusicFileAttempt;
  }> {
    const startedAt = Date.now();
    const originalMuted = audio.muted;
    let metadataLoaded = reuseSource && audio.readyState >= 1;
    let metadataElapsedMs = metadataLoaded ? 0 : -1;
    let playResolved = false;
    let playStarted = false;
    let positionVerified = false;
    let pendingLoadError = false;
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let resolveResult: (value: {
      success: boolean;
      cancelled: boolean;
      error: unknown | null;
      attempt: MusicFileAttempt;
    }) => void = () => undefined;

    const resultPromise = new Promise<{
      success: boolean;
      cancelled: boolean;
      error: unknown | null;
      attempt: MusicFileAttempt;
    }>((resolve) => {
      resolveResult = resolve;
    });

    const removeListeners = (): void => {
      audio.removeEventListener('loadedmetadata', onMetadata);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('pause', onPause);
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const finish = (success: boolean, error: unknown | null, playResult: string): void => {
      if (settled) return;
      settled = true;
      removeListeners();
      if (muted) {
        try {
          audio.pause();
          audio.muted = originalMuted;
        } catch {
          audio.muted = originalMuted;
        }
      }
      resolveResult({
        success,
        cancelled: !isCurrent(),
        error,
        attempt: recordAttempt(
          file,
          strategy,
          mime,
          startedAt,
          audio,
          error,
          playResult,
          metadataElapsedMs,
        ),
      });
    };

    const finishIfReady = (): void => {
      if (metadataLoaded && (playResolved || !audio.paused)) {
        if (offsetSec > 0 && !positionVerified) {
          positionVerified = true;
          try {
            if (Math.abs(audio.currentTime - offsetSec) > 2) audio.currentTime = offsetSec;
          } catch {
            // A failed verification seek must not block audio playback.
          }
        }
        finish(true, null, playResolved ? 'OK' : 'playing event');
      }
    };

    const onMetadata: EventListener = () => {
      metadataLoaded = true;
      metadataElapsedMs = Math.max(0, Date.now() - startedAt);
      if (offsetSec > 0) {
        try {
          audio.currentTime = offsetSec;
        } catch {
          // iOS may reject seeking until metadata settles; playback can still proceed.
        }
      }
      finishIfReady();
    };
    const onPlaying: EventListener = () => finishIfReady();
    const onError: EventListener = () => {
      if (!playStarted) {
        pendingLoadError = true;
        return;
      }
      finish(
        false,
        new Error(errorDescription(audio.error ? audio.error.code : null)),
        'error event',
      );
    };
    const onPause: EventListener = () => {
      if (!isCurrent()) finish(false, null, 'cancelled by higher-priority audio');
    };

    if (reuseSource && metadataLoaded && offsetSec > 0) {
      try {
        audio.currentTime = offsetSec;
      } catch {
        // iOS may reject a seek while a cached source is still settling.
      }
    }

    let clearError: unknown = null;
    if (!reuseSource) {
      try {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      } catch (error) {
        clearError = error;
      }
    }

    audio.addEventListener('loadedmetadata', onMetadata);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('error', onError);
    audio.addEventListener('pause', onPause);
    timeoutId = setTimeout(
      () => finish(false, new Error('loadedmetadata timeout (20s)'), 'timeout'),
      PLAYBACK_TIMEOUT_MS,
    );

    if (clearError) {
      finish(
        false,
        clearError,
        `${errorDetails(clearError, audio).name}: ${errorDetails(clearError, audio).message}`,
      );
      return resultPromise;
    }

    try {
      if (muted) audio.muted = true;
      if (!reuseSource) {
        audio.src = url;
        audio.load();
        revokeReplacedUrls(url);
      }
      let playPromise: Promise<void>;
      try {
        playPromise = audio.play();
        playStarted = true;
      } catch (error) {
        playStarted = true;
        finish(false, error, `${error instanceof Error ? error.name : 'Error'}: ${String(error)}`);
        return resultPromise;
      }
      Promise.resolve(playPromise).then(
        () => {
          playResolved = true;
          if (pendingLoadError) {
            finish(
              false,
              new Error(errorDescription(audio.error ? audio.error.code : null)),
              'OK then error event',
            );
          } else {
            finishIfReady();
          }
        },
        (error: unknown) =>
          finish(
            false,
            error,
            `${error instanceof Error ? error.name : 'Error'}: ${String(error)}`,
          ),
      );
      finishIfReady();
    } catch (error) {
      finish(false, error, `${error instanceof Error ? error.name : 'Error'}: ${String(error)}`);
    }

    return resultPromise;
  }

  async function runChain(
    audio: HTMLAudioElement,
    offsetSec: number,
    isCurrent: () => boolean,
    muted: boolean,
  ): Promise<MusicFilePlaybackResult> {
    const file = selectedFile;
    const generation = selectedFileId;
    if (!file) {
      return {
        success: false,
        cancelled: false,
        src: '',
        strategy: null,
        error: new Error('Файл не вибрано'),
        message: 'Файл не вибрано.',
      };
    }
    if (successfulStrategy && successfulUrl) {
      const reused = await runAttempt(
        audio,
        file,
        successfulStrategy,
        successfulUrl,
        mimeForSlice(file),
        offsetSec,
        () => isCurrent() && generation === selectedFileId,
        muted,
        audio.src === successfulUrl,
      );
      if (reused.success) {
        return {
          success: true,
          cancelled: false,
          src: successfulUrl,
          strategy: successfulStrategy,
          error: null,
          message: '',
        };
      }
      if (reused.cancelled || generation !== selectedFileId) {
        return {
          success: false,
          cancelled: true,
          src: '',
          strategy: successfulStrategy,
          error: reused.error,
          message: '',
        };
      }
      try {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      } catch {
        // Cleanup is best-effort after a cached source fails.
      }
      ownedUrls.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Continue cleanup for remaining URLs.
        }
      });
      ownedUrls.clear();
      successfulStrategy = null;
      successfulUrl = '';
      chainFinished = true;
      finalResult = {
        success: false,
        cancelled: false,
        src: '',
        strategy: null,
        error: reused.error,
        message: 'Не вдалося відтворити файл. Виберіть файл ще раз, щоб повторити перевірку.',
      };
      return finalResult;
    }
    if (chainFinished && finalResult) return finalResult;

    const strategies: MusicFileStrategy[] = [];
    const useLegacyDataUrl = isIOS12() && file.size <= IOS12_DATA_URL_LIMIT;
    if (useLegacyDataUrl && legacyDataUrlPending) {
      return {
        success: false,
        cancelled: false,
        src: '',
        strategy: null,
        error: null,
        message:
          'Файл готується для iOS 12. Дочекайтеся завершення підготовки й натисніть «Грати» ще раз.',
      };
    }
    if (useLegacyDataUrl && legacyDataUrl) strategies.push('D');
    if (file.type && file.type.indexOf('audio/') === 0) strategies.push('A');
    strategies.push('B');
    if (file.size <= options.memoryCopyLimit) strategies.push('C');
    const attempts: MusicFileAttempt[] = [];

    for (const strategy of strategies) {
      if (!isCurrent() || generation !== selectedFileId) {
        return {
          success: false,
          cancelled: true,
          src: '',
          strategy: null,
          error: null,
          message: '',
        };
      }
      if (strategy === 'C' && options.onProgress) options.onProgress(0);
      const candidateValue = createCandidate(file, strategy);
      const candidate = candidateValue instanceof Promise ? await candidateValue : candidateValue;
      if (!candidate.url || candidate.error) {
        const synthetic = recordAttempt(
          file,
          strategy,
          candidate.mime,
          Date.now(),
          audio,
          candidate.error,
          'URL/read failed',
          -1,
        );
        attempts.push(synthetic);
        if (strategy === 'C' && candidate.error && candidate.readFailure) {
          finalResult = {
            success: false,
            cancelled: false,
            src: '',
            strategy: null,
            error: candidate.error,
            message:
              'Файл недоступний. Перевірте, що він збережений на iPhone (не в iCloud, без значка хмаринки), і виберіть його ще раз.',
          };
          chainFinished = true;
          if (options.onProgress) options.onProgress(-1);
          return finalResult;
        }
        continue;
      }
      const result = await runAttempt(
        audio,
        file,
        strategy,
        candidate.url,
        candidate.mime,
        offsetSec,
        () => isCurrent() && generation === selectedFileId,
        muted,
        false,
      );
      attempts.push(result.attempt);
      if (strategy === 'C' && options.onProgress) options.onProgress(-1);
      if (result.success) {
        successfulStrategy = strategy;
        successfulUrl = candidate.url;
        chainFinished = true;
        finalResult = {
          success: true,
          cancelled: false,
          src: candidate.url,
          strategy,
          error: null,
          message: '',
        };
        return finalResult;
      }
      if (result.cancelled || generation !== selectedFileId) {
        if (result.cancelled && generation === selectedFileId) {
          successfulStrategy = strategy;
          successfulUrl = candidate.url;
          chainFinished = true;
        }
        return {
          success: false,
          cancelled: true,
          src: '',
          strategy: null,
          error: result.error,
          message: '',
        };
      }
    }

    try {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } catch {
      // Releasing a failed source is best-effort after all candidates are exhausted.
    }
    ownedUrls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Continue cleanup for the remaining strategy URLs.
      }
    });
    ownedUrls.clear();
    chainFinished = true;
    finalResult = finalFailure(file, options.memoryCopyLimit, attempts);
    return finalResult;
  }

  async function probe(file = selectedFile): Promise<MusicFileProbeResult> {
    if (!file) {
      return { success: false, message: 'Файл не вибрано.' };
    }
    const first = file.slice(0, Math.min(PROBE_BYTES, file.size));
    const last = file.slice(Math.max(0, file.size - PROBE_BYTES), file.size);
    const firstResult = await readBlob(first, { timeoutMs: PROBE_TIMEOUT_MS });
    if (firstResult.error || !firstResult.buffer) {
      const result = {
        success: false,
        message: `Зондування початку: ${firstResult.error ? firstResult.error.message : 'немає даних'}`,
      };
      if (options.onProbe) options.onProbe(result);
      return result;
    }
    const lastResult = await readBlob(last, { timeoutMs: PROBE_TIMEOUT_MS });
    if (lastResult.error || !lastResult.buffer) {
      const result = {
        success: false,
        message: `Зондування кінця: ${lastResult.error ? lastResult.error.message : 'немає даних'}`,
      };
      if (options.onProbe) options.onProbe(result);
      return result;
    }
    const result = {
      success: true,
      message: `Зондування OK · початок ${firstResult.buffer.byteLength} байт · кінець ${lastResult.buffer.byteLength} байт · timeout ${PROBE_TIMEOUT_MS / 1000} с`,
    };
    if (options.onProbe) options.onProbe(result);
    return result;
  }

  return {
    selectFile,
    play: (audio, offsetSec, isCurrent) => runChain(audio, offsetSec, isCurrent, false),
    check: (audio, isCurrent) => runChain(audio, 0, isCurrent, true),
    probe,
    destroy: (audio) => {
      try {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      } catch {
        // Cleanup is best-effort while the page is being discarded.
      }
      ownedUrls.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Continue cleanup for remaining URLs.
        }
      });
      ownedUrls.clear();
      selectedFile = null;
      legacyDataUrl = '';
      legacyDataUrlPending = false;
    },
  };
}
