import type { Cadence, DateKey, IsoWeekday, Millis, MonthKey, PeriodKey, WeekKey } from './model';

const MS_PER_DAY = 86_400_000;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The calendar date on the wall clock of `timeZone` at `instant`. */
function calendarDate(instant: Millis, timeZone: string): CalendarDate {
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Cannot read the ${type} of ${instant} in ${timeZone}`);
    return Number(part.value);
  };
  return { year: read('year'), month: read('month'), day: read('day') };
}

const pad = (value: number, length = 2): string => String(value).padStart(length, '0');

export function dateKey(instant: Millis, timeZone: string): DateKey {
  const { year, month, day } = calendarDate(instant, timeZone);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function monthKey(instant: Millis, timeZone: string): MonthKey {
  const { year, month } = calendarDate(instant, timeZone);
  return `${pad(year, 4)}-${pad(month)}`;
}

/** ISO 8601 weekday of a calendar date: 1 = Monday ... 7 = Sunday. */
function weekdayOf({ year, month, day }: CalendarDate): IsoWeekday {
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (utcDay === 0 ? 7 : utcDay) as IsoWeekday;
}

export function isoWeekday(instant: Millis, timeZone: string): IsoWeekday {
  return weekdayOf(calendarDate(instant, timeZone));
}

export function weekKey(instant: Millis, timeZone: string): WeekKey {
  const date = calendarDate(instant, timeZone);
  // The ISO week belongs to the year of its Thursday.
  const thursday = Date.UTC(date.year, date.month - 1, date.day) + (4 - weekdayOf(date)) * MS_PER_DAY;
  const thursdayYear = new Date(thursday).getUTCFullYear();
  const dayOfYear = Math.round((thursday - Date.UTC(thursdayYear, 0, 1)) / MS_PER_DAY);
  return `${pad(thursdayYear, 4)}-W${pad(Math.floor(dayOfYear / 7) + 1)}`;
}

export function periodKey(cadence: Cadence, instant: Millis, timeZone: string): PeriodKey {
  switch (cadence) {
    case 'daily':
      return dateKey(instant, timeZone);
    case 'weekly':
      return weekKey(instant, timeZone);
    case 'monthly':
      return monthKey(instant, timeZone);
    default:
      throw new Error(`Unknown cadence: ${String(cadence)}`);
  }
}
