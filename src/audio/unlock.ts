export interface AudioElements {
  music: HTMLAudioElement;
  signals: HTMLAudioElement;
}

export interface AudioUnlockState {
  audioUnlocked: boolean;
}

export type AudioUnlockPlayResult = (element: 'music' | 'signals', error: unknown | null) => void;

const UNLOCK_TIMEOUT_MS = 8000;

function createSilentWav(): Blob {
  const sampleCount = 4410;
  const bytesPerSample = 2;
  const dataByteLength = sampleCount * bytesPerSample;
  const sampleRate = 44_100;
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
  return new Blob([bytes], { type: 'audio/wav' });
}

function cleanupAudio(audio: HTMLAudioElement, unlockUrl: string): void {
  if (audio.src !== unlockUrl) {
    return;
  }
  try {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  } catch (error) {
    console.error('Unable to clean up audio unlock source', error);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

export function unlockAudio(
  elements: AudioElements,
  state: AudioUnlockState,
  onPlayResult?: AudioUnlockPlayResult,
): Promise<void> {
  state.audioUnlocked = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let objectUrl = '';
  const audios = [elements.music, elements.signals];
  const attempts: Promise<void>[] = [];
  let cleanupStarted = false;

  try {
    objectUrl = URL.createObjectURL(createSilentWav());
    audios.forEach((audio, index) => {
      try {
        audio.src = objectUrl;
        audio.load();
        attempts.push(
          Promise.resolve(audio.play()).then(
            () => {
              if (onPlayResult) {
                onPlayResult(index === 0 ? 'music' : 'signals', null);
              }
            },
            (error: unknown) => {
              if (onPlayResult && !(cleanupStarted && isAbortError(error))) {
                onPlayResult(index === 0 ? 'music' : 'signals', error);
              }
              throw error;
            },
          ),
        );
      } catch (error) {
        if (onPlayResult) {
          onPlayResult(index === 0 ? 'music' : 'signals', error);
        }
        attempts.push(Promise.reject(error));
      }
    });
  } catch (error) {
    audios.forEach((audio) => cleanupAudio(audio, objectUrl));
    state.audioUnlocked = false;
    return Promise.reject(error);
  }

  return new Promise<void>((resolve, reject) => {
    let finished = false;
    let failures = 0;
    let firstError: unknown;
    const cleanup = (): void => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      cleanupStarted = true;
      audios.forEach((audio) => cleanupAudio(audio, objectUrl));
      try {
        URL.revokeObjectURL(objectUrl);
      } catch (error) {
        console.error('Unable to release audio unlock URL', error);
      }
    };

    attempts.forEach((attempt) => {
      attempt.then(
        () => {
          if (finished) {
            return;
          }
          finished = true;
          state.audioUnlocked = true;
          cleanup();
          resolve();
        },
        (error: unknown) => {
          if (finished) {
            return;
          }
          failures += 1;
          if (firstError === undefined) {
            firstError = error;
          }
          if (failures === attempts.length) {
            finished = true;
            state.audioUnlocked = false;
            cleanup();
            reject(firstError);
          }
        },
      );
    });

    timeoutId = setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;
      state.audioUnlocked = false;
      cleanup();
      reject(firstError || new Error('Audio unlock timed out'));
    }, UNLOCK_TIMEOUT_MS);
  });
}
