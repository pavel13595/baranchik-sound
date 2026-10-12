import { communitiesForArea, locationSelectionInfo, sortLocations } from '../locations';
import type { LocationIndex, LocationNode } from '../types';

function replaceOptions(
  select: HTMLSelectElement,
  placeholder: string,
  items: LocationNode[],
  selectedUid = '',
): void {
  while (select.firstChild) {
    select.removeChild(select.firstChild);
  }
  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = placeholder;
  select.appendChild(placeholderOption);
  sortLocations(items).forEach((item) => {
    const option = document.createElement('option');
    option.value = item.uid;
    option.textContent = item.name;
    select.appendChild(option);
  });
  select.value = selectedUid;
}

function explanation(locations: LocationIndex, uid: string): string {
  const info = locationSelectionInfo(locations, uid);
  if (!info) {
    return 'Оберіть місто в налаштуваннях';
  }
  if (info.specialCity) {
    return `Відстежуємо: ${info.selected.name}. Сигнали спрацюють на тривогу в ${info.selected.name}.`;
  }
  if (info.community && info.raion && info.oblast) {
    return `Відстежуємо: ${info.community.name}. Сигнали спрацюють на тривогу в ${info.community.name}, у ${info.raion.name} або в усій ${info.oblast.name}. Тривога в іншому районі цієї області вас не стосується.`;
  }
  if (info.raion && info.oblast) {
    return `Відстежуємо: ${info.raion.name}. Сигнали спрацюють на тривогу у ${info.raion.name} або в усій ${info.oblast.name}. Тривога в іншому районі цієї області вас не стосується.`;
  }
  return `Відстежуємо: ${info.selected.name}. Сигнали спрацюють на тривогу в усій ${info.selected.name}.`;
}

export function setupLocationSelection(
  root: HTMLElement,
  locations: LocationIndex,
  initialUid: string | null,
  onChange: (uid: string | null) => void,
): (uid: string) => boolean {
  const oblastSelect = root.querySelector<HTMLSelectElement>('[data-location-oblast]');
  const raionSelect = root.querySelector<HTMLSelectElement>('[data-location-raion]');
  const hromadaSelect = root.querySelector<HTMLSelectElement>('[data-location-hromada]');
  const raionField = root.querySelector<HTMLElement>('[data-location-raion-field]');
  const hromadaField = root.querySelector<HTMLElement>('[data-location-hromada-field]');
  const searchInput = root.querySelector<HTMLInputElement>('[data-location-search]');
  const explanationNode = root.querySelector<HTMLElement>('[data-location-explanation]');
  if (!oblastSelect || !raionSelect || !hromadaSelect) {
    return () => false;
  }

  const roots = sortLocations(locations.oblasts);
  oblastSelect.disabled = false;
  replaceOptions(oblastSelect, 'Оберіть область', roots, '');
  let currentUid: string | null = null;

  const selectedOblast = (): LocationNode | null => {
    for (let index = 0; index < roots.length; index += 1) {
      if (roots[index].uid === oblastSelect.value) return roots[index];
    }
    return null;
  };

  const refreshRaions = (selectedUid: string): void => {
    const oblast = selectedOblast();
    const special = oblast !== null && oblast.type === 'city';
    if (raionField) raionField.hidden = !oblast || special;
    if (hromadaField) hromadaField.hidden = !oblast || special;
    raionSelect.disabled = !oblast || special;
    hromadaSelect.disabled = !oblast || special;
    if (!oblast || special) {
      replaceOptions(raionSelect, 'Уся область', [], '');
      replaceOptions(hromadaSelect, 'Увесь район', [], '');
      return;
    }
    replaceOptions(raionSelect, 'Уся область', oblast.raions || [], '');
    raionSelect.value = selectedUid;
    refreshHromadas('');
  };

  const refreshHromadas = (preferredUid: string): void => {
    const oblast = selectedOblast();
    if (!oblast) {
      replaceOptions(hromadaSelect, 'Увесь район', [], '');
      return;
    }
    const search = searchInput ? searchInput.value.trim().toLocaleLowerCase('uk') : '';
    let items: LocationNode[] = [];
    if (search) {
      communitiesForArea(locations, oblast.uid).forEach((item) => {
        if (item.name.toLocaleLowerCase('uk').indexOf(search) !== -1) {
          items.push(item);
        }
      });
    } else if (raionSelect.value) {
      const raion = (oblast.raions || []).find((item) => item.uid === raionSelect.value);
      items = raion ? raion.hromadas || [] : [];
    }
    replaceOptions(hromadaSelect, 'Увесь район', items, preferredUid);
  };

  const commitSelection = (): void => {
    const oblast = selectedOblast();
    if (!oblast) {
      currentUid = null;
    } else if (oblast.type === 'city') {
      currentUid = oblast.uid;
    } else {
      currentUid = hromadaSelect.value || raionSelect.value || oblast.uid;
    }
    if (explanationNode) {
      explanationNode.textContent = currentUid
        ? explanation(locations, currentUid)
        : 'Оберіть місто в налаштуваннях';
    }
    onChange(currentUid);
  };

  oblastSelect.addEventListener('change', () => {
    if (searchInput) searchInput.value = '';
    refreshRaions('');
    commitSelection();
  });
  raionSelect.addEventListener('change', () => {
    if (searchInput) searchInput.value = '';
    refreshHromadas('');
    commitSelection();
  });
  hromadaSelect.addEventListener('change', () => {
    const item = locations.byUid[hromadaSelect.value];
    if (item && item.raionUid && item.raionUid !== raionSelect.value) {
      raionSelect.value = item.raionUid;
      refreshHromadas(item.uid);
    }
    commitSelection();
  });
  if (searchInput) {
    searchInput.addEventListener('input', () => refreshHromadas(hromadaSelect.value));
  }

  const selectUid = (uid: string): boolean => {
    if (!uid) {
      oblastSelect.value = '';
      if (searchInput) searchInput.value = '';
      refreshRaions('');
      commitSelection();
      return true;
    }
    const info = locationSelectionInfo(locations, uid);
    if (!info) return false;
    oblastSelect.value = info.oblast ? info.oblast.uid : info.selected.uid;
    if (searchInput) searchInput.value = '';
    refreshRaions(info.raion ? info.raion.uid : '');
    if (info.community) hromadaSelect.value = info.community.uid;
    commitSelection();
    return true;
  };

  if (!initialUid || !selectUid(initialUid)) {
    refreshRaions('');
    if (explanationNode) {
      explanationNode.textContent = 'Оберіть місто в налаштуваннях';
    }
    onChange(null);
  }
  return selectUid;
}
