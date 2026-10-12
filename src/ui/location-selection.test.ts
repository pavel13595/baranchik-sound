/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSelectedLocation, saveSelectedLocation } from '../settings';
import type { LocationIndex } from '../types';
import { bindSelectedLocationView } from './location-display';
import { setupLocationSelection } from './location-selection';

const locations: LocationIndex = {
  updatedAt: '',
  oblasts: [
    {
      uid: '19',
      name: 'Полтавська область',
      type: 'oblast',
      raions: [
        {
          uid: '107',
          name: 'Кременчуцький район',
          type: 'raion',
          hromadas: [{ uid: '1088', name: 'Кременчуцька громада', type: 'hromada' }],
        },
      ],
      hromadas: [],
    },
  ],
  byUid: {
    '19': {
      uid: '19',
      name: 'Полтавська область',
      type: 'oblast',
      oblastUid: '19',
      raionUid: null,
    },
    '107': {
      uid: '107',
      name: 'Кременчуцький район',
      type: 'raion',
      oblastUid: '19',
      raionUid: null,
    },
    '1088': {
      uid: '1088',
      name: 'Кременчуцька громада',
      type: 'hromada',
      oblastUid: '19',
      raionUid: '107',
    },
  },
};

function createRoot(): HTMLElement {
  document.body.innerHTML = `
    <div>
      <select data-location-oblast></select>
      <div data-location-raion-field><select data-location-raion></select></div>
      <div data-location-hromada-field><input data-location-search /><select data-location-hromada></select></div>
      <p data-location-explanation></p>
      <p data-selected-location></p>
    </div>`;
  return document.body.firstElementChild as HTMLElement;
}

function selectedLocationText(root: HTMLElement): string {
  const element = root.querySelector<HTMLElement>('[data-selected-location]');
  return element ? element.textContent || '' : '';
}

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('location selection persistence and notification', () => {
  it('updates the selected place and UI on community, district and oblast changes', () => {
    const root = createRoot();
    const changed = vi.fn();
    window.addEventListener('locationchanged', changed);
    const selectedView = bindSelectedLocationView(root, () => locations, getSelectedLocation);
    setupLocationSelection(root, locations, getSelectedLocation(), (uid) => {
      saveSelectedLocation(uid || '');
    });

    const oblast = root.querySelector<HTMLSelectElement>('[data-location-oblast]');
    const raion = root.querySelector<HTMLSelectElement>('[data-location-raion]');
    const hromada = root.querySelector<HTMLSelectElement>('[data-location-hromada]');
    if (!oblast || !raion || !hromada) throw new Error('Location selectors missing');

    oblast.value = '19';
    oblast.dispatchEvent(new Event('change', { bubbles: true }));
    expect(getSelectedLocation()).toBe('19');
    expect(selectedLocationText(root)).toBe('Місто: Полтавська область (вся область)');

    raion.value = '107';
    raion.dispatchEvent(new Event('change', { bubbles: true }));
    expect(getSelectedLocation()).toBe('107');
    expect(selectedLocationText(root)).toBe('Місто: Кременчуцький район (весь район)');

    hromada.value = '1088';
    hromada.dispatchEvent(new Event('change', { bubbles: true }));
    expect(getSelectedLocation()).toBe('1088');
    expect(selectedLocationText(root)).toBe('Місто: Кременчуцька громада');
    expect(changed).toHaveBeenCalledTimes(3);
    selectedView.destroy();
    window.removeEventListener('locationchanged', changed);
  });

  it('restores the stored selection when the location controls initialize again', () => {
    expect(saveSelectedLocation('1088')).toBe(true);
    const root = createRoot();
    const selectedView = bindSelectedLocationView(root, () => locations, getSelectedLocation);
    setupLocationSelection(root, locations, getSelectedLocation(), (uid) => {
      saveSelectedLocation(uid || '');
    });

    const oblast = root.querySelector<HTMLSelectElement>('[data-location-oblast]');
    const raion = root.querySelector<HTMLSelectElement>('[data-location-raion]');
    const hromada = root.querySelector<HTMLSelectElement>('[data-location-hromada]');
    expect(oblast && oblast.value).toBe('19');
    expect(raion && raion.value).toBe('107');
    expect(hromada && hromada.value).toBe('1088');
    expect(selectedLocationText(root)).toBe('Місто: Кременчуцька громада');
    selectedView.destroy();
  });
});
