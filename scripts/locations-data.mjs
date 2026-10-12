import { parse } from 'csv-parse/sync';

const ROOT_LOCATION_UIDS = [
  '3',
  '4',
  '5',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
  '28',
  '29',
  '30',
  '31',
];
const SPECIAL_CITY_UIDS = new Set(['30', '31']);
const CRIMEA_UID = '29';

function normalize(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('uk-UA');
}

function normalizedType(value) {
  const type = normalize(value);
  if (type === 'область') return 'oblast';
  if (type === 'район') return 'raion';
  if (type === 'громада') return 'hromada';
  if (
    type.indexOf('місто з спеціальним статусом') !== -1 ||
    type.indexOf('місто зі спеціальним статусом') !== -1
  ) {
    return 'city';
  }
  return 'unknown';
}

export function parseLocationCsv(csvText) {
  const rows = parse(csvText, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  });
  const headerIndex = rows.findIndex(
    (row) =>
      normalize(row[0]) === 'uid' && normalize(row[1]) === 'назва' && normalize(row[2]) === 'тип',
  );
  if (headerIndex < 0) {
    throw new Error('В CSV не знайдено заголовки UID, Назва, Тип');
  }

  return rows
    .slice(headerIndex + 1)
    .filter((row) => row.length >= 3 && String(row[0] || '').trim() && String(row[1] || '').trim())
    .map((row) => ({
      uid: String(row[0]).trim(),
      name: String(row[1]).trim(),
      type: normalizedType(row[2]),
      sourceType: String(row[2]).trim(),
      notes: String(row[3] || '').trim(),
    }));
}

export function buildLocationIndex(rows) {
  const oblasts = [];
  const byUid = {};
  const raionsWithoutOblast = [];
  const hromadasWithoutRaion = [];
  const unknownTypes = [];
  const duplicateUids = [];
  let currentOblast = null;
  let currentRaion = null;

  rows.forEach((row) => {
    const uid = String(row.uid).trim();
    const name = String(row.name).trim();
    let type = row.type || normalizedType(row.sourceType);
    if (!uid || !name) return;
    if (byUid[uid]) {
      duplicateUids.push({ uid, name });
      return;
    }

    if (uid === CRIMEA_UID && type === 'oblast') {
      oblasts.push({ uid, name, type, raions: [], hromadas: [] });
      byUid[uid] = { uid, name, type, oblastUid: uid, raionUid: null };
      return;
    }

    if (SPECIAL_CITY_UIDS.has(uid) || type === 'city') {
      type = 'city';
      oblasts.push({ uid, name, type, raions: [], hromadas: [] });
      byUid[uid] = { uid, name, type, oblastUid: uid, raionUid: null };
      return;
    }

    if (type === 'oblast') {
      const oblast = { uid, name, type, raions: [], hromadas: [] };
      oblasts.push(oblast);
      byUid[uid] = { uid, name, type, oblastUid: uid, raionUid: null };
      currentOblast = oblast;
      currentRaion = null;
      return;
    }

    if (type === 'raion') {
      if (!currentOblast) {
        raionsWithoutOblast.push({ uid, name });
        currentRaion = null;
        return;
      }
      const raion = { uid, name, type, hromadas: [] };
      currentOblast.raions.push(raion);
      byUid[uid] = { uid, name, type, oblastUid: currentOblast.uid, raionUid: null };
      currentRaion = raion;
      return;
    }

    if (type === 'hromada') {
      if (!currentOblast || !currentRaion) {
        hromadasWithoutRaion.push({ uid, name });
        if (currentOblast) {
          currentOblast.hromadas.push({ uid, name, type });
          byUid[uid] = {
            uid,
            name,
            type,
            oblastUid: currentOblast.uid,
            raionUid: null,
          };
        }
        return;
      }
      currentRaion.hromadas.push({ uid, name, type });
      byUid[uid] = {
        uid,
        name,
        type,
        oblastUid: currentOblast.uid,
        raionUid: currentRaion.uid,
      };
      return;
    }

    unknownTypes.push({ uid, name, sourceType: row.sourceType || 'не вказано' });
  });

  const missingRootUids = ROOT_LOCATION_UIDS.filter((uid) => !byUid[uid]);
  const raionCount = oblasts.reduce((count, oblast) => count + oblast.raions.length, 0);
  const hromadaCount = oblasts.reduce((count, oblast) => {
    return (
      count +
      oblast.hromadas.length +
      oblast.raions.reduce((inner, raion) => inner + raion.hromadas.length, 0)
    );
  }, 0);
  const raionsPerOblast = oblasts.map((oblast) => ({
    uid: oblast.uid,
    name: oblast.name,
    count: oblast.raions.length,
  }));
  const poltava = oblasts.find(
    (oblast) => oblast.uid === '19' || normalize(oblast.name) === 'полтавська область',
  );
  const kremenchukRaion = poltava
    ? poltava.raions.find((raion) => normalize(raion.name) === 'кременчуцький район')
    : null;
  const kremenchukCandidates = [];
  if (poltava) {
    poltava.raions.forEach((raion) => {
      raion.hromadas.forEach((item) => {
        if (normalize(item.name).indexOf('кременчук') !== -1) {
          kremenchukCandidates.push(item);
        }
      });
    });
  }
  const kremenchukCommunity =
    kremenchukCandidates.find((item) => {
      const name = normalize(item.name);
      return (
        name === 'м. кременчук та кременчуцька територіальна громада' ||
        name.indexOf('кременчуцька територіальна громада') !== -1
      );
    }) || null;

  return {
    locations: { updatedAt: new Date().toISOString(), oblasts, byUid },
    report: {
      oblastCount: oblasts.length,
      raionCount,
      hromadaCount,
      raionsPerOblast,
      raionsWithoutOblast,
      hromadasWithoutRaion,
      unknownTypes,
      duplicateUids,
      missingRootUids,
      poltava: {
        raions: poltava ? poltava.raions : [],
        kremenchukRaion,
        kremenchukCommunity,
        kremenchukCandidates,
      },
    },
  };
}
