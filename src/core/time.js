// Day seeds and week keys, in Cambodia time (UTC+7) so the reset is
// Monday 00:00 local time for everyone.

export const TZ_OFFSET_HOURS = 7;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function local(date) {
  // A Date whose UTC fields read as UTC+7 wall-clock time.
  return new Date(date.getTime() + TZ_OFFSET_HOURS * HOUR);
}

const pad = n => String(n).padStart(2, '0');

export function dayKey(date = new Date()) {
  const d = local(date);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function weekKey(date = new Date()) {
  // ISO-8601 week: weeks start Monday; week 1 contains the year's first Thursday.
  const d = local(date);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7; // Mon=1..Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - dow); // Thursday of this week
  const year = t.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / DAY + 1) / 7);
  return `${year}-W${pad(week)}`;
}

export function previousWeekKey(date = new Date()) {
  return weekKey(new Date(date.getTime() - 7 * DAY));
}

export function weekLabel(key) {
  return `Week ${Number(key.split('-W')[1])}`;
}
