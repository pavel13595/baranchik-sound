import { logError, logInfo } from '../log';
import type { GamarjosFile, LocalMusicTrack, SignalConfig, VenueConfig } from '../types';
import { unlockAudio, type AudioUnlockState } from './unlock';
import type { MusicFilePlaybackResult } from './music-file-player';

export type AlarmSignal = 'yellow' | 'red' | 'clear';
export type ActiveAudioSource = 'music' | 'alarm' | 'greeting' | 'test' | null;
export type GreetingPlaybackState = 'idle' | 'queued' | 'playing';
export type MusicPlaybackStatus =
  | 'unselected'
  | 'loading'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'paused-for-signal'
  | 'error';

export interface AudioDirectorSnapshot {
  audioUnlocked: boolean;
  musicWanted: boolean;
  musicStatus: MusicPlaybackStatus;
  activeSource: ActiveAudioSource;
  greetingState: GreetingPlaybackState;
  track: LocalMusicTrack | null;
  currentTime: number;
  duration: number;
  loadSeconds: number;
  lastErrorCode: number | null;
  lastErrorMessage: string;
  queueLength: number;
  alarmQueueLength: number;
}

export interface AudioDirectorOptions {
  musicAudio: HTMLAudioElement;
  signalsAudio: HTMLAudioElement;
  config: Pick<VenueConfig, 'signals'>;
  greetings: GamarjosFile[];
  getNow: () => Date;
  random?: () => number;
  onStatus?: (snapshot: AudioDirectorSnapshot) => void;
  onLog?: (message: string, error?: unknown) => void;
  onPlayResult?: (element: 'music' | 'signals', error: unknown | null) => void;
  playLocalMusicFile?: (
    audio: HTMLAudioElement,
    offsetSec: number,
    isCurrent: () => boolean,
  ) => Promise<MusicFilePlaybackResult>;
}

export interface AudioDirector {
  start(): Promise<boolean>;
  isAudioUnlocked(): boolean;
  selectTrack(track: LocalMusicTrack | null): void;
  playMusic(): Promise<boolean>;
  pauseMusic(): void;
  seek(positionSec: number): boolean;
  recoverMusic(): Promise<void>;
  enqueueAlarm(signal: AlarmSignal): Promise<boolean>;
  playAlarm(signal: AlarmSignal): Promise<boolean>;
  stopGreeting(): void;
  stopAlarm(): void;
  playTestSignal(signal: AlarmSignal): Promise<boolean>;
  playTestTone(): Promise<boolean>;
  playGreeting(): Promise<boolean>;
  destroy(): void;
}

type QueueItem = {
  kind: 'alarm' | 'greeting' | 'test';
  src: string;
  title: string;
};

interface ActiveSignal {
  id: number;
  item: QueueItem;
  onEnded: EventListener;
  onError: EventListener;
}

interface MediaWaiter {
  promise: Promise<boolean>;
  cancel: () => void;
}

const MEDIA_TIMEOUT_MS = 8000;

function waitForMediaEvent(audio: HTMLAudioElement, eventName: string): MediaWaiter {
  let resolveWaiter: (success: boolean) => void = () => undefined;
  let settled = false;

  const promise = new Promise<boolean>((resolve) => {
    resolveWaiter = resolve;
  });

  const finish = (success: boolean): void => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timeoutId);
    audio.removeEventListener(eventName, onSuccess);
    audio.removeEventListener('error', onError);
    resolveWaiter(success);
  };

  const onSuccess: EventListener = () => finish(true);
  const onError: EventListener = () => finish(false);
  const timeoutId = setTimeout(() => finish(false), MEDIA_TIMEOUT_MS);

  audio.addEventListener(eventName, onSuccess);
  audio.addEventListener('error', onError);
  return { promise, cancel: () => finish(false) };
}

function pauseSafely(audio: HTMLAudioElement): void {
  try {
    audio.pause();
  } catch (error) {
    logError('Unable to pause audio element', error);
  }
}

function activeHoursAllowPlayback(signals: SignalConfig, now: Date): boolean {
  const hours = signals.activeHours;
  if (hours === null) {
    return true;
  }
  const startMatch = /^(\d{2}):(\d{2})$/.exec(hours.start);
  const endMatch = /^(\d{2}):(\d{2})$/.exec(hours.end);
  if (!startMatch || !endMatch) {
    return false;
  }
  const startHour = Number(startMatch[1]);
  const startMinute = Number(startMatch[2]);
  const endHour = Number(endMatch[1]);
  const endMinute = Number(endMatch[2]);
  if (startHour > 23 || startMinute > 59 || endHour > 23 || endMinute > 59) {
    return false;
  }
  const current = now.getHours() * 60 + now.getMinutes();
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  return start <= end ? current >= start && current < end : current >= start || current < end;
}

