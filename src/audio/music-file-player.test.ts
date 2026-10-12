import { afterEach, describe, expect, it, vi } from 'vitest';
import { MUSIC_MEMORY_COPY_LIMIT } from '../config';
import { createMusicFilePlayer, type MusicFileAttempt } from './music-file-player';

class MockAudio extends EventTarget {
  currentTime = 0;
  duration = 128;
  paused = true;
  readyState = 0;
  networkState = 0;
  preload = 'metadata';
  muted = false;
  error: { code: number } | null = null;
  loadCount = 0;
  failUrls = new Set<string>();
  private currentSource = '';

  canPlayType = vi.fn((mime: string): string => (mime === 'audio/mpeg' ? 'probably' : ''));

  get src(): string {
    return this.currentSource;
  }

  set src(value: string) {
    this.currentSource = value;
    this.error = null;
    this.readyState = 0;
  }

  readonly play = vi.fn((): Promise<void> => {
    if (this.failUrls.has(this.currentSource)) {
      const error = new Error('Unsupported media source');
      error.name = 'NotSupportedError';
      return Promise.reject(error);
    }
    this.paused = false;
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  });

  readonly pause = vi.fn((): void => {
    this.paused = true;
  });

  readonly removeAttribute = vi.fn((name: string): void => {
    if (name === 'src') this.src = '';
  });

  readonly load = vi.fn((): void => {
    this.loadCount += 1;
    if (!this.currentSource) return;
    if (this.failUrls.has(this.currentSource)) {
      this.error = { code: 4 };
      this.dispatchEvent(new Event('error'));
      return;
    }
    this.readyState = 1;
    this.dispatchEvent(new Event('loadedmetadata'));
  });
}

class MockFileReader {
  result: string | ArrayBuffer | null = null;
  error: DOMException | null = null;
  onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onabort: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onprogress: ((event: ProgressEvent<FileReader>) => void) | null = null;
  static fail = false;
  static calls = 0;

  readAsArrayBuffer(blob: Blob): void {
    MockFileReader.calls += 1;
    if (MockFileReader.fail) {
      this.error = new DOMException('File is not locally available', 'NotReadableError');
      this.onerror?.({} as ProgressEvent<FileReader>);
      return;
    }
    this.onprogress?.({
      lengthComputable: true,
      loaded: blob.size,
      total: blob.size,
    } as ProgressEvent<FileReader>);
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onload?.({} as ProgressEvent<FileReader>);
    });
  }

  readAsDataURL(blob: Blob): void {
    MockFileReader.calls += 1;
    this.onprogress?.({
      lengthComputable: true,
      loaded: blob.size,
      total: blob.size,
    } as ProgressEvent<FileReader>);
    this.result = `data:${blob.type};base64,dGVzdA==`;
    this.onload?.({} as ProgressEvent<FileReader>);
  }

  abort(): void {
    this.onabort?.({} as ProgressEvent<FileReader>);
  }
}

function makeFile(name: string, type: string, size = 4096): File {
  const file = new Blob([new Uint8Array(size)], { type }) as File;
  Object.defineProperty(file, 'name', { value: name });
  return file;
}

function createPlayer(onAttempt?: (attempt: MusicFileAttempt) => void) {
  let nextUrl = 0;
  const createUrl = vi
    .spyOn(URL, 'createObjectURL')
    .mockImplementation(() => `blob:music-${++nextUrl}`);
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const player = createMusicFilePlayer({
    memoryCopyLimit: 150 * 1024 * 1024,
    onAttempt,
  });
  return { player, createUrl, revokeUrl };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  MockFileReader.fail = false;
  MockFileReader.calls = 0;
});

