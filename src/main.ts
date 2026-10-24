import { renderView } from './ui/view';
import { loadVenueConfig, MUSIC_MEMORY_COPY_LIMIT } from './config';
import {
  getSelectedLocation,
  getMusicSyncStart,
  getToken,
  importTokenFromHash,
  saveAlertsToken,
  saveSelectedLocation,
  saveMusicSyncStart,
} from './settings';
import { formatClock as formatMusicClock, formatDurationLabel, targetOffset } from './music-sync';
import {
  createAudioDirector,
  type AudioDirectorSnapshot,
  type AlarmSignal,
} from './audio/director';
import { getAudioMime, isAudioFile } from './audio/files';
import { createMusicFilePlayer } from './audio/music-file-player';
import { isDirectAudioActionTarget } from './audio/gesture';
import { isLocationIndex } from './locations';
import { setupLocationSelection } from './ui/location-selection';
import { bindSelectedLocationView } from './ui/location-display';
import { getApiStatusPresentation } from './ui/api-status';
import { getGreetingControlPresentation } from './ui/greeting-control';
import { preventPageZoom } from './ui/zoom';
import {
  createAlertPoller,
  type AlertPollSnapshot,
  type SimulationResponse,
} from './alerts/poller';
import {
  formatAlertApiDiagnostics,
  getAlertApiFailureMessage,
  AlertApiError,
  AlertHttpError,
  AlertRequestLimiter,
  fetchActiveAlerts,
} from './alerts/api';
import { clockSkewSeconds, isStale, parseApiTimestamp } from './diagnostics';
import { inspectAlertLocations } from './alerts';
import { formatSelectedLocationDiagnostic } from './locations';
import type { AlertRecord } from './alerts';
import type { GamarjosFile, LocationIndex, SignalConfig } from './types';
import { getRecentEvents, logError, logInfo, logWarning, redactSensitiveText } from './log';
import {
  createWakeLockController,
  installGlobalErrorHandlers,
  type WakeLockNavigatorLike,
} from './reliability';

let cachedTimeZone: string | null = null;

document.addEventListener('touchstart', function () {}, true);
preventPageZoom(document);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readJson(path: string): Promise<unknown> {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    logError(`Unable to load ${path}`, error);
    throw error;
  }
}

function readGreetings(value: unknown): GamarjosFile[] {
  if (!isRecord(value) || !Array.isArray(value.files)) {
    return [];
  }
  return value.files.filter((entry): entry is GamarjosFile => {
    return isRecord(entry) && typeof entry.src === 'string' && typeof entry.title === 'string';
  });
}

async function readLocationIndex(): Promise<LocationIndex> {
  const value = await readJson('./locations.json');
  if (!isLocationIndex(value)) {
    throw new Error('locations.json має некоректну структуру');
  }
  return value;
}

function manualLocationIndex(uid: string): LocationIndex {
  return {
    updatedAt: '',
    oblasts: [],
    byUid: {
      [uid]: { uid, name: `UID ${uid}`, type: 'city', oblastUid: uid, raionUid: null },
    },
  };
}

