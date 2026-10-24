import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const viewports = [
  { width: 320, height: 568, name: '320x568' },
  { width: 375, height: 667, name: '375x667' },
  { width: 414, height: 896, name: '414x896' },
  { width: 600, height: 800, name: '600x800' },
  { width: 768, height: 1024, name: '768x1024' },
  { width: 1024, height: 768, name: '1024x768' },
  { width: 1280, height: 800, name: '1280x800' },
  { width: 1440, height: 900, name: '1440x900' },
  { width: 1920, height: 1080, name: '1920x1080' },
];

function overlaps(
  first: { x: number; y: number; right: number; bottom: number },
  second: { x: number; y: number; right: number; bottom: number },
): boolean {
  return (
    first.x < second.right &&
    first.right > second.x &&
    first.y < second.bottom &&
    first.bottom > second.y
  );
}

test('shows an audio unlock action before the first sound gesture', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('[data-audio-lock-banner]')).toBeVisible();
  await expect(page.locator('[data-audio-lock-message]')).toHaveText(
    'Натисніть кнопку, щоб увімкнути звук сигналів.',
  );
  await expect(page.locator('[data-audio-unlock]')).toBeEnabled();
  await page.locator('[data-audio-unlock]').click();
  await expect(page.locator('[data-audio-lock-banner]')).toBeHidden();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('[data-audio-lock-banner]')).toBeVisible();
});

test('toggles and remembers inverted screen orientation', async ({ page }) => {
  await page.goto('/');
  const orientationButton = page.locator('[data-orientation-toggle]');
  await expect(orientationButton).toBeVisible();
  await orientationButton.click();
  await expect(page.locator('#app')).toHaveClass(/app--inverted/);
  await expect(orientationButton).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('screenOrientationInverted')))
    .toBe('1');

  await orientationButton.click();
  await expect(page.locator('#app')).not.toHaveClass(/app--inverted/);
  await expect(orientationButton).toHaveAttribute('aria-pressed', 'false');
});

