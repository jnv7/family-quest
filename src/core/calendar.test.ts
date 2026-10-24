import { describe, expect, it } from 'vitest';
import { addDays, dateKey, formatBuildDate, isoWeekday, lastDayOfPeriod, monthKey, periodKey, weekKey } from './calendar';
import type { IsoWeekday } from './model';

const LISBON = 'Europe/Lisbon';

// Independently computed values (docs/plans/0.1.md, delivery 0.1.2).
const rows: ReadonlyArray<[string, string, string, string, IsoWeekday]> = [
  ['2026-10-18T22:59:00Z', '2026-10-18', '2026-W42', '2026-10', 7],
  ['2026-10-18T23:00:00Z', '2026-10-19', '2026-W43', '2026-10', 1],
  ['2026-10-24T23:30:00Z', '2026-10-25', '2026-W43', '2026-10', 7],
  ['2026-10-25T00:59:00Z', '2026-10-25', '2026-W43', '2026-10', 7],
  ['2026-10-25T01:00:00Z', '2026-10-25', '2026-W43', '2026-10', 7],
  ['2026-10-25T23:59:00Z', '2026-10-25', '2026-W43', '2026-10', 7],
  ['2026-10-26T00:00:00Z', '2026-10-26', '2026-W44', '2026-10', 1],
  ['2026-03-29T00:59:00Z', '2026-03-29', '2026-W13', '2026-03', 7],
  ['2026-03-29T01:00:00Z', '2026-03-29', '2026-W13', '2026-03', 7],
  ['2026-03-29T22:59:00Z', '2026-03-29', '2026-W13', '2026-03', 7],
  ['2026-03-29T23:00:00Z', '2026-03-30', '2026-W14', '2026-03', 1],
  ['2025-12-29T00:00:00Z', '2025-12-29', '2026-W01', '2025-12', 1],
  ['2026-12-31T23:59:00Z', '2026-12-31', '2026-W53', '2026-12', 4],
  ['2027-01-01T00:00:00Z', '2027-01-01', '2026-W53', '2027-01', 5],
  ['2027-01-03T23:59:00Z', '2027-01-03', '2026-W53', '2027-01', 7],
  ['2027-01-04T00:00:00Z', '2027-01-04', '2027-W01', '2027-01', 1],
  ['2026-02-28T23:30:00Z', '2026-02-28', '2026-W09', '2026-02', 6],
  ['2028-02-29T12:00:00Z', '2028-02-29', '2028-W09', '2028-02', 2],
];

describe.each(rows)('Lisbon calendar at %s', (utc, date, week, month, weekday) => {
  const instant = Date.parse(utc);

  it('computes dateKey', () => expect(dateKey(instant, LISBON)).toBe(date));
  it('computes weekKey', () => expect(weekKey(instant, LISBON)).toBe(week));
  it('computes monthKey', () => expect(monthKey(instant, LISBON)).toBe(month));
  it('computes isoWeekday', () => expect(isoWeekday(instant, LISBON)).toBe(weekday));

  it('computes periodKey for every cadence', () => {
    expect(periodKey('daily', instant, LISBON)).toBe(date);
    expect(periodKey('weekly', instant, LISBON)).toBe(week);
    expect(periodKey('monthly', instant, LISBON)).toBe(month);
  });
});

describe('calendar time zones', () => {
  it('depends on the given time zone', () => {
    const instant = Date.parse('2026-10-18T23:30:00Z');
    expect(dateKey(instant, 'Europe/Lisbon')).toBe('2026-10-19');
    expect(dateKey(instant, 'UTC')).toBe('2026-10-18');
  });
});

describe('periodKey', () => {
  it('fails explicitly on an unknown cadence', () => {
    expect(() => periodKey('yearly' as never, 0, LISBON)).toThrow('Unknown cadence');
  });
});

