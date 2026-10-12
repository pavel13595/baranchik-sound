import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudioDirector, type AudioDirector } from './director';
import type { GamarjosFile, LocalMusicTrack, VenueConfig } from '../types';

class MockAudio extends EventTarget {
  src = '';
  currentTime = 0;
  duration = 120;
  paused = true;
  ended = false;
  loop = false;
  error: MediaError | null = null;
  readonly failSources = new Set<string>();
  readonly play = vi.fn(async (): Promise<void> => {
    if (this.failSources.has(this.src)) {
      this.paused = true;
      throw new Error(`play failed: ${this.src}`);
    }
    this.paused = false;
    this.ended = false;
    this.dispatchEvent(new Event('playing'));
  });
  readonly pause = vi.fn((): void => {
    this.paused = true;
  });
  readonly removeAttribute = vi.fn((name: string): void => {
    if (name === 'src') {
      this.src = '';
    }
  });
  readonly load = vi.fn((): void => {
    if (this.failSources.has(this.src)) {
      this.dispatchEvent(new Event('error'));
      return;
    }
    this.dispatchEvent(new Event('loadedmetadata'));
  });

  finish(): void {
    this.paused = true;
    this.ended = true;
    this.currentTime = this.duration;
    this.dispatchEvent(new Event('ended'));
  }
}

interface Harness {
  director: AudioDirector;
  music: MockAudio;
  signals: MockAudio;
}

const directors: AudioDirector[] = [];

afterEach(() => {
  directors.forEach((director) => director.destroy());
  directors.length = 0;
});

function venue(): VenueConfig {
  return {
    venueName: 'Venue',
    logo: '',
    pollIntervalSec: 10,
    staleAfterSec: 600,
    alerts: {
      clearConfirmPolls: 2,
    },
    signals: { yellow: 'yellow.mp3', red: 'red.mp3', clear: 'clear.mp3', activeHours: null },
    gamarjos: { dir: 'gamarjos' },
    proxyUrl: '',
  };
}

function localTrack(): LocalMusicTrack {
  return { src: 'blob:track-1', fileName: 'song.mp3', title: 'song.mp3', size: 1000 };
}

