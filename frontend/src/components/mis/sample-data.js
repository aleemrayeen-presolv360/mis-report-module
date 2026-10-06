/**
 * Fake rows for the builder's "Preview — sample data" panel, so a user can see the file's shape
 * before any real data is involved. Values are deterministic (same column -> same sample).
 */

const NAMES = ['Rajesh Sharma', 'Priya Mehta', 'Anil Verma', 'Sunita Kapoor', 'Mohammed Farouk', 'Deepak Nair', 'Kavita Rao', 'Suresh Patil'];
const COURTS = ['JMFC Court, Pune', 'Metropolitan Magistrate, Mumbai', 'Saket District Court', 'CMM Court, Chennai'];
const STATUSES = ['Delivered', 'Sent', 'Failed', 'Read'];

// Small seeded random generator, so the preview does not change on every render.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const pick = (random, list) => list[Math.floor(random() * list.length)];

function sampleDate(random) {
  const date = new Date(Date.now() - Math.floor(random() * 400) * 864e5);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function sampleValue(field, random) {
  const key = field.key;
  switch (field.type) {
    case 'date':
      return sampleDate(random);
    case 'datetime':
      return `${sampleDate(random)} ${String(9 + Math.floor(random() * 9)).padStart(2, '0')}:${random() < 0.5 ? '00' : '30'}`;
    case 'boolean':
      return random() < 0.3;
    case 'amount':
      return Math.round((8000 + random() * 450000) / 100) * 100;
    case 'number':
      return 1 + Math.floor(random() * 140);
    case 'enum':
      return pick(random, field.options || ['—']);
    default:
      break;
  }
  if (key === 'case_number') return `S138-26-${10000 + Math.floor(random() * 90000)}`;
  if (key.includes('name') || key.includes('borrower') || key.includes('advocate')) return pick(random, NAMES);
  if (key.includes('court')) return pick(random, COURTS);
  if (key.includes('status')) return pick(random, STATUSES);
  if (key.includes('email')) return `${pick(random, NAMES).split(' ')[0].toLowerCase()}@mail.com`;
  if (key.includes('cnr')) return `MHPU01${String(Math.floor(random() * 1e6)).padStart(6, '0')}2026`;
  return `${key.slice(0, 3).toUpperCase()}/${100000 + Math.floor(random() * 900000)}`;
}

/**
 * @param columns     template columns [{ key, label, mv }]
 * @param fieldsByKey catalog fields
 * @returns {{ columns: {label, type}[], rows: any[][] }} ready for <DataTable>
 */
export function sampleTable(columns, fieldsByKey, count = 5) {
  const usable = columns.filter((c) => fieldsByKey[c.key]);
  const outColumns = usable.map((c) => {
    const field = fieldsByKey[c.key];
    const type = field.repeating && c.mv === 'count' ? 'number' : field.repeating && c.mv === 'all' ? 'text' : field.type;
    return { label: c.label || field.label, type };
  });

  const rows = Array.from({ length: count }, (_, i) =>
    usable.map((c, j) => {
      const field = fieldsByKey[c.key];
      const random = seeded(hash(c.key) + i * 977);
      if (outColumns[j].type === 'number' && c.mv === 'count') return 1 + Math.floor(random() * 4);
      if (c.mv === 'all') return [sampleValue(field, random), sampleValue(field, random)].join('; ');
      return sampleValue(field, random);
    })
  );
  return { columns: outColumns, rows };
}
