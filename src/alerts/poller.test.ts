import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertHttpError, type AlertFetcher } from './api';
import { createAlertPoller, type AlertPollSnapshot, type SimulationResponse } from './poller';
import type { AlertRecord } from '../alerts';
import type { LocationIndex, VenueConfig } from '../types';

const locations: LocationIndex = {
  updatedAt: '',
  oblasts: [],
  byUid: {
    '19': {
      uid: '19',
      name: 'Полтавська область',
      type: 'oblast',
      oblastUid: '19',
      raionUid: null,
    },
    '107': {
      uid: '107',
      name: 'Кременчуцький район',
      type: 'raion',
      oblastUid: '19',
      raionUid: null,
    },
    '1088': {
      uid: '1088',
      name: 'Кременчуцька громада',
      type: 'hromada',
      oblastUid: '19',
      raionUid: '107',
    },
  },
};

function config(): VenueConfig {
  return {
    venueName: 'Venue',
    logo: '',
    pollIntervalSec: 12,
    staleAfterSec: 600,
    alerts: {
      clearConfirmPolls: 2,
    },
    signals: { yellow: 'yellow.mp3', red: 'red.mp3', clear: 'clear.mp3', activeHours: null },
    gamarjos: { dir: 'gamarjos' },
    proxyUrl: '',
  };
}

function active(level: string): AlertRecord {
  return {
    location_title: 'Кременчуцька громада',
    location_type: 'hromada',
    location_uid: '1088',
    location_raion: 'Кременчуцький район',
    location_oblast: 'Полтавська область',
    location_oblast_uid: '19',
    alert_type: 'air_raid',
    alert_level: level,
  };
}

