/**
 * Fake report rows for the demo server, in the same shape the real query returns:
 * arrays in column order; dates 'YYYY-MM-DD', date-times 'YYYY-MM-DD HH:MM', numbers as strings.
 * Row n is always the same, so previews and downloaded files agree.
 */

const NAMES = ['Rajesh Sharma', 'Priya Mehta', 'Anil Verma', 'Sunita Kapoor', 'Mohammed Farouk', 'Deepak Nair', 'Kavita Rao', 'Suresh Patil', 'Lakshmi Iyer', 'Harpreet Singh'];
const COURTS = ['JMFC Court, Pune', 'Metropolitan Magistrate, Mumbai', 'Saket District Court', 'CMM Court, Chennai'];
const STAGES = ['Notice sent', 'Notice served', 'Complaint filed', 'Summons', 'Evidence', 'Arguments'];
const STATUSES = ['Delivered', 'Sent', 'Failed', 'Read'];

// Deterministic pseudo-random number in [0, 1) for (row, column).
function noise(row, col) {
  let h = (row * 2654435761) ^ (col * 40503);
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const pick = (list, r) => list[Math.floor(r * list.length)];

function dateBetween(fromIso, toIso, r) {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return new Date(from + Math.floor(r * ((to - from) / 864e5 + 1)) * 864e5).toISOString().slice(0, 10);
}

function value(column, row, col, range) {
  const r = noise(row, col);
  const key = column.key || '';
  switch (column.type) {
    case 'date':
      return dateBetween(range.dateFrom, range.dateTo, r);
    case 'datetime':
      return `${dateBetween(range.dateFrom, range.dateTo, r)} ${String(9 + Math.floor(r * 9)).padStart(2, '0')}:30`;
    case 'amount':
      return String(Math.round(8000 + r * 450000));
    case 'number':
      return String(Math.floor(r * 120));
    case 'boolean':
      return r < 0.3;
    case 'enum':
      return pick(['0–30 days', '31–90 days', '91–180 days', '181–365 days', 'Over 1 year'], r);
    default:
      break;
  }
  if (key === 'case_number') return `S138-26-${String(10000 + row).padStart(6, '0')}`;
  if (key.includes('court')) return pick(COURTS, r);
  if (key.includes('name') || key.includes('borrower') || key.includes('advocate')) return pick(NAMES, r);
  if (key.includes('stage')) return pick(STAGES, r);
  if (key.includes('status')) return pick(STATUSES, r);
  if (key.includes('cnr')) return `MHPU01${String(row).padStart(6, '0')}2026`;
  return `${key.slice(0, 3).toUpperCase()}/${100000 + row}`;
}

function sampleRows(columns, start, count, range) {
  return Array.from({ length: count }, (_, i) => columns.map((c, col) => value(c, start + i, col, range)));
}

module.exports = { sampleRows };
