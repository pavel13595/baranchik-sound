import type { LocationIndex, LocationLookup, LocationNode } from './types';
import { buildLocationChain } from './alerts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function formatSelectedLocationDiagnostic(
  uid: string | null,
  locations: LocationIndex | null,
): string {
  if (!uid) return 'Оберіть місце в налаштуваннях';
  if (!locations) return `UID ${uid}; UID chain: ${uid}`;
  const selection = locationSelectionInfo(locations, uid);
  const name = selection ? selection.selected.name : `UID ${uid}`;
  const chain = buildLocationChain(uid, locations);
  return `${name}; UID chain: ${chain.join(' → ') || uid}`;
}

export function isLocationIndex(value: unknown): value is LocationIndex {
  if (!isRecord(value) || !Array.isArray(value.oblasts) || !isRecord(value.byUid)) {
    return false;
  }
  return typeof value.updatedAt === 'string' && Object.keys(value.byUid).length > 0;
}

export function sortLocations(items: LocationNode[]): LocationNode[] {
  return items.slice().sort((left, right) => left.name.localeCompare(right.name, 'uk'));
}

export interface LocationSelectionInfo {
  selected: LocationLookup;
  oblast: LocationLookup | null;
  raion: LocationLookup | null;
  community: LocationLookup | null;
  levelName: string;
  specialCity: boolean;
}

export function locationSelectionInfo(
  locations: LocationIndex,
  uid: string | number,
): LocationSelectionInfo | null {
  const selected = locations.byUid[String(uid)];
  if (!selected) {
    return null;
  }
  const oblast = locations.byUid[String(selected.oblastUid)] || null;
  const raion =
    selected.type === 'raion'
      ? selected
      : selected.raionUid
        ? locations.byUid[String(selected.raionUid)] || null
        : null;
  const community = selected.type === 'hromada' ? selected : null;
  const specialCity = selected.type === 'city' && selected.uid === selected.oblastUid;
  const levelName = community
    ? 'громада / місто'
    : raion
      ? 'район'
      : specialCity
        ? 'місто'
        : 'область';
  return { selected, oblast, raion, community, levelName, specialCity };
}

export function selectedLocationLabel(locations: LocationIndex, uid: string): string {
  const info = locationSelectionInfo(locations, uid);
  if (!info) return `UID ${uid}`;
  if (info.community) return info.community.name;
  if (info.raion) return `${info.raion.name} (весь район)`;
  if (info.specialCity) return info.selected.name;
  if (info.oblast) return `${info.oblast.name} (вся область)`;
  return info.selected.name;
}

export function communitiesForArea(locations: LocationIndex, oblastUid: string): LocationLookup[] {
  const result: LocationLookup[] = [];
  const oblast = locations.oblasts.find((item) => item.uid === String(oblastUid));
  if (!oblast) {
    return result;
  }
  (oblast.hromadas || []).forEach((item) => {
    const lookup = locations.byUid[String(item.uid)];
    if (lookup && lookup.type === 'hromada') {
      result.push(lookup);
    }
  });
  (oblast.raions || []).forEach((raion) => {
    (raion.hromadas || []).forEach((item) => {
      const lookup = locations.byUid[String(item.uid)];
      if (lookup && lookup.type === 'hromada') {
        result.push(lookup);
      }
    });
  });
  return result.sort((left, right) => left.name.localeCompare(right.name, 'uk'));
}