function formatTwoDigits(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function formatDuration(value: number): string {
  return formatDurationLabel(value);
}

function updateMusicDiagnostics(
  root: HTMLElement,
  audio: HTMLAudioElement,
  file: File | null,
  mime: string,
): void {
  const source = audio.currentSrc;
  const sourceType =
    source.indexOf('blob:') === 0 ? 'blob' : source.indexOf('data:') === 0 ? 'data' : '';
  const values: Array<[string, string]> = [
    ['[data-diag-music-ready-state]', String(audio.readyState)],
    ['[data-diag-music-network-state]', String(audio.networkState)],
    ['[data-diag-music-paused]', String(audio.paused)],
    ['[data-diag-music-error-code]', audio.error ? String(audio.error.code) : '—'],
    [
      '[data-diag-music-current-src]',
      source ? `${sourceType || 'other'} · ${source}` : '(порожній)',
    ],
    ['[data-diag-music-file-type]', file ? file.type || '(порожній)' : '—'],
    ['[data-diag-music-mime]', mime || '—'],
    ['[data-diag-music-file-size]', file ? `${file.size} байт` : '—'],
  ];
  values.forEach(([selector, value]) => setDiagnosticText(root, selector, value));
  const liveStatus = root.querySelector<HTMLElement>('[data-music-live-status]');
  if (liveStatus) {
    liveStatus.textContent = `readyState ${audio.readyState} · networkState ${audio.networkState} · paused ${audio.paused} · error ${audio.error ? audio.error.code : '—'} · currentSrc ${source || 'порожній'} · file.type ${file ? file.type || 'порожній' : '—'} · mime ${mime || '—'} · ${file ? `${file.size} байт` : 'файл не вибрано'}`;
  }
}

function updateSignalDiagnostics(root: HTMLElement, audio: HTMLAudioElement): void {
  const values: Array<[string, string]> = [
    ['[data-diag-sig-ready-state]', String(audio.readyState)],
    ['[data-diag-sig-network-state]', String(audio.networkState)],
    ['[data-diag-sig-paused]', String(audio.paused)],
    ['[data-diag-sig-error-code]', audio.error ? String(audio.error.code) : '—'],
    ['[data-diag-sig-current-src]', audio.currentSrc || '(порожній)'],
  ];
  values.forEach(([selector, value]) => setDiagnosticText(root, selector, value));
}

function appendAudioEvent(root: HTMLElement, entry: string): void {
  const history = root.querySelector<HTMLOListElement>('[data-audio-event-log]');
  if (!history) {
    return;
  }
  const entries = (history.getAttribute('data-event-list') || '').split('\n').filter(Boolean);
  entries.push(entry);
  while (entries.length > 10) {
    entries.shift();
  }
  history.setAttribute('data-event-list', entries.join('\n'));
  while (history.firstChild) {
    history.removeChild(history.firstChild);
  }
  entries.forEach((value) => {
    const item = document.createElement('li');
    item.textContent = value;
    history.appendChild(item);
  });
}

function listenForAudioDiagnostics(
  root: HTMLElement,
  label: string,
  audio: HTMLAudioElement,
  update: () => void,
): void {
  const eventNames = [
    'loadstart',
    'loadedmetadata',
    'canplay',
    'playing',
    'pause',
    'ended',
    'error',
    'stalled',
    'waiting',
  ];
  eventNames.forEach((eventName) => {
    audio.addEventListener(eventName, () => {
      update();
      appendAudioEvent(
        root,
        `${formatClockTime(new Date())} ${label}.${eventName} · ready ${audio.readyState} · network ${audio.networkState} · paused ${audio.paused} · error ${audio.error ? audio.error.code : '—'}`,
      );
    });
  });
}

async function inspectSignalFiles(
  root: HTMLElement,
  signals: SignalConfig,
): Promise<Array<{ status: string }>> {
  const output = root.querySelector<HTMLElement>('[data-signal-head-results]');
  if (!output) {
    return [];
  }
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 8000);
  try {
    const names: AlarmSignal[] = ['yellow', 'red', 'clear'];
    const results = await Promise.all(
      names.map(async (name) => {
        const url = signals[name];
        try {
          const response = await fetch(url, {
            method: 'HEAD',
            cache: 'no-store',
            signal: controller.signal,
          });
          return {
            name,
            url,
            status: String(response.status),
            type: response.headers.get('Content-Type') || '—',
            length: response.headers.get('Content-Length') || '—',
            ranges: response.headers.get('Accept-Ranges') || '—',
          };
        } catch (error) {
          return {
            name,
            url,
            status:
              error instanceof Error
                ? redactSensitiveText(`${error.name}: ${error.message}`)
                : 'Помилка запиту',
            type: '—',
            length: '—',
            ranges: '—',
          };
        }
      }),
    );
    const table = document.createElement('table');
    table.className = 'alert-diagnostic-table';
    const head = document.createElement('thead');
    const header = document.createElement('tr');
    ['Сигнал / URL', 'HTTP', 'Content-Type', 'Content-Length', 'Accept-Ranges'].forEach((text) => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = text;
      header.appendChild(cell);
    });
    head.appendChild(header);
    table.appendChild(head);
    const body = document.createElement('tbody');
    results.forEach((result) => {
      const row = document.createElement('tr');
      [
        `${result.name}: ${redactSensitiveText(result.url)}`,
        result.status,
        result.type,
        result.length,
        result.ranges,
      ].forEach((text) => {
        const cell = document.createElement('td');
        cell.textContent = text;
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
    table.appendChild(body);
    while (output.firstChild) {
      output.removeChild(output.firstChild);
    }
    output.appendChild(table);
    return results;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
function updateAudioView(
  root: HTMLElement,
  snapshot: AudioDirectorSnapshot,
  hasGreetings = true,
): void {
  const musicStatus = root.querySelector<HTMLElement>('[data-music-status]');
  const musicButton = root.querySelector<HTMLButtonElement>('[data-music-toggle]');
  const musicLabel = root.querySelector<HTMLElement>('[data-music-label]');
  const trackTitle = root.querySelector<HTMLElement>('[data-track-title]');
  const trackPosition = root.querySelector<HTMLElement>('[data-track-position]');
  const seekInput = root.querySelector<HTMLInputElement>('[data-music-seek]');
  const musicFeedback = root.querySelector<HTMLElement>('[data-music-feedback]');
  const homeMusic = root.querySelector<HTMLElement>('[data-home-music]');
  const homeMusicEmpty = root.querySelector<HTMLElement>('[data-home-music-empty]');
  const selectedMusicFile = root.querySelector<HTMLElement>('[data-selected-music-file]');

  if (musicStatus) {
    const statusText: Record<AudioDirectorSnapshot['musicStatus'], string> = {
      unselected: 'Музику не вибрано',
      loading:
        snapshot.loadSeconds > 60
          ? `Завантаження файлу… ${snapshot.loadSeconds} с. Великий файл, зачекайте. Якщо довго нічого не відбувається, виберіть файл ще раз`
          : `Завантаження файлу… ${snapshot.loadSeconds} с`,
      buffering: 'Буферизація…',
      playing: 'Грає',
      paused: 'Пауза',
      'paused-for-signal': 'Пауза на час сигналу',
      error: snapshot.lastErrorMessage || 'Помилка аудіофайлу',
    };
    musicStatus.textContent = statusText[snapshot.musicStatus];
  }

  if (musicFeedback) {
    musicFeedback.textContent =
      snapshot.musicStatus === 'error'
        ? snapshot.lastErrorMessage || 'Помилка аудіофайлу'
        : snapshot.track
          ? `Вибрано: ${snapshot.track.fileName} (${(snapshot.track.size / 1024 / 1024).toFixed(1)} МБ)`
          : 'Музику вибирайте після кожного відкриття сторінки.';
  }

  if (musicButton) {
    musicButton.disabled = !snapshot.track;
  }
  if (homeMusic) homeMusic.hidden = !snapshot.track;
  if (homeMusicEmpty) homeMusicEmpty.hidden = Boolean(snapshot.track);
  if (selectedMusicFile) {
    selectedMusicFile.textContent = snapshot.track
      ? `${snapshot.track.fileName} · ${(snapshot.track.size / 1024 / 1024).toFixed(1)} МБ`
      : 'Файл не вибрано';
  }
  if (musicLabel) {
    musicLabel.textContent = snapshot.musicWanted ? 'Пауза' : 'Грати';
  }
  if (trackTitle && trackPosition) {
    trackTitle.textContent = snapshot.track ? snapshot.track.fileName : 'Оберіть музику';
    trackPosition.textContent = snapshot.track
      ? `${formatDuration(snapshot.currentTime)} / ${formatDuration(snapshot.duration)}`
      : '--:-- / --:--';
  }

  if (seekInput) {
    seekInput.max = String(Math.max(0, snapshot.duration));
    seekInput.value = String(Math.min(snapshot.currentTime, snapshot.duration || 0));
    seekInput.disabled = snapshot.duration <= 0;
    seekInput.setAttribute('aria-valuetext', formatDuration(snapshot.currentTime));
  }
  if (musicButton) {
    const icon = musicButton.querySelector<HTMLElement>('[data-music-icon]');
    if (icon) {
      icon.textContent = snapshot.musicWanted ? '⏸' : '▶';
    }
  }

  const greetingButton = root.querySelector<HTMLButtonElement>('[data-greeting-button]');
  const greetingLabel = root.querySelector<HTMLElement>('[data-greeting-label]');
  if (greetingButton && greetingLabel) {
    const presentation = getGreetingControlPresentation(snapshot.greetingState, hasGreetings);
    greetingButton.disabled = presentation.disabled;
    greetingButton.classList.toggle('gamarjos-button--playing', presentation.playing);
    greetingLabel.textContent = presentation.label;
  }
  const stopGreetingButton = root.querySelector<HTMLButtonElement>('[data-stop-greeting]');
  if (stopGreetingButton) {
    const presentation = getGreetingControlPresentation(snapshot.greetingState, hasGreetings);
    stopGreetingButton.disabled = presentation.stopDisabled;
    stopGreetingButton.classList.toggle('is-hidden', presentation.stopHidden);
  }
  setDiagnosticText(root, '[data-diag-audio-source]', snapshot.activeSource || 'Немає');
  setDiagnosticText(root, '[data-diag-music-state]', snapshot.musicStatus);
  setDiagnosticText(root, '[data-diag-audio-unlocked]', snapshot.audioUnlocked ? 'Так' : 'Ні');
  setDiagnosticText(
    root,
    '[data-diag-music-load]',
    snapshot.loadSeconds > 0 ? `${snapshot.loadSeconds} с` : '—',
  );
  setDiagnosticText(
    root,
    '[data-diag-music-error]',
    snapshot.lastErrorCode === null ? '—' : String(snapshot.lastErrorCode),
  );
  setDiagnosticText(root, '[data-diag-music-wanted]', snapshot.musicWanted ? 'Так' : 'Ні');
  updateSystemDiagnostics(root);
}

function updateAlertView(
  root: HTMLElement,
  snapshot: AlertPollSnapshot,
  clockWarning: string,
): void {
  const card = root.querySelector<HTMLElement>('[data-alert-card]');
  const title = root.querySelector<HTMLElement>('[data-alert-title]');
  const description = root.querySelector<HTMLElement>('[data-alert-description]');
  const warning = root.querySelector<HTMLElement>('[data-header-warning]');
  if (!card || !title || !description) {
    return;
  }

  const stale = snapshot.stale || snapshot.status === 'stale';
  if (!stale) {
    let stateClass = 'no-data';
    let stateTitle = 'Немає даних';
    let stateDescription = 'Немає даних про тривогу';
    if (snapshot.state.level === 'red') {
      stateClass = 'red';
      stateTitle = 'Червоний рівень (ракети)';
      stateDescription = 'Повітряна тривога у вашому регіоні';
    } else if (snapshot.state.level === 'yellow') {
      stateClass = 'yellow';
      stateTitle = 'Жовтий рівень (дрони)';
      stateDescription = 'Повітряна тривога у вашому регіоні';
    } else if (snapshot.status === 'missing-token') {
      stateDescription = 'Немає даних про тривогу';
    } else if (snapshot.status === 'missing-location') {
      stateDescription = 'Немає даних про тривогу';
    } else if (snapshot.status === 'no-data' && snapshot.statusMessage) {
      stateDescription = snapshot.statusMessage;
    } else if (snapshot.status === 'offline' || snapshot.status === 'retrying') {
      stateTitle = 'Немає зв’язку';
      stateDescription = snapshot.statusMessage;
    } else if (snapshot.status === 'ready' && snapshot.state.level === 'none') {
      stateClass = 'none';
      stateTitle = 'Тихо';
      stateDescription = 'У вашому регіоні тихо';
    }

    card.classList.remove(
      'alert-card--none',
      'alert-card--yellow',
      'alert-card--red',
      'alert-card--no-data',
      'alert-card--stale',
    );
    card.classList.add(`alert-card--${stateClass}`);
    card.setAttribute('aria-label', `Стан тривоги: ${stateTitle}`);
    title.textContent = stateTitle;
    description.textContent = stateDescription;
  }
  if (warning) {
    const warningText = stale ? 'Дані застаріли' : clockWarning;
    warning.textContent = warningText;
    warning.hidden = warningText.length === 0;
    warning.classList.toggle('header-warning--warning', stale || clockWarning.length > 0);
  }
  setDiagnosticText(
    root,
    '[data-diagnostic-status]',
    `Тривога: ${snapshot.state.level || 'не ініціалізовано'}${snapshot.statusMessage ? ` · ${snapshot.statusMessage}` : ''}`,
  );
  setDiagnosticText(root, '[data-diagnostic-time]', formatClockTime(snapshot.checkedAt));
  setDiagnosticText(root, '[data-diag-network]', navigator.onLine ? 'Онлайн' : 'Офлайн');
}

function formatClockTime(date: Date | null): string {
  if (!date) {
    return '--:--:--';
  }
  return `${formatTwoDigits(date.getHours())}:${formatTwoDigits(date.getMinutes())}:${formatTwoDigits(date.getSeconds())}`;
}

function setDiagnosticText(root: HTMLElement, selector: string, value: string): void {
  const element = root.querySelector<HTMLElement>(selector);
  if (element && element.textContent !== value) {
    element.textContent = value;
  }
}

function updateDiagnosticEvents(root: HTMLElement): void {
  const list = root.querySelector<HTMLOListElement>('[data-diagnostic-events]');
  if (!list) {
    return;
  }

  const events = getRecentEvents();
  const signature = events
    .map((event) => `${event.time}|${event.level}|${event.message}`)
    .join('\n');
  if (list.getAttribute('data-event-signature') === signature) {
    return;
  }
  list.setAttribute('data-event-signature', signature);
  while (list.firstChild) {
    list.removeChild(list.firstChild);
  }
  for (const event of events) {
    const item = document.createElement('li');
    const time = document.createElement('time');
    time.textContent = event.time.slice(11, 19);
    const message = document.createElement('span');
    message.textContent = `${event.level}: ${event.message}`;
    item.append(time, message);
    list.appendChild(item);
  }
}

function updateSystemDiagnostics(root: HTMLElement): void {
  const network = navigator.onLine ? 'Онлайн' : 'Офлайн';
  setDiagnosticText(root, '[data-diag-network]', network);
  setDiagnosticText(root, '[data-diag-build]', `${__BUILD_VERSION__} · ${__BUILD_TIME__}`);
  setDiagnosticText(
    root,
    '[data-diag-screen]',
    `${window.screen.width}×${window.screen.height} · ${window.innerWidth}×${window.innerHeight}`,
  );
  setDiagnosticText(root, '[data-diag-user-agent]', navigator.userAgent);
  setDiagnosticText(
    root,
    '[data-about-build]',
    `${__APP_NAME__} · версія ${__BUILD_VERSION__} · збірка ${__BUILD_TIME__}`,
  );

  if (cachedTimeZone === null) {
    cachedTimeZone = 'Недоступний';
    try {
      const resolved = Intl.DateTimeFormat().resolvedOptions();
      if (resolved.timeZone) {
        cachedTimeZone = resolved.timeZone;
      }
    } catch {
      cachedTimeZone = 'Недоступний';
    }
  }
  setDiagnosticText(root, '[data-diag-timezone]', cachedTimeZone);
  updateDiagnosticEvents(root);
}

function diagnosticsPayload(root: HTMLElement, clockSkew: number | null): string {
  const value = (selector: string): string => {
    const element = root.querySelector<HTMLElement>(selector);
    return element ? element.textContent || '' : '';
  };
  const canPlayType = (selector: string, mime: string): string => {
    const audio = root.querySelector<HTMLAudioElement>(selector);
    if (!audio || typeof audio.canPlayType !== 'function') return 'unavailable';
    try {
      return audio.canPlayType(mime) || '(empty)';
    } catch {
      return 'error';
    }
  };
  const audioEventLog = root.querySelector<HTMLElement>('[data-audio-event-log]');

  return redactSensitiveText(
    JSON.stringify(
      {
        network: value('[data-diag-network]'),
        lastSuccessfulPoll: value('[data-diagnostic-time]'),
        apiRequestsPerMinute: value('[data-diag-api-requests]'),
        selectedLocation: value('[data-location-explanation]'),
        alertState: value('[data-diagnostic-status]'),
        audioSource: value('[data-diag-audio-source]'),
        musicState: value('[data-diag-music-state]'),
        timeZone: value('[data-diag-timezone]'),
        clockSkewSeconds: clockSkew,
        buildVersion: __BUILD_VERSION__,
        buildTime: __BUILD_TIME__,
        screen: value('[data-diag-screen]'),
        userAgent: value('[data-diag-user-agent]'),
        audioUnlocked: value('[data-diag-audio-unlocked]'),
        musicCanPlayMp3: canPlayType('#music', 'audio/mpeg'),
        musicCanPlayWav: canPlayType('#music', 'audio/wav'),
        musicReadyState: value('[data-diag-music-ready-state]'),
        musicNetworkState: value('[data-diag-music-network-state]'),
        musicPaused: value('[data-diag-music-paused]'),
        musicCurrentSourceType: value('[data-diag-music-current-src]'),
        musicFileType: value('[data-diag-music-file-type]'),
        musicMime: value('[data-diag-music-mime]'),
        musicFileSize: value('[data-diag-music-file-size]'),
        musicMetadataLatency: value('[data-diag-music-load]'),
        musicErrorCode: value('[data-diag-music-error]'),
        mediaErrorCode: value('[data-diag-music-error-code]'),
        musicFileReport: value('[data-music-file-report]'),
        lastPlayResult: value('[data-diag-last-play-result]'),
        signalCanPlayMp3: canPlayType('#sig', 'audio/mpeg'),
        signalCanPlayWav: canPlayType('#sig', 'audio/wav'),
        signalReadyState: value('[data-diag-sig-ready-state]'),
        signalNetworkState: value('[data-diag-sig-network-state]'),
        signalPaused: value('[data-diag-sig-paused]'),
        signalErrorCode: value('[data-diag-sig-error-code]'),
        signalCurrentSrc: value('[data-diag-sig-current-src]'),
        audioEvents: audioEventLog ? audioEventLog.innerText : '',
        musicWanted: value('[data-diag-music-wanted]'),
        mode: 'legacy-бандл',
        events: getRecentEvents(),
      },
      null,
      2,
    ),
  );
}

async function copyDiagnostics(root: HTMLElement, clockSkew: number | null): Promise<boolean> {
  const text = diagnosticsPayload(root, clockSkew);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // iOS Safari may not expose Clipboard API; use the legacy selection fallback below.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.className = 'copy-buffer';
  root.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  textarea.remove();
  if (!copied) {
    const fallback = root.querySelector<HTMLTextAreaElement>('[data-diagnostic-copy-fallback]');
    const hint = root.querySelector<HTMLElement>('[data-diagnostic-copy-hint]');
    if (fallback) {
      fallback.value = text;
      fallback.hidden = false;
      fallback.focus();
      fallback.select();
    }
    if (hint) hint.hidden = false;
  }
  return copied;
}

function startHeartbeat(): number {
  const key = 'appHeartbeatAt';

  const writeHeartbeat = (): void => {
    try {
      localStorage.setItem(key, String(Date.now()));
    } catch {
      // Heartbeat не повинен зупиняти застосунок без localStorage.
    }
  };
  writeHeartbeat();
  return window.setInterval(writeHeartbeat, 10_000);
}

async function initializeAudio(
  root: HTMLElement,
  tokenImportResult: 'none' | 'saved' | 'failed',
): Promise<void> {
  const musicAudio = root.querySelector<HTMLAudioElement>('#music');
  const signalsAudio = root.querySelector<HTMLAudioElement>('#sig');
  const audioFeedback = root.querySelector<HTMLElement>('[data-audio-feedback]');
  if (!musicAudio || !signalsAudio) {
    logError('Audio markup is missing one of the two audio elements');
    return;
  }

  try {
    const loaded = await Promise.all([
      loadVenueConfig(fetch, (message) => logWarning(message)),
      readJson('./gamarjos.json'),
    ]);
    const config = loaded[0];
    let locationsIndex: LocationIndex | null = null;
    try {
      locationsIndex = await readLocationIndex();
    } catch {
      logWarning('Location directory is unavailable; manual UID fallback is enabled');
    }
    const initialLocationUid = getSelectedLocation();
    const signalNames: AlarmSignal[] = ['yellow', 'red', 'clear'];
    signalNames.forEach((signal) => {
      config.signals[signal] = new URL(config.signals[signal], document.baseURI).toString();
    });
    const greetings = readGreetings(loaded[1]);
    const signalChecks = inspectSignalFiles(root, config.signals);
    const simulationSelect = root.querySelector<HTMLSelectElement>('[data-sim-alert]');
    const musicInput = root.querySelector<HTMLInputElement>('[data-music-files]');
    const musicFileCheckButton = root.querySelector<HTMLButtonElement>('[data-music-file-check]');
    const musicFeedback = root.querySelector<HTMLElement>('[data-music-feedback]');
    const tokenInput = root.querySelector<HTMLInputElement>('[data-alert-token]');
    const tokenField = root.querySelector<HTMLElement>('[data-token-field]');
    const tokenSection = root.querySelector<HTMLElement>('[data-menu-section="token"]');
    const tokenActions = root.querySelector<HTMLElement>('[data-token-actions]');
    const tokenFeedback = root.querySelector<HTMLElement>('[data-token-feedback]');
    const tokenVisibilityButton = root.querySelector<HTMLButtonElement>('[data-token-visibility]');
    const verifyTokenButton = root.querySelector<HTMLButtonElement>('[data-verify-token]');
    const settingsButton = root.querySelector<HTMLButtonElement>('[data-save-settings]');
    const settingsFeedback = root.querySelector<HTMLElement>('[data-settings-feedback]');
    const restartBanner = root.querySelector<HTMLElement>('[data-audio-lock-banner]');
    const lockMessage = root.querySelector<HTMLElement>('[data-audio-lock-message]');
    const unlockButton = root.querySelector<HTMLButtonElement>('[data-audio-unlock]');
    const copyDiagnosticsButton = root.querySelector<HTMLButtonElement>('[data-copy-diagnostics]');
    const wakeFallback = root.querySelector<HTMLDetailsElement>('[data-wake-fallback]');
    const selfTestButton = root.querySelector<HTMLButtonElement>('[data-self-test-run]');
    const scenarioButton = root.querySelector<HTMLButtonElement>('[data-run-scenario]');
    const scenarioResult = root.querySelector<HTMLElement>('[data-scenario-result]');
    const locationError = root.querySelector<HTMLElement>('[data-location-error]');
    const locationManual = root.querySelector<HTMLElement>('[data-location-manual]');
    const manualLocationInput = root.querySelector<HTMLInputElement>('[data-manual-location-uid]');
    const manualLocationFeedback = root.querySelector<HTMLElement>(
      '[data-manual-location-feedback]',
    );
    const retryLocationsButton = root.querySelector<HTMLButtonElement>('[data-retry-locations]');
    const findLocationButton = root.querySelector<HTMLButtonElement>('[data-find-location]');
    const resetLocationButton = root.querySelector<HTMLButtonElement>('[data-reset-location]');
    const musicSyncStartInput = root.querySelector<HTMLInputElement>('[data-music-sync-start]');
    const homeToast = root.querySelector<HTMLElement>('[data-home-toast]');
    const syncNowButton = root.querySelector<HTMLButtonElement>('[data-sync-now]');
    const syncTargetNote = root.querySelector<HTMLElement>('[data-sync-target-note]');
    const timeDialog = root.querySelector<HTMLElement>('[data-time-dialog]');
    const customMusicTime = root.querySelector<HTMLInputElement>('[data-custom-music-time]');
    const customTimeNote = root.querySelector<HTMLElement>('[data-custom-time-note]');
    const customTimeApply = root.querySelector<HTMLButtonElement>('[data-custom-time-apply]');
    const signalDialog = root.querySelector<HTMLElement>('[data-signal-dialog]');
    const signalDialogTitle = root.querySelector<HTMLElement>('[data-signal-dialog-title]');
    const signalConfirmButton = root.querySelector<HTMLButtonElement>('[data-signal-confirm]');
    const stopGreetingButton = root.querySelector<HTMLButtonElement>('[data-stop-greeting]');
    const greetingButton = root.querySelector<HTMLButtonElement>('[data-greeting-button]');
    const manualSignalButtons = root.querySelectorAll<HTMLButtonElement>('[data-manual-signal]');

    const venueTitle = root.querySelector<HTMLElement>('[data-venue-name]');
    const venueTagline = root.querySelector<HTMLElement>('[data-venue-tagline]');
    if (venueTitle) {
      venueTitle.textContent = config.venueName;
    }
    if (venueTagline) venueTagline.textContent = config.tagline || '';
    const heroImagePath =
      config.theme && config.theme.heroImage ? config.theme.heroImage.trim() : '';
    if (heroImagePath) {
      try {
        const heroUrl = new URL(encodeURI(heroImagePath), document.baseURI).toString();
        const heroImage = new Image();
        heroImage.onload = () => {
          document.documentElement.style.setProperty('--hero-image', `url("${heroUrl}")`);
        };
        heroImage.onerror = () => undefined;
        heroImage.src = heroUrl;
      } catch {
        document.documentElement.style.setProperty('--hero-image', 'none');
      }
    }
    const venueLogo = root.querySelector<HTMLImageElement>('[data-venue-logo]');
    if (venueLogo && config.logo.length > 0) {
      venueLogo.src = config.logo;
      venueLogo.alt = config.venueName;
      venueLogo.hidden = false;
      const initials = root.querySelector<HTMLElement>('[data-venue-initials]');
      if (initials) {
        initials.hidden = true;
      }
    }

    const initialToken = getToken(config.proxyUrl);
    if (tokenInput) {
      tokenInput.value = initialToken || '';
    }
    if (tokenFeedback) {
      tokenFeedback.textContent =
        tokenImportResult === 'saved'
          ? 'Токен збережено'
          : tokenImportResult === 'failed'
            ? 'Не вдалося зберегти токен на цьому пристрої'
            : '';
    }
    if (tokenField) {
      tokenField.hidden = config.proxyUrl.trim().length > 0;
    }
    if (tokenActions) {
      tokenActions.hidden = config.proxyUrl.trim().length > 0;
    }
    if (tokenSection) {
      tokenSection.hidden = config.proxyUrl.trim().length > 0;
    }
    if (manualLocationInput && initialLocationUid) {
      manualLocationInput.value = initialLocationUid;
    }
    manualSignalButtons.forEach((button) => {
      button.disabled = !initialLocationUid;
    });

    const getNow = (): Date => new Date();
    let syncStart = getMusicSyncStart(
      config.music && config.music.syncStart ? config.music.syncStart : '11:30',
    );
    if (musicSyncStartInput) musicSyncStartInput.value = syncStart;
    let homeToastTimer: number | null = null;

    const showHomeToast = (message: string): void => {
      if (!homeToast) return;
      homeToast.textContent = message;
      homeToast.hidden = false;
      if (homeToastTimer !== null) window.clearTimeout(homeToastTimer);
      homeToastTimer = window.setTimeout(() => {
        homeToast.hidden = true;
        homeToastTimer = null;
      }, 3600);
    };

    const getSyncTarget = (date: Date) =>
      targetOffset(
        date,
        syncStart,
        config.music && typeof config.music.dayRolloverHour === 'number'
          ? config.music.dayRolloverHour
          : 5,
        Number.isFinite(musicAudio.duration) && musicAudio.duration > 0
          ? musicAudio.duration
          : null,
      );

    const updateSyncDisplay = (): void => {
      const target = getSyncTarget(getNow());
      if (syncTargetNote) {
        syncTargetNote.textContent =
          target.state === 'before-start'
            ? `Відлік з ${syncStart} ще не почався`
            : target.state === 'no-duration'
              ? 'Завантаження тривалості треку…'
              : `${formatMusicClock(getNow())} → ${target.label}`;
      }
      if (syncNowButton) {
        syncNowButton.disabled = target.state !== 'ready';
      }
    };
    updateSyncDisplay();
    const syncDisplayTimer = window.setInterval(updateSyncDisplay, 60_000);
    let requestedSeek: number | null = null;
    const onMusicSeeked = (): void => {
      if (requestedSeek === null) return;
      const requested = requestedSeek;
      requestedSeek = null;
      const actual = Number(musicAudio.currentTime) || 0;
      const difference = Math.abs(actual - requested);
      if (difference > 5) {
        showHomeToast('Позиція неточна');
        setDiagnosticText(
          root,
          '[data-diag-seek-result]',
          `requested=${requested.toFixed(2)}s actual=${actual.toFixed(2)}s diff=${difference.toFixed(2)}s`,
        );
        logWarning(
          `Music seek differs from requested position by ${difference.toFixed(2)} seconds`,
        );
      }
    };
    musicAudio.addEventListener('seeked', onMusicSeeked);

    const seekToOffset = (offsetSec: number): void => {
      requestedSeek = offsetSec;
      showHomeToast('Перемотка…');
      if (!director.seek(offsetSec)) {
        requestedSeek = null;
        showHomeToast('Не вдалося перейти до цієї позиції');
      }
    };

    const syncToTime = (date: Date): void => {
      const target = getSyncTarget(date);
      if (target.state === 'ready') {
        seekToOffset(target.offsetSec);
      } else if (target.state === 'before-start') {
        showHomeToast(`Відлік з ${syncStart} ще не почався`);
      } else {
        showHomeToast('Зачекайте, поки завантажиться тривалість треку');
      }
    };

    function getSimulation(): SimulationResponse | null {
      if (!simulationSelect) {
        return null;
      }
      const selected = simulationSelect.value;
      if (
        selected === 'none' ||
        selected === 'yellow' ||
        selected === 'red' ||
        selected === 'network-error' ||
        selected === 'stale'
      ) {
        return selected;
      }
      return null;
    }

    let clockWarning = '';
    let selectedMusicFile: File | null = null;
    let selectedMusicMime = '';
    const musicFileProgress = root.querySelector<HTMLElement>('[data-music-file-progress]');
    const musicFilePlayer = createMusicFilePlayer({
      memoryCopyLimit: MUSIC_MEMORY_COPY_LIMIT,
      onAttempt: (attempt) => {
        const errorText =
          attempt.errorCode === null ? '—' : `${attempt.errorCode} (${attempt.errorDescription})`;
        const entry = `#music strategy ${attempt.strategy} · ${attempt.size} bytes · type ${attempt.fileType} · MIME ${attempt.mime} · canPlayType ${attempt.canPlayType || '(empty)'} · ${attempt.elapsedMs} ms · error ${errorText} · ready ${attempt.readyState} · network ${attempt.networkState} · preload ${attempt.preload} · play ${attempt.playResult}`;
        appendAudioEvent(root, `${formatClockTime(new Date())} ${entry}`);
        setDiagnosticText(
          root,
          '[data-music-file-report]',
          attempt.playResult === 'OK' || attempt.playResult === 'playing event'
            ? `Стратегія ${attempt.strategy} спрацювала. ${entry}`
            : entry,
        );
      },
      onProgress: (percent) => {
        if (!musicFileProgress) return;
        if (percent < 0) {
          musicFileProgress.hidden = true;
          musicFileProgress.textContent = '';
          return;
        }
        musicFileProgress.textContent = `Підготовка файлу… ${percent}%`;
        musicFileProgress.hidden = false;
      },
      onLegacyFallbackReady: () => showHomeToast('Файл підготовлено для iPhone зі старою iOS'),
      onProbe: (result) => {
        const message = `Зондування: ${result.message}`;
        appendAudioEvent(root, `${formatClockTime(new Date())} ${message}`);
        setDiagnosticText(root, '[data-music-file-report]', message);
      },
    });
    let selectedMusicTrack: { src: string; fileName: string; title: string; size: number } | null =
      null;
    const director = createAudioDirector({
      musicAudio,
      signalsAudio,
      config,
      greetings,
      getNow,
      playLocalMusicFile: (audio, offsetSec, isCurrent) =>
        musicFilePlayer.play(audio, offsetSec, isCurrent),
      onStatus: (snapshot) => {
        updateAudioView(root, snapshot, greetings.length > 0);
        updateSyncDisplay();
        updateMusicDiagnostics(root, musicAudio, selectedMusicFile, selectedMusicMime);
        if (snapshot.musicStatus === 'error' && snapshot.lastErrorMessage) {
          setDiagnosticText(root, '[data-music-file-report]', snapshot.lastErrorMessage);
        }
      },
      onPlayResult: (element, error) => {
        const result =
          error === null
            ? 'OK'
            : error instanceof Error
              ? `${error.name}: ${error.message}`
              : String(error);
        const audio = element === 'music' ? musicAudio : signalsAudio;
        let canPlayMp3 = 'unavailable';
        let canPlayWav = 'unavailable';
        try {
          if (typeof audio.canPlayType === 'function') {
            canPlayMp3 = audio.canPlayType('audio/mpeg') || '(empty)';
            canPlayWav = audio.canPlayType('audio/wav') || '(empty)';
          }
        } catch {
          canPlayMp3 = 'error';
          canPlayWav = 'error';
        }
        const details = `${element}.play(): ${result} · canPlayType audio/mpeg=${canPlayMp3} · audio/wav=${canPlayWav} · ready=${audio.readyState} · network=${audio.networkState} · paused=${audio.paused}`;
        const selector =
          element === 'music' ? '[data-music-play-result]' : '[data-signal-play-result]';
        setDiagnosticText(root, selector, details);
        setDiagnosticText(root, '[data-diag-last-play-result]', details);
        appendAudioEvent(root, `${formatClockTime(new Date())} ${details}`);
      },
      onLog: (message, error) => {
        if (error !== undefined) {
          logError(message, error);
          if (message === 'Audio unlock failed' && audioFeedback) {
            const reason =
              error instanceof Error ? `${error.name}: ${error.message}` : String(error);
            audioFeedback.textContent = `Не вдалося розблокувати звук: ${reason}. Торкніться екрана ще раз.`;
          }
        } else {
          logInfo(message);
        }
      },
    });

    listenForAudioDiagnostics(root, 'music', musicAudio, () =>
      updateMusicDiagnostics(root, musicAudio, selectedMusicFile, selectedMusicMime),
    );
    listenForAudioDiagnostics(root, 'sig', signalsAudio, () =>
      updateSignalDiagnostics(root, signalsAudio),
    );
    updateSignalDiagnostics(root, signalsAudio);

    const musicDiagnosticEvents = [
      'loadstart',
      'loadedmetadata',
      'canplay',
      'playing',
      'waiting',
      'stalled',
      'error',
      'pause',
    ];
    musicDiagnosticEvents.forEach((eventName) => {
      musicAudio.addEventListener(eventName, () =>
        updateMusicDiagnostics(root, musicAudio, selectedMusicFile, selectedMusicMime),
      );
    });
    updateMusicDiagnostics(root, musicAudio, selectedMusicFile, selectedMusicMime);

    const handleMusicFiles = (input: HTMLInputElement): void => {
      const selectedFiles = input.files;
      const file = selectedFiles && selectedFiles.length > 0 ? selectedFiles[0] : null;
      input.value = '';
      if (!file) {
        return;
      }

      if (!isAudioFile(file)) {
        if (musicFeedback) {
          musicFeedback.textContent = 'Цей файл не схожий на аудіо';
        }
        return;
      }

      const mime = getAudioMime(file);
      musicFilePlayer.selectFile(file);
      selectedMusicTrack = {
        src: '',
        fileName: file.name,
        title: file.name,
        size: file.size,
      };
      director.selectTrack(selectedMusicTrack);
      selectedMusicFile = file;
      selectedMusicMime = mime;
      updateMusicDiagnostics(root, musicAudio, selectedMusicFile, selectedMusicMime);
      if (musicFeedback) musicFeedback.textContent = 'Файл доступний до завершення цієї сесії.';
      if (musicFileCheckButton) musicFileCheckButton.disabled = false;
      void musicFilePlayer.probe(file);
      showHomeToast('Музику вибрано');
      const menuCloseButton = root.querySelector<HTMLButtonElement>('[data-menu-close]');
      if (menuCloseButton) menuCloseButton.click();
    };
    if (musicInput) {
      musicInput.addEventListener('change', () => handleMusicFiles(musicInput));
    }
    if (musicFileCheckButton) {
      musicFileCheckButton.addEventListener('click', () => {
        if (!selectedMusicFile) return;
        if (!musicAudio.paused || !signalsAudio.paused) {
          setDiagnosticText(
            root,
            '[data-music-file-report]',
            'Перевірка доступна після завершення відтворення.',
          );
          return;
        }
        musicFileCheckButton.disabled = true;
        const probePromise = musicFilePlayer.probe(selectedMusicFile);
        const checkPromise = musicFilePlayer.check(musicAudio, () => signalsAudio.paused);
        void Promise.all([probePromise, checkPromise])
          .then((results) => {
            const playback = results[1];
            if (playback.success && selectedMusicTrack) {
              selectedMusicTrack.src = playback.src;
              const summary = `Файл відкрився · стратегія ${playback.strategy}. ${results[0].message}`;
              setDiagnosticText(root, '[data-music-file-report]', summary);
              if (musicFeedback)
                musicFeedback.textContent = 'Файл доступний до завершення цієї сесії.';
            } else {
              const message =
                playback.message ||
                (playback.error instanceof Error
                  ? playback.error.message
                  : 'Не вдалося перевірити файл.');
              setDiagnosticText(
                root,
                '[data-music-file-report]',
                `${message} ${results[0].message}`,
              );
              if (musicFeedback) musicFeedback.textContent = message;
            }
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            setDiagnosticText(root, '[data-music-file-report]', `Перевірка файлу: ${message}`);
          })
          .then(() => {
            musicFileCheckButton.disabled = !selectedMusicFile;
          });
      });
    }

    let selectLocationByUid: ((uid: string) => boolean) | null = null;
    const requestLimiter = new AlertRequestLimiter();
    let apiFailureCode: number | null = null;
    let apiRetryUntil = 0;
    let proxyUnavailable = false;
    let latestPollSnapshot: AlertPollSnapshot | null = null;
    const renderApiStatus = (): void => {
      if (!latestPollSnapshot) return;
      const retrySeconds =
        apiRetryUntil > Date.now() ? Math.ceil((apiRetryUntil - Date.now()) / 1000) : 60;
      const presentation = getApiStatusPresentation(
        latestPollSnapshot.status,
        latestPollSnapshot.checkedAt,
        latestPollSnapshot.updatedAt,
        apiFailureCode,
        proxyUnavailable,
        retrySeconds,
      );
      const statusElement = root.querySelector<HTMLElement>('[data-api-status]');
      const statusText = root.querySelector<HTMLElement>('[data-api-status-text]');
      if (statusElement) {
        statusElement.className = `api-status api-status--${presentation.state}`;
        statusElement.setAttribute('aria-label', presentation.text);
      }
      if (statusText) statusText.textContent = presentation.text;
    };
    const selectedLocationView = bindSelectedLocationView(
      root,
      () => locationsIndex,
      getSelectedLocation,
    );
    const poller = createAlertPoller({
      config,
      getToken: () => getToken(config.proxyUrl),
      getSelectedLocation,
      getLocations: () => locationsIndex,
      requestLimiter,
      isOnline: () => navigator.onLine,
      getNow,
      director,
      fetcher: (url, init) => fetch(url, init),
      onlineTarget: window,
      getSimulation,
      onUpdate: (snapshot) => {
        latestPollSnapshot = snapshot;
        if (snapshot.status === 'ready' || snapshot.status === 'stale') {
          apiFailureCode = null;
          apiRetryUntil = 0;
          proxyUnavailable = false;
        } else if (snapshot.status === 'missing-location' || snapshot.status === 'missing-token') {
          apiFailureCode = null;
          apiRetryUntil = 0;
        }
        updateAlertView(root, snapshot, clockWarning);
        selectedLocationView.render();
        renderApiStatus();
        manualSignalButtons.forEach((button) => {
          button.disabled = snapshot.status === 'missing-location';
        });
        setDiagnosticText(
          root,
          '[data-diag-api-requests]',
          String(requestLimiter.getRequestCount()),
        );
      },
      onTransition: (message) => logInfo(message),
      onFailure: (message, error) => {
        const diagnostics = formatAlertApiDiagnostics(error, navigator.onLine);
        logError(`${message} · ${diagnostics}`, error);
        const apiError = error instanceof AlertApiError ? error : null;
        const apiDetails = apiError ? apiError.diagnostics : null;
        setDiagnosticText(root, '[data-diag-api-error-class]', apiError ? apiError.name : '—');
        setDiagnosticText(
          root,
          '[data-diag-api-error-status]',
          !apiDetails || apiDetails.status === null ? '—' : String(apiDetails.status),
        );
        setDiagnosticText(
          root,
          '[data-diag-api-error-content-type]',
          apiDetails && apiDetails.contentType ? apiDetails.contentType : '—',
        );
        setDiagnosticText(
          root,
          '[data-diag-api-error-path]',
          apiDetails && apiDetails.path ? apiDetails.path : '—',
        );
        setDiagnosticText(
          root,
          '[data-diag-api-error-body]',
          apiDetails && apiDetails.bodyPreview ? apiDetails.bodyPreview : '—',
        );
        setDiagnosticText(root, '[data-diag-api-error-message]', message);
        if (error instanceof AlertHttpError) {
          apiFailureCode = error.status;
          apiRetryUntil = error.retryAfterMs ? Date.now() + error.retryAfterMs : 0;
        } else if (error && typeof error === 'object' && 'retryAfterMs' in error) {
          apiFailureCode = 429;
          apiRetryUntil = Date.now() + Number(error.retryAfterMs || 60_000);
        }
        if (
          config.proxyUrl.trim().length > 0 &&
          error instanceof AlertHttpError &&
          error.status === 404
        ) {
          proxyUnavailable = true;
          if (tokenFeedback) tokenFeedback.textContent = 'Проксі недоступний. Запустіть npm start.';
        }
      },
    });
    const apiStatusTimer = window.setInterval(renderApiStatus, 1000);
    const locationChangedHandler: EventListener = () => {
      manualSignalButtons.forEach((button) => {
        button.disabled = !getSelectedLocation();
      });
      poller.locationChanged();
    };
    window.addEventListener('locationchanged', locationChangedHandler);

    const installLocationIndex = (index: LocationIndex, selectedUid: string | null): void => {
      locationsIndex = index;
      selectedLocationView.render();
      if (locationError) locationError.hidden = true;
      if (locationManual) locationManual.hidden = true;
      selectLocationByUid = setupLocationSelection(root, index, selectedUid, (uid) => {
        saveSelectedLocation(uid || '');
      });
    };

    if (locationsIndex) {
      installLocationIndex(locationsIndex, initialLocationUid);
    } else {
      if (locationError) locationError.hidden = false;
      if (locationManual) locationManual.hidden = false;
      const oblastSelect = root.querySelector<HTMLSelectElement>('[data-location-oblast]');
      if (oblastSelect) {
        oblastSelect.disabled = true;
        oblastSelect.options[0].textContent = 'Довідник локацій не завантажено';
      }
    }

    if (resetLocationButton) {
      resetLocationButton.addEventListener('click', () => {
        if (selectLocationByUid) selectLocationByUid('');
        else saveSelectedLocation('');
      });
    }
    if (!initialLocationUid) {
      root.dispatchEvent(new CustomEvent('menu-open', { detail: 'city' }));
    }

    const reloadLocationIndex = async (): Promise<void> => {
      if (retryLocationsButton) retryLocationsButton.disabled = true;
      try {
        const index = await readLocationIndex();
        const preferredUid = getSelectedLocation();
        installLocationIndex(index, preferredUid);
        if (manualLocationFeedback) manualLocationFeedback.textContent = '';
      } catch (error) {
        logError('Unable to reload location directory', error);
        if (manualLocationFeedback) {
          manualLocationFeedback.textContent =
            'Довідник не завантажено. Перевірте мережу та повторіть спробу.';
        }
      } finally {
        if (retryLocationsButton) retryLocationsButton.disabled = false;
      }
    };
    if (retryLocationsButton) {
      retryLocationsButton.addEventListener('click', () => {
        void reloadLocationIndex();
      });
    }
    if (findLocationButton && manualLocationInput) {
      findLocationButton.addEventListener('click', () => {
        const uid = manualLocationInput.value.trim();
        if (!/^\d+$/.test(uid)) {
          if (manualLocationFeedback) manualLocationFeedback.textContent = 'Введіть числовий UID';
          return;
        }
        if (locationsIndex && selectLocationByUid) {
          if (selectLocationByUid(uid)) {
            if (manualLocationFeedback)
              manualLocationFeedback.textContent = 'Місце знайдено в довіднику';
          } else if (manualLocationFeedback) {
            manualLocationFeedback.textContent = 'UID відсутній у довіднику';
          }
          return;
        }
        locationsIndex = manualLocationIndex(uid);
        saveSelectedLocation(uid);
        if (manualLocationFeedback) {
          manualLocationFeedback.textContent = `Використовується UID ${uid} без довідника; доступне лише точне зіставлення.`;
        }
      });
    }

    if (musicSyncStartInput) {
      musicSyncStartInput.addEventListener('change', () => {
        if (!saveMusicSyncStart(musicSyncStartInput.value)) {
          musicSyncStartInput.value = syncStart;
          return;
        }
        syncStart = musicSyncStartInput.value;
        updateSyncDisplay();
      });
    }
    if (syncNowButton) {
      syncNowButton.addEventListener('click', () => syncToTime(getNow()));
    }
    const customTimeOpen = root.querySelector<HTMLButtonElement>('[data-custom-time-open]');
    const customTimeCancel = root.querySelector<HTMLButtonElement>('[data-custom-time-cancel]');
    const customTimeBackdrop = timeDialog;
    const updateCustomTimeNote = (): void => {
      if (!customMusicTime || !customTimeNote) return;
      const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(customMusicTime.value);
      if (!match) {
        customTimeNote.textContent = 'Вкажіть коректний час';
        if (customTimeApply) customTimeApply.disabled = true;
        return;
      }
      const targetDate = new Date();
      targetDate.setHours(Number(match[1]), Number(match[2]), 0, 0);
      const target = getSyncTarget(targetDate);
      customTimeNote.textContent =
        target.state === 'before-start'
          ? `Відлік з ${syncStart} ще не почався`
          : target.state === 'no-duration'
            ? 'Позиція буде доступна після завантаження тривалості'
            : `${customMusicTime.value} → ${target.label}`;
      if (customTimeApply) customTimeApply.disabled = target.state !== 'ready';
    };
    if (customTimeOpen && timeDialog) {
      customTimeOpen.addEventListener('click', () => {
        timeDialog.hidden = false;
        updateCustomTimeNote();
        if (customMusicTime) customMusicTime.focus();
      });
    }
    if (customMusicTime) customMusicTime.addEventListener('input', updateCustomTimeNote);
    const closeTimeDialog = (): void => {
      if (timeDialog) timeDialog.hidden = true;
    };
    if (customTimeCancel) customTimeCancel.addEventListener('click', closeTimeDialog);
    if (customTimeBackdrop) {
      customTimeBackdrop.addEventListener('click', (event) => {
        if (event.target === customTimeBackdrop) closeTimeDialog();
      });
    }
    if (customTimeApply && customMusicTime) {
      customTimeApply.addEventListener('click', () => {
        const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(customMusicTime.value);
        if (!match) return;
        const targetDate = new Date();
        targetDate.setHours(Number(match[1]), Number(match[2]), 0, 0);
        const target = getSyncTarget(targetDate);
        if (target.state === 'ready') {
          seekToOffset(target.offsetSec);
          closeTimeDialog();
        }
      });
    }

    let pendingManualSignal: AlarmSignal | null = null;
    const manualSignalLabels: Record<AlarmSignal, string> = {
      yellow: 'Жовтий',
      red: 'Червоний',
      clear: 'Відбій',
    };
    const closeSignalDialog = (): void => {
      if (signalDialog) signalDialog.hidden = true;
      pendingManualSignal = null;
    };
    manualSignalButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const signal = button.getAttribute('data-manual-signal');
        if (signal !== 'yellow' && signal !== 'red' && signal !== 'clear') return;
        pendingManualSignal = signal;
        if (signalDialogTitle)
          signalDialogTitle.textContent = `Увімкнути ${manualSignalLabels[signal].toLowerCase()} сигнал?`;
        if (signalDialog) signalDialog.hidden = false;
      });
    });
    const signalCancelButton = root.querySelector<HTMLButtonElement>('[data-signal-cancel]');
    if (signalCancelButton) signalCancelButton.addEventListener('click', closeSignalDialog);
    if (signalDialog) {
      signalDialog.addEventListener('click', (event) => {
        if (event.target === signalDialog) closeSignalDialog();
      });
    }
    if (signalConfirmButton) {
      signalConfirmButton.addEventListener('click', () => {
        const signal = pendingManualSignal;
        closeSignalDialog();
        if (!signal) return;
        logInfo(`Ручний сигнал: ${manualSignalLabels[signal]}`);
        const playback = director.playAlarm(signal);
        void playback.then((played) => {
          if (played) completeDirectUnlock();
          else showHomeToast('Не вдалося відтворити, торкніться ще раз');
        });
      });
    }
    if (stopGreetingButton)
      stopGreetingButton.addEventListener('click', () => director.stopGreeting());
    if (greetingButton) {
      greetingButton.addEventListener('click', () => {
        const playback = director.playGreeting();
        void playback.then((played) => {
          if (played) completeDirectUnlock();
          else showHomeToast('Не вдалося відтворити, торкніться ще раз');
        });
      });
    }

    let appStarted = false;
    let clockTimer: number | null = null;
    let copyFeedbackTimer: number | null = null;
    let latestClockSkew: number | null = null;
    function updateAudioLockBanner(unlocked: boolean): void {
      if (!restartBanner || !lockMessage) {
        return;
      }

      restartBanner.hidden = unlocked;
      if (unlockButton) {
        unlockButton.disabled = false;
      }
      if (!unlocked) {
        lockMessage.textContent = 'Натисніть кнопку, щоб увімкнути звук сигналів.';
      }
    }

    const showAudioUnlockPrompt = (): void => {
      if (restartBanner && lockMessage) {
        restartBanner.hidden = false;
        lockMessage.textContent = 'Натисніть кнопку, щоб увімкнути звук сигналів.';
      }
    };

    const startRuntime = (): void => {
      if (appStarted) {
        return;
      }
      appStarted = true;
      poller.start();
      startClockCheck();
      wakeLockController.start();
      updateAudioLockBanner(false);
    };

    let unlockListenersBound = false;
    let unlockInProgress = false;
    let globalUnlockHandler: ((event: Event) => void) | null = null;
    const attachGlobalUnlock = (): void => {
      if (unlockListenersBound) {
        return;
      }

      const onFirstTouch = (event: Event): void => {
        if (isDirectAudioActionTarget(event.target, root)) {
          return;
        }
        if (director.isAudioUnlocked()) {
          document.removeEventListener('touchend', onFirstTouch, true);
          document.removeEventListener('click', onFirstTouch, true);
          globalUnlockHandler = null;
          unlockListenersBound = false;
          return;
        }
        if (unlockInProgress) {
          return;
        }
        unlockInProgress = true;
        void director
          .start()
          .then((unlocked) => {
            if (unlocked) {
              document.removeEventListener('touchend', onFirstTouch, true);
              document.removeEventListener('click', onFirstTouch, true);
              unlockListenersBound = false;
              globalUnlockHandler = null;
              updateAudioLockBanner(true);
              if (audioFeedback) {
                audioFeedback.textContent = '';
              }
            } else {
              updateAudioLockBanner(false);
            }
          })
          .catch((error: unknown) => {
            const reason =
              error instanceof Error ? `${error.name}: ${error.message}` : String(error);
            if (audioFeedback) {
              audioFeedback.textContent = `Не вдалося розблокувати звук: ${reason}. Торкніться екрана ще раз.`;
            }
          })
          .then(() => {
            unlockInProgress = false;
          });
      };

      document.addEventListener('touchend', onFirstTouch, { capture: true, passive: true });
      document.addEventListener('click', onFirstTouch, { capture: true, passive: true });
      globalUnlockHandler = onFirstTouch;
      unlockListenersBound = true;
    };

    const completeDirectUnlock = (): void => {
      if (!director.isAudioUnlocked()) {
        return;
      }
      if (globalUnlockHandler) {
        document.removeEventListener('touchend', globalUnlockHandler, true);
        document.removeEventListener('click', globalUnlockHandler, true);
      }
      globalUnlockHandler = null;
      unlockListenersBound = false;
      updateAudioLockBanner(true);
      if (audioFeedback) {
        audioFeedback.textContent = '';
      }
    };

    if (unlockButton) {
      unlockButton.addEventListener('click', () => {
        unlockButton.disabled = true;
        void director.start().then((unlocked) => {
          unlockButton.disabled = false;
          updateAudioLockBanner(unlocked);
          if (unlocked) {
            completeDirectUnlock();
          }
          if (!unlocked && audioFeedback) {
            audioFeedback.textContent = 'Не вдалося увімкнути звук. Натисніть кнопку ще раз.';
          }
        });
      });
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        showAudioUnlockPrompt();
      }
    });

    const wakeLockController = createWakeLockController({
      navigator: navigator as unknown as WakeLockNavigatorLike,
      document,
      onFallback: () => {
        let alreadyShown = false;
        try {
          alreadyShown = localStorage.getItem('wakeLockHintShown') === '1';
          localStorage.setItem('wakeLockHintShown', '1');
        } catch {
          alreadyShown = false;
        }
        if (wakeFallback && !alreadyShown) {
          wakeFallback.hidden = false;
          wakeFallback.open = true;
        }
        logWarning('Wake Lock is unavailable; screen may auto-lock');
      },
      onEvent: (message) => logInfo(message),
    });

    const checkDeviceClock = async (): Promise<void> => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch('./venue.json', {
          method: 'HEAD',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const serverDate = response.headers.get('Date');
        const skew = serverDate ? clockSkewSeconds(serverDate, new Date()) : null;
        latestClockSkew = skew;
        if (skew !== null && Math.abs(skew) > 5) {
          clockWarning = `Годинник пристрою відхиляється на ${Math.abs(skew)} с. Увімкніть автоматичну дату й час`;
          const clockDiagnostic = root.querySelector<HTMLElement>('[data-clock-diagnostic]');
          if (clockDiagnostic) {
            clockDiagnostic.textContent = clockWarning;
          }
        } else {
          clockWarning = '';
          const clockDiagnostic = root.querySelector<HTMLElement>('[data-clock-diagnostic]');
          if (clockDiagnostic) {
            clockDiagnostic.textContent =
              skew === null ? 'Заголовок Date відсутній' : 'Час збігається';
          }
        }
        updateAlertView(root, poller.getSnapshot(), clockWarning);
      } catch (error) {
        logError('Clock synchronization failed', error);
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    const startClockCheck = (): void => {
      if (clockTimer !== null) {
        return;
      }
      void checkDeviceClock();
      clockTimer = window.setInterval(
        () => {
          void checkDeviceClock();
        },
        10 * 60 * 1000,
      );
    };

    const setSelfTestResult = (key: string, value: string): void => {
      setDiagnosticText(root, `[data-self-test-${key}]`, value);
    };

    const runSelfTest = async (soundCheck: Promise<boolean>): Promise<void> => {
      if (selfTestButton) {
        selfTestButton.disabled = true;
      }
      const userAgent = navigator.userAgent;
      setSelfTestResult(
        'browser',
        /iPhone|iPad|iPod/i.test(userAgent) ? 'OK: iOS/iPhone detected' : 'OK: браузер доступний',
      );
      const configOk =
        config.venueName.length > 0 &&
        ['yellow', 'red', 'clear'].every((name) => {
          const url = config.signals[name as AlarmSignal];
          return url.length > 0 && /^https?:/.test(url);
        });
      setSelfTestResult('config', configOk ? 'OK' : 'Перевірте venue.json');

      try {
        const files = await signalChecks;
        const allFilesAvailable =
          files.length === 3 && files.every((item) => /^2\d\d$/.test(item.status));
        setSelfTestResult(
          'files',
          allFilesAvailable ? 'OK: 3 сигнали доступні' : 'Помилка доступу до файлів сигналів',
        );
      } catch {
        setSelfTestResult('files', 'Помилка перевірки файлів сигналів');
      }

      try {
        const played = await soundCheck;
        setSelfTestResult('sound', played ? 'OK' : 'Не вдалося відтворити тестовий звук');
        if (played) {
          completeDirectUnlock();
        }
      } catch (error) {
        setSelfTestResult(
          'sound',
          error instanceof Error ? `${error.name}: ${error.message}` : 'Помилка звуку',
        );
      }
      setSelfTestResult(
        'music',
        selectedMusicFile ? `OK: ${selectedMusicFile.name}` : 'Файл не вибрано',
      );

      const selectedUid = getSelectedLocation();
      setSelfTestResult('location', formatSelectedLocationDiagnostic(selectedUid, locationsIndex));
      const responseAlerts: AlertRecord[] = [];
      let responseKeys = '—';
      if (!selectedUid) {
        setSelfTestResult('api', 'Запит не виконано: локацію не обрано');
      } else {
        try {
          const response = await fetchActiveAlerts(
            config,
            getToken(config.proxyUrl),
            (url, init) => fetch(url, init),
            8000,
            requestLimiter,
          );
          responseAlerts.push(...response.alerts);
          responseKeys = Object.keys(response).sort().join(', ');
          const updatedValue = response.meta && response.meta.last_updated_at;
          const updatedAt =
            typeof updatedValue === 'string' ? parseApiTimestamp(updatedValue) : null;
          const stale = isStale(updatedAt, new Date(), 180);
          setSelfTestResult(
            'api',
            stale ? 'Дані застарілі' : `OK: ${response.alerts.length} тривог`,
          );
        } catch (error) {
          const failure = getAlertApiFailureMessage(error, navigator.onLine);
          const diagnostics = formatAlertApiDiagnostics(error, navigator.onLine);
          setSelfTestResult('api', `${failure} ${diagnostics}`);
        }
      }
      setSelfTestResult('api-shape', responseKeys);
      const alertDiagnostics = root.querySelector<HTMLElement>('[data-self-test-alerts]');
      const inspections =
        selectedUid && locationsIndex
          ? inspectAlertLocations(responseAlerts, selectedUid, locationsIndex)
          : [];
      if (alertDiagnostics) {
        alertDiagnostics.textContent = inspections.length
          ? inspections
              .map((item) => {
                const title = item.alert.location_title || item.alert.location_uid || 'Без назви';
                const uid =
                  item.alert.location_uid === undefined ? '' : ` [UID ${item.alert.location_uid}]`;
                return `${item.isOurs ? 'НАША' : 'не наша'}: ${title}${uid}. ${item.reason}`;
              })
              .join('\n')
          : 'Немає активних подій у вибраній області або API ще не відповіло.';
      }
      setSelfTestResult(
        'filter',
        selectedUid
          ? `UID-based; опрацьовано: ${inspections.length} подій області`
          : 'Локацію не обрано',
      );

      await checkDeviceClock();
      const clockDiagnostic = root.querySelector<HTMLElement>('[data-clock-diagnostic]');
      const clockText = clockDiagnostic ? clockDiagnostic.textContent || '' : '';
      setSelfTestResult(
        'clock',
        clockText === 'Час збігається' ? 'OK' : clockText || 'Не вдалося перевірити',
      );

      const summaryValues = [
        'browser',
        'config',
        'files',
        'sound',
        'music',
        'api',
        'filter',
        'clock',
      ];
      const passed = summaryValues.every((key) => {
        const row = root.querySelector<HTMLElement>(`[data-self-test-${key}]`);
        return Boolean(row && row.textContent && row.textContent.indexOf('OK') === 0);
      });
      setSelfTestResult(
        'summary',
        passed
          ? 'Усі обов’язкові перевірки пройдено'
          : 'Є перевірки з помилками або застереженнями',
      );
      if (selfTestButton) {
        selfTestButton.disabled = false;
      }
    };

    if (selfTestButton) {
      selfTestButton.addEventListener('click', () => {
        const soundCheck = director.playTestTone();
        void runSelfTest(soundCheck).catch((error: unknown) => {
          logError('Self-test failed', error);
          setSelfTestResult('summary', 'Самотест перервано через помилку');
          selfTestButton.disabled = false;
        });
      });
    }

    if (scenarioButton && simulationSelect) {
      scenarioButton.addEventListener('click', () => {
        const soundCheck = director.playTestTone();
        scenarioButton.disabled = true;
        if (scenarioResult) {
          scenarioResult.textContent = 'Сценарій виконується…';
        }
        void (async () => {
          await soundCheck;
          const applyMode = async (mode: SimulationResponse): Promise<void> => {
            simulationSelect.value = mode;
            await poller.pollNow();
          };
          await applyMode('none');
          await applyMode('none');
          await applyMode('yellow');
          await applyMode('red');
          const greetingPlayed = await director.playGreeting();
          await applyMode('none');
          await applyMode('none');
          if (scenarioResult) {
            scenarioResult.textContent = greetingPlayed
              ? 'Завершено: none → yellow → red → none; Гамарджос запущено під час red'
              : 'Завершено зі сценарієм тривог; для перевірки Гамарджос додайте файл у public/gamarjos';
          }
        })()
          .catch((error: unknown) => {
            const message =
              error instanceof Error ? redactSensitiveText(error.message) : 'Помилка сценарію';
            if (scenarioResult) {
              scenarioResult.textContent = message;
            }
            logError('Simulation scenario failed', error);
          })
          .then(() => {
            scenarioButton.disabled = false;
          });
      });
    }

    attachGlobalUnlock();
    startRuntime();

    if (tokenVisibilityButton && tokenInput) {
      tokenVisibilityButton.addEventListener('click', () => {
        const visible = tokenInput.type === 'password';
        tokenInput.type = visible ? 'text' : 'password';
        tokenVisibilityButton.textContent = visible ? 'Сховати' : 'Показати';
        tokenVisibilityButton.setAttribute('aria-pressed', String(visible));
      });
    }

    if (settingsButton) {
      settingsButton.addEventListener('click', () => {
        const nextToken = tokenInput ? tokenInput.value : '';
        if (!saveAlertsToken(nextToken)) {
          if (tokenFeedback) {
            tokenFeedback.textContent = 'Не вдалося зберегти токен на цьому пристрої';
          }
          return;
        }
        if (settingsFeedback) {
          settingsFeedback.textContent = getToken(config.proxyUrl)
            ? 'Налаштування збережено'
            : 'Введіть токен';
        }
        if (tokenFeedback && getToken(config.proxyUrl)) {
          tokenFeedback.textContent = 'Токен збережено на цьому пристрої';
        }
        void poller.pollNow();
      });
    }

    if (verifyTokenButton) {
      verifyTokenButton.addEventListener('click', async () => {
        verifyTokenButton.disabled = true;
        if (tokenFeedback) {
          tokenFeedback.textContent = 'Перевіряємо…';
        }
        try {
          if (!getSelectedLocation()) {
            if (tokenFeedback) tokenFeedback.textContent = 'Спочатку оберіть місце';
            return;
          }
          const response = await fetchActiveAlerts(
            config,
            getToken(config.proxyUrl),
            (url, init) => fetch(url, init),
            8000,
            requestLimiter,
          );
          if (tokenFeedback) {
            tokenFeedback.textContent = `OK: ${response.alerts.length} тривог`;
          }
        } catch (error) {
          if (tokenFeedback) {
            tokenFeedback.textContent = `${getAlertApiFailureMessage(error, navigator.onLine)} ${formatAlertApiDiagnostics(error, navigator.onLine)}`;
          }
        } finally {
          verifyTokenButton.disabled = false;
        }
      });
    }

    if (copyDiagnosticsButton) {
      copyDiagnosticsButton.addEventListener('click', async () => {
        copyDiagnosticsButton.disabled = true;
        const copied = await copyDiagnostics(root, latestClockSkew);
        copyDiagnosticsButton.disabled = false;
        copyDiagnosticsButton.textContent = copied
          ? 'Діагностику скопійовано'
          : 'Не вдалося скопіювати';
        if (copyFeedbackTimer !== null) {
          window.clearTimeout(copyFeedbackTimer);
        }
        copyFeedbackTimer = window.setTimeout(() => {
          copyDiagnosticsButton.textContent = 'Копіювати діагностику';
          copyFeedbackTimer = null;
        }, 2000);
      });
    }

    const musicButton = root.querySelector<HTMLButtonElement>('[data-music-toggle]');
    const seekInput = root.querySelector<HTMLInputElement>('[data-music-seek]');

    if (musicButton) {
      musicButton.addEventListener('click', () => {
        const musicLabel = musicButton.querySelector<HTMLElement>('[data-music-label]');
        if (musicLabel && musicLabel.textContent === 'Пауза') {
          director.pauseMusic();
          return;
        }
        void director
          .playMusic()
          .then((played) => {
            if (played) {
              completeDirectUnlock();
            } else {
              showHomeToast('Не вдалося відтворити, торкніться ще раз');
            }
          })
          .catch((error: unknown) => {
            const message =
              error instanceof Error ? `${error.name}: ${error.message}` : String(error);
            if (musicFeedback) {
              musicFeedback.textContent = message;
            }
            showHomeToast('Не вдалося відтворити, торкніться ще раз');
            logError('Music playback failed', error);
          });
      });
    }

    if (seekInput) {
      seekInput.addEventListener('input', () => {
        director.seek(Number(seekInput.value));
      });
    }

    window.addEventListener('pagehide', (event: PageTransitionEvent) => {
      if (event.persisted) {
        return;
      }
      director.destroy();
      window.clearInterval(syncDisplayTimer);
      musicAudio.removeEventListener('seeked', onMusicSeeked);
      if (homeToastTimer !== null) {
        window.clearTimeout(homeToastTimer);
        homeToastTimer = null;
      }
      musicFilePlayer.destroy(musicAudio);
      poller.stop();
      selectedLocationView.destroy();
      window.removeEventListener('locationchanged', locationChangedHandler);
      window.clearInterval(apiStatusTimer);
      wakeLockController.destroy();
      if (clockTimer !== null) {
        window.clearInterval(clockTimer);
        clockTimer = null;
      }
      if (copyFeedbackTimer !== null) {
        window.clearTimeout(copyFeedbackTimer);
        copyFeedbackTimer = null;
      }
    });

    root.addEventListener('alerts-simulation-change', () => {
      void poller.pollNow();
    });
  } catch (error) {
    logError('Audio initialization failed', error);
    if (audioFeedback) {
      audioFeedback.textContent = 'Не вдалося завантажити конфігурацію звуку.';
    }
  }
}

const appRoot = document.getElementById('app');
if (appRoot) {
  const tokenImportResult = importTokenFromHash(window.location.hash, saveAlertsToken, () => {
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}`,
    );
  });
  installGlobalErrorHandlers(window);
  renderView(appRoot);
  updateSystemDiagnostics(appRoot);
  startHeartbeat();
  void initializeAudio(appRoot, tokenImportResult);
}
