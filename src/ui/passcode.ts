const ACCESS_CODE = '2355';

function passcodeMarkup(): string {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const numberKeys = keys
    .map(
      (key) =>
        `<button class="passcode-key" type="button" data-passcode-digit="${key}">${key}</button>`,
    )
    .join('');

  return `
    <section class="passcode-screen" role="dialog" aria-modal="true" aria-labelledby="passcode-title">
      <div class="passcode-content">
        <p class="passcode-brand">Baranchik Sound</p>
        <h1 class="passcode-title" id="passcode-title">Введіть код</h1>
        <div class="passcode-indicators" data-passcode-indicators role="img" aria-label="Код: 0 з 4 цифр">
          <span class="passcode-dot"></span><span class="passcode-dot"></span><span class="passcode-dot"></span><span class="passcode-dot"></span>
        </div>
        <p class="passcode-status" data-passcode-status role="status" aria-live="polite">Код доступу</p>
        <div class="passcode-keypad" role="group" aria-label="Цифрова клавіатура">
          ${numberKeys}
          <span class="passcode-key-spacer" aria-hidden="true"></span>
          <button class="passcode-key" type="button" data-passcode-digit="0">0</button>
          <button class="passcode-key passcode-delete" type="button" data-passcode-delete aria-label="Видалити останню цифру">⌫</button>
        </div>
      </div>
    </section>`;
}

export function requestPasscode(root: HTMLElement): Promise<void> {
  root.innerHTML = passcodeMarkup();

  return new Promise((resolve) => {
    const screen = root.querySelector<HTMLElement>('.passcode-screen');
    const indicators = root.querySelector<HTMLElement>('[data-passcode-indicators]');
    const status = root.querySelector<HTMLElement>('[data-passcode-status]');
    const dots = root.querySelectorAll<HTMLElement>('.passcode-dot');
    const buttons = root.querySelectorAll<HTMLButtonElement>('.passcode-key');
    let enteredCode = '';
    let isChecking = false;
    let errorTimer = 0;

    const updateIndicators = (): void => {
      dots.forEach((dot, index) => {
        dot.classList.toggle('passcode-dot--filled', index < enteredCode.length);
      });
      if (indicators) {
        indicators.setAttribute('aria-label', `Код: ${enteredCode.length} з 4 цифр`);
      }
    };

    const cleanup = (): void => {
      root.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
      window.clearTimeout(errorTimer);
    };

    const finish = (): void => {
      cleanup();
      resolve();
    };

    const submitDigit = (digit: string): void => {
      if (isChecking || enteredCode.length >= ACCESS_CODE.length) return;
      enteredCode += digit;
      updateIndicators();

      if (enteredCode.length !== ACCESS_CODE.length) return;
      if (enteredCode === ACCESS_CODE) {
        finish();
        return;
      }

      isChecking = true;
      if (screen) screen.classList.add('passcode-screen--error');
      if (status) status.textContent = 'Неправильний код';
      buttons.forEach((button) => {
        button.disabled = true;
      });
      errorTimer = window.setTimeout(() => {
        enteredCode = '';
        isChecking = false;
        if (screen) screen.classList.remove('passcode-screen--error');
        if (status) status.textContent = 'Код доступу';
        buttons.forEach((button) => {
          button.disabled = false;
        });
        updateIndicators();
      }, 700);
    };

    const deleteDigit = (): void => {
      if (isChecking || enteredCode.length === 0) return;
      enteredCode = enteredCode.slice(0, -1);
      updateIndicators();
    };

    function handleClick(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>(
        '[data-passcode-digit], [data-passcode-delete]',
      );
      if (!button) return;
      event.preventDefault();
      if (button.hasAttribute('data-passcode-delete')) {
        deleteDigit();
      } else {
        submitDigit(button.getAttribute('data-passcode-digit') || '');
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        submitDigit(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        deleteDigit();
      }
    }

    root.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeyDown);
  });
}
