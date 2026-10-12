import type { GreetingPlaybackState } from '../audio/director';

export interface GreetingControlPresentation {
  label: string;
  disabled: boolean;
  stopDisabled: boolean;
  stopHidden: boolean;
  playing: boolean;
}

export function getGreetingControlPresentation(
  state: GreetingPlaybackState,
  hasGreetings: boolean,
): GreetingControlPresentation {
  if (state === 'playing') {
    return {
      label: 'Грає… натисніть, щоб почати заново',
      disabled: false,
      stopDisabled: false,
      stopHidden: false,
      playing: true,
    };
  }
  if (state === 'queued') {
    return {
      label: 'Після сигналу…',
      disabled: true,
      stopDisabled: false,
      stopHidden: false,
      playing: false,
    };
  }
  return {
    label: hasGreetings ? '🎉 Гамарджос' : 'Додайте файл у public/gamarjos',
    disabled: !hasGreetings,
    stopDisabled: true,
    stopHidden: true,
    playing: false,
  };
}
