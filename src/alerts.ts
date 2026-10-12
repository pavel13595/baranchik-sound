import type { AlertLevel, LocationIndex } from './types';

export interface AlertRecord {
  location_title?: string | null;
  location_type?: string | null;
  location_raion?: string | null;
  location_oblast?: string | null;
  alert_type?: string;
  alert_level?: string | null;
  location_uid?: string | number | null;
  location_oblast_uid?: string | number | null;
  threats?: Array<{
    threat_type?: string | null;
    level?: string | null;
    started_at?: string | null;
    source_message?: string | null;
  }>;
}

export interface AlertLocationInspection {
  alert: AlertRecord;
  isOurs: boolean;
  reason: string;
}

export function buildLocationChain(uid: string | number, locations: LocationIndex): string[] {
  const requestedUid = String(uid);
  const selected = locations.byUid[requestedUid];
  if (!selected) {
    return [];
  }
  const chain = [requestedUid];
  if (selected.type === 'city' && selected.oblastUid === requestedUid) {
    return chain;
  }
  if (selected.raionUid && chain.indexOf(String(selected.raionUid)) < 0) {
    chain.push(String(selected.raionUid));
  }
  if (selected.oblastUid && chain.indexOf(String(selected.oblastUid)) < 0) {
    chain.push(String(selected.oblastUid));
  }
  return chain;
}

export function isAlertForLocation(
  alert: AlertRecord,
  locationUid: string | number,
  locations: LocationIndex,
): boolean {
  if (alert.alert_type !== 'air_raid') {
    return false;
  }
  const selected = locations.byUid[String(locationUid)];
  if (!selected) return false;
  const alertUid =
    alert.location_uid === undefined || alert.location_uid === null
      ? ''
      : String(alert.location_uid);
  const chain = buildLocationChain(locationUid, locations);
  if (chain.indexOf(alertUid) >= 0) return true;
  return (
    alert.location_type === 'oblast' &&
    String(alert.location_oblast_uid || alert.location_uid || '') === String(selected.oblastUid)
  );
}

export function filterOurAlerts(
  alerts: AlertRecord[],
  locationUid: string | number,
  locations: LocationIndex,
): AlertRecord[] {
  return alerts.filter((alert) => isAlertForLocation(alert, locationUid, locations));
}

function alertLevel(alert: AlertRecord): AlertLevel {
  if (alert.alert_level !== undefined && alert.alert_level !== null) {
    return String(alert.alert_level).toLowerCase() === 'yellow' ? 'yellow' : 'red';
  }

  const threatLevels = (alert.threats || []).map((threat) =>
    String(threat.level || '').toLowerCase(),
  );
  if (threatLevels.indexOf('red') !== -1) {
    return 'red';
  }
  if (threatLevels.indexOf('yellow') !== -1) {
    return 'yellow';
  }

  return 'red';
}

export function levelFor(
  alerts: AlertRecord[],
  locationUid: string | number | null,
  locations: LocationIndex,
): AlertLevel {
  if (locationUid === null || String(locationUid).length === 0) return 'none';
  const matching = filterOurAlerts(alerts, locationUid, locations);
  if (matching.length === 0) {
    return 'none';
  }

  return matching.some((alert) => alertLevel(alert) === 'red') ? 'red' : 'yellow';
}

export function inspectAlertLocations(
  alerts: AlertRecord[],
  locationUid: string | number,
  locations: LocationIndex,
): AlertLocationInspection[] {
  const selected = locations.byUid[String(locationUid)];
  if (!selected) return [];
  return alerts
    .filter((alert) => {
      return (
        String(alert.location_oblast_uid || alert.location_uid || '') === String(selected.oblastUid)
      );
    })
    .map((alert) => {
      const isOurs = isAlertForLocation(alert, locationUid, locations);
      const uid =
        alert.location_uid === undefined || alert.location_uid === null
          ? ''
          : String(alert.location_uid);
      const chain = buildLocationChain(locationUid, locations);
      const reason =
        alert.alert_type !== 'air_raid'
          ? 'Інший тип події, не air_raid'
          : chain.indexOf(uid) >= 0
            ? `UID ${uid} входить до ланцюжка обраного місця`
            : alert.location_type === 'oblast'
              ? 'Тривога на всю обрану область'
              : 'Інший район цієї області або не збігається UID';
      return { alert, isOurs, reason };
    });
}

export function getMatchingAlertLevel(
  alerts: AlertRecord[],
  locationUid: string | number,
  locations: LocationIndex,
): AlertLevel {
  return levelFor(alerts, locationUid, locations);
}
