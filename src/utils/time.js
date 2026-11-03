// Converts between UTC instants and wall-clock times in an IANA timezone,
// for <input type="datetime-local"> values ("2026-09-01T09:30").

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function partsInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
}

function offsetMs(date, timeZone) {
  const p = partsInZone(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

// Returns a Date, or null for an empty/invalid value. Times that don't exist
// (skipped by a DST change) resolve to the instant just after the gap.
function zonedLocalToUtc(local, timeZone) {
  const m = LOCAL_PATTERN.exec(String(local || '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  let result = asUtc - offsetMs(new Date(asUtc), timeZone);
  result = asUtc - offsetMs(new Date(result), timeZone);
  const check = partsInZone(new Date(result), timeZone);
  if (check.year !== y || check.month !== mo || check.day !== d) return null;
  return new Date(result);
}

function utcToZonedLocal(date, timeZone) {
  if (!date) return '';
  const p = partsInZone(new Date(date), timeZone);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

function isValidTimezone(tz) {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const TIMEZONES = ['UTC', ...Intl.supportedValuesOf('timeZone')];

module.exports = { TIMEZONES, zonedLocalToUtc, utcToZonedLocal, isValidTimezone };