test('home screen and menu adapt without overlap in WebKit', async ({ page }) => {
  mkdirSync('design/screenshots', { recursive: true });

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/?sim=1');
    await expect(page.locator('[data-alert-title]')).toHaveText('Немає даних');
    await expect(page.locator('[data-audio-lock-banner]')).toBeVisible();
    await expect(page.locator('[data-audio-lock-message]')).toHaveText(
      'Натисніть кнопку, щоб увімкнути звук сигналів.',
    );
    const greetingsResponse = await page.request.get('/gamarjos.json');
    const greetingsManifest = (await greetingsResponse.json()) as {
      files: Array<{ src: string; title: string }>;
    };
    expect(greetingsManifest.files).toContainEqual({ src: 'gamarjos/Gamar.mp3', title: 'Gamar' });
    await expect(page.locator('[data-greeting-button]')).toBeEnabled();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.style.getPropertyValue('--hero-image')),
      )
      .toContain('hero.jpeg');
    await expect(page.locator('[data-menu-toggle="city"]')).toBeVisible();
    await expect(page.locator('[data-menu-toggle="city"]')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.locator('[data-stop-greeting]')).toBeHidden();
    await expect(page.locator('[data-stop-signals]')).toHaveCount(0);
    await expect(page.locator('.signal-stop-slot')).toHaveCount(0);

    await page.screenshot({
      path: `design/screenshots/${viewport.name}-menu.png`,
      fullPage: false,
      animations: 'disabled',
    });

    const closeButton = page.locator('[data-menu-close]');
    await expect(closeButton).toBeFocused();
    const closeBox = await closeButton.boundingBox();
    expect(closeBox).not.toBeNull();
    if (closeBox) {
      expect(closeBox.width).toBeGreaterThanOrEqual(48);
      expect(closeBox.height).toBeGreaterThanOrEqual(48);
      expect(closeBox.x).toBeGreaterThanOrEqual(0);
      expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(viewport.width);
      expect(closeBox.y + closeBox.height).toBeLessThanOrEqual(viewport.height);
    }

    await closeButton.click();
    await expect(page.locator('[data-settings-menu]')).toBeHidden();
    await page.screenshot({
      path: `design/screenshots/${viewport.name}-home.png`,
      fullPage: false,
      animations: 'disabled',
    });

    const homeMetrics = await page.evaluate(() => {
      const selectors = [
        '.alarm-block',
        '.music-block',
        '.greeting-block',
        '.signal-block',
        '.safety-notice',
      ];
      const boxes = selectors
        .map((selector) => document.querySelector(selector))
        .filter((element): element is Element => Boolean(element))
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden';
        })
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            selector: element.className,
            x: rect.x,
            y: rect.y,
            right: rect.right,
            bottom: rect.bottom,
          };
        });
      const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>('.home-screen button'),
      )
        .filter((button) => !button.hidden && button.offsetWidth > 0 && button.offsetHeight > 0)
        .map((button) => {
          const rect = button.getBoundingClientRect();
          return {
            label: button.innerText,
            x: rect.x,
            y: rect.y,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          };
        });
      const titleElement = document.querySelector('[data-venue-name]');
      const taglineElement = document.querySelector('[data-venue-tagline]');
      const clockElement = document.querySelector('[data-current-time]');
      const menuElement = document.querySelector('[data-menu-open]');
      const homeScreen = document.querySelector('.home-screen');
      const titleRect = titleElement ? titleElement.getBoundingClientRect() : new DOMRect();
      const taglineRect = taglineElement ? taglineElement.getBoundingClientRect() : new DOMRect();
      const clockRect = clockElement ? clockElement.getBoundingClientRect() : new DOMRect();
      const menuRect = menuElement ? menuElement.getBoundingClientRect() : new DOMRect();
      const topbar = document.querySelector('.topbar');
      const topbarChildren = topbar ? Array.from(topbar.children) : [];
      const fontFamily = homeScreen ? getComputedStyle(homeScreen).fontFamily : '';
      const blockOrder = Array.from(document.querySelectorAll('.home-screen > .card')).map(
        (element) =>
          element.classList.contains('alarm-block')
            ? 'alarm'
            : element.classList.contains('music-block')
              ? 'music'
              : element.classList.contains('greeting-block')
                ? 'greeting'
                : 'signals',
      );
      const stopParents = {
        greeting: Boolean(document.querySelector('.greeting-block [data-stop-greeting]')),
        alarm: Boolean(document.querySelector('.signal-block [data-stop-signals]')),
      };
      const cardRects: Record<
        string,
        { x: number; y: number; right: number; bottom: number; width: number; height: number }
      > = {};
      ['music', 'greeting', 'alarm', 'signals'].forEach((name) => {
        const selector = name === 'signals' ? '.signal-block' : `.${name}-block`;
        const card = document.querySelector(selector);
        if (card) {
          const rect = card.getBoundingClientRect();
          cardRects[name] = {
            x: rect.x,
            y: rect.y,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          };
        }
      });
      const shell = document.querySelector('.app-shell');
      const shellRect = shell ? shell.getBoundingClientRect() : new DOMRect();
      const homeStyle = homeScreen ? getComputedStyle(homeScreen) : null;
      const alertCard = document.querySelector('[data-alert-card]');
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        homeText: homeScreen ? homeScreen.textContent || '' : '',
        boxes,
        buttons,
        title: { x: titleRect.x, y: titleRect.y, right: titleRect.right, bottom: titleRect.bottom },
        tagline: {
          x: taglineRect.x,
          y: taglineRect.y,
          right: taglineRect.right,
          bottom: taglineRect.bottom,
        },
        clock: { x: clockRect.x, y: clockRect.y, right: clockRect.right, bottom: clockRect.bottom },
        menu: {
          x: menuRect.x,
          y: menuRect.y,
          right: menuRect.right,
          bottom: menuRect.bottom,
          width: menuRect.width,
          height: menuRect.height,
        },
        menuIsLastTopbarChild:
          topbarChildren.length > 0 && topbarChildren[topbarChildren.length - 1] === menuElement,
        fontFamily,
        blockOrder,
        stopParents,
        cardRects,
        shell: { x: shellRect.x, width: shellRect.width },
        grid: {
          display: homeStyle ? homeStyle.display : '',
          columns: homeStyle ? homeStyle.gridTemplateColumns : '',
          areas: homeStyle ? homeStyle.gridTemplateAreas : '',
        },
        alertHeight: alertCard ? alertCard.getBoundingClientRect().height : 0,
      };
    });

    expect(homeMetrics.scrollWidth, `${viewport.name} horizontal overflow`).toBeLessThanOrEqual(
      homeMetrics.innerWidth,
    );
    expect(homeMetrics.homeText).not.toMatch(
      /readyState|networkState|currentSrc|blob:|file\.type|mime|Вибрано|play\(\)/,
    );
    expect(homeMetrics.fontFamily).toContain('Raleway');
    expect(homeMetrics.blockOrder).toEqual(['alarm', 'music', 'greeting', 'signals']);
    expect(homeMetrics.stopParents).toEqual({ greeting: true, alarm: false });
    expect(homeMetrics.menuIsLastTopbarChild).toBe(true);
    expect(homeMetrics.menu.width).toBe(48);
    expect(homeMetrics.menu.height).toBe(48);
    expect(homeMetrics.menu.right).toBeLessThanOrEqual(viewport.width);
    expect(overlaps(homeMetrics.clock, homeMetrics.menu), `${viewport.name} clock/menu`).toBe(
      false,
    );
    expect(homeMetrics.title.y).toBeLessThan(homeMetrics.tagline.y);
    expect(overlaps(homeMetrics.title, homeMetrics.tagline), `${viewport.name} brand lines`).toBe(
      false,
    );
    if (viewport.width <= 375) {
      expect(
        overlaps(homeMetrics.tagline, homeMetrics.clock),
        `${viewport.name} tagline/clock`,
      ).toBe(false);
      expect(overlaps(homeMetrics.tagline, homeMetrics.menu), `${viewport.name} tagline/menu`).toBe(
        false,
      );
    }
    if (viewport.width >= 900) {
      expect(homeMetrics.grid.display).toBe('grid');
      expect(homeMetrics.grid.columns.split(' ')).toHaveLength(2);
      expect(homeMetrics.grid.areas).toContain('alarm music');
      expect(homeMetrics.grid.areas).toContain('helper gamarjos');
      expect(homeMetrics.cardRects.music.y).toBe(homeMetrics.cardRects.alarm.y);
      expect(homeMetrics.cardRects.signals.y).toBe(homeMetrics.cardRects.greeting.y);
      expect(homeMetrics.cardRects.music.height).toBe(homeMetrics.cardRects.alarm.height);
      expect(homeMetrics.cardRects.signals.height).toBe(homeMetrics.cardRects.greeting.height);
      expect(homeMetrics.cardRects.music.x).toBeGreaterThan(homeMetrics.cardRects.alarm.x);
      const maximumWidth = viewport.width >= 1400 ? 1200 : 1040;
      expect(homeMetrics.shell.width).toBeLessThanOrEqual(maximumWidth);
      expect(homeMetrics.shell.x).toBeCloseTo((viewport.width - homeMetrics.shell.width) / 2, 0);
    } else if (viewport.width >= 600) {
      expect(homeMetrics.grid.display).toBe('block');
      expect(homeMetrics.shell.width).toBeLessThanOrEqual(560);
      expect(homeMetrics.shell.x).toBeCloseTo((viewport.width - homeMetrics.shell.width) / 2, 0);
    }
    if (viewport.width === 375) expect(homeMetrics.alertHeight).toBeLessThanOrEqual(180);
    const glyphsLoaded = await page.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('400 16px Raleway', 'є і ї ґ апостроф');
    });
    expect(glyphsLoaded, `${viewport.name} Ukrainian font glyphs`).toBe(true);
    for (let first = 0; first < homeMetrics.boxes.length; first += 1) {
      for (let second = first + 1; second < homeMetrics.boxes.length; second += 1) {
        expect(
          overlaps(homeMetrics.boxes[first], homeMetrics.boxes[second]),
          `${viewport.name}: ${homeMetrics.boxes[first].selector} overlaps ${homeMetrics.boxes[second].selector}`,
        ).toBe(false);
      }
    }
    for (const button of homeMetrics.buttons) {
      expect(button.height, `${viewport.name}: ${button.label} height`).toBeGreaterThanOrEqual(48);
      expect(button.width, `${viewport.name}: ${button.label} width`).toBeGreaterThanOrEqual(44);
      expect(button.x, `${viewport.name}: ${button.label} left edge`).toBeGreaterThanOrEqual(0);
      expect(button.right, `${viewport.name}: ${button.label} right edge`).toBeLessThanOrEqual(
        viewport.width,
      );
    }
    if (viewport.width <= 320) {
      expect(overlaps(homeMetrics.title, homeMetrics.clock), `${viewport.name} title/clock`).toBe(
        false,
      );
      expect(homeMetrics.clock.y).toBeGreaterThanOrEqual(homeMetrics.title.bottom);
    }

    await page.locator('[data-menu-open]').first().click();
    await page.locator('[data-menu-toggle="diagnostics"]').click();
    await expect(page.locator('[data-menu-toggle="city"]')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(page.locator('[data-menu-toggle="diagnostics"]')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const menuMetrics = await page.evaluate(() => {
      const content = document.querySelector<HTMLElement>('.menu-content');
      const close = document.querySelector<HTMLElement>('[data-menu-close]');
      const menu = document.querySelector<HTMLElement>('[data-settings-menu]');
      if (!content || !close || !menu) return null;
      const rect = close.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      return {
        scrollHeight: content.scrollHeight,
        clientHeight: content.clientHeight,
        closeVisible: rect.top >= 0 && rect.bottom <= window.innerHeight,
        menuX: menuRect.x,
        menuRight: menuRect.right,
        menuWidth: menuRect.width,
        menuHeight: menuRect.height,
      };
    });
    expect(menuMetrics).not.toBeNull();
    if (menuMetrics) {
      expect(menuMetrics.closeVisible).toBe(true);
      expect(menuMetrics.scrollHeight).toBeGreaterThan(menuMetrics.clientHeight);
      if (viewport.width >= 900) {
        expect(menuMetrics.menuWidth).toBe(440);
        expect(menuMetrics.menuRight).toBe(viewport.width);
        expect(menuMetrics.menuX).toBe(viewport.width - 440);
        expect(menuMetrics.menuHeight).toBe(viewport.height);
      } else {
        expect(menuMetrics.menuWidth).toBe(viewport.width);
      }
    }

    if (viewport.width <= 360) {
      await page.locator('[data-menu-close]').click();
      await page.evaluate(() => window.scrollTo(0, 80));
      const savedScroll = await page.evaluate(() => window.pageYOffset);
      await page
        .locator('[data-menu-open]')
        .first()
        .evaluate((button) => {
          button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
      await page.locator('[data-menu-close]').click();
      await expect.poll(() => page.evaluate(() => window.pageYOffset)).toBe(savedScroll);
    }
    if (viewport.width > 320) {
      await page.locator('[data-menu-close]').click();
    }
    await expect(page.locator('[data-audio-lock-banner]')).toBeHidden();
    if (viewport.width >= 900) {
      await page.locator('[data-menu-open]').first().click();
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-settings-menu]')).toBeHidden();
      await page.locator('[data-menu-open]').first().click();
      await page.locator('[data-menu-backdrop]').click({ position: { x: 24, y: 24 } });
      await expect(page.locator('[data-settings-menu]')).toBeHidden();
    }
    await expect(page.locator('[data-menu-open]').first()).toBeFocused();
  }
});