describe('lastDayOfPeriod', () => {
  it('is the day itself for a daily period', () => {
    expect(lastDayOfPeriod('daily', '2026-10-19')).toBe('2026-10-19');
  });

  it('is the Sunday of the ISO week', () => {
    expect(lastDayOfPeriod('weekly', '2026-W43')).toBe('2026-10-25');
    expect(lastDayOfPeriod('weekly', '2026-W42')).toBe('2026-10-18');
    expect(lastDayOfPeriod('weekly', '2026-W01')).toBe('2026-01-04');
    expect(lastDayOfPeriod('weekly', '2026-W13')).toBe('2026-03-29'); // the clocks go forward that night
  });

  it('follows the turn of the year: 2026 has 53 weeks', () => {
    expect(lastDayOfPeriod('weekly', '2026-W53')).toBe('2027-01-03');
    expect(lastDayOfPeriod('weekly', '2027-W01')).toBe('2027-01-10');
    expect(lastDayOfPeriod('weekly', '2025-W52')).toBe('2025-12-28');
  });

  it('is the last day of the month, leap years included', () => {
    expect(lastDayOfPeriod('monthly', '2026-10')).toBe('2026-10-31');
    expect(lastDayOfPeriod('monthly', '2026-02')).toBe('2026-02-28');
    expect(lastDayOfPeriod('monthly', '2028-02')).toBe('2028-02-29');
    expect(lastDayOfPeriod('monthly', '2026-12')).toBe('2026-12-31');
  });

  it('agrees with weekKey: the last day of a week is still in that week, the next day is not', () => {
    for (const key of ['2026-W43', '2026-W53', '2027-W01', '2026-W09']) {
      const last = lastDayOfPeriod('weekly', key);
      const noon = (date: string) => Date.parse(`${date}T12:00:00Z`);
      expect(weekKey(noon(last), LISBON)).toBe(key);
      expect(weekKey(noon(last) + 86_400_000, LISBON)).not.toBe(key);
    }
  });

  it('throws on a key that is not of the cadence', () => {
    expect(() => lastDayOfPeriod('daily', '2026-W43')).toThrow();
    expect(() => lastDayOfPeriod('weekly', '2026-10')).toThrow();
    expect(() => lastDayOfPeriod('monthly', '2026-10-19')).toThrow();
  });
});

describe('addDays', () => {
  it.each([
    ['2026-10-18', 1, '2026-10-19'],
    ['2026-10-31', 1, '2026-11-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-02-28', 1, '2026-03-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2026-10-24', 2, '2026-10-26'], // across the change to winter time on 25 October
    ['2026-03-28', 2, '2026-03-30'], // across the change to summer time
    ['2026-10-19', -1, '2026-10-18'],
    ['2026-10-19', 0, '2026-10-19'],
  ])('%s + %i days is %s', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });

  it('rejects what is not a date key or a whole number of days', () => {
    expect(() => addDays('2026-W43', 1)).toThrow();
    expect(() => addDays('2026-10-18', 1.5)).toThrow(RangeError);
  });
});

describe('formatBuildDate', () => {
  it('writes the Lisbon day as dd/mm/aaaa', () => {
    expect(formatBuildDate(Date.parse('2026-10-24T12:00:00Z'), 'Europe/Lisbon')).toBe('24/10/2026');
    expect(formatBuildDate(Date.parse('2026-01-05T09:00:00Z'), 'Europe/Lisbon')).toBe('05/01/2026');
  });

  it('follows the wall clock around the day the clocks change (25 October 2026)', () => {
    // Summer time (UTC+1) ends at 01:00 UTC on 25 October.
    expect(formatBuildDate(Date.parse('2026-10-24T22:59:00Z'), 'Europe/Lisbon')).toBe('24/10/2026');
    expect(formatBuildDate(Date.parse('2026-10-24T23:30:00Z'), 'Europe/Lisbon')).toBe('25/10/2026'); // 00:30 summer time
    expect(formatBuildDate(Date.parse('2026-10-25T00:30:00Z'), 'Europe/Lisbon')).toBe('25/10/2026'); // 01:30, first pass
    expect(formatBuildDate(Date.parse('2026-10-25T23:30:00Z'), 'Europe/Lisbon')).toBe('25/10/2026'); // 23:30 winter time
    expect(formatBuildDate(Date.parse('2026-10-26T00:30:00Z'), 'Europe/Lisbon')).toBe('26/10/2026');
  });
});
