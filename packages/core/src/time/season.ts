/** The calendar date (YYYY-MM-DD) of an instant in an IANA time zone. */
export function localDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** True when the instant falls on a date from start to end inclusive, in the program time zone. */
export function isInSeason(
  at: Date,
  season: { start: string; end: string; timezone: string },
): boolean {
  const day = localDate(at, season.timezone);
  return day >= season.start && day <= season.end;
}

/** The UTC instant of local midnight starting `day` (YYYY-MM-DD) in a time zone. */
export function zonedStartOfDay(day: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(guess));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return new Date(guess - (asUtc - guess));
}

/** The Pacific calendar date, matching when Google's Gemini quota resets. */
export function pacificDay(at: Date): string {
  return localDate(at, 'America/Los_Angeles');
}

/** The start of the given instant's UTC day; used for "paid today" style windows. */
export function startOfUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}
