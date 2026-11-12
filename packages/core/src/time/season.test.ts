import { describe, expect, it } from 'vitest';
import { isInSeason, localDate, pacificDay, zonedStartOfDay } from './season.js';

const season = { start: '2026-10-01', end: '2027-01-31', timezone: 'America/Los_Angeles' };

describe('season', () => {
  it.each([
    // 2026-10-01 00:30 Pacific (PDT, UTC-7) is inside; 23:30 the day before is not.
    ['2026-10-01T07:30:00Z', true],
    ['2026-10-01T06:30:00Z', false],
    // 2027-01-31 23:30 Pacific (PST, UTC-8) is inside; 00:30 Feb 1 is not.
    ['2027-02-01T07:30:00Z', true],
    ['2027-02-01T08:30:00Z', false],
  ])('treats %s as in season: %s', (iso, inside) => {
    expect(isInSeason(new Date(iso), season)).toBe(inside);
  });

  it('reads the local date in a time zone', () => {
    expect(localDate(new Date('2026-11-12T05:00:00Z'), 'America/Los_Angeles')).toBe('2026-11-11');
    expect(localDate(new Date('2026-11-12T05:00:00Z'), 'UTC')).toBe('2026-11-12');
  });

  it('finds local midnight in UTC across daylight saving', () => {
    expect(zonedStartOfDay('2026-10-01', 'America/Los_Angeles').toISOString()).toBe(
      '2026-10-01T07:00:00.000Z',
    );
    expect(zonedStartOfDay('2026-12-01', 'America/Los_Angeles').toISOString()).toBe(
      '2026-12-01T08:00:00.000Z',
    );
    expect(zonedStartOfDay('2026-12-01', 'UTC').toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('uses the Pacific date for the Gemini quota day', () => {
    expect(pacificDay(new Date('2026-11-12T07:59:00Z'))).toBe('2026-11-11');
    expect(pacificDay(new Date('2026-11-12T08:01:00Z'))).toBe('2026-11-12');
  });
});
