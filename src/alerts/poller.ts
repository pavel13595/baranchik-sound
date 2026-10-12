import {
  inspectAlertLocations,
  levelFor,
  type AlertLocationInspection,
  type AlertRecord,
} from '../alerts';
import type { LocationIndex } from '../types';
import {
  AlertHttpError,
  AlertRequestLimitError,
  AlertRequestLimiter,
  getAlertApiFailureMessage,
  fetchActiveAlerts,
  InvalidAlertResponseError,
  MissingAlertsTokenError,
  type ActiveAlertsResponse,
  type AlertFetcher,
} from './api';
import { isStale, parseApiTimestamp } from '../diagnostics';
import { reduce, createInitialState, type AlertMachineState } from '../state';
import type { AlertLevel, VenueConfig } from '../types';

export type SimulationResponse = 'none' | 'yellow' | 'red' | 'network-error' | 'stale';
export type PollStatus =
  | 'ready'
  | 'stale'
  | 'missing-token'
  | 'missing-location'
  | 'retrying'
  | 'offline'
  | 'no-data';

export interface AlertPollSnapshot {
  state: AlertMachineState;
  status: PollStatus;
  statusMessage: string;
  stale: boolean;
  checkedAt: Date | null;
  updatedAt: Date | null;
  consecutiveFailures: number;
}

export interface AlertPollDiagnostic {
  alerts: AlertLocationInspection[];
  alertCount: number;
  level: AlertLevel;
  checkedAt: Date;
  stale: boolean;
}

export interface AlarmQueue {
  enqueueAlarm(signal: 'yellow' | 'red' | 'clear'): Promise<boolean> | boolean;
}

export class MissingAlertLocationError extends Error {
  constructor() {
    super('Оберіть місто в налаштуваннях');
    this.name = 'MissingAlertLocationError';
  }
}

export interface OnlineEventTarget {
  addEventListener(type: 'online', listener: EventListener): void;
  removeEventListener(type: 'online', listener: EventListener): void;
}

export interface AlertPollerOptions {
  config: VenueConfig;
  getToken: () => string | null;
  getSelectedLocation: () => string | null;
  getLocations: () => LocationIndex | null;
  requestLimiter?: AlertRequestLimiter;
  isOnline?: () => boolean;
  getNow: () => Date;
  director: AlarmQueue;
  fetcher: AlertFetcher;
  onlineTarget?: OnlineEventTarget;
  getSimulation?: () => SimulationResponse | null;
  onUpdate: (snapshot: AlertPollSnapshot) => void;
  onTransition?: (message: string) => void;
  onDiagnostic?: (diagnostic: AlertPollDiagnostic) => void;
  onFailure?: (message: string, error: unknown) => void;
}

export interface AlertPoller {
  start(): void;
  stop(): void;
  pollNow(): Promise<void>;
  diagnose(): Promise<AlertPollDiagnostic>;
  locationChanged(): void;
  getSnapshot(): AlertPollSnapshot;
}

function simulationAlerts(
  mode: SimulationResponse,
  locations: LocationIndex | null,
  locationUid: string | null,
): AlertRecord[] {
  if (mode === 'none') {
    return [];
  }
  if (mode === 'network-error') {
    throw new TypeError('Simulated network error');
  }

  if (!locationUid || !locations || !locations.byUid[String(locationUid)]) {
    throw new MissingAlertLocationError();
  }
  const location = locations.byUid[String(locationUid)];
  return [
    {
      location_title: location.name,
      location_type: location.type,
      location_uid: location.uid,
      location_oblast_uid: location.oblastUid,
      alert_type: 'air_raid',
      alert_level: mode === 'red' ? 'red' : 'yellow',
    },
  ];
}

function simulationResponse(
  mode: SimulationResponse,
  config: VenueConfig,
  now: Date,
  locations: LocationIndex | null,
  locationUid: string | null,
): ActiveAlertsResponse {
  const alerts = simulationAlerts(mode, locations, locationUid);
  const lastUpdated =
    mode === 'stale' ? new Date(now.getTime() - (config.staleAfterSec + 1) * 1000) : now;
  return {
    alerts,
    meta: { last_updated_at: lastUpdated.toISOString() },
  };
}

