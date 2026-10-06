/**
 * Formatting helpers shared by the Report screens.
 * Dates move around as 'YYYY-MM-DD' strings in the user's local calendar — never via toISOString(),
 * which converts to UTC and gives yesterday's date for anyone east of London before 05:30.
 */

const pad = (n) => String(n).padStart(2, '0');

// Date object -> 'YYYY-MM-DD' in the local calendar.
export function toIsoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 'YYYY-MM-DD' (or an ISO timestamp) -> '05 Oct 2026'
export function formatDate(value) {
  if (!value) return '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Timestamp -> '09:30 am'
export function formatTime(value) {
  return new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export function relativeDay(value) {
  const days = Math.round((Date.now() - new Date(value).getTime()) / 864e5);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

export function formatInr(n) {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export function formatCount(n) {
  return Number(n).toLocaleString('en-IN');
}

export const plural = (n, word) => `${formatCount(n)} ${word}${n === 1 ? '' : 's'}`;

/**
 * A preview cell, formatted by column type. Values come from the API as:
 * date 'YYYY-MM-DD', datetime 'YYYY-MM-DD HH:MM', numbers as strings, booleans as true/false.
 */
export function formatCell(value, type) {
  if (value === null || value === undefined || value === '') return '—';
  switch (type) {
    case 'date':
      return formatDate(value);
    case 'datetime':
      return `${formatDate(value.slice(0, 10))} ${value.slice(11, 16)}`;
    case 'amount':
      return formatInr(Number(value));
    case 'number':
      return formatCount(value);
    case 'boolean':
      return value ? 'Yes' : 'No';
    default:
      return String(value);
  }
}

export const isNumericType = (type) => type === 'amount' || type === 'number';

/* ------------------------------------------------------------------ */
/* Date range presets (Report download screen)                         */
/* ------------------------------------------------------------------ */

export const DATE_PRESETS = [
  { key: 'last7', label: 'Last 7 days' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_quarter', label: 'This quarter' },
  { key: 'this_fy', label: 'This financial year' },
  { key: 'custom', label: 'Custom' },
];

// Returns { from, to } as 'YYYY-MM-DD', or null for "custom".
export function presetRange(preset, today = new Date()) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const day = (yy, mm, dd) => toIsoDate(new Date(yy, mm, dd));
  const todayIso = toIsoDate(today);

  switch (preset) {
    case 'last7':
      return { from: day(y, m, today.getDate() - 6), to: todayIso };
    case 'this_month':
      return { from: day(y, m, 1), to: todayIso };
    case 'last_month':
      return { from: day(y, m - 1, 1), to: day(y, m, 0) };
    case 'this_quarter':
      return { from: day(y, Math.floor(m / 3) * 3, 1), to: todayIso };
    case 'this_fy': // Indian financial year starts 1 April
      return { from: day(m >= 3 ? y : y - 1, 3, 1), to: todayIso };
    default:
      return null;
  }
}
