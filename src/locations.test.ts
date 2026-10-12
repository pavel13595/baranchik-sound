import { describe, expect, it } from 'vitest';
import {
  communitiesForArea,
  formatSelectedLocationDiagnostic,
  isLocationIndex,
  locationSelectionInfo,
  selectedLocationLabel,
  sortLocations,
} from './locations';
import type { LocationIndex, LocationNode } from './types';

const locations: LocationIndex = {
  updatedAt: '2026-10-10T00:00:00Z',
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
          hromadas: [
            {
              uid: '1088',
              name: 'м. Кременчук та Кременчуцька територіальна громада',
              type: 'hromada',
            },
          ],
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
      name: 'м. Кременчук та Кременчуцька територіальна громада',
      type: 'hromada',
      oblastUid: '19',
      raionUid: '107',
    },
    '31': { uid: '31', name: 'м. Київ', type: 'city', oblastUid: '31', raionUid: null },
  },
};

describe('location index helpers', () => {
  it('validates index shape and sorts select options alphabetically in Ukrainian', () => {
    expect(isLocationIndex(locations)).toBe(true);
    const options: LocationNode[] = [
      { uid: '2', name: 'Чернігівська', type: 'oblast' },
      { uid: '1', name: 'Волинська', type: 'oblast' },
    ];
    expect(sortLocations(options).map((option) => option.name)).toEqual([
      'Волинська',
      'Чернігівська',
    ]);
  });

  it('returns selected hromada, raion and oblast context', () => {
    expect(locationSelectionInfo(locations, 1088)).toMatchObject({
      selected: { uid: '1088' },
      community: { uid: '1088' },
      raion: { uid: '107' },
      oblast: { uid: '19' },
      levelName: 'громада / місто',
    });
  });

  it('labels selected hromada, whole raion and whole oblast levels', () => {
    expect(selectedLocationLabel(locations, '1088')).toBe(
      'м. Кременчук та Кременчуцька територіальна громада',
    );
    expect(selectedLocationLabel(locations, '107')).toBe('Кременчуцький район (весь район)');
    expect(selectedLocationLabel(locations, '19')).toBe('Полтавська область (вся область)');
  });

  it('lists hromadas in the chosen oblast for the quick-search select', () => {
    expect(communitiesForArea(locations, '19').map((item) => item.uid)).toEqual(['1088']);
  });

  it('formats the current stored location for the self-test report', () => {
    expect(formatSelectedLocationDiagnostic('1088', locations)).toBe(
      'м. Кременчук та Кременчуцька територіальна громада; UID chain: 1088 → 107 → 19',
    );
    expect(formatSelectedLocationDiagnostic(null, locations)).toBe('Оберіть місце в налаштуваннях');
  });
});
