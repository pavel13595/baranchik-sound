import { describe, expect, it } from 'vitest';
import { getGreetingControlPresentation } from './greeting-control';

describe('Gamarjos control states', () => {
  it('shows idle, playing, restarted and finished states consistently', () => {
    const idle = getGreetingControlPresentation('idle', true);
    expect(idle.label).toBe('🎉 Гамарджос');
    expect(idle.disabled).toBe(false);
    expect(idle.stopDisabled).toBe(true);
    expect(idle.stopHidden).toBe(true);

    const playing = getGreetingControlPresentation('playing', true);
    expect(playing.label).toContain('натисніть, щоб почати заново');
    expect(playing.disabled).toBe(false);
    expect(playing.stopDisabled).toBe(false);
    expect(playing.stopHidden).toBe(false);

    const restarted = getGreetingControlPresentation('playing', true);
    expect(restarted).toEqual(playing);

    const finished = getGreetingControlPresentation('idle', true);
    expect(finished.label).toBe('🎉 Гамарджос');
    expect(finished.stopDisabled).toBe(true);
    expect(finished.stopHidden).toBe(true);
  });

  it('shows queued state and a disabled Stop button while alarm takes priority', () => {
    expect(getGreetingControlPresentation('queued', true)).toEqual({
      label: 'Після сигналу…',
      disabled: true,
      stopDisabled: false,
      stopHidden: false,
      playing: false,
    });
  });

  it('disables greeting when there are no greeting files', () => {
    expect(getGreetingControlPresentation('idle', false).disabled).toBe(true);
  });
});