function createQuietToneObjectUrl(): string | null {
  try {
    const sampleRate = 44_100;
    const sampleCount = sampleRate;
    const bytesPerSample = 2;
    const dataByteLength = sampleCount * bytesPerSample;
    const bytes = new Uint8Array(44 + dataByteLength);
    const view = new DataView(bytes.buffer);
    const writeText = (offset: number, value: string): void => {
      for (let index = 0; index < value.length; index += 1) {
        bytes[offset + index] = value.charCodeAt(index);
      }
    };
    writeText(0, 'RIFF');
    view.setUint32(4, 36 + dataByteLength, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, dataByteLength, true);
    for (let index = 0; index < sampleCount; index += 1) {
      view.setInt16(
        44 + index * bytesPerSample,
        Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 2048),
        true,
      );
    }
    return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  } catch (error) {
    logError('Unable to create diagnostic tone', error);
    return null;
  }
}

function mediaErrorMessage(code: number | null): string {
  if (code === 1) {
    return 'Відтворення файлу перервано';
  }
  if (code === 2) {
    return 'Помилка мережі під час завантаження файлу';
  }
  if (code === 3) {
    return 'Не вдалося декодувати аудіофайл';
  }
  if (code === 4) {
    return 'Формат аудіофайлу не підтримується';
  }
  return 'Невідома помилка аудіофайлу';
}

