import { describe, expect, it, vi } from 'vitest';
import { preventPageZoom } from './zoom';

describe('preventPageZoom', () => {
  it('cancels Safari gesture events and multi-touch movement without changing single-touch behavior', () => {
    const handlers: Record<string, EventListener> = {};
    const documentRef = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        handlers[type] = listener;
      }),
    } as unknown as Document;
    preventPageZoom(documentRef);

    const preventGesture = vi.fn();
    handlers.gesturestart({ cancelable: true, preventDefault: preventGesture } as unknown as Event);
    expect(preventGesture).toHaveBeenCalledOnce();

    const preventPinch = vi.fn();
    handlers.touchmove({
      cancelable: true,
      touches: { length: 2 },
      preventDefault: preventPinch,
    } as unknown as TouchEvent);
    expect(preventPinch).toHaveBeenCalledOnce();

    const preventScroll = vi.fn();
    handlers.touchmove({
      cancelable: true,
      touches: { length: 1 },
      preventDefault: preventScroll,
    } as unknown as TouchEvent);
    expect(preventScroll).not.toHaveBeenCalled();
  });
});