test('a missing hero image leaves the light fallback without a page error', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/images/hero.jpeg', (route) => route.abort());
  await page.goto('/?sim=1');
  await expect(page.locator('[data-alert-title]')).toHaveText('Немає даних');

  const heroValue = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--hero-image').trim(),
  );
  expect(heroValue).toBe('none');
  expect(pageErrors).toEqual([]);
});

test('selected location updates status immediately and survives page refresh from menu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/?sim=1');
  await page.locator('[data-location-oblast]').selectOption('19');
  await page.locator('[data-location-raion]').selectOption('107');
  await page.locator('[data-location-hromada]').selectOption('1088');

  await expect(page.locator('[data-alert-title]')).toHaveText('Тихо');
  await expect(page.locator('[data-selected-location]')).toHaveText(
    'Місто: м. Кременчук та Кременчуцька територіальна громада',
  );
  await expect(page.locator('[data-api-status-text]')).toContainText("API: на зв'язку");
  await expect(page.locator('.home-screen')).not.toContainText('Оберіть місто');
  await expect(page.locator('.home-screen')).not.toContainText('API: оберіть місто');
  await page.locator('[data-menu-close]').click();
  await expect(page.locator('[data-settings-menu]')).toBeHidden();
  await page.locator('[data-manual-signal="red"]').click();
  await expect(page.locator('[data-signal-dialog-title]')).toHaveText('Увімкнути червоний сигнал?');
  await page.locator('[data-signal-cancel]').click();
  await expect(page.locator('[data-signal-dialog]')).toBeHidden();
  await expect(page.locator('[data-alert-title]')).toHaveText('Тихо');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('locationUid'))).toBe('1088');

  await page.locator('[data-menu-open]').first().click();
  await page.locator('[data-page-refresh]').click();
  await expect(page.locator('[data-selected-location]')).toHaveText(
    'Місто: м. Кременчук та Кременчуцька територіальна громада',
  );
  await expect(page.locator('[data-alert-title]')).toHaveText('Тихо');
});

