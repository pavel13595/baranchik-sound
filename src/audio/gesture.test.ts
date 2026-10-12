import { describe, expect, it, vi } from 'vitest';
import { isDirectAudioActionTarget } from './gesture';

describe('isDirectAudioActionTarget', () => {
  it('identifies a sound button so the global unlock listener leaves it alone', () => {
    const button = {} as Element;
    const target = { closest: vi.fn(() => button) } as unknown as Element;
    const root = { contains: vi.fn(() => true) } as unknown as HTMLElement;

    expect(isDirectAudioActionTarget(target, root)).toBe(true);
    expect(root.contains).toHaveBeenCalledWith(button);
  });

  it('identifies self-test and scenario controls that launch sound', () => {
    const scenario = {} as Element;
    const target = { closest: vi.fn(() => scenario) } as unknown as Element;
    const root = { contains: vi.fn(() => true) } as unknown as HTMLElement;

    expect(isDirectAudioActionTarget(target, root)).toBe(true);
  });

  it('identifies the file-check action that plays the selected track muted', () => {
    const checkButton = {} as Element;
    const target = { closest: vi.fn(() => checkButton) } as unknown as Element;
    const root = { contains: vi.fn(() => true) } as unknown as HTMLElement;

    expect(isDirectAudioActionTarget(target, root)).toBe(true);
    expect(root.contains).toHaveBeenCalledWith(checkButton);
  });

  it('does not classify a regular target or a control outside the app root as an audio action', () => {
    const outsideButton = {} as Element;
    const target = { closest: vi.fn(() => outsideButton) } as unknown as Element;
    const root = { contains: vi.fn(() => false) } as unknown as HTMLElement;

    expect(isDirectAudioActionTarget(target, root)).toBe(false);
    expect(isDirectAudioActionTarget({} as EventTarget, root)).toBe(false);
  });
});