function formatTime(date: Date): string {
  const twoDigits = (value: number): string => (value < 10 ? `0${value}` : String(value));
  return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}:${twoDigits(date.getSeconds())}`;
}

export function createAlertPoller(options: AlertPollerOptions): AlertPoller {
  let state = createInitialState();
  let status: PollStatus = 'ready';
  let statusMessage = '';
  let stale = false;
  let checkedAt: Date | null = null;
  let updatedAt: Date | null = null;
  let consecutiveFailures = 0;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let started = false;
  let nextDelayMs = Math.max(10, options.config.pollIntervalSec) * 1000;
  let authBlockedKey: string | null = null;
  let lastSuccessAt: Date | null = null;
  const requestLimiter = options.requestLimiter || new AlertRequestLimiter();
  let pollInFlight = false;
  let pollAgain = false;

  function getSnapshot(): AlertPollSnapshot {
    return {
      state,
      status,
      statusMessage,
      stale,
      checkedAt,
      updatedAt,
      consecutiveFailures,
    };
  }

  function publish(): void {
    try {
      options.onUpdate(getSnapshot());
    } catch (error) {
      if (options.onFailure) {
        options.onFailure('Alert UI update failed', error);
      }
    }
  }

  function authKey(): string {
    return `${options.config.proxyUrl.trim()}|${options.getToken() || ''}`;
  }

  function scheduleNext(delayMs = nextDelayMs): void {
    if (!started || authBlockedKey !== null) return;
    if (timerId !== null) clearTimeout(timerId);
    timerId = setTimeout(() => {
      timerId = null;
      void pollNow();
    }, delayMs);
  }

  function requestData(): Promise<ActiveAlertsResponse> {
    const simulation = options.getSimulation ? options.getSimulation() : null;
    if (simulation) {
      if (simulation === 'network-error') {
        return Promise.reject(new TypeError('Simulated network error'));
      }
      return Promise.resolve(
        simulationResponse(
          simulation,
          options.config,
          options.getNow(),
          options.getLocations(),
          options.getSelectedLocation(),
        ),
      );
    }
    return fetchActiveAlerts(
      options.config,
      options.getToken(),
      options.fetcher,
      8000,
      requestLimiter,
    );
  }

  function setFailure(error: unknown): void {
    checkedAt = options.getNow();
    stale = lastSuccessAt !== null && checkedAt.getTime() - lastSuccessAt.getTime() > 180_000;
    if (error instanceof MissingAlertsTokenError) {
      status = 'missing-token';
      statusMessage = 'Вставте токен';
      publish();
      return;
    }
    if (error instanceof MissingAlertLocationError) {
      status = 'missing-location';
      statusMessage = 'Оберіть місто в налаштуваннях';
      publish();
      return;
    }

    if (error instanceof InvalidAlertResponseError) {
      status = 'no-data';
      statusMessage = getAlertApiFailureMessage(
        error,
        options.isOnline ? options.isOnline() : true,
      );
      if (options.onFailure) {
        options.onFailure(statusMessage, error);
      }
      publish();
      return;
    }

    consecutiveFailures += 1;
    if (error instanceof AlertHttpError && error.status === 401) {
      authBlockedKey = authKey();
    }
    if (error instanceof AlertHttpError && error.status === 429) {
      nextDelayMs = error.retryAfterMs || 60_000;
      requestLimiter.defer(nextDelayMs);
    } else if (error instanceof AlertRequestLimitError) {
      nextDelayMs = error.retryAfterMs;
    } else if (error instanceof TypeError && options.isOnline && options.isOnline()) {
      nextDelayMs = 60_000;
      requestLimiter.defer(nextDelayMs);
    } else {
      nextDelayMs = Math.min(
        60_000,
        Math.max(10, options.config.pollIntervalSec) * 1000 * Math.pow(2, consecutiveFailures),
      );
    }
    const hint = getAlertApiFailureMessage(error, options.isOnline ? options.isOnline() : true);
    status = consecutiveFailures >= 3 ? 'offline' : 'retrying';
    statusMessage = consecutiveFailures >= 3 ? `Немає зв’язку. ${hint}` : hint;
    if (options.onFailure) {
      options.onFailure(statusMessage, error);
    }
    publish();
  }

  async function processResponse(response: ActiveAlertsResponse): Promise<void> {
    const now = options.getNow();
    if (response.notModified) {
      if (lastSuccessAt === null) {
        setFailure(new InvalidAlertResponseError());
        return;
      }
      checkedAt = now;
      updatedAt = now;
      lastSuccessAt = now;
      stale = false;
      status = 'ready';
      statusMessage = '';
      consecutiveFailures = 0;
      nextDelayMs = Math.max(10, options.config.pollIntervalSec) * 1000;
      publish();
      return;
    }
    const lastUpdatedAt = response.meta && response.meta.last_updated_at;
    const parsedTimestamp =
      typeof lastUpdatedAt === 'string' ? parseApiTimestamp(lastUpdatedAt) : null;
    const responseIsStale = parsedTimestamp
      ? isStale(parsedTimestamp, now, options.config.staleAfterSec)
      : false;
    const locations = options.getLocations();
    const locationUid = options.getSelectedLocation();
    if (!locations || !locationUid) {
      setFailure(new MissingAlertLocationError());
      return;
    }
    const nextLevel = levelFor(response.alerts, locationUid, locations);
    const previousLevel = state.level;
    const result = reduce(
      state,
      { kind: 'success', level: nextLevel, stale: responseIsStale },
      options.config.alerts,
    );

    state = result.state;
    stale = responseIsStale;
    status = responseIsStale ? 'stale' : 'ready';
    statusMessage = responseIsStale ? 'Дані застаріли' : '';
    checkedAt = now;
    updatedAt = now;
    lastSuccessAt = now;
    consecutiveFailures = 0;
    nextDelayMs = Math.max(10, options.config.pollIntervalSec) * 1000;

    if (result.signal) {
      try {
        if (result.signal === 'yellow' || result.signal === 'red' || result.signal === 'clear') {
          await options.director.enqueueAlarm(result.signal);
        }
      } catch (error) {
        if (options.onFailure) {
          options.onFailure('Не вдалося поставити сигнал у чергу', error);
        }
      }
    }

    if (previousLevel !== null && state.level !== previousLevel && options.onTransition) {
      options.onTransition(
        `${formatTime(now)} ${previousLevel} → ${state.level === null ? 'unknown' : state.level}`,
      );
    }
    publish();
  }

  async function pollNow(): Promise<void> {
    if (!started) {
      return;
    }
    if (authBlockedKey !== null) {
      if (authBlockedKey === authKey()) return;
      authBlockedKey = null;
    }
    if (!options.getSelectedLocation() || !options.getLocations()) {
      setFailure(new MissingAlertLocationError());
      return;
    }
    if (pollInFlight) {
      pollAgain = true;
      return;
    }

    pollInFlight = true;
    try {
      const response = await requestData();
      if (started) {
        await processResponse(response);
      }
    } catch (error) {
      if (started) {
        setFailure(error);
      }
    } finally {
      pollInFlight = false;
      if (pollAgain && started) {
        pollAgain = false;
        void pollNow();
      } else if (started && authBlockedKey === null) {
        scheduleNext();
      }
    }
  }

  const onlineHandler: EventListener = () => {
    void pollNow();
  };

  function start(): void {
    if (started) {
      return;
    }
    started = true;
    if (options.onlineTarget) {
      options.onlineTarget.addEventListener('online', onlineHandler);
    }
    const simulation = options.getSimulation ? options.getSimulation() : null;
    if (!options.getSelectedLocation() || !options.getLocations()) {
      setFailure(new MissingAlertLocationError());
    } else if (!simulation && !options.config.proxyUrl.trim() && !options.getToken()) {
      setFailure(new MissingAlertsTokenError());
    } else {
      void pollNow();
    }
  }

  function stop(): void {
    started = false;
    pollAgain = false;
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (options.onlineTarget) {
      options.onlineTarget.removeEventListener('online', onlineHandler);
    }
  }

  function locationChanged(): void {
    state = createInitialState();
    stale = false;
    checkedAt = null;
    updatedAt = null;
    lastSuccessAt = null;
    consecutiveFailures = 0;
    pollAgain = false;
    status = options.getSelectedLocation() && options.getLocations() ? 'ready' : 'missing-location';
    statusMessage = status === 'missing-location' ? 'Оберіть місто в налаштуваннях' : '';
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    publish();
    if (started && status !== 'missing-location') {
      void pollNow();
    }
  }

  async function diagnose(): Promise<AlertPollDiagnostic> {
    const locations = options.getLocations();
    const locationUid = options.getSelectedLocation();
    if (!locations || !locationUid) {
      throw new MissingAlertLocationError();
    }
    const response = await requestData();
    const checked = options.getNow();
    const lastUpdatedAt = response.meta && response.meta.last_updated_at;
    const parsedTimestamp =
      typeof lastUpdatedAt === 'string' ? parseApiTimestamp(lastUpdatedAt) : null;
    return {
      alerts: inspectAlertLocations(response.alerts, locationUid, locations),
      alertCount: response.alerts.length,
      level: levelFor(response.alerts, locationUid, locations),
      checkedAt: checked,
      stale: isStale(parsedTimestamp, checked, options.config.staleAfterSec),
    };
  }

  return { start, stop, pollNow, diagnose, locationChanged, getSnapshot };
}