test('greeting Stop remains available and manual alarms require confirmation', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('locationUid', '1088');
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: function () {
        return Promise.resolve();
      },
    });
  });
  await page.goto('/?sim=1');
  await expect(page.locator('[data-alert-title]')).toHaveText('Тихо');
  const initialAlertState = await page.locator('[data-diagnostic-status]').textContent();
  const greetingHeight = await page
    .locator('.greeting-block')
    .evaluate((element) => element.getBoundingClientRect().height);
  const alarmHeight = await page
    .locator('.signal-block')
    .evaluate((element) => element.getBoundingClientRect().height);

  await page.locator('[data-greeting-button]').click();
  await expect(page.locator('[data-greeting-label]')).toContainText('Грає…');
  await expect(page.locator('[data-stop-greeting]')).toBeEnabled();
  await expect(page.locator('[data-stop-greeting]')).toBeVisible();
  await expect
    .poll(() =>
      page.locator('.greeting-block').evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBe(greetingHeight);
  await expect(page.locator('[data-stop-signals]')).toHaveCount(0);
  await expect(page.locator('.signal-stop-slot')).toHaveCount(0);
  await expect(page.locator('[data-stop-greeting]')).toHaveClass(/button-primary/);
  await expect(page.locator('[data-stop-greeting]')).toHaveText('Стоп');
  await page.locator('[data-stop-greeting]').click();
  await expect(page.locator('[data-greeting-label]')).toHaveText('🎉 Гамарджос');
  await expect(page.locator('[data-stop-greeting]')).toBeHidden();
  await expect
    .poll(() =>
      page.locator('.greeting-block').evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBe(greetingHeight);

  await page.locator('[data-manual-signal="red"]').click();
  await expect(page.locator('[data-signal-dialog-title]')).toHaveText('Увімкнути червоний сигнал?');
  await page.locator('[data-signal-confirm]').click();
  await expect(page.locator('[data-stop-signals]')).toHaveCount(0);
  await expect(page.locator('.signal-stop-slot')).toHaveCount(0);
  await expect(page.locator('.signal-block .alarm-cancel-button')).toHaveCount(0);
  await expect(page.locator('[data-stop-greeting]')).toBeHidden();
  await expect
    .poll(() =>
      page.locator('.signal-block').evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBe(alarmHeight);
  await expect(page.locator('[data-alert-title]')).toHaveText('Тихо');
  await expect(page.locator('[data-diagnostic-status]')).toHaveText(initialAlertState || '');
  await expect
    .poll(() =>
      page.locator('.signal-block').evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBe(alarmHeight);
  await expect(page.locator('[data-alert-title]')).toHaveText('Тихо');
});

test('shows a helpful message when the proxy returns an HTML SPA page', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('locationUid', '1088'));
  await page.route('**/api/alerts', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body>SPA fallback</body></html>',
    }),
  );
  await page.goto('/');

  await expect(page.locator('[data-alert-description]')).toContainText('Сервер повернув не JSON');
  await expect(page.locator('[data-alert-description]')).toContainText('HTTP 200');
  await expect(page.locator('[data-alert-description]')).not.toContainText('Спроба');
});

