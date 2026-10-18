import { describe, expect, it } from 'vitest';
import { dateKey, isoWeekday, monthKey, periodKey, weekKey } from './calendar';
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
