// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPasscode } from './passcode';

afterEach(() => {
  vi.useRealTimers();
});

function enterDigits(root: HTMLElement, digits: string): void {
  for (const digit of digits) {
    const button = root.querySelector<HTMLButtonElement>(`[data-passcode-digit="${digit}"]`);
    if (!button) throw new Error(`Missing passcode key ${digit}`);
    button.click();
  }
}

describe('passcode gate', () => {
  it('keeps the app locked until the correct code is entered', async () => {
    const root = document.createElement('main');
    const unlocked = requestPasscode(root);

    expect(root.querySelectorAll('[data-passcode-digit]')).toHaveLength(10);
    enterDigits(root, '2355');

    await expect(unlocked).resolves.toBeUndefined();
  });

  it('shows an error and resets the keypad after an incorrect code', async () => {
    vi.useFakeTimers();
    const root = document.createElement('main');
    const unlocked = requestPasscode(root);

    enterDigits(root, '0000');
    expect(root.querySelector('[data-passcode-status]')?.textContent).toBe('Неправильний код');
    expect(root.querySelectorAll('.passcode-dot--filled')).toHaveLength(4);

    await vi.advanceTimersByTimeAsync(700);

    expect(root.querySelector('[data-passcode-status]')?.textContent).toBe('Код доступу');
    expect(root.querySelectorAll('.passcode-dot--filled')).toHaveLength(0);
    enterDigits(root, '2355');
    await expect(unlocked).resolves.toBeUndefined();
  });
});
