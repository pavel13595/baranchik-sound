import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLocationIndex, parseLocationCsv } from './locations-data.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const outputPath = path.join(projectRoot, 'public/locations.json');
const fallbackPath = path.join(projectRoot, 'data/locations.csv');
const sourceUrl =
  'https://docs.google.com/spreadsheets/d/1XnTOzcPHd1LZUrarR1Fk43FUyl8Ae6a6M7pcwDRjNdA/export?format=csv&gid=0';

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function summarizeExisting(locations) {
  const oblasts = Array.isArray(locations.oblasts) ? locations.oblasts : [];
  const byUid = locations.byUid && typeof locations.byUid === 'object' ? locations.byUid : {};
  let raionCount = 0;
  let hromadaCount = 0;
  const raionsPerOblast = oblasts.map((oblast) => {
    const raions = Array.isArray(oblast.raions) ? oblast.raions : [];
    raionCount += raions.length;
    hromadaCount += Array.isArray(oblast.hromadas) ? oblast.hromadas.length : 0;
    raions.forEach((raion) => {
      hromadaCount += Array.isArray(raion.hromadas) ? raion.hromadas.length : 0;
    });
    return { uid: oblast.uid, name: oblast.name, count: raions.length };
  });
  const raionsWithoutOblast = [];
  const hromadasWithoutRaion = [];
  Object.keys(byUid).forEach((uid) => {
    const entry = byUid[uid];
    if (entry.type === 'raion' && !entry.oblastUid) {
      raionsWithoutOblast.push({ uid, name: entry.name });
    }
    if (entry.type === 'hromada' && !entry.raionUid) {
      hromadasWithoutRaion.push({ uid, name: entry.name });
    }
  });
  const poltava = oblasts.find((oblast) => String(oblast.uid) === '19');
  const kremenchukRaion =
    poltava &&
    poltava.raions.find((raion) => raion.name.toLocaleLowerCase('uk-UA') === 'кременчуцький район');
  const kremenchukCandidates = [];
  if (poltava) {
    poltava.raions.forEach((raion) => {
      (raion.hromadas || []).forEach((hromada) => {
        if (hromada.name.toLocaleLowerCase('uk-UA').indexOf('кременчук') !== -1) {
          kremenchukCandidates.push(hromada);
        }
      });
    });
  }
  const kremenchukCommunity =
    kremenchukCandidates.find((hromada) => {
      const name = hromada.name.toLocaleLowerCase('uk-UA');
      return (
        name === 'м. кременчук та кременчуцька територіальна громада' ||
        name.indexOf('кременчуцька територіальна громада') !== -1
      );
    }) || null;
  return {
    oblastCount: oblasts.length,
    raionCount,
    hromadaCount,
    raionsPerOblast,
    raionsWithoutOblast,
    hromadasWithoutRaion,
    unknownTypes: [],
    duplicateUids: [],
    missingRootUids: [],
    poltava: {
      raions: poltava ? poltava.raions : [],
      kremenchukRaion: kremenchukRaion || null,
      kremenchukCommunity,
      kremenchukCandidates,
    },
  };
}

function printReport(report, source) {
  console.log(`Locations source: ${source}`);
  console.log(`Областей и специальных городов: ${report.oblastCount}`);
  console.log(`Районов: ${report.raionCount}`);
  console.log(`Громад: ${report.hromadaCount}`);
  report.raionsPerOblast.forEach((oblast) => {
    console.log(`Районы ${oblast.name} (UID ${oblast.uid}): ${oblast.count}`);
  });
  console.log(
    `Районы без области: ${report.raionsWithoutOblast.length ? JSON.stringify(report.raionsWithoutOblast) : 'нет'}`,
  );
  console.log(
    `Громады без района: ${report.hromadasWithoutRaion.length ? JSON.stringify(report.hromadasWithoutRaion) : 'нет'}`,
  );
  if (report.unknownTypes.length > 0) {
    console.warn(`Предупреждение: неизвестные типы строк: ${JSON.stringify(report.unknownTypes)}`);
  }
  if (report.duplicateUids.length > 0) {
    console.warn(
      `Предупреждение: повторные UID пропущены: ${JSON.stringify(report.duplicateUids)}`,
    );
  }
  if (report.missingRootUids.length > 0) {
    console.warn(
      `Предупреждение: отсутствуют UID областей/спецгородов: ${report.missingRootUids.join(', ')}`,
    );
  }
  if (report.oblastCount !== 27) {
    console.warn(
      `Предупреждение: ожидалось 27 областей и специальных городов, получено ${report.oblastCount}`,
    );
  }
  console.log('Полтавская область — районы и громады:');
  report.poltava.raions.forEach((raion) => {
    console.log(`- ${raion.name} (UID ${raion.uid})`);
    (raion.hromadas || []).forEach((hromada) => {
      console.log(`  - ${hromada.name} (UID ${hromada.uid})`);
    });
  });
  console.log(
    `UID Кременчуцького району: ${report.poltava.kremenchukRaion ? report.poltava.kremenchukRaion.uid : 'НЕ НАЙДЕНО'}`,
  );
  console.log(
    `UID «м. Кременчук та Кременчуцька територіальна громада»: ${report.poltava.kremenchukCommunity ? report.poltava.kremenchukCommunity.uid : 'НЕ НАЙДЕНО'}`,
  );
  if (!report.poltava.kremenchukCommunity && report.poltava.kremenchukCandidates.length > 0) {
    console.log('Кандидаты с «Кременчук» в названии:');
    report.poltava.kremenchukCandidates.forEach((item) =>
      console.log(`- ${item.name} (UID ${item.uid})`),
    );
  }
}

async function loadExistingLocations() {
  if (!(await pathExists(outputPath))) {
    return null;
  }
  try {
    return JSON.parse(await readFile(outputPath, 'utf8'));
  } catch {
    return null;
  }
}

async function loadCsv() {
  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return { text: await response.text(), source: sourceUrl };
  } catch (networkError) {
    console.warn(
      `Не удалось скачать таблицу локаций (${networkError instanceof Error ? networkError.message : 'ошибка сети'}).`,
    );
  }

  try {
    return { text: await readFile(fallbackPath, 'utf8'), source: 'data/locations.csv' };
  } catch {
    const existing = await loadExistingLocations();
    if (existing) {
      console.warn('CSV недоступен; используем уже существующий public/locations.json.');
      printReport(summarizeExisting(existing), 'public/locations.json (cached)');
      return null;
    }
    throw new Error(
      'Нет CSV таблицы или существующего public/locations.json; скачайте таблицу в data/locations.csv.',
    );
  }
}

const loaded = await loadCsv();
if (loaded) {
  const rows = parseLocationCsv(loaded.text);
  const result = buildLocationIndex(rows);
  await writeFile(outputPath, `${JSON.stringify(result.locations, null, 2)}\n`);
  printReport(result.report, loaded.source);
}