export function createAudioDirector(options: AudioDirectorOptions): AudioDirector {
  const musicAudio = options.musicAudio;
  const signalsAudio = options.signalsAudio;
  musicAudio.loop = true;
  const greetings = options.greetings.slice();
  const unlockState: AudioUnlockState = { audioUnlocked: false };
  const alarmQueue: QueueItem[] = [];
  const pendingMusicWaiters = new Set<MediaWaiter>();
  const pendingSignalWaiters = new Set<MediaWaiter>();

  let musicWanted = false;
  let musicStatus: MusicPlaybackStatus = 'unselected';
  let track: LocalMusicTrack | null = null;
  let activeSource: ActiveAudioSource = null;
  let activeSignal: ActiveSignal | null = null;
  let queuedGreeting: QueueItem | null = null;
  let lastGreetingSrc: string | null = null;
  let loadedSource = '';
  let currentDuration = 0;
  let loadStartedAt: Date | null = null;
  let lastErrorCode: number | null = null;
  let lastErrorMessage = '';
  let musicErrorHandler: EventListener | null = null;
  let requestId = 0;
  let pumpRunning = false;
  let dispatchPending = false;
  let started = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let ownerDocument: Document | null = null;
  let ownerWindow: Window | null = null;
  let visibilityHandler: EventListener | null = null;
  let onlineHandler: EventListener | null = null;
  let musicTimeHandler: EventListener | null = null;
  let musicPlayingHandler: EventListener | null = null;
  let musicWaitingHandler: EventListener | null = null;
  let musicStalledHandler: EventListener | null = null;
  let musicMetadataHandler: EventListener | null = null;
  let musicPauseHandler: EventListener | null = null;
  let tickInFlight = false;
  let lastPlayError: unknown = null;

  function writeLog(message: string, error?: unknown): void {
    try {
      if (options.onLog) {
        options.onLog(message, error);
      } else if (error !== undefined) {
        logError(message, error);
      } else {
        logInfo(message);
      }
    } catch {
      // Logging must not interrupt audio recovery.
    }
  }

  function markAudioUnlocked(): void {
    unlockState.audioUnlocked = true;
    if (!started) {
      started = true;
      attachListeners();
      intervalId = setInterval(() => {
        void tick().catch((error: unknown) => writeLog('Audio UI tick failed', error));
      }, 1000);
    }
    publishStatus();
    if (alarmQueue.length > 0 || queuedGreeting !== null) {
      void dispatchQueue();
    }
  }

  function reportPlayResult(audio: HTMLAudioElement, error: unknown | null): void {
    const element = audio === musicAudio ? 'music' : 'signals';
    const result =
      error === null
        ? 'OK'
        : error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
    writeLog(`${element}.play(): ${result}`, error === null ? undefined : error);
    try {
      if (options.onPlayResult) {
        options.onPlayResult(element, error);
      }
    } catch (callbackError) {
      writeLog('Audio play result callback failed', callbackError);
    }
  }

  function callPlay(audio: HTMLAudioElement): Promise<boolean> {
    try {
      return Promise.resolve(audio.play()).then(
        () => {
          reportPlayResult(audio, null);
          return true;
        },
        (error: unknown) => {
          lastPlayError = error;
          reportPlayResult(audio, error);
          return false;
        },
      );
    } catch (error) {
      lastPlayError = error;
      reportPlayResult(audio, error);
      return Promise.resolve(false);
    }
  }

  function queueBusy(): boolean {
    return activeSignal !== null || alarmQueue.length > 0 || queuedGreeting !== null;
  }

  function getSnapshot(): AudioDirectorSnapshot {
    const now = options.getNow();
    const loadSeconds = loadStartedAt
      ? Math.max(0, Math.floor((now.getTime() - loadStartedAt.getTime()) / 1000))
      : 0;
    return {
      audioUnlocked: unlockState.audioUnlocked,
      musicWanted,
      musicStatus,
      activeSource,
      greetingState:
        activeSignal && activeSignal.item.kind === 'greeting'
          ? 'playing'
          : queuedGreeting
            ? 'queued'
            : 'idle',
      track,
      currentTime: Number.isFinite(musicAudio.currentTime) ? musicAudio.currentTime : 0,
      duration:
        currentDuration > 0
          ? currentDuration
          : Number.isFinite(musicAudio.duration)
            ? musicAudio.duration
            : 0,
      loadSeconds,
      lastErrorCode,
      lastErrorMessage,
      queueLength: alarmQueue.length + (queuedGreeting ? 1 : 0) + (activeSignal ? 1 : 0),
      alarmQueueLength:
        alarmQueue.length + (activeSignal && activeSignal.item.kind === 'alarm' ? 1 : 0),
    };
  }

  function publishStatus(): void {
    if (!options.onStatus) {
      return;
    }
    try {
      options.onStatus(getSnapshot());
    } catch (error) {
      writeLog('Audio status callback failed', error);
    }
  }

  function assertSingleAudioPlaying(): void {
    if (!musicAudio.paused && !signalsAudio.paused) {
      pauseSafely(musicAudio);
      pauseSafely(signalsAudio);
      activeSource = null;
      throw new Error('More than one audio element is playing');
    }
  }

  function trackWaiter(
    audio: HTMLAudioElement,
    eventName: string,
    registry: Set<MediaWaiter>,
  ): MediaWaiter {
    const waiter = waitForMediaEvent(audio, eventName);
    registry.add(waiter);
    void waiter.promise.then(() => registry.delete(waiter));
    return waiter;
  }

  function cancelWaiters(registry: Set<MediaWaiter>): void {
    registry.forEach((waiter) => waiter.cancel());
    registry.clear();
  }

  function removeMusicErrorHandler(): void {
    if (musicErrorHandler) {
      musicAudio.removeEventListener('error', musicErrorHandler);
      musicErrorHandler = null;
    }
  }

  function setMusicPausedStatus(): void {
    if (queueBusy() && musicWanted) {
      musicStatus = 'paused-for-signal';
    } else if (!track) {
      musicStatus = 'unselected';
    } else {
      musicStatus = 'paused';
    }
  }

  function pauseMusicForSignal(): void {
    if (activeSource === 'music' || !musicAudio.paused) {
      requestId += 1;
      cancelWaiters(pendingMusicWaiters);
      removeMusicErrorHandler();
      pauseSafely(musicAudio);
      activeSource = null;
    }
    setMusicPausedStatus();
    publishStatus();
  }

  function isCurrentRequest(id: number, source: 'music' | 'signal'): boolean {
    if (requestId !== id) {
      return false;
    }
    return source === 'music'
      ? activeSource === 'music'
      : activeSignal !== null && activeSignal.id === id;
  }

  async function waitUntilPlaying(
    audio: HTMLAudioElement,
    registry: Set<MediaWaiter>,
  ): Promise<boolean> {
    const waiter = trackWaiter(audio, 'playing', registry);
    const playResult = callPlay(audio).then((didPlay) =>
      didPlay ? ('resolved' as const) : ('rejected' as const),
    );

    const first = await Promise.race([
      waiter.promise.then((success) => (success ? ('event' as const) : ('failed' as const))),
      playResult,
    ]);
    if (first === 'event') {
      return true;
    }
    if (first === 'failed' || first === 'rejected') {
      waiter.cancel();
      return false;
    }
    return await waiter.promise;
  }

  function setMediaError(error: unknown, message?: string): void {
    const code = musicAudio.error ? musicAudio.error.code : null;
    lastErrorCode = code;
    if (message) {
      lastErrorMessage = message;
    } else if (error instanceof Error) {
      lastErrorMessage = `${error.name}: ${error.message}`;
    } else {
      lastErrorMessage = mediaErrorMessage(code);
    }
    musicStatus = 'error';
    writeLog(`Local music error (${code === null ? 'unknown' : code}): ${lastErrorMessage}`, error);
  }

  async function startMusicAt(offset: number): Promise<boolean> {
    if (!track || !musicWanted) {
      return false;
    }

    const id = requestId + 1;
    requestId = id;
    activeSource = 'music';
    musicStatus = 'loading';
    loadStartedAt = options.getNow();
    lastErrorCode = null;
    lastErrorMessage = '';
    lastPlayError = null;
    removeMusicErrorHandler();
    cancelWaiters(pendingMusicWaiters);
    pauseSafely(signalsAudio);

    let localPlayback: Promise<MusicFilePlaybackResult> | null = null;
    if (options.playLocalMusicFile) {
      localPlayback = options.playLocalMusicFile(musicAudio, offset, () =>
        isCurrentRequest(id, 'music'),
      );
    } else if (loadedSource !== track.src) {
      try {
        musicAudio.src = track.src;
        loadedSource = track.src;
        musicAudio.load();
      } catch (error) {
        activeSource = null;
        musicWanted = false;
        setMediaError(error);
        publishStatus();
        return false;
      }
    }
    if (Number.isFinite(musicAudio.duration)) {
      currentDuration = musicAudio.duration;
    }
    publishStatus();

    if (!musicWanted) {
      activeSource = null;
      setMusicPausedStatus();
      publishStatus();
      return false;
    }

    let didPlay = false;
    if (localPlayback) {
      const result = await localPlayback;
      didPlay = result.success;
      if (result.success && track) {
        track = { ...track, src: result.src };
        loadedSource = result.src;
        currentDuration = Number.isFinite(musicAudio.duration)
          ? musicAudio.duration
          : currentDuration;
      } else if (!result.cancelled) {
        lastPlayError = result.error;
        if (result.message) lastErrorMessage = result.message;
      }
    } else {
      if (offset > 0 && musicAudio.readyState >= 1) {
        try {
          musicAudio.currentTime = offset;
        } catch (error) {
          writeLog('Unable to restore music position before playback', error);
        }
      } else if (offset > 0) {
        const restorePosition: EventListener = () => {
          if (isCurrentRequest(id, 'music')) {
            try {
              musicAudio.currentTime = offset;
            } catch (error) {
              writeLog('Unable to restore music position after metadata', error);
            }
          }
        };
        musicAudio.addEventListener('loadedmetadata', restorePosition);
      }
      didPlay = await waitUntilPlaying(musicAudio, pendingMusicWaiters);
    }
    if (!isCurrentRequest(id, 'music')) {
      if (!musicAudio.paused) {
        pauseSafely(musicAudio);
      }
      return false;
    }
    if (!didPlay) {
      pauseSafely(musicAudio);
      activeSource = null;
      musicWanted = false;
      setMediaError(lastPlayError || new Error('Playback failed or timed out'), lastErrorMessage);
      publishStatus();
      return false;
    }

    try {
      assertSingleAudioPlaying();
    } catch (error) {
      activeSource = null;
      musicWanted = false;
      setMediaError(error);
      publishStatus();
      return false;
    }

    activeSource = 'music';
    musicStatus = 'playing';
    loadStartedAt = null;
    musicErrorHandler = onMusicError;
    musicAudio.addEventListener('error', musicErrorHandler);
    publishStatus();
    return true;
  }

  async function playCurrentTrack(offset?: number): Promise<boolean> {
    if (!track) {
      musicStatus = 'unselected';
      publishStatus();
      return false;
    }
    const position = offset === undefined ? Math.max(0, musicAudio.currentTime || 0) : offset;
    return startMusicAt(position);
  }

  function removeSignalListeners(signal: ActiveSignal): void {
    signalsAudio.removeEventListener('ended', signal.onEnded);
    signalsAudio.removeEventListener('error', signal.onError);
  }

  function finishSignal(id: number, failed: boolean, error?: unknown): void {
    if (!activeSignal || activeSignal.id !== id) {
      return;
    }
    const finished = activeSignal;
    removeSignalListeners(finished);
    activeSignal = null;
    activeSource = null;
    requestId += 1;
    if (failed) {
      pauseSafely(signalsAudio);
      writeLog(`Audio file or playback failed: ${finished.item.title}`, error);
    }
    if (finished.item.kind === 'test' && finished.item.src.indexOf('blob:') === 0) {
      try {
        URL.revokeObjectURL(finished.item.src);
      } catch (revokeError) {
        writeLog('Unable to revoke diagnostic sound URL', revokeError);
      }
    }
    void dispatchQueue();
    publishStatus();
  }

  function playSignalFromGesture(item: QueueItem): Promise<boolean> {
    if (!item.src) {
      return Promise.resolve(false);
    }
    if (activeSource === 'music' || !musicAudio.paused) {
      pauseMusicForSignal();
    }
    if (activeSignal) {
      if (activeSignal.item.kind === 'alarm') {
        alarmQueue.unshift(activeSignal.item);
      }
      removeSignalListeners(activeSignal);
      activeSignal = null;
    }
    cancelWaiters(pendingSignalWaiters);
    requestId += 1;
    const id = requestId;
    activeSource = item.kind;

    const signal: ActiveSignal = {
      id,
      item,
      onEnded: () => finishSignal(id, false),
      onError: (event) => finishSignal(id, true, event),
    };
    activeSignal = signal;
    signalsAudio.addEventListener('ended', signal.onEnded);
    signalsAudio.addEventListener('error', signal.onError);

    try {
      signalsAudio.src = item.src;
      signalsAudio.load();
    } catch (error) {
      finishSignal(id, true, error);
      return Promise.resolve(false);
    }

    const playback = callPlay(signalsAudio);
    publishStatus();
    return playback.then((didPlay) => {
      if (!isCurrentRequest(id, 'signal')) {
        return false;
      }
      if (!didPlay) {
        finishSignal(id, true, lastPlayError || new Error('Signal play() failed'));
        return false;
      }
      markAudioUnlocked();
      try {
        assertSingleAudioPlaying();
      } catch (error) {
        finishSignal(id, true, error);
        return false;
      }
      if (item.kind === 'greeting') {
        writeLog(`Гамарджос: ${item.title}`);
      }
      publishStatus();
      return true;
    });
  }

  async function startSignal(item: QueueItem): Promise<boolean> {
    if (!item.src || !started || !unlockState.audioUnlocked) {
      return false;
    }
    pauseMusicForSignal();
    const id = requestId + 1;
    requestId = id;
    activeSource = item.kind;

    const signal: ActiveSignal = {
      id,
      item,
      onEnded: () => finishSignal(id, false),
      onError: (event) => finishSignal(id, true, event),
    };
    activeSignal = signal;
    signalsAudio.addEventListener('ended', signal.onEnded);
    signalsAudio.addEventListener('error', signal.onError);
    cancelWaiters(pendingSignalWaiters);

    const metadataWaiter = trackWaiter(signalsAudio, 'loadedmetadata', pendingSignalWaiters);
    try {
      signalsAudio.src = item.src;
      signalsAudio.load();
    } catch (error) {
      metadataWaiter.cancel();
      finishSignal(id, true, error);
      return false;
    }

    const loaded = await metadataWaiter.promise;
    if (!isCurrentRequest(id, 'signal')) {
      return false;
    }
    if (!loaded) {
      finishSignal(id, true, new Error(`Unable to load ${item.src}`));
      return false;
    }

    try {
      signalsAudio.currentTime = 0;
    } catch (error) {
      finishSignal(id, true, error);
      return false;
    }

    const didPlay = await waitUntilPlaying(signalsAudio, pendingSignalWaiters);
    if (!isCurrentRequest(id, 'signal')) {
      if (activeSignal && activeSignal.id === id && !signalsAudio.paused) {
        pauseSafely(signalsAudio);
      }
      return false;
    }
    if (!didPlay) {
      finishSignal(id, true, new Error(`Playback failed for ${item.src}`));
      return false;
    }

    try {
      assertSingleAudioPlaying();
    } catch (error) {
      finishSignal(id, true, error);
      return false;
    }
    if (item.kind === 'greeting') {
      writeLog(`Гамарджос: ${item.title}`);
    }
    publishStatus();
    return true;
  }

  async function dispatchQueue(): Promise<void> {
    if (activeSignal !== null || !started || !unlockState.audioUnlocked) {
      return;
    }
    if (pumpRunning) {
      dispatchPending = true;
      return;
    }
    dispatchPending = false;
    pumpRunning = true;
    try {
      while (activeSignal === null) {
        let item: QueueItem | null = null;
        if (alarmQueue.length > 0) {
          item = alarmQueue.shift() || null;
        } else if (queuedGreeting) {
          item = queuedGreeting;
          queuedGreeting = null;
        }
        if (!item) {
          await resumeMusicAfterQueue();
          break;
        }
        const didStart = await startSignal(item);
        if (didStart || activeSignal) {
          break;
        }
      }
    } catch (error) {
      writeLog('Audio queue failed', error);
    } finally {
      pumpRunning = false;
    }
    if (
      activeSignal === null &&
      (dispatchPending || alarmQueue.length > 0 || queuedGreeting !== null)
    ) {
      dispatchPending = false;
      void dispatchQueue();
    }
  }

  async function resumeMusicAfterQueue(): Promise<void> {
    if (!musicWanted || !track || !unlockState.audioUnlocked) {
      setMusicPausedStatus();
      publishStatus();
      return;
    }
    await playCurrentTrack(musicAudio.currentTime || 0);
  }

  function onMusicError(): void {
    if (activeSource !== 'music') {
      return;
    }
    requestId += 1;
    activeSource = null;
    removeMusicErrorHandler();
    pauseSafely(musicAudio);
    setMediaError(new Error('Playback error event'));
    musicWanted = false;
    publishStatus();
  }

  function onWaiting(): void {
    if (activeSource === 'music') {
      musicStatus = 'buffering';
      publishStatus();
    }
  }

  function onTimeUpdate(): void {
    if (activeSource === 'music') {
      publishStatus();
    }
  }

  function onVisibilityOrOnline(): void {
    if (musicWanted && !queueBusy() && musicAudio.paused && track) {
      void recoverMusic();
    }
  }

  function attachListeners(): void {
    musicTimeHandler = onTimeUpdate;
    musicPlayingHandler = () => {
      if (activeSource === 'music') {
        musicStatus = 'playing';
        loadStartedAt = null;
        publishStatus();
      }
    };
    musicMetadataHandler = () => {
      currentDuration = Number.isFinite(musicAudio.duration) ? musicAudio.duration : 0;
      publishStatus();
    };
    musicWaitingHandler = onWaiting;
    musicStalledHandler = onWaiting;
    musicPauseHandler = () => {
      if (activeSource === 'music' && !queueBusy()) {
        musicStatus = musicWanted ? 'paused' : 'paused';
        publishStatus();
      }
    };
    musicAudio.addEventListener('timeupdate', musicTimeHandler);
    musicAudio.addEventListener('playing', musicPlayingHandler);
    musicAudio.addEventListener('loadedmetadata', musicMetadataHandler);
    musicAudio.addEventListener('waiting', musicWaitingHandler);
    musicAudio.addEventListener('stalled', musicStalledHandler);
    musicAudio.addEventListener('pause', musicPauseHandler);
    ownerDocument = musicAudio.ownerDocument;
    if (ownerDocument) {
      visibilityHandler = onVisibilityOrOnline;
      ownerDocument.addEventListener('visibilitychange', visibilityHandler);
      ownerWindow = ownerDocument.defaultView;
    }
    if (ownerWindow) {
      onlineHandler = onVisibilityOrOnline;
      ownerWindow.addEventListener('online', onlineHandler);
    }
  }

  function detachListeners(): void {
    if (musicTimeHandler) {
      musicAudio.removeEventListener('timeupdate', musicTimeHandler);
    }
    if (musicPlayingHandler) {
      musicAudio.removeEventListener('playing', musicPlayingHandler);
    }
    if (musicMetadataHandler) {
      musicAudio.removeEventListener('loadedmetadata', musicMetadataHandler);
    }
    if (musicWaitingHandler) {
      musicAudio.removeEventListener('waiting', musicWaitingHandler);
    }
    if (musicStalledHandler) {
      musicAudio.removeEventListener('stalled', musicStalledHandler);
    }
    if (musicPauseHandler) {
      musicAudio.removeEventListener('pause', musicPauseHandler);
    }
    if (ownerDocument && visibilityHandler) {
      ownerDocument.removeEventListener('visibilitychange', visibilityHandler);
    }
    if (ownerWindow && onlineHandler) {
      ownerWindow.removeEventListener('online', onlineHandler);
    }
    musicTimeHandler = null;
    musicPlayingHandler = null;
    musicMetadataHandler = null;
    musicWaitingHandler = null;
    musicStalledHandler = null;
    musicPauseHandler = null;
    visibilityHandler = null;
    onlineHandler = null;
    ownerDocument = null;
    ownerWindow = null;
  }

  function publishTick(): void {
    if (musicStatus === 'loading' && loadStartedAt) {
      publishStatus();
    }
  }

  async function tick(): Promise<void> {
    if (!started || tickInFlight) {
      return;
    }
    tickInFlight = true;
    try {
      publishTick();
    } finally {
      tickInFlight = false;
    }
  }

  function start(): Promise<boolean> {
    if (unlockState.audioUnlocked) {
      return Promise.resolve(true);
    }
    loadedSource = '';
    return unlockAudio(
      { music: musicAudio, signals: signalsAudio },
      unlockState,
      (element, error) => {
        reportPlayResult(element === 'signals' ? signalsAudio : musicAudio, error);
      },
    )
      .then(() => {
        loadedSource = track && musicAudio.src === track.src ? track.src : '';
        markAudioUnlocked();
        return true;
      })
      .catch((error: unknown) => {
        writeLog('Audio unlock failed', error);
        publishStatus();
        return false;
      });
  }

  function selectTrack(selectedTrack: LocalMusicTrack | null): void {
    requestId += 1;
    cancelWaiters(pendingMusicWaiters);
    removeMusicErrorHandler();
    pauseSafely(musicAudio);
    if (activeSource === 'music') {
      activeSource = null;
    }
    try {
      musicAudio.removeAttribute('src');
      if (selectedTrack && selectedTrack.src) {
        musicAudio.src = selectedTrack.src;
        loadedSource = selectedTrack.src;
      } else {
        loadedSource = '';
      }
      musicAudio.load();
    } catch (error) {
      writeLog('Unable to update selected music source', error);
    }
    track = selectedTrack;
    currentDuration = 0;
    musicWanted = false;
    loadStartedAt = null;
    lastErrorCode = null;
    lastErrorMessage = '';
    musicStatus = track ? 'paused' : 'unselected';
    publishStatus();
  }

  function playMusic(): Promise<boolean> {
    if (!track) {
      return Promise.resolve(false);
    }
    if (activeSignal) {
      if (activeSignal.item.kind === 'alarm') {
        alarmQueue.unshift(activeSignal.item);
      }
      removeSignalListeners(activeSignal);
      activeSignal = null;
    }
    cancelWaiters(pendingSignalWaiters);
    requestId += 1;
    if (activeSource !== 'music') {
      activeSource = null;
    }
    pauseSafely(signalsAudio);
    musicWanted = true;
    const playback = playCurrentTrack(musicAudio.currentTime || 0);
    return playback.then((didPlay) => {
      if (didPlay) {
        markAudioUnlocked();
      }
      return didPlay;
    });
  }

  function pauseMusic(): void {
    musicWanted = false;
    if (activeSource === 'music') {
      requestId += 1;
      cancelWaiters(pendingMusicWaiters);
      removeMusicErrorHandler();
      pauseSafely(musicAudio);
      activeSource = null;
    }
    musicStatus = track ? 'paused' : 'unselected';
    publishStatus();
  }

  function seek(positionSec: number): boolean {
    if (!track || currentDuration <= 0 || !Number.isFinite(positionSec)) {
      return false;
    }
    try {
      musicAudio.currentTime = Math.max(0, Math.min(currentDuration, positionSec));
      publishStatus();
      return true;
    } catch (error) {
      writeLog('Unable to seek local music', error);
      setMediaError(error);
      publishStatus();
      return false;
    }
  }

  async function recoverMusic(): Promise<void> {
    if (!musicWanted || queueBusy() || !track || !unlockState.audioUnlocked) {
      return;
    }
    if (!musicAudio.paused && activeSource === 'music') {
      return;
    }
    await playCurrentTrack(musicAudio.currentTime || 0);
  }

  async function enqueueAlarm(signal: AlarmSignal): Promise<boolean> {
    if (!activeHoursAllowPlayback(options.config.signals, options.getNow())) {
      return false;
    }
    const item: QueueItem = { kind: 'alarm', src: options.config.signals[signal], title: signal };
    if (!unlockState.audioUnlocked) {
      alarmQueue.push(item);
      publishStatus();
      return true;
    }
    if (activeSignal && activeSignal.item.kind === 'greeting') {
      removeSignalListeners(activeSignal);
      activeSignal = null;
      activeSource = null;
      requestId += 1;
      cancelWaiters(pendingSignalWaiters);
      pauseSafely(signalsAudio);
    }
    if (activeSignal && activeSignal.item.kind === 'test') {
      removeSignalListeners(activeSignal);
      activeSignal = null;
      requestId += 1;
      cancelWaiters(pendingSignalWaiters);
      pauseSafely(signalsAudio);
    }
    if (activeSource === 'music' || !musicAudio.paused) {
      pauseMusicForSignal();
    }
    alarmQueue.push(item);
    publishStatus();
    await dispatchQueue();
    return true;
  }

  function playAlarm(signal: AlarmSignal): Promise<boolean> {
    return playSignalFromGesture({
      kind: 'alarm',
      src: options.config.signals[signal],
      title: signal,
    });
  }

  function playTestSignal(signal: AlarmSignal): Promise<boolean> {
    return playSignalFromGesture({
      kind: 'test',
      src: options.config.signals[signal],
      title: signal,
    });
  }

  function playTestTone(): Promise<boolean> {
    const source = createQuietToneObjectUrl();
    if (!source) {
      return Promise.resolve(false);
    }
    return playSignalFromGesture({ kind: 'test', src: source, title: 'Тест звуку' });
  }

  function playGreeting(): Promise<boolean> {
    if (greetings.length === 0) {
      return Promise.resolve(false);
    }
    if (activeSignal && activeSignal.item.kind === 'alarm') {
      const random = options.random ? options.random() : Math.random();
      let index = Math.floor(Math.max(0, Math.min(0.999999, random)) * greetings.length);
      if (greetings.length > 1 && greetings[index].src === lastGreetingSrc) {
        index = (index + 1) % greetings.length;
      }
      const greeting = greetings[index];
      lastGreetingSrc = greeting.src;
      queuedGreeting = { kind: 'greeting', src: greeting.src, title: greeting.title };
      publishStatus();
      return Promise.resolve(true);
    }
    if (activeSignal && activeSignal.item.kind === 'greeting') {
      return playSignalFromGesture({ ...activeSignal.item });
    }
    if (alarmQueue.length > 0) {
      const random = options.random ? options.random() : Math.random();
      let index = Math.floor(Math.max(0, Math.min(0.999999, random)) * greetings.length);
      if (greetings.length > 1 && greetings[index].src === lastGreetingSrc) {
        index = (index + 1) % greetings.length;
      }
      const greeting = greetings[index];
      lastGreetingSrc = greeting.src;
      queuedGreeting = { kind: 'greeting', src: greeting.src, title: greeting.title };
      publishStatus();
      return Promise.resolve(true);
    }
    const random = options.random ? options.random() : Math.random();
    let index = Math.floor(Math.max(0, Math.min(0.999999, random)) * greetings.length);
    if (greetings.length > 1 && greetings[index].src === lastGreetingSrc) {
      index = (index + 1) % greetings.length;
    }
    const greeting = greetings[index];
    lastGreetingSrc = greeting.src;
    return playSignalFromGesture({ kind: 'greeting', src: greeting.src, title: greeting.title });
  }

  function stopGreeting(): void {
    queuedGreeting = null;
    if (activeSignal && activeSignal.item.kind === 'greeting') {
      removeSignalListeners(activeSignal);
      activeSignal = null;
      cancelWaiters(pendingSignalWaiters);
      requestId += 1;
      pauseSafely(signalsAudio);
      activeSource = null;
    }
    if (activeSignal === null && alarmQueue.length > 0) {
      void dispatchQueue();
    } else if (activeSignal === null && queuedGreeting === null) {
      void resumeMusicAfterQueue();
    }
    publishStatus();
  }

  function stopAlarm(): void {
    alarmQueue.length = 0;
    if (activeSignal && activeSignal.item.kind === 'alarm') {
      removeSignalListeners(activeSignal);
      activeSignal = null;
      cancelWaiters(pendingSignalWaiters);
      requestId += 1;
      pauseSafely(signalsAudio);
      activeSource = null;
    }
    if (activeSignal === null && queuedGreeting !== null) {
      void dispatchQueue();
    } else if (activeSignal === null) {
      void resumeMusicAfterQueue();
    }
    publishStatus();
  }

  function destroy(): void {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    detachListeners();
    requestId += 1;
    cancelWaiters(pendingMusicWaiters);
    cancelWaiters(pendingSignalWaiters);
    if (activeSignal) {
      removeSignalListeners(activeSignal);
      activeSignal = null;
    }
    alarmQueue.length = 0;
    queuedGreeting = null;
    removeMusicErrorHandler();
    pauseSafely(musicAudio);
    pauseSafely(signalsAudio);
    activeSource = null;
    musicWanted = false;
    started = false;
    publishStatus();
  }

  const director: AudioDirector = {
    start,
    isAudioUnlocked: () => unlockState.audioUnlocked,
    selectTrack,
    playMusic,
    pauseMusic,
    seek,
    recoverMusic,
    enqueueAlarm,
    playAlarm,
    stopGreeting,
    stopAlarm,
    playTestSignal,
    playTestTone,
    playGreeting,
    destroy,
  };

  publishStatus();
  return director;
}
