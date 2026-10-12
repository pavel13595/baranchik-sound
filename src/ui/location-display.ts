import { selectedLocationLabel } from '../locations';
import type { LocationIndex } from '../types';

export interface SelectedLocationView {
  render(): void;
  destroy(): void;
}

export function bindSelectedLocationView(
  root: HTMLElement,
  getLocations: () => LocationIndex | null,
  getSelectedLocation: () => string | null,
): SelectedLocationView {
  const status = root.querySelector<HTMLElement>('[data-selected-location]');
  if (!status) {
    return { render: () => undefined, destroy: () => undefined };
  }

  const render = (): void => {
    const uid = getSelectedLocation();
    if (!uid) {
      status.textContent = 'Місто не обрано. Меню → Місто';
      return;
    }
    const locations = getLocations();
    status.textContent = locations
      ? `Місто: ${selectedLocationLabel(locations, uid)}`
      : `Місто: UID ${uid}`;
  };
  const onLocationChanged: EventListener = () => render();

  window.addEventListener('locationchanged', onLocationChanged);
  render();

  return {
    render,
    destroy: () => window.removeEventListener('locationchanged', onLocationChanged),
  };
}
