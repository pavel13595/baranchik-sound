interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  offsetMinutes: number;
}

function timestampFromParts(parts: DateParts): number | null {
  if (
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > 31 ||
    parts.hour > 23 ||
    parts.minute > 59 ||
    parts.second > 59
  ) {
    return null;
  }

  let timestamp = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );

  if (parts.year >= 0 && parts.year < 100) {
    const adjusted = new Date(timestamp);
    adjusted.setUTCFullYear(parts.year);
    timestamp = adjusted.getTime();
  }

  const calendarDate = new Date(timestamp);
  if (
    calendarDate.getUTCFullYear() !== parts.year ||
    calendarDate.getUTCMonth() + 1 !== parts.month ||
    calendarDate.getUTCDate() !== parts.day
  ) {
    return null;
  }

  return timestamp - parts.offsetMinutes * 60 * 1000;
}

function offsetMinutes(sign: string, hours: string, minutes: string): number | null {
  const parsedHours = Number(hours);
  const parsedMinutes = Number(minutes);
  if (parsedHours > 23 || parsedMinutes > 59) {
    return null;
  }

  const multiplier = sign === '-' ? -1 : 1;
  return multiplier * (parsedHours * 60 + parsedMinutes);
}

export function parseApiTimestamp(value: string): Date | null {
  const input = value.trim();
  const legacy = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(
    input,
  );
  if (legacy) {
    const offset = offsetMinutes(legacy[7], legacy[8], legacy[9]);
    if (offset === null) {
      return null;
    }
    const timestamp = timestampFromParts({
      year: Number(legacy[1]),
      month: Number(legacy[2]),
      day: Number(legacy[3]),
      hour: Number(legacy[4]),
      minute: Number(legacy[5]),
      second: Number(legacy[6]),
      millisecond: 0,
      offsetMinutes: offset,
    });
    return timestamp === null ? null : new Date(timestamp);
  }

  const iso =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):?(\d{2}))$/i.exec(
      input,
    );
  if (!iso) {
    return null;
  }

  let offset = 0;
  if (iso[8].toUpperCase() !== 'Z') {
    const parsedOffset = offsetMinutes(iso[9], iso[10], iso[11]);
    if (parsedOffset === null) {
      return null;
    }
    offset = parsedOffset;
  }

  const fraction = iso[7] || '';
  const timestamp = timestampFromParts({
    year: Number(iso[1]),
    month: Number(iso[2]),
    day: Number(iso[3]),
    hour: Number(iso[4]),
    minute: Number(iso[5]),
    second: iso[6] ? Number(iso[6]) : 0,
    millisecond: Number((fraction + '00').slice(0, 3)),
    offsetMinutes: offset,
  });
  return timestamp === null ? null : new Date(timestamp);
}

export function isStale(lastUpdated: Date | null, now: Date, staleAfterSec: number): boolean {
  if (
    lastUpdated === null ||
    !Number.isFinite(lastUpdated.getTime()) ||
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(staleAfterSec) ||
    staleAfterSec < 0
  ) {
    return false;
  }

  return now.getTime() - lastUpdated.getTime() > staleAfterSec * 1000;
}

export function clockSkewSeconds(serverDateHeader: string, localNow: Date): number | null {
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const match =
    /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/i.exec(
      serverDateHeader.trim(),
    );
  if (!match || !Number.isFinite(localNow.getTime())) {
    return null;
  }

  const month = monthNames.findIndex((name) => name.toLowerCase() === match[2].toLowerCase()) + 1;
  if (month === 0) {
    return null;
  }

  const timestamp = timestampFromParts({
    year: Number(match[3]),
    month,
    day: Number(match[1]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
    millisecond: 0,
    offsetMinutes: 0,
  });
  if (timestamp === null) {
    return null;
  }

  return Math.round((timestamp - localNow.getTime()) / 1000);
}
