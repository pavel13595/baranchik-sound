import { describe, expect, it } from 'vitest';
import { buildLocationIndex, parseLocationCsv } from './locations-data.mjs';

const csv = [
  'Адміністративно-територіальний устрій,,,',
  'UID ідентифікатори для API alerts.in.ua список,,,',
  'UID,Назва,Тип,Примітки',
  '8,Волинська область,Область,',
  '29,Автономна Республіка Крим,Область,',
  '31,м. Київ,Місто з спеціальним статусом,',
  '801,Волинський район,Район,',
  '802,"Тестова громада, перша",Громада,"Примітка з комою, перший рядок\nдругий рядок"',
  '19,Полтавська область,Область,',
  '1901,Кременчуцький район,Район,',
  '1902,м. Кременчук та Кременчуцька територіальна громада,Громада,',
].join('\n');

describe('locations spreadsheet parser and hierarchy', () => {
  it('parses the sheet header and quoted multiline CSV cells', () => {
    const rows = parseLocationCsv(csv);
    expect(rows).toHaveLength(8);
    expect(rows[4].notes).toBe('Примітка з комою, перший рядок\nдругий рядок');
  });

  it('keeps oblast context when Crimea and Kyiv rows interrupt the CSV order', () => {
    const result = buildLocationIndex(parseLocationCsv(csv));
    const volynRaion = result.locations.byUid['801'];
    const volynCommunity = result.locations.byUid['802'];

    expect(volynRaion).toMatchObject({ oblastUid: '8', raionUid: null });
    expect(volynCommunity).toMatchObject({ oblastUid: '8', raionUid: '801' });
    expect(result.report.raionsWithoutOblast).toEqual([]);
    expect(result.report.hromadasWithoutRaion).toEqual([]);
  });

  it('reports the Kremenchuk district and hromada UIDs from Poltava oblast', () => {
    const result = buildLocationIndex(parseLocationCsv(csv));

    expect(result.report.poltava.kremenchukRaion.uid).toBe('1901');
    expect(result.report.poltava.kremenchukCommunity.uid).toBe('1902');
    expect(result.locations.byUid['1902']).toMatchObject({ oblastUid: '19', raionUid: '1901' });
  });
});