describe('iOS local music source strategies', () => {
  it('uses the original audio File for strategy A and calls play synchronously', async () => {
    const file = makeFile('song.mp3', 'audio/mpeg');
    const attempts: MusicFileAttempt[] = [];
    const { player, createUrl } = createPlayer((attempt) => attempts.push(attempt));
    const audio = new MockAudio();
    vi.stubGlobal('FileReader', MockFileReader);
    player.selectFile(file);

    const playback = player.play(audio as unknown as HTMLAudioElement, 0, () => true);
    expect(audio.play).toHaveBeenCalledOnce();
    expect(createUrl).toHaveBeenCalledWith(file);
    await expect(playback).resolves.toMatchObject({ success: true, strategy: 'A' });
    expect(attempts[0].canPlayType).toBe('probably');
  });

  it('uses an extension-typed slice for strategy B when File.type is empty', async () => {
    const file = makeFile('song.mp3', '');
    const { player, createUrl } = createPlayer();
    const audio = new MockAudio();
    player.selectFile(file);

    const result = await player.play(audio as unknown as HTMLAudioElement, 0, () => true);

    expect(result).toMatchObject({ success: true, strategy: 'B' });
    expect(createUrl).toHaveBeenCalledOnce();
    expect(createUrl.mock.calls[0][0]).not.toBe(file);
    expect((createUrl.mock.calls[0][0] as Blob).type).toBe('audio/mpeg');
  });

  it('prepares a bounded data URL on iOS 12 and plays it synchronously on the next gesture', async () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_8 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
    });
    vi.stubGlobal('FileReader', MockFileReader);
    const file = makeFile('song.mp3', 'audio/mpeg');
    const { player, createUrl } = createPlayer();
    const audio = new MockAudio();
    player.selectFile(file);
    await Promise.resolve();

    const playback = player.play(audio as unknown as HTMLAudioElement, 0, () => true);

    expect(audio.src).toBe('data:audio/mpeg;base64,dGVzdA==');
    expect(audio.play).toHaveBeenCalledOnce();
    expect(createUrl).not.toHaveBeenCalled();
    await expect(playback).resolves.toMatchObject({ success: true, strategy: 'D' });
  });

  it('remembers the successful strategy for pause/resume without reloading or rebuilding the URL', async () => {
    const file = makeFile('song.mp3', 'audio/mpeg');
    const { player, createUrl } = createPlayer();
    const audio = new MockAudio();
    player.selectFile(file);

    await expect(
      player.play(audio as unknown as HTMLAudioElement, 0, () => true),
    ).resolves.toMatchObject({
      success: true,
      strategy: 'A',
    });
    const loadCount = audio.load.mock.calls.length;
    audio.pause();
    await expect(
      player.play(audio as unknown as HTMLAudioElement, 15, () => true),
    ).resolves.toMatchObject({
      success: true,
      strategy: 'A',
    });

    expect(createUrl).toHaveBeenCalledOnce();
    expect(audio.load).toHaveBeenCalledTimes(loadCount);
    expect(audio.currentTime).toBe(15);
  });

  it('retries the restore seek once when playback starts more than two seconds off target', async () => {
    const file = makeFile('song.mp3', 'audio/mpeg');
    const { player } = createPlayer();
    const audio = new MockAudio();
    let currentTime = 0;
    let seekCount = 0;
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        seekCount += 1;
        if (seekCount > 1) currentTime = value;
      },
    });
    player.selectFile(file);

    const result = await player.play(audio as unknown as HTMLAudioElement, 15, () => true);

    expect(result.success).toBe(true);
    expect(seekCount).toBe(2);
    expect(audio.currentTime).toBe(15);
  });

  it('falls through A and B to a full FileReader-backed Blob for strategy C', async () => {
    const file = makeFile('song.m4a', 'audio/mp4');
    const { createUrl } = createPlayer();
    const audio = new MockAudio();
    audio.failUrls.add('blob:music-1');
    audio.failUrls.add('blob:music-2');
    vi.stubGlobal('FileReader', MockFileReader);
    const progress: number[] = [];
    const playerWithProgress = createMusicFilePlayer({
      memoryCopyLimit: 150 * 1024 * 1024,
      onProgress: (value) => progress.push(value),
    });
    playerWithProgress.selectFile(file);

    const result = await playerWithProgress.play(
      audio as unknown as HTMLAudioElement,
      0,
      () => true,
    );

    expect(result).toMatchObject({ success: true, strategy: 'C' });
    expect(MockFileReader.calls).toBe(1);
    expect(createUrl).toHaveBeenCalledTimes(3);
    expect((createUrl.mock.calls[2][0] as Blob).type).toBe('audio/mp4');
    expect(progress).toContain(100);
  });

  it('tries A, B, and C when Safari rejects play() with NotSupportedError', async () => {
    const file = makeFile('song.mp3', 'audio/mpeg');
    const attempts: MusicFileAttempt[] = [];
    const { player, createUrl } = createPlayer((attempt) => attempts.push(attempt));
    const audio = new MockAudio();
    audio.play.mockImplementation(() => {
      const error = new Error('The operation is not supported');
      error.name = 'NotSupportedError';
      return Promise.reject(error);
    });
    vi.stubGlobal('FileReader', MockFileReader);
    player.selectFile(file);

    const result = await player.play(audio as unknown as HTMLAudioElement, 0, () => true);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Safari відхилив формат або джерело аудіо');
    expect(createUrl).toHaveBeenCalledTimes(3);
    expect(attempts.map((attempt) => attempt.strategy)).toEqual(['A', 'B', 'C']);
    expect(attempts.map((attempt) => attempt.errorName)).toEqual([
      'NotSupportedError',
      'NotSupportedError',
      'NotSupportedError',
    ]);
    expect(attempts.map((attempt) => attempt.errorCode)).toEqual([null, null, null]);
  });

  it('reports iCloud/unreadable FileReader failures with a human hint', async () => {
    const file = makeFile('song.m4a', 'audio/mp4');
    const { player } = createPlayer();
    const audio = new MockAudio();
    audio.failUrls.add('blob:music-1');
    audio.failUrls.add('blob:music-2');
    MockFileReader.fail = true;
    vi.stubGlobal('FileReader', MockFileReader);
    player.selectFile(file);

    const result = await player.play(audio as unknown as HTMLAudioElement, 0, () => true);
    expect(result.success).toBe(false);
    expect(result.message).toContain('не в iCloud');
  });

  it('probes the first and last 64KB using FileReader', async () => {
    const file = makeFile('song.mp3', 'audio/mpeg', 140_000);
    vi.stubGlobal('FileReader', MockFileReader);
    const player = createMusicFilePlayer({ memoryCopyLimit: 150 * 1024 * 1024 });
    player.selectFile(file);

    const result = await player.probe();
    expect(result.success).toBe(true);
    expect(result.message).toContain('початок 65536 байт');
    expect(result.message).toContain('кінець 65536 байт');
    expect(MockFileReader.calls).toBe(2);
  });

  it('does not repeat the fallback chain after all strategies fail', async () => {
    const file = makeFile('song.mp3', 'audio/mpeg');
    const { player, createUrl } = createPlayer();
    const audio = new MockAudio();
    audio.failUrls = new Set(['blob:music-1', 'blob:music-2', 'blob:music-3']);
    vi.stubGlobal('FileReader', MockFileReader);
    player.selectFile(file);

    const first = await player.play(audio as unknown as HTMLAudioElement, 0, () => true);
    const second = await player.play(audio as unknown as HTMLAudioElement, 0, () => true);

    expect(first.success).toBe(false);
    expect(second.message).toBe(first.message);
    expect(createUrl).toHaveBeenCalledTimes(3);
  });

  it('does not restart A/B/C after the remembered successful source later fails', async () => {
    const file = makeFile('song.mp3', 'audio/mpeg');
    const { player, createUrl, revokeUrl } = createPlayer();
    const audio = new MockAudio();
    player.selectFile(file);
    await expect(
      player.play(audio as unknown as HTMLAudioElement, 0, () => true),
    ).resolves.toMatchObject({
      success: true,
      strategy: 'A',
    });

    audio.paused = true;
    audio.failUrls.add('blob:music-1');
    const failedResume = await player.play(audio as unknown as HTMLAudioElement, 0, () => true);
    const repeated = await player.play(audio as unknown as HTMLAudioElement, 0, () => true);

    expect(failedResume.success).toBe(false);
    expect(repeated.message).toBe(failedResume.message);
    expect(createUrl).toHaveBeenCalledOnce();
    expect(revokeUrl).toHaveBeenCalledWith('blob:music-1');
  });

  it('revokes the previous object URL only after the replacement source is loaded', async () => {
    const order: string[] = [];
    const firstFile = makeFile('first.mp3', 'audio/mpeg');
    const secondFile = makeFile('second.mp3', 'audio/mpeg');
    const { player, createUrl, revokeUrl } = createPlayer();
    revokeUrl.mockImplementation((url) => {
      order.push(`revoke:${url}`);
    });
    const audio = new MockAudio();
    const originalLoad = audio.load.getMockImplementation();
    audio.load.mockImplementation(() => {
      order.push(`load:${audio.src || 'empty'}`);
      if (originalLoad) originalLoad();
    });

    player.selectFile(firstFile);
    await player.play(audio as unknown as HTMLAudioElement, 0, () => true);
    player.selectFile(secondFile);
    expect(revokeUrl).not.toHaveBeenCalled();

    await player.play(audio as unknown as HTMLAudioElement, 0, () => true);

    expect(order.indexOf('load:blob:music-2')).toBeLessThan(order.indexOf('revoke:blob:music-1'));
    expect(createUrl).toHaveBeenCalledTimes(2);
  });

  it('skips copying files over memoryCopyLimit without assuming error 4 means low memory', async () => {
    const file = makeFile('large.mp3', 'audio/mpeg', 4096);
    Object.defineProperty(file, 'size', {
      value: MUSIC_MEMORY_COPY_LIMIT + 1024 * 1024,
    });
    const { createUrl } = createPlayer();
    const boundedPlayer = createMusicFilePlayer({ memoryCopyLimit: MUSIC_MEMORY_COPY_LIMIT });
    const audio = new MockAudio();
    audio.failUrls = new Set(['blob:music-1', 'blob:music-2']);
    MockFileReader.calls = 0;
    vi.stubGlobal('FileReader', MockFileReader);
    boundedPlayer.selectFile(file);

    const result = await boundedPlayer.play(audio as unknown as HTMLAudioElement, 0, () => true);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Safari відхилив формат або джерело');
    expect(result.message).not.toContain('не вистачає пам');
    expect(result.message).toContain('ліміт резервного читання 150 МБ');
    expect(result.message).toContain('151.0 МБ');
    expect(MockFileReader.calls).toBe(0);
    expect(createUrl).toHaveBeenCalledTimes(2);
  });
});