function response(
  alerts: AlertRecord[],
  updated = new Date(2025, 0, 2, 11, 30).toISOString(),
): Response {
  return new Response(JSON.stringify({ alerts, meta: { last_updated_at: updated } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createHarness(
  options: {
    responses?: Array<Response | Error>;
    now?: Date;
    token?: string | null;
    proxyUrl?: string;
    simulation?: SimulationResponse | null;
    locationUid?: string | null;
  } = {},
): {
  poller: ReturnType<typeof createAlertPoller>;
  calls: Array<{ url: string; init: RequestInit }>;
  signals: string[];
  snapshots: AlertPollSnapshot[];
  transitions: string[];
  onlineTarget: EventTarget;
  setSimulation: (value: SimulationResponse | null) => void;
  setNow: (value: Date) => void;
  setToken: (value: string | null) => void;
  setSelectedLocation: (value: string | null) => void;
} {
  const results = (options.responses || []).slice();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const signals: string[] = [];
  const snapshots: AlertPollSnapshot[] = [];
  const transitions: string[] = [];
  const onlineTarget = new EventTarget();
  let now = options.now || new Date(2025, 0, 2, 11, 30);
  let simulation = options.simulation || null;
  let token = options.token === undefined ? 'test-token' : options.token;
  let selectedLocation = options.locationUid === undefined ? '1088' : options.locationUid;

  const fetcher: AlertFetcher = async (url, init) => {
    calls.push({ url, init });
    const result = results.shift();
    if (result instanceof Error) {
      throw result;
    }
    return result || response([]);
  };

  const poller = createAlertPoller({
    config: {
      ...config(),
      proxyUrl: options.proxyUrl || '',
    },
    getToken: () => token,
    getSelectedLocation: () => selectedLocation,
    getLocations: () => locations,
    getNow: () => new Date(now.getTime()),
    director: {
      enqueueAlarm: async (signal) => {
        signals.push(signal);
        return true;
      },
    },
    fetcher,
    onlineTarget,
    getSimulation: () => simulation,
    onUpdate: (snapshot) => snapshots.push(snapshot),
    onTransition: (message) => transitions.push(message),
  });

  return {
    poller,
    calls,
    signals,
    snapshots,
    transitions,
    onlineTarget,
    setSimulation: (value) => {
      simulation = value;
    },
    setNow: (value) => {
      now = value;
    },
    setToken: (value) => {
      token = value;
    },
    setSelectedLocation: (value) => {
      selectedLocation = value;
    },
  };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AlertPoller', () => {
  it('resets the alert automaton and polls once when the selected location changes', async () => {
    const districtAlert = {
      ...active('red'),
      location_uid: '107',
      location_type: 'raion' as const,
    };
    const harness = createHarness({ responses: [response([]), response([districtAlert])] });
    harness.poller.start();
    await flushPromises();
    expect(harness.poller.getSnapshot().state.level).toBe('none');

    harness.setSelectedLocation('107');
    harness.poller.locationChanged();
    await flushPromises();

    expect(harness.calls).toHaveLength(2);
    expect(harness.poller.getSnapshot().state.level).toBe('red');
    expect(harness.signals).toEqual(['red']);
    harness.poller.stop();
  });

  it('processes none → yellow → red → confirmed none and queues signals', async () => {
    const harness = createHarness({
      responses: [
        response([]),
        response([active('yellow')]),
        response([active('red')]),
        response([]),
        response([]),
      ],
    });
    harness.poller.start();
    await flushPromises();
    await harness.poller.pollNow();
    await harness.poller.pollNow();
    await harness.poller.pollNow();
    await harness.poller.pollNow();

    expect(harness.signals).toEqual(['yellow', 'red', 'clear']);
    expect(harness.poller.getSnapshot().state.level).toBe('none');
    expect(harness.transitions).toEqual([
      '11:30:00 none → yellow',
      '11:30:00 yellow → red',
      '11:30:00 red → none',
    ]);
    harness.poller.stop();
  });

  it('does not change state or enqueue clear after three network failures', async () => {
    const harness = createHarness({
      responses: [
        response([active('red')]),
        new TypeError('Failed to fetch'),
        new Error('offline'),
        new Error('offline'),
      ],
    });
    harness.poller.start();
    await flushPromises();
    await harness.poller.pollNow();
    await harness.poller.pollNow();
    await harness.poller.pollNow();

    expect(harness.poller.getSnapshot().state.level).toBe('red');
    expect(harness.poller.getSnapshot().status).toBe('offline');
    expect(harness.poller.getSnapshot().statusMessage).toContain('proxy-сервера');
    expect(harness.poller.getSnapshot().statusMessage).not.toContain('Спроба');
    expect(harness.poller.getSnapshot().updatedAt).not.toBeNull();
    expect(harness.signals).toEqual(['red']);
    harness.poller.stop();
  });

  it('does not change alert state or signal for stale data', async () => {
    const harness = createHarness({
      responses: [
        response([active('yellow')]),
        response(
          [],
          new Date(new Date(2025, 0, 2, 11, 30).getTime() - 30 * 60 * 1000).toISOString(),
        ),
      ],
    });
    harness.poller.start();
    await flushPromises();
    await harness.poller.pollNow();

    expect(harness.poller.getSnapshot().state.level).toBe('yellow');
    expect(harness.poller.getSnapshot().stale).toBe(true);
    expect(harness.poller.getSnapshot().status).toBe('stale');
    expect(harness.signals).toEqual(['yellow']);
    harness.poller.stop();
  });

  it('initializes to an alert active at start and queues its sound', async () => {
    const harness = createHarness({ responses: [response([active('red')])] });
    harness.poller.start();
    await flushPromises();

    expect(harness.poller.getSnapshot().state.level).toBe('red');
    expect(harness.signals).toEqual(['red']);
    expect(harness.transitions).toEqual([]);
    harness.poller.stop();
  });

  it('uses a proxy URL and cache no-store', async () => {
    const harness = createHarness({ proxyUrl: '/alerts-proxy', responses: [response([])] });
    harness.poller.start();
    await flushPromises();

    expect(harness.calls[0].url).toBe('http://localhost/alerts-proxy');
    expect(harness.calls[0].init.cache).toBe('no-store');
    expect(harness.calls[0].init.method).toBe('GET');
    harness.poller.stop();
  });

  it('is idempotent and registers only one polling timer', async () => {
    vi.useFakeTimers();
    const pendingFetch = vi.fn(() => new Promise<Response>(() => undefined));
    const harness = createHarness();
    const poller = createAlertPoller({
      config: config(),
      getToken: () => 'token',
      getSelectedLocation: () => '1088',
      getLocations: () => locations,
      getNow: () => new Date(Date.UTC(2025, 0, 2, 11, 30)),
      director: { enqueueAlarm: vi.fn() },
      fetcher: pendingFetch as unknown as AlertFetcher,
      onUpdate: () => undefined,
    });
    poller.start();
    poller.start();

    expect(vi.getTimerCount()).toBe(1);
    expect(pendingFetch).toHaveBeenCalledOnce();
    poller.stop();
    harness.poller.stop();
  });

  it('starts one immediate poll after an online event', async () => {
    const harness = createHarness({ responses: [response([]), response([])] });
    harness.poller.start();
    await flushPromises();
    harness.onlineTarget.dispatchEvent(new Event('online'));
    await flushPromises();

    expect(harness.calls).toHaveLength(2);
    harness.poller.stop();
  });

  it('reports missing token without making a request', async () => {
    const harness = createHarness({ token: null });
    harness.poller.start();

    expect(harness.poller.getSnapshot().status).toBe('missing-token');
    expect(harness.poller.getSnapshot().statusMessage).toBe('Вставте токен');
    expect(harness.calls).toHaveLength(0);
    harness.poller.stop();
  });

  it('does not request the API without a selected location', async () => {
    const harness = createHarness({ locationUid: null });
    harness.poller.start();

    expect(harness.poller.getSnapshot().status).toBe('missing-location');
    expect(harness.calls).toHaveLength(0);
    harness.poller.stop();
  });

  it('backs off network retries from 12 to 24 seconds', async () => {
    vi.useFakeTimers();
    const harness = createHarness({ responses: [new TypeError('offline'), response([])] });
    harness.poller.start();
    await flushPromises();
    expect(harness.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(23_999);
    await flushPromises();
    expect(harness.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(harness.calls).toHaveLength(2);
    harness.poller.stop();
  });

  it('honors Retry-After for 429', async () => {
    vi.useFakeTimers();
    const harness = createHarness({ responses: [new AlertHttpError(429, 30_000), response([])] });
    harness.poller.start();
    await flushPromises();
    expect(harness.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(29_999);
    await flushPromises();
    expect(harness.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(harness.calls).toHaveLength(2);
    harness.poller.stop();
  });

  it('stops after 401 until the authentication value changes', async () => {
    const harness = createHarness({ responses: [new AlertHttpError(401), response([])] });
    harness.poller.start();
    await flushPromises();
    await harness.poller.pollNow();
    expect(harness.calls).toHaveLength(1);

    harness.setToken('replacement-token');
    await harness.poller.pollNow();
    await flushPromises();
    expect(harness.calls).toHaveLength(2);
    harness.poller.stop();
  });

  it('marks data stale after three minutes without a successful response', async () => {
    const responseWithoutMeta = new Response(JSON.stringify({ alerts: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const harness = createHarness({ responses: [responseWithoutMeta, new TypeError('offline')] });
    harness.poller.start();
    await flushPromises();
    harness.setNow(new Date(new Date(2025, 0, 2, 11, 30).getTime() + 181_000));
    await harness.poller.pollNow();

    expect(harness.poller.getSnapshot().stale).toBe(true);
    harness.poller.stop();
  });

  it('does not mutate state when simulation is stale', async () => {
    const harness = createHarness({ simulation: 'stale' });
    harness.poller.start();
    await flushPromises();

    expect(harness.poller.getSnapshot().stale).toBe(true);
    expect(harness.poller.getSnapshot().state.level).toBeNull();
    expect(harness.calls).toHaveLength(0);
    harness.poller.stop();
  });
});
