/**
 * Date helpers. All business dates are Indian Standard Time (UTC+05:30, no daylight saving).
 * Dates travel as 'YYYY-MM-DD' strings so they never shift with the server's timezone.
 */

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_HH_MM = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isTime(value) {
  return typeof value === 'string' && TIME_HH_MM.test(value);
}

// Today's date in India, e.g. '2026-10-05'.
function todayIst(now = new Date()) {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

// Number of days in a range, counting both ends: 1 Oct to 7 Oct = 7.
function daysInRange(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS) + 1;
}

// The moment when it is `time` (HH:MM) on `isoDate` in India.
function istDateTime(isoDate, time) {
  const [hours, minutes] = time.split(':').map(Number);
  const utcMidnight = Date.parse(`${isoDate}T00:00:00Z`);
  return new Date(utcMidnight + (hours * 60 + minutes) * 60 * 1000 - IST_OFFSET_MS);
}

// Same IST clock time, one period later. Monthly keeps the day of month, clamped (31 Jan -> 28 Feb).
function addPeriod(moment, frequency) {
  const ist = new Date(moment.getTime() + IST_OFFSET_MS);
  if (frequency === 'daily') ist.setUTCDate(ist.getUTCDate() + 1);
  else if (frequency === 'weekly') ist.setUTCDate(ist.getUTCDate() + 7);
  else if (frequency === 'monthly') {
    const day = ist.getUTCDate();
    ist.setUTCDate(1);
    ist.setUTCMonth(ist.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 0)).getUTCDate();
    ist.setUTCDate(Math.min(day, lastDay));
  } else throw new Error(`Unknown frequency "${frequency}"`);
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

/**
 * When a schedule should send next.
 * Starts from `from` (the previous planned send, or today at the send time for a new schedule)
 * and steps forward one period at a time until it is in the future. If the server was down,
 * missed sends are skipped instead of sent in a burst.
 */
function nextRunAfter(from, frequency, now = new Date()) {
  let next = addPeriod(from, frequency);
  while (next <= now) next = addPeriod(next, frequency);
  return next;
}

module.exports = { isIsoDate, isTime, todayIst, addDays, daysInRange, istDateTime, nextRunAfter };
