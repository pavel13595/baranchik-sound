import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unlockAudio, type AudioElements, type AudioUnlockState } from './unlock';

function mockAudio(play: () => Promise<void>): HTMLAudioElement {
  let source = '';
  return {
    get src() {
      return source;
    },
    set src(value: string) {
      source = value;
    },
    load: vi.fn(),
    play: vi.fn(play),
    pause: vi.fn(),
    removeAttribute: vi.fn((name: string) => {
      if (name === 'src') {
        source = '';
      }
    }),
  } as unknown as HTMLAudioElement;
}

function createElements(
  musicPlay: () => Promise<void> = () => Promise.resolve(),
  signalPlay: () => Promise<void> = () => Promise.resolve(),
): AudioElements {
  return {
    music: mockAudio(musicPlay),
    signals: mockAudio(signalPlay),
  };
}

describe('unlockAudio', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:silent-wav');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts both elements synchronously with a Blob URL, then clears their sources', async () => {
    const elements = createElements();
    const playbackOrder: string[] = [];
    elements.music.load = vi.fn(() => playbackOrder.push('music.load'));
    elements.music.play = vi.fn(() => {
      playbackOrder.push('music.play');
      return Promise.resolve();
    });
    elements.signals.load = vi.fn(() => playbackOrder.push('signals.load'));
    elements.signals.play = vi.fn(() => {
      playbackOrder.push('signals.play');
      return Promise.resolve();
    });
    const state: AudioUnlockState = { audioUnlocked: false };

    const onPlayResult = vi.fn();
    const unlocking = unlockAudio(elements, state, onPlayResult);

    expect(elements.music.src).toBe('blob:silent-wav');
    expect(elements.signals.src).toBe('blob:silent-wav');
    expect(elements.music.load).toHaveBeenCalledOnce();
    expect(elements.signals.load).toHaveBeenCalledOnce();
    expect(elements.music.play).toHaveBeenCalledOnce();
    expect(elements.signals.play).toHaveBeenCalledOnce();
    expect(playbackOrder).toEqual(['music.load', 'music.play', 'signals.load', 'signals.play']);

    const wav = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    const header = new DataView(await wav.arrayBuffer());
    expect(wav.type).toBe('audio/wav');
    expect(header.getUint32(24, true)).toBe(44_100);
    expect(header.getUint16(22, true)).toBe(1);
    expect(header.getUint16(34, true)).toBe(16);
    expect(header.getUint32(40, true)).toBe(8_820);
    await unlocking;

    expect(elements.music.src).toBe('');
    expect(elements.signals.src).toBe('');
    expect(elements.music.removeAttribute).toHaveBeenCalledWith('src');
    expect(elements.music.load).toHaveBeenCalledTimes(2);
    expect(elements.signals.load).toHaveBeenCalledTimes(2);
    expect(elements.music.pause).toHaveBeenCalledOnce();
    expect(elements.signals.pause).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:silent-wav');
    expect(onPlayResult).toHaveBeenNthCalledWith(1, 'music', null);
    expect(onPlayResult).toHaveBeenNthCalledWith(2, 'signals', null);
    expect(state.audioUnlocked).toBe(true);
  });

  it('stays locked when the music element resolves but the signal is blocked', async () => {
    const elements = createElements(
      () => Promise.resolve(),
      () => Promise.reject(new Error('signals blocked')),
    );
    const state: AudioUnlockState = { audioUnlocked: true };

    await expect(unlockAudio(elements, state)).rejects.toThrow('signals blocked');
    expect(state.audioUnlocked).toBe(false);
    expect(elements.music.src).toBe('');
    expect(elements.signals.src).toBe('');
  });

  it('does not report the other play as failed when cleanup aborts it after unlock', async () => {
    let rejectMusic: (error: unknown) => void = () => undefined;
    const elements = createElements(
      () => new Promise<void>((_resolve, reject) => (rejectMusic = reject)),
      () => Promise.resolve(),
    );
    const onPlayResult = vi.fn();

    await unlockAudio(elements, { audioUnlocked: false }, onPlayResult);
    rejectMusic(Object.assign(new Error('interrupted by cleanup'), { name: 'AbortError' }));
    await Promise.resolve();

    expect(onPlayResult).toHaveBeenCalledOnce();
    expect(onPlayResult).toHaveBeenCalledWith('signals', null);
  });

  it('rejects and leaves audio locked when both play attempts fail', async () => {
    const elements = createElements(
      () => Promise.reject(new Error('music blocked')),
      () => Promise.reject(new Error('signals blocked')),
    );
    const state: AudioUnlockState = { audioUnlocked: true };

    await expect(unlockAudio(elements, state)).rejects.toThrow('signals blocked');

    expect(elements.music.pause).toHaveBeenCalled();
    expect(elements.signals.pause).toHaveBeenCalled();
    expect(elements.music.src).toBe('');
    expect(elements.signals.src).toBe('');
    expect(state.audioUnlocked).toBe(false);
  });

  it('fails in finite time when neither media play promise settles', async () => {
    vi.useFakeTimers();
    const pendingPlay = (): Promise<void> => new Promise<void>(() => undefined);
    const elements = createElements(pendingPlay, pendingPlay);
    const state: AudioUnlockState = { audioUnlocked: false };
    const unlocking = unlockAudio(elements, state);
    const assertion = expect(unlocking).rejects.toThrow('Audio unlock timed out');

    await vi.advanceTimersByTimeAsync(8000);
    await assertion;

    expect(state.audioUnlocked).toBe(false);
    expect(elements.music.pause).toHaveBeenCalled();
    expect(elements.signals.pause).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