function createHarness(greetings: GamarjosFile[] = []): Harness {
  const music = new MockAudio();
  const signals = new MockAudio();
  const director = createAudioDirector({
    musicAudio: music as unknown as HTMLAudioElement,
    signalsAudio: signals as unknown as HTMLAudioElement,
    config: { signals: venue().signals },
    greetings,
    getNow: () => new Date(2025, 0, 2, 12, 0),
    random: () => 0,
  });
  directors.push(director);
  return { director, music, signals };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function startWithMusic(harness: Harness): Promise<void> {
  await harness.director.start();
  harness.director.selectTrack(localTrack());
  await harness.director.playMusic();
}

describe('local music and alert audio dispatcher', () => {
  it('plays a manual signal synchronously on the first audio gesture without pausing sig', async () => {
    const harness = createHarness();

    const playback = harness.director.playTestSignal('yellow');

    expect(harness.signals.src).toBe('yellow.mp3');
    expect(harness.signals.load).toHaveBeenCalledOnce();
    expect(harness.signals.play).toHaveBeenCalledOnce();
    expect(harness.signals.pause).not.toHaveBeenCalled();
    expect(harness.director.isAudioUnlocked()).toBe(false);
    expect(await playback).toBe(true);
    expect(harness.director.isAudioUnlocked()).toBe(true);
  });

  it('generates the diagnostic tone as a Safari-compatible PCM WAV', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:diagnostic-tone');
    const harness = createHarness();

    const playback = harness.director.playTestTone();

    const wav = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    const header = new DataView(await wav.arrayBuffer());
    expect(wav.type).toBe('audio/wav');
    expect(header.getUint32(24, true)).toBe(44_100);
    expect(header.getUint16(34, true)).toBe(16);
    expect(harness.signals.play).toHaveBeenCalledOnce();
    expect(await playback).toBe(true);
  });

  it('plays music synchronously from the button gesture without requiring global unlock', async () => {
    const harness = createHarness();
    harness.director.selectTrack(localTrack());
    harness.music.play.mockClear();

    const playback = harness.director.playMusic();

    expect(harness.music.play).toHaveBeenCalledOnce();
    expect(harness.music.src).toBe('blob:track-1');
    expect(await playback).toBe(true);
    expect(harness.director.isAudioUnlocked()).toBe(true);
  });

  it('invokes the local File strategy callback synchronously for an empty source track', async () => {
    const music = new MockAudio();
    const signals = new MockAudio();
    const director = createAudioDirector({
      musicAudio: music as unknown as HTMLAudioElement,
      signalsAudio: signals as unknown as HTMLAudioElement,
      config: { signals: venue().signals },
      greetings: [],
      getNow: () => new Date(2025, 0, 2, 12, 0),
      playLocalMusicFile: (audio) => {
        audio.src = 'blob:resolved-local-file';
        audio.load();
        const playResult = audio.play();
        return Promise.resolve(playResult).then(() => ({
          success: true,
          cancelled: false,
          src: 'blob:resolved-local-file',
          strategy: 'A' as const,
          error: null,
          message: '',
        }));
      },
    });
    directors.push(director);
    director.selectTrack({ src: '', fileName: 'song.mp3', title: 'song.mp3', size: 1024 });
    music.play.mockClear();

    const playback = director.playMusic();

    expect(music.play).toHaveBeenCalledOnce();
    expect(await playback).toBe(true);
    expect(music.src).toBe('blob:resolved-local-file');
  });

  it('pauses music before an alarm and resumes from the same currentTime', async () => {
    const harness = createHarness();
    await startWithMusic(harness);
    harness.music.currentTime = 41;

    await harness.director.enqueueAlarm('yellow');
    expect(harness.music.paused).toBe(true);
    expect(harness.music.currentTime).toBe(41);

    harness.signals.finish();
    await flushPromises();

    expect(harness.music.paused).toBe(false);
    expect(harness.music.currentTime).toBe(41);
  });

  it('waits for both consecutive alarms before resuming music', async () => {
    const harness = createHarness();
    await startWithMusic(harness);
    harness.music.currentTime = 19;

    await harness.director.enqueueAlarm('yellow');
    await harness.director.enqueueAlarm('red');
    expect(harness.signals.src).toBe('yellow.mp3');
    expect(harness.music.paused).toBe(true);

    harness.signals.finish();
    await flushPromises();
    expect(harness.signals.src).toBe('red.mp3');
    expect(harness.music.paused).toBe(true);

    harness.signals.finish();
    await flushPromises();
    expect(harness.music.paused).toBe(false);
    expect(harness.music.currentTime).toBe(19);
  });

  it('queues a greeting until an active alarm finishes', async () => {
    const harness = createHarness([{ src: 'blob:greeting', title: 'greeting.mp3' }]);
    await startWithMusic(harness);
    await harness.director.enqueueAlarm('red');

    expect(await harness.director.playGreeting()).toBe(true);
    expect(harness.signals.src).toBe('red.mp3');
    harness.signals.finish();
    await flushPromises();

    expect(harness.signals.src).toBe('blob:greeting');
    expect(harness.music.paused).toBe(true);
  });

  it('removes a queued greeting without stopping the active alarm', async () => {
    const harness = createHarness([{ src: 'blob:greeting', title: 'greeting.mp3' }]);
    await startWithMusic(harness);
    await harness.director.enqueueAlarm('red');
    await harness.director.playGreeting();

    harness.director.stopGreeting();
    harness.signals.finish();
    await flushPromises();

    expect(harness.signals.src).toBe('red.mp3');
    expect(harness.music.paused).toBe(false);
  });

  it('restarts the active greeting from the same file on a second gesture', async () => {
    const harness = createHarness([
      { src: 'blob:first', title: 'first.mp3' },
      { src: 'blob:second', title: 'second.mp3' },
    ]);
    await harness.director.playGreeting();
    harness.signals.play.mockClear();

    await harness.director.playGreeting();

    expect(harness.signals.src).toBe('blob:first');
    expect(harness.signals.play).toHaveBeenCalledOnce();
  });

  it('chooses a different greeting after the previous one finishes', async () => {
    const harness = createHarness([
      { src: 'blob:first', title: 'first.mp3' },
      { src: 'blob:second', title: 'second.mp3' },
    ]);
    await harness.director.playGreeting();
    harness.signals.finish();
    await flushPromises();

    await harness.director.playGreeting();
    expect(harness.signals.src).toBe('blob:second');
  });

  it('plays a manual alarm synchronously and can stop it while restoring wanted music', async () => {
    const harness = createHarness();
    await startWithMusic(harness);
    harness.music.currentTime = 37;
    harness.signals.play.mockClear();
    const playback = harness.director.playAlarm('red');

    expect(harness.signals.src).toBe('red.mp3');
    expect(harness.signals.play).toHaveBeenCalledOnce();
    expect(harness.music.paused).toBe(true);
    await playback;
    harness.director.stopAlarm();
    await flushPromises();

    expect(harness.signals.paused).toBe(true);
    expect(harness.music.paused).toBe(false);
    expect(harness.music.currentTime).toBe(37);
  });

  it('does not stop an active greeting when Stop alarm is requested', async () => {
    const harness = createHarness([{ src: 'blob:greeting', title: 'greeting.mp3' }]);
    await harness.director.playGreeting();

    harness.director.stopAlarm();

    expect(harness.signals.paused).toBe(false);
    expect(harness.signals.src).toBe('blob:greeting');
  });

  it('starts the queued greeting when Stop alarm clears the remaining alarms', async () => {
    const harness = createHarness([{ src: 'blob:greeting', title: 'greeting.mp3' }]);
    await startWithMusic(harness);
    await harness.director.enqueueAlarm('yellow');
    await harness.director.playGreeting();
    await harness.director.enqueueAlarm('red');

    harness.director.stopAlarm();
    await flushPromises();

    expect(harness.signals.src).toBe('blob:greeting');
    expect(harness.music.paused).toBe(true);
  });

  it('stops only greeting and resumes music at its interrupted position', async () => {
    const harness = createHarness([{ src: 'blob:greeting', title: 'greeting.mp3' }]);
    await startWithMusic(harness);
    harness.music.currentTime = 29;
    await harness.director.playGreeting();

    harness.director.stopGreeting();
    await flushPromises();

    expect(harness.signals.paused).toBe(true);
    expect(harness.music.paused).toBe(false);
    expect(harness.music.currentTime).toBe(29);
  });

  it('interrupts greeting when alarm arrives and does not replay it', async () => {
    const harness = createHarness([{ src: 'blob:greeting', title: 'greeting.mp3' }]);
    await startWithMusic(harness);
    await harness.director.playGreeting();
    expect(harness.signals.src).toBe('blob:greeting');

    await harness.director.enqueueAlarm('yellow');
    expect(harness.signals.src).toBe('yellow.mp3');
    harness.signals.finish();
    await flushPromises();

    expect(harness.signals.src).toBe('yellow.mp3');
    expect(harness.music.paused).toBe(false);
  });

  it('does not resume after a manual pause during an alarm', async () => {
    const harness = createHarness();
    await startWithMusic(harness);
    await harness.director.enqueueAlarm('red');
    harness.director.pauseMusic();
    harness.signals.finish();
    await flushPromises();

    expect(harness.music.paused).toBe(true);
    expect(harness.music.currentTime).toBe(0);
  });

  it('runs alerts normally when no local music has been selected', async () => {
    const harness = createHarness();
    await harness.director.start();
    harness.music.play.mockClear();
    await harness.director.enqueueAlarm('yellow');
    expect(harness.signals.src).toBe('yellow.mp3');
    harness.signals.finish();
    await flushPromises();

    expect(harness.music.play).not.toHaveBeenCalled();
    expect(harness.music.paused).toBe(true);
  });

  it('uses loop for the selected single track without an ended-track transition', async () => {
    const harness = createHarness();
    await startWithMusic(harness);
    await harness.director.enqueueAlarm('yellow');
    expect(harness.music.loop).toBe(true);
    harness.music.dispatchEvent(new Event('ended'));
    harness.signals.finish();
    await flushPromises();

    expect(harness.music.src).toBe('blob:track-1');
    expect(harness.music.loop).toBe(true);
  });

  it('replaces the selected track without starting it', async () => {
    const harness = createHarness();
    await startWithMusic(harness);
    harness.music.play.mockClear();

    harness.director.selectTrack({
      src: 'blob:replacement',
      fileName: 'replacement.mp3',
      title: 'replacement.mp3',
      size: 3000,
    });

    expect(harness.music.paused).toBe(true);
    expect(harness.music.src).toBe('blob:replacement');
    expect(harness.music.play).not.toHaveBeenCalled();

    expect(await harness.director.playMusic()).toBe(true);
    expect(harness.music.src).toBe('blob:replacement');
    expect(harness.music.play).toHaveBeenCalledTimes(1);
  });

  it('plays the selected track synchronously before awaiting playback events', async () => {
    const harness = createHarness();
    await harness.director.start();
    harness.director.selectTrack(localTrack());
    harness.music.play.mockClear();

    const playback = harness.director.playMusic();
    expect(harness.music.play).toHaveBeenCalledOnce();
    expect(harness.music.src).toBe('blob:track-1');
    expect(await playback).toBe(true);
    expect(harness.music.paused).toBe(false);
  });

  it('keeps seek and pause/resume position for the selected track', async () => {
    const harness = createHarness();
    await startWithMusic(harness);
    harness.music.currentTime = 32;
    harness.director.pauseMusic();
    expect(harness.director.seek(32)).toBe(true);
    expect(await harness.director.playMusic()).toBe(true);
    expect(harness.music.currentTime).toBe(32);
  });
});
