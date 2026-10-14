import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderView } from './view';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderMarkup(): string {
  const root = {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => [],
  } as unknown as HTMLElement;
  vi.stubGlobal('window', {
    location: { search: '' },
    setInterval: vi.fn(),
  });
  renderView(root);
  return root.innerHTML;
}

describe('home screen markup', () => {
  it('keeps technical audio details out of the home screen', () => {
    const markup = renderMarkup();
    const homeScreen = /<main class="home-screen">([\s\S]*?)<\/main>/.exec(markup);

    expect(homeScreen).not.toBeNull();
    expect(homeScreen ? homeScreen[1] : '').not.toMatch(
      /readyState|networkState|currentSrc|blob:|file\.type|mime|Вибрано|play\(\)/,
    );
  });

  it('keeps one music input and both audio elements in the view', () => {
    const markup = renderMarkup();

    expect(markup.match(/data-music-files/g)).toHaveLength(1);
    expect(markup.match(/<audio\b/g)).toHaveLength(2);
    expect(markup).toContain('data-menu-toggle="city"');
    expect(markup).toContain('data-menu-toggle="diagnostics"');
    expect(markup).toContain('data-page-refresh');
    expect(markup).toContain('id="music" class="audio-element" preload="metadata" loop');
    expect(markup).not.toMatch(/<audio[^>]+(?:crossorigin|autoplay)/i);
    expect(markup).toContain('data-music-file-check');
    expect(markup).toContain(
      'class="music-picker-input" id="music-files" data-music-files type="file"',
    );
    expect(markup).toContain('data-music-file-report role="status"');
  });

  it('orders four cards and keeps manual controls outside the information card', () => {
    const markup = renderMarkup();
    const home = /<main class="home-screen">([\s\S]*?)<\/main>/.exec(markup);
    const homeMarkup = home ? home[1] : '';
    const order = [
      homeMarkup.indexOf('class="card alarm-block'),
      homeMarkup.indexOf('class="card music-block'),
      homeMarkup.indexOf('class="card greeting-block'),
      homeMarkup.indexOf('class="card signal-block'),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual(order.slice().sort((left, right) => left - right));

    const alarmMarkup = /<section class="card alarm-block[^>]*>([\s\S]*?)<\/section>/.exec(
      homeMarkup,
    );
    expect(alarmMarkup).not.toBeNull();
    expect(alarmMarkup ? alarmMarkup[1] : '').not.toContain('<button');
    expect(homeMarkup).toContain('class="card signal-block"');
    expect(homeMarkup).toContain('data-stop-greeting disabled');
    expect(homeMarkup).not.toContain('data-stop-signals');
    expect(homeMarkup).not.toContain('signal-stop-slot');
  });

  it('uses compact alert and uniform home-card headings without legacy sound controls', () => {
    const markup = renderMarkup();
    const home = /<main class="home-screen">([\s\S]*?)<\/main>/.exec(markup);
    const homeMarkup = home ? home[1] : '';
    const alarmMarkup = /<section class="card alarm-block[^>]*>([\s\S]*?)<\/section>/.exec(
      homeMarkup,
    );

    expect(alarmMarkup).not.toBeNull();
    expect(alarmMarkup ? alarmMarkup[1] : '').not.toMatch(/card-heading|alert-icon|updated-time/);
    expect(homeMarkup.match(/class="card-title/g)).toHaveLength(4);
    expect(homeMarkup).not.toMatch(
      /header-sound|alarm-cancel-button|Звук вимкнено|data-stop-alarm/,
    );
    expect(homeMarkup).toContain('data-stop-greeting disabled>Стоп</button>');
  });

  it('places the menu opener after the brand and clock in the topbar', () => {
    const markup = renderMarkup();
    const topbar = /<header class="topbar">([\s\S]*?)<\/header>/.exec(markup);
    const headerMarkup = topbar ? topbar[1] : '';
    const order = [
      headerMarkup.indexOf('class="brand"'),
      headerMarkup.indexOf('data-current-time'),
      headerMarkup.indexOf('data-menu-open'),
    ];

    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual(order.slice().sort((left, right) => left - right));
    expect(headerMarkup.trim().endsWith('</button>')).toBe(true);
    expect(headerMarkup).toContain(
      '<div class="brand">\n          <h1 class="brand-title" data-venue-name>',
    );
  });
});
