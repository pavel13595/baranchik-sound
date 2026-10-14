function twoDigits(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function isSimulationMode(): boolean {
  return new URLSearchParams(window.location.search).get('sim') === '1';
}

function setupSimulation(root: HTMLElement): void {
  const simulator = root.querySelector<HTMLSelectElement>('[data-sim-alert]');

  if (simulator) {
    simulator.addEventListener('change', () => {
      root.dispatchEvent(new CustomEvent('alerts-simulation-change', { detail: simulator.value }));
    });
  }
}

function setupMenu(root: HTMLElement): void {
  const menu = root.querySelector<HTMLElement>('[data-settings-menu]');
  const backdrop = root.querySelector<HTMLElement>('[data-menu-backdrop]');
  const closeButton = root.querySelector<HTMLButtonElement>('[data-menu-close]');
  const refreshButton = root.querySelector<HTMLButtonElement>('[data-page-refresh]');
  const burgerButton = root.querySelector<HTMLButtonElement>('[data-menu-open]');
  const openButtons = root.querySelectorAll<HTMLButtonElement>('[data-menu-open]');
  const sectionButtons = root.querySelectorAll<HTMLButtonElement>('[data-menu-toggle]');
  if (!menu || !backdrop || !closeButton) return;

  let savedScrollY = 0;
  let returnFocus: HTMLElement | null = burgerButton;

  const showSection = (name: string): void => {
    sectionButtons.forEach((button) => {
      const expanded = button.getAttribute('data-menu-toggle') === name;
      button.setAttribute('aria-expanded', String(expanded));
      const panelId = button.getAttribute('aria-controls');
      const panel = panelId ? document.getElementById(panelId) : null;
      if (panel) panel.hidden = !expanded;
    });
  };

  const closeMenu = (): void => {
    if (menu.hidden) return;
    menu.hidden = true;
    backdrop.hidden = true;
    document.body.classList.remove('menu-open');
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.style.top = '';
    if (burgerButton) burgerButton.setAttribute('aria-expanded', 'false');
    if (returnFocus) returnFocus.focus();
    const restoreScroll = (): void => {
      document.documentElement.scrollTop = savedScrollY;
      document.body.scrollTop = savedScrollY;
      window.scrollTo(0, savedScrollY);
    };
    window.requestAnimationFrame(restoreScroll);
    window.setTimeout(restoreScroll, 0);
  };

  const openMenu = (section: string, trigger: HTMLElement | null): void => {
    if (menu.hidden) {
      savedScrollY = window.pageYOffset || 0;
      returnFocus = trigger || burgerButton;
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${savedScrollY}px`;
      document.body.classList.add('menu-open');
    }
    menu.hidden = false;
    backdrop.hidden = false;
    if (burgerButton) burgerButton.setAttribute('aria-expanded', 'true');
    if (section) showSection(section);
    closeButton.focus();
  };

  openButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const section = button.getAttribute('data-menu-section') || '';
      openMenu(section, button);
    });
  });
  sectionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const name = button.getAttribute('data-menu-toggle') || '';
      const isExpanded = button.getAttribute('aria-expanded') === 'true';
      showSection(isExpanded ? '' : name);
    });
  });

  root.addEventListener('menu-open', (event) => {
    const customEvent = event as CustomEvent<string>;
    openMenu(customEvent.detail || '', burgerButton);
  });
  closeButton.addEventListener('click', closeMenu);
  if (refreshButton) {
    refreshButton.addEventListener('click', () => window.location.reload());
  }
  backdrop.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
}

export function renderView(root: HTMLElement): void {
  const simulatorMarkup = isSimulationMode()
    ? `
      <section class="simulator-panel" aria-labelledby="sim-title">
        <h3 class="panel-title" id="sim-title">Симуляція</h3>
        <div class="form-field">
          <label for="sim-alert">Підмінити відповідь API</label>
          <select id="sim-alert" data-sim-alert>
            <option value="none">Тихо</option>
            <option value="yellow">Жовтий рівень</option>
            <option value="red">Червоний рівень</option>
            <option value="network-error">Помилка мережі</option>
            <option value="stale">Застарілі дані</option>
          </select>
        </div>
        <button type="button" data-run-scenario>Прогнати сценарій</button>
        <p class="supporting-copy" data-scenario-result role="status" aria-live="polite"></p>
      </section>`
    : '';

  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <h1 class="brand-title" data-venue-name>Той самий Баранчик</h1>
          <p class="brand-tagline" data-venue-tagline></p>
        </div>
        <div class="topbar-meta">
          <time class="current-time" data-current-time>--:--</time>
          <span class="header-warning" data-header-warning hidden></span>
        </div>
        <button class="menu-open-button" type="button" data-menu-open aria-label="Відкрити меню" aria-expanded="false" aria-controls="settings-menu" title="Меню">☰</button>
      </header>

      <div class="audio-lock-banner" data-audio-lock-banner role="status" aria-live="polite" hidden><span data-audio-lock-message></span></div>

      <main class="home-screen">
        <section class="card alarm-block alert-card alert-card--no-data" data-alert-card role="status" aria-live="polite" aria-label="Стан тривоги: немає даних">
          <div class="alert-copy">
            <h2 class="alert-title" data-alert-title>Немає даних</h2>
            <p class="alert-description" data-alert-description>Немає даних про тривогу</p>
          </div>
          <div class="alert-context">
            <p class="selected-location" data-selected-location>Місто не обрано. Меню → Місто</p>
            <p class="api-status api-status--missing-location" data-api-status role="status" aria-live="polite"><span data-api-status-text>● API: оберіть місто</span></p>
          </div>
        </section>

        <section class="card music-block" aria-label="Музика">
          <div class="home-music" data-home-music hidden aria-label="Керування музикою">
            <p class="card-title track-title" data-track-title>Музику не вибрано</p>
            <p class="track-position" data-track-position>--:-- / --:--</p>
            <div class="music-actions">
              <button class="button-primary music-home-toggle" type="button" data-music-toggle disabled><span data-music-icon aria-hidden="true">▶</span><span data-music-label>Грати</span></button>
              <button class="button-primary music-sync-button" type="button" data-sync-now disabled><span>⏱ На поточний час</span><small data-sync-target-note>Завантажте музику</small></button>
            </div>
            <button class="text-action" type="button" data-custom-time-open>Інший час…</button>
          </div>
          <div class="home-music-empty" data-home-music-empty aria-label="Музику не вибрано">
            <p class="card-title">Музику не вибрано</p>
            <button class="button-primary" type="button" data-menu-open data-menu-section="music">Вибрати в меню</button>
          </div>
        </section>

        <section class="card greeting-block" aria-label="Гамарджос">
          <p class="card-title">Вітання з днем народження</p>
          <div class="greeting-actions">
            <button class="button-primary gamarjos-button" type="button" data-greeting-button disabled><span data-greeting-label>🎉 Гамарджос</span></button>
            <button class="button-primary is-hidden" type="button" data-stop-greeting disabled>Стоп</button>
          </div>
        </section>

        <section class="card signal-block" aria-label="Допоміжні сигнали">
          <p class="card-title">Ручний запуск сигналів тривоги</p>
          <div class="signal-buttons" aria-label="Ручні сигнали">
            <button class="signal-button signal-button--yellow" type="button" data-manual-signal="yellow">Жовтий</button>
            <button class="signal-button signal-button--red" type="button" data-manual-signal="red">Червоний</button>
            <button class="signal-button signal-button--clear" type="button" data-manual-signal="clear">Відбій</button>
          </div>
        </section>
      </main>

      <p class="home-toast" data-home-toast role="status" aria-live="polite" hidden></p>
      <footer class="safety-notice">Допоміжний інструмент закладу. Не замінює офіційні сирени та сповіщення.</footer>
      <p class="supporting-copy" data-audio-feedback role="status" aria-live="polite" hidden></p>

      <div class="menu-backdrop" data-menu-backdrop hidden></div>
      <aside class="settings-menu" id="settings-menu" data-settings-menu aria-label="Меню" hidden>
        <div class="menu-header"><h2>Меню</h2><button class="menu-close-button" type="button" data-menu-close aria-label="Закрити меню">✕</button></div>
        <div class="menu-content">
          <button class="secondary-button menu-refresh-button" type="button" data-page-refresh><span aria-hidden="true">↻</span> Оновити сторінку</button>
          <section class="menu-section">
            <button class="menu-section-toggle" type="button" data-menu-toggle="music" aria-expanded="false" aria-controls="menu-panel-music">Музика</button>
            <div class="menu-section-content" id="menu-panel-music" hidden>
              <input class="music-picker-input" id="music-files" data-music-files type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,audio/mpeg,audio/mp4,audio/x-m4a" />
              <label class="button-primary music-picker-label" for="music-files">Вибрати музику</label>
              <button class="secondary-button music-check-button" type="button" data-music-file-check disabled>Перевірити файл</button>
              <p class="selected-file-name" data-selected-music-file>Файл не вибрано</p>
              <p class="music-status" data-music-status>Музику не вибрано</p>
              <div class="form-field"><label for="music-sync-start">Початок відліку</label><input id="music-sync-start" data-music-sync-start type="time" value="11:30" /></div>
              <p class="supporting-copy">На iPhone виберіть локальний аудіофайл у «Файлах». Файл із «Музики» або лише з iCloud може бути недоступний.</p>
              <p class="supporting-copy" data-music-feedback>Після перезавантаження сторінки локальні файли потрібно вибрати знову.</p>
              <p class="supporting-copy music-file-progress" data-music-file-progress role="status" aria-live="polite" hidden></p>
              <p class="music-file-report" data-music-file-report role="status" aria-live="polite"></p>
              <p class="supporting-copy" data-music-play-result role="status" aria-live="polite"></p>
            </div>
          </section>
          <section class="menu-section">
            <button class="menu-section-toggle" type="button" data-menu-toggle="city" aria-expanded="false" aria-controls="menu-panel-city">Місто</button>
            <div class="menu-section-content" id="menu-panel-city" hidden>
              <div class="form-field"><label for="location-oblast">Область</label><select id="location-oblast" data-location-oblast disabled><option value="">Завантаження довідника…</option></select></div>
              <div class="form-field" data-location-raion-field hidden><label for="location-raion">Район</label><select id="location-raion" data-location-raion disabled><option value="">Уся область</option></select></div>
              <div class="form-field" data-location-hromada-field hidden><label for="location-search">Пошук громади</label><input id="location-search" data-location-search type="search" autocomplete="off" /><label for="location-hromada">Громада / місто</label><select id="location-hromada" data-location-hromada disabled><option value="">Увесь район</option></select></div>
              <p class="supporting-copy" data-location-explanation>Оберіть місто для відстеження тривог</p>
              <button class="secondary-button reset-location-button" type="button" data-reset-location>Скинути вибір</button>
              <div class="location-error" data-location-error hidden><p>Довідник локацій не завантажено</p><button class="secondary-button" type="button" data-retry-locations>Завантажити довідник</button></div>
              <div class="form-field" data-location-manual hidden><label for="manual-location-uid">UID локації</label><input id="manual-location-uid" data-manual-location-uid type="number" min="1" inputmode="numeric" /><button class="secondary-button" type="button" data-find-location>Знайти в довіднику</button><p class="supporting-copy" data-manual-location-feedback role="status" aria-live="polite"></p></div>
            </div>
          </section>
          <section class="menu-section" data-menu-section="token" hidden>
            <button class="menu-section-toggle" type="button" data-menu-toggle="token" aria-expanded="false" aria-controls="menu-panel-token">Токен</button>
            <div class="menu-section-content" id="menu-panel-token" hidden>
              <div class="form-field" data-token-field><label for="alerts-token">Токен</label><div class="token-input-row"><input id="alerts-token" data-alert-token type="password" autocomplete="off" placeholder="Введіть токен" /><button class="secondary-button" type="button" data-token-visibility aria-pressed="false">Показати</button></div><p class="supporting-copy">Токен зберігається на цьому пристрої.</p><p class="supporting-copy" data-token-feedback role="status" aria-live="polite"></p></div>
              <div class="menu-action-row" data-token-actions><button class="button-primary" type="button" data-save-settings>Зберегти</button><button class="secondary-button" type="button" data-verify-token>Перевірити токен</button><p class="supporting-copy" data-settings-feedback role="status" aria-live="polite"></p></div>
            </div>
          </section>
          <section class="menu-section">
            <button class="menu-section-toggle" type="button" data-menu-toggle="diagnostics" aria-expanded="false" aria-controls="menu-panel-diagnostics">Діагностика</button>
            <div class="menu-section-content" id="menu-panel-diagnostics" hidden>
              <dl class="diagnostic-list"><div class="diagnostic-row"><dt>Клас помилки API</dt><dd data-diag-api-error-class>—</dd></div><div class="diagnostic-row"><dt>HTTP код</dt><dd data-diag-api-error-status>—</dd></div><div class="diagnostic-row"><dt>Content-Type</dt><dd data-diag-api-error-content-type>—</dd></div><div class="diagnostic-row"><dt>Шлях запиту</dt><dd data-diag-api-error-path>—</dd></div><div class="diagnostic-row"><dt>Початок відповіді</dt><dd data-diag-api-error-body>—</dd></div><div class="diagnostic-row"><dt>Підказка API</dt><dd data-diag-api-error-message>—</dd></div></dl>
              <dl class="diagnostic-list">
                <div class="diagnostic-row"><dt>Мережа</dt><dd data-diag-network>—</dd></div><div class="diagnostic-row"><dt>Останнє успішне опитування</dt><dd data-diagnostic-time>—</dd></div><div class="diagnostic-row"><dt>Запити API за хвилину</dt><dd data-diag-api-requests>0</dd></div><div class="diagnostic-row"><dt>Стан тривоги</dt><dd data-diagnostic-status>Очікує запуску</dd></div><div class="diagnostic-row"><dt>Джерело звуку</dt><dd data-diag-audio-source>—</dd></div><div class="diagnostic-row"><dt>Стан музики</dt><dd data-diag-music-state>—</dd></div><div class="diagnostic-row"><dt>music.readyState</dt><dd data-diag-music-ready-state>—</dd></div><div class="diagnostic-row"><dt>music.networkState</dt><dd data-diag-music-network-state>—</dd></div><div class="diagnostic-row"><dt>music.paused</dt><dd data-diag-music-paused>—</dd></div><div class="diagnostic-row"><dt>music.error.code</dt><dd data-diag-music-error-code>—</dd></div><div class="diagnostic-row"><dt>music.currentSrc</dt><dd data-diag-music-current-src>—</dd></div><div class="diagnostic-row"><dt>file.type</dt><dd data-diag-music-file-type>—</dd></div><div class="diagnostic-row"><dt>mime</dt><dd data-diag-music-mime>—</dd></div><div class="diagnostic-row"><dt>Розмір файла</dt><dd data-diag-music-file-size>—</dd></div><div class="diagnostic-row"><dt>sig.readyState</dt><dd data-diag-sig-ready-state>—</dd></div><div class="diagnostic-row"><dt>sig.networkState</dt><dd data-diag-sig-network-state>—</dd></div><div class="diagnostic-row"><dt>sig.paused</dt><dd data-diag-sig-paused>—</dd></div><div class="diagnostic-row"><dt>sig.error.code</dt><dd data-diag-sig-error-code>—</dd></div><div class="diagnostic-row"><dt>sig.currentSrc</dt><dd data-diag-sig-current-src>—</dd></div><div class="diagnostic-row"><dt>Останній результат play()</dt><dd data-diag-last-play-result>—</dd></div><div class="diagnostic-row"><dt>Часовий пояс</dt><dd data-diag-timezone>—</dd></div><div class="diagnostic-row"><dt>Годинник сервера</dt><dd data-clock-diagnostic>Не перевірено</dd></div><div class="diagnostic-row"><dt>Збірка</dt><dd data-diag-build>—</dd></div><div class="diagnostic-row"><dt>Екран</dt><dd data-diag-screen>—</dd></div><div class="diagnostic-row"><dt>Браузер</dt><dd data-diag-user-agent>—</dd></div><div class="diagnostic-row"><dt>Звук розблоковано</dt><dd data-diag-audio-unlocked>Ні</dd></div><div class="diagnostic-row"><dt>До metadata</dt><dd data-diag-music-load>—</dd></div><div class="diagnostic-row"><dt>Останній код помилки audio</dt><dd data-diag-music-error>—</dd></div><div class="diagnostic-row"><dt>musicWanted</dt><dd data-diag-music-wanted>Ні</dd></div><div class="diagnostic-row"><dt>Точність перемотки</dt><dd data-diag-seek-result>—</dd></div>
              </dl>
              <label class="field-label" for="music-seek">Позиція файлу</label><input id="music-seek" data-music-seek type="range" min="0" max="0" value="0" aria-label="Перемотати музику" disabled />
              <p class="music-live-diagnostics" data-music-live-status aria-live="polite">Аудіо очікує вибору файлу.</p>
              <div class="menu-action-row"><button class="button-primary" type="button" data-self-test-run>Запустити самотест</button><button class="secondary-button" type="button" data-copy-diagnostics>Копіювати звіт</button></div>
              <p class="supporting-copy" data-diagnostic-copy-hint hidden>Затисніть поле, виберіть «Виділити все» і «Копіювати».</p><textarea class="diagnostic-copy-fallback" data-diagnostic-copy-fallback readonly hidden aria-label="Звіт діагностики для копіювання"></textarea>
              <h3 class="panel-title diagnostic-events-title">Самотест</h3><dl class="diagnostic-list" data-self-test-results><div class="diagnostic-row"><dt>Браузер</dt><dd data-self-test-browser>Очікує</dd></div><div class="diagnostic-row"><dt>Конфігурація</dt><dd data-self-test-config>Очікує</dd></div><div class="diagnostic-row"><dt>Файли сигналів</dt><dd data-self-test-files>Очікує</dd></div><div class="diagnostic-row"><dt>Звук</dt><dd data-self-test-sound>Очікує</dd></div><div class="diagnostic-row"><dt>Музика</dt><dd data-self-test-music>Очікує</dd></div><div class="diagnostic-row"><dt>Обране місце</dt><dd data-self-test-location>Очікує</dd></div><div class="diagnostic-row"><dt>API</dt><dd data-self-test-api>Очікує</dd></div><div class="diagnostic-row"><dt>Ключі відповіді</dt><dd data-self-test-api-shape>Очікує</dd></div><div class="diagnostic-row"><dt>Зіставлення тривог</dt><dd data-self-test-filter>Очікує</dd></div><div class="diagnostic-row"><dt>Годинник</dt><dd data-self-test-clock>Очікує</dd></div><div class="diagnostic-results" data-self-test-alerts aria-live="polite"></div><div class="diagnostic-row"><dt>Підсумок</dt><dd data-self-test-summary>Не запущено</dd></div></dl>
              <p class="supporting-copy" data-test-tone-result role="status" aria-live="polite"></p><h3 class="panel-title diagnostic-events-title">Перевірка файлів сигналів (HEAD)</h3><div class="diagnostic-results" data-signal-head-results aria-live="polite">Перевірка виконується…</div><h3 class="panel-title diagnostic-events-title">Останні події audio</h3><ol class="diagnostic-events" data-audio-event-log aria-live="polite"></ol><div class="diagnostic-results" data-diagnostic-results aria-live="polite"></div><h3 class="panel-title diagnostic-events-title">Останні події</h3><ol class="diagnostic-events" data-diagnostic-events></ol>
              <details class="wake-hint" data-wake-fallback hidden><summary>Підказка про автоблокування</summary><p>Wake Lock недоступний. Змініть автоблокування екрана в налаштуваннях пристрою.</p></details>
            </div>
          </section>
          <section class="menu-section">
            <button class="menu-section-toggle" type="button" data-menu-toggle="about" aria-expanded="false" aria-controls="menu-panel-about">Про застосунок</button>
            <div class="menu-section-content" id="menu-panel-about" hidden><p>Версія збірки: <span data-about-build>—</span></p><p class="supporting-copy">Допоміжний інструмент закладу. Не замінює офіційні сирени та сповіщення.</p></div>
          </section>
          ${simulatorMarkup}
        </div>
      </aside>

      <div class="app-dialog-backdrop" data-time-dialog hidden><section class="app-dialog" role="dialog" aria-modal="true" aria-labelledby="time-dialog-title"><h2 id="time-dialog-title">Перейти до іншого часу</h2><label for="custom-music-time">Час</label><input id="custom-music-time" data-custom-music-time type="time" value="13:00" /><p class="supporting-copy" data-custom-time-note></p><div class="dialog-actions"><button class="button-primary" type="button" data-custom-time-apply>Перейти</button><button class="secondary-button" type="button" data-custom-time-cancel>Скасувати</button></div></section></div>
      <div class="app-dialog-backdrop" data-signal-dialog hidden><section class="app-dialog" role="dialog" aria-modal="true" aria-labelledby="signal-dialog-title"><h2 id="signal-dialog-title" data-signal-dialog-title>Увімкнути сигнал?</h2><div class="dialog-actions"><button class="button-primary" type="button" data-signal-confirm>Так, увімкнути</button><button class="secondary-button" type="button" data-signal-cancel>Скасувати</button></div></section></div>
      <audio id="music" class="audio-element" preload="metadata" loop aria-hidden="true"></audio><audio id="sig" class="audio-element" preload="none" aria-hidden="true"></audio>
    </div>`;

  const clock = root.querySelector<HTMLElement>('[data-current-time]');

  const updateClock = (): void => {
    const now = new Date();
    const displayTime = `${twoDigits(now.getHours())}:${twoDigits(now.getMinutes())}`;
    if (clock) clock.textContent = displayTime;
  };

  updateClock();
  window.setInterval(updateClock, 1000);
  setupMenu(root);
  setupSimulation(root);
}
