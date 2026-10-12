import { describe, expect, it } from 'vitest';
import {
  buildLocationChain,
  filterOurAlerts,
  inspectAlertLocations,
  levelFor,
  type AlertRecord,
} from './alerts';
import type { LocationIndex } from './types';

const locations: LocationIndex = {
  updatedAt: '',
  oblasts: [],
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
    '1083': {
      uid: '1083',
      name: 'Глобинська територіальна громада',
      type: 'hromada',
      oblastUid: '19',
      raionUid: '107',
    },
    '109': {
      uid: '109',
      name: 'Полтавський район',
      type: 'raion',
      oblastUid: '19',
      raionUid: null,
    },
    '1060': {
      uid: '1060',
      name: 'Полтавська територіальна громада',
      type: 'hromada',
      oblastUid: '19',
      raionUid: '109',
    },
    '9': {
      uid: '9',
      name: 'Дніпропетровська область',
      type: 'oblast',
      oblastUid: '9',
      raionUid: null,
    },
    '31': { uid: '31', name: 'м. Київ', type: 'city', oblastUid: '31', raionUid: null },
    '30': { uid: '30', name: 'м. Севастополь', type: 'city', oblastUid: '30', raionUid: null },
  },
};

function alert(overrides: Partial<AlertRecord> = {}): AlertRecord {
  return {
    location_title: 'м. Кременчук та Кременчуцька територіальна громада',
    location_type: 'hromada',
    location_uid: '1088',
    location_oblast: 'Полтавська область',
    location_oblast_uid: '19',
    alert_type: 'air_raid',
    alert_level: 'yellow',
    ...overrides,
  };
}

describe('UID-based alert matching', () => {
  it('builds community → raion → oblast chain', () => {
    expect(buildLocationChain('1088', locations)).toEqual(['1088', '107', '19']);
  });

  it('matches an alert on the selected community', () => {
    expect(filterOurAlerts([alert()], '1088', locations)).toHaveLength(1);
  });

  it('matches an alert on the selected community raion', () => {
    expect(
      filterOurAlerts([alert({ location_type: 'raion', location_uid: 107 })], 1088, locations),
    ).toHaveLength(1);
  });

  it('matches an oblast-wide alert for the selected oblast', () => {
    expect(
      filterOurAlerts(
        [alert({ location_type: 'oblast', location_uid: 19, location_oblast_uid: 19 })],
        '1088',
        locations,
      ),
    ).toHaveLength(1);
  });

  it('does not match a different raion in the same oblast', () => {
    expect(
      filterOurAlerts(
        [
          alert({
            location_title: 'Полтавський район',
            location_type: 'raion',
            location_uid: '109',
          }),
        ],
        '1088',
        locations,
      ),
    ).toEqual([]);
  });

  it('does not match an alert in another oblast', () => {
    expect(
      filterOurAlerts(
        [alert({ location_uid: '9', location_type: 'oblast', location_oblast_uid: '9' })],
        '1088',
        locations,
      ),
    ).toEqual([]);
  });

  it('ignores non-air-raid alerts even when their UID matches', () => {
    expect(
      filterOurAlerts([alert({ alert_type: 'artillery_shelling' })], '1088', locations),
    ).toEqual([]);
  });

  it('normalizes numeric and string UIDs', () => {
    expect(filterOurAlerts([alert({ location_uid: 1088 })], 1088, locations)).toHaveLength(1);
  });

  it('uses only the selected UID chain for Kyiv and Sevastopol', () => {
    expect(buildLocationChain('31', locations)).toEqual(['31']);
    expect(buildLocationChain('30', locations)).toEqual(['30']);
    expect(
      filterOurAlerts([alert({ location_uid: '19', location_type: 'oblast' })], '31', locations),
    ).toEqual([]);
  });

  it('lists all active alerts in the selected oblast with ownership reasons', () => {
    const results = inspectAlertLocations(
      [
        alert(),
        alert({ location_uid: '109', location_type: 'raion', location_title: 'Полтавський район' }),
        alert({ location_uid: '9', location_type: 'oblast', location_oblast_uid: '9' }),
      ],
      '1088',
      locations,
    );
    expect(results).toHaveLength(2);
    expect(results.map((item) => item.isOurs)).toEqual([true, false]);
    expect(results[1].reason).toContain('Інший район');
  });
});

describe('alert level', () => {
  it('returns none without a selected UID', () => {
    expect(levelFor([alert()], null, locations)).toBe('none');
  });

  it('returns none when no alert UID matches', () => {
    expect(levelFor([alert({ location_uid: '109' })], '1088', locations)).toBe('none');
  });

  it('gives red priority over yellow matches', () => {
    expect(
      levelFor(
        [alert(), alert({ alert_level: 'red', location_type: 'raion', location_uid: '107' })],
        '1088',
        locations,
      ),
    ).toBe('red');
  });

  it('uses the highest threat level when alert_level is absent', () => {
    expect(
      levelFor(
        [alert({ alert_level: undefined, threats: [{ level: 'yellow' }, { level: 'red' }] })],
        '1088',
        locations,
      ),
    ).toBe('red');
  });

  it('defaults to red when both alert_level and threats are absent', () => {
    expect(
      levelFor([alert({ alert_level: undefined, threats: undefined })], '1088', locations),
    ).toBe('red');
  });
});