test('serves branded manifest and icons allowed by the production CSP', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Baranchik Sound');
  const manifestResponse = await page.request.get('/manifest.webmanifest');
  expect(manifestResponse.status()).toBe(200);
  const manifest = (await manifestResponse.json()) as {
    name: string;
    short_name: string;
    icons: Array<{ src: string; sizes: string }>;
  };
  expect(manifest.name).toBe('Baranchik Sound');
  expect(manifest.short_name).toBe('Baranchik');
  expect(manifest.icons).toContainEqual({
    src: './icons/icon-192.png',
    sizes: '192x192',
    type: 'image/png',
  });
  expect(manifest.icons).toContainEqual({
    src: './icons/icon-512.png',
    sizes: '512x512',
    type: 'image/png',
  });

  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("img-src 'self' data:");
  const loadedWidth = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const icon = new Image();
        icon.onload = () => resolve(icon.naturalWidth);
        icon.onerror = () => reject(new Error('Production app icon failed to load'));
        icon.src = './icons/icon-192.png';
      }),
  );
  expect(loadedWidth).toBe(192);
});

test('keeps the sync target time inside its button on narrow screens', async ({ page }) => {
  for (const width of [320, 375, 414]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/?sim=1');
    const metrics = await page.locator('.music-block').evaluate((card) => {
      const music = card.querySelector<HTMLElement>('[data-home-music]');
      const empty = card.querySelector<HTMLElement>('[data-home-music-empty]');
      const button = card.querySelector<HTMLButtonElement>('.music-sync-button');
      const note = button ? button.querySelector<HTMLElement>('[data-sync-target-note]') : null;
      if (!music || !empty || !button || !note) return null;
      music.hidden = false;
      empty.hidden = true;
      note.textContent = '14:53 → 3:23:17';
      const buttonRect = button.getBoundingClientRect();
      const noteRect = note.getBoundingClientRect();
      return {
        buttonHeight: buttonRect.height,
        scrollHeight: button.scrollHeight,
        clientHeight: button.clientHeight,
        noteBottom: noteRect.bottom,
        buttonBottom: buttonRect.bottom,
      };
    });

    expect(metrics, `${width}px sync button`).not.toBeNull();
    if (metrics) {
      expect(metrics.buttonHeight).toBeGreaterThanOrEqual(56);
      expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight);
      expect(metrics.noteBottom).toBeLessThanOrEqual(metrics.buttonBottom);
    }
  }
});
