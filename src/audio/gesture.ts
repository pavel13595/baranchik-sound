const DIRECT_AUDIO_ACTIONS =
  '[data-music-toggle], [data-music-file-check], [data-greeting-button], [data-test-tone], [data-self-test-run], [data-run-scenario], [data-signal-confirm]';

export function isDirectAudioActionTarget(target: EventTarget | null, root: HTMLElement): boolean {
  if (!target || typeof (target as Element).closest !== 'function') {
    return false;
  }
  const action = (target as Element).closest(DIRECT_AUDIO_ACTIONS);
  return action !== null && root.contains(action);
}
