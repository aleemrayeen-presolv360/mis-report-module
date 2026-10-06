/**
 * QUERY BUILDER — turns a saved template + a date range into SQL.
 *
 * Rules that keep it safe and fast on millions of rows:
 *   1. Column/table names only ever come from column-catalog.js (developer-written).
 *      Anything the user typed (dates, filter values) goes in as a $n parameter.
 *   2. Output is always one row per case. Repeating data is read with sub-queries, never joined,
 *      so there is no GROUP BY and no duplicate rows.
 *   3. Only the lookups the chosen columns and filters need are joined.
 *   4. Result columns are aliased c0, c1, c2... and mapped back to the user's headings by position,
 *      so headings can contain any character.
 *
 * Run queries from this file through db/pool.js withReportSession(): it sets the session timezone to
 * India so CURRENT_DATE and `::date` match Indian dates.
 */

const { getWorkflow } = require('../config/workflows');
const { getCatalog } = require('../config/column-catalog');
const { badRequest } = require('./http-error');

/**
 * @returns {{ sql: string, countSql: string, params: any[], columns: {alias, label, type}[] }}
 *   sql      — the rows, newest first on the date basis
 *   countSql — total number of rows (same WHERE, same params)
 *   columns  — what each c0, c1... alias is, in file order
 */
function buildReportQuery(template, { dateFrom, dateTo }) {
  const workflow = getWorkflow(template.workflow);
  const catalog = getCatalog(template.workflow);
  if (!workflow || !workflow.baseTable) throw badRequest(`Reports are not available for "${template.workflow}" yet.`);

  const fieldFor = (key) => {
    const field = catalog.fieldsByKey[key];
    if (!field) throw badRequest(`Column "${key}" no longer exists. Edit the report and remove it.`);
    return field;
  };

  const params = [];
  const addParam = (value, cast) => {
    params.push(value);
    return cast ? `$${params.length}::${cast}` : `$${params.length}`;
  };

  // SELECT list
  const selectLookups = new Set();
  const columns = template.columns.map((column, index) => {
    const field = fieldFor(column.key);
    field.needs.forEach((name) => selectLookups.add(name));
    const { sql, type } = selectExpression(field, column.mv);
    return { alias: `c${index}`, label: column.label || field.label, type, sql };
  });

  // WHERE: enterprise + date range + fixed filters
  const whereLookups = new Set();
  const dateField = fieldFor(template.dateBasis);
  dateField.needs.forEach((name) => whereLookups.add(name));
  const dateExpr = valueExpression(dateField);

  const conditions = [
    `c.enterprise_id = ${addParam(template.enterpriseId, 'uuid')}`,
    `${dateExpr} >= ${addParam(dateFrom, 'date')}`,
    `${dateExpr} < ${addParam(dateTo, 'date')} + 1`, // up to the end of the "to" day
  ];
  if (workflow.baseWhere) conditions.push(workflow.baseWhere);

  for (const filter of template.filters) {
    const field = fieldFor(filter.key);
    field.needs.forEach((name) => whereLookups.add(name));
    conditions.push(buildFilterCondition(valueExpression(field), filter, addParam));
  }

  const from = `FROM ${workflow.baseTable} c`;
  const where = `WHERE ${conditions.join('\n  AND ')}`;
  const allLookups = new Set([...selectLookups, ...whereLookups]);

  const sql = [
    `SELECT\n  ${columns.map((c) => `${c.sql} AS ${c.alias}`).join(',\n  ')}`,
    from,
    joinClauses(catalog.lookups, allLookups),
    where,
    `ORDER BY ${dateExpr} DESC`,
  ]
    .filter(Boolean)
    .join('\n');

  // The count only joins what the WHERE clause needs, so it stays cheap.
  const countSql = ['SELECT count(*)::bigint AS total', from, joinClauses(catalog.lookups, whereLookups), where]
    .filter(Boolean)
    .join('\n');

  return { sql, countSql, params, columns: columns.map(({ alias, label, type }) => ({ alias, label, type })) };
}

/* ------------------------------------------------------------------ */
/* Expressions                                                         */
/* ------------------------------------------------------------------ */

// The raw value of a field, used in WHERE. Repeating fields use their latest value.
function valueExpression(field) {
  if (!field.repeating) return field.sql;
  return repeatingSubquery(field.repeating, 'latest');
}

// What goes in the SELECT list, formatted so the file writers get predictable values.
function selectExpression(field, mv = 'latest') {
  if (!field.repeating) return { sql: formatForOutput(field.sql, field.type), type: field.type };

  if (mv === 'count') return { sql: repeatingSubquery(field.repeating, 'count'), type: 'number' };
  if (mv === 'all') return { sql: repeatingSubquery(field.repeating, 'all', field.type), type: 'text' };
  return { sql: formatForOutput(repeatingSubquery(field.repeating, mv), field.type), type: field.type };
}

function repeatingSubquery(source, mv, type) {
  const { from, where, value, orderBy } = source;
  switch (mv) {
    case 'count':
      return `(SELECT count(*) FROM ${from} WHERE ${where})`;
    case 'all':
      return `(SELECT string_agg(DISTINCT ${asText(value, type)}, '; ') FROM ${from} WHERE ${where})`;
    case 'first':
      return `(SELECT ${value} FROM ${from} WHERE ${where} ORDER BY ${orderBy} ASC NULLS LAST LIMIT 1)`;
    default: // latest
      return `(SELECT ${value} FROM ${from} WHERE ${where} ORDER BY ${orderBy} DESC NULLS LAST LIMIT 1)`;
  }
}

// Dates come back as 'YYYY-MM-DD', date-times as 'YYYY-MM-DD HH24:MI' (India time). Writers turn them into Excel dates.
function formatForOutput(expr, type) {
  if (type === 'date') return `(${expr})::date`;
  if (type === 'datetime') return `to_char(${expr}, 'YYYY-MM-DD HH24:MI')`;
  if (type === 'text' || type === 'enum') return `(${expr})::text`;
  return expr; // number, amount, boolean stay native
}

function asText(expr, type) {
  if (type === 'date') return `to_char(${expr}, 'YYYY-MM-DD')`;
  if (type === 'datetime') return `to_char(${expr}, 'YYYY-MM-DD HH24:MI')`;
  return `(${expr})::text`;
}

/* ------------------------------------------------------------------ */
/* Fixed filters                                                       */
/* ------------------------------------------------------------------ */

const COMPARISON = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=' };

/**
 * One WHERE condition for a fixed filter. `filter` has already been checked by validators.js,
 * so `op` is valid for the field type and `value` has the right shape.
 */
function buildFilterCondition(expr, { op, value }, addParam) {
  switch (op) {
    case 'is':
      return `${expr}::text = ${addParam(value)}`;
    case 'isnot':
      return `${expr}::text IS DISTINCT FROM ${addParam(value)}`; // keeps empty values, unlike <>
    case 'contains':
      return `${expr}::text ILIKE ${addParam(`%${escapeLike(value)}%`)}`;
    case 'in':
      return `${expr}::text = ANY(${addParam(value, 'text[]')})`;
    case 'notin':
      return `(${expr} IS NULL OR NOT (${expr}::text = ANY(${addParam(value, 'text[]')})))`;
    case 'empty':
      return `NULLIF(${expr}::text, '') IS NULL`;
    case 'notempty':
      return `NULLIF(${expr}::text, '') IS NOT NULL`;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'eq':
      return `${expr} ${COMPARISON[op]} ${addParam(value, 'numeric')}`;
    case 'before':
      return `${expr} < ${addParam(value, 'date')}`;
    case 'after':
      return `${expr} >= ${addParam(value, 'date')} + 1`;
    case 'lastn':
      return `(${expr} >= CURRENT_DATE - ${addParam(value, 'int')} + 1 AND ${expr} < CURRENT_DATE + 1)`;
    case 'nextn':
      return `(${expr} >= CURRENT_DATE AND ${expr} < CURRENT_DATE + 1 + ${addParam(value, 'int')})`;
    case 'yes':
      return `${expr} IS TRUE`;
    case 'no':
      return `${expr} IS NOT TRUE`;
    default:
      throw badRequest(`Unknown filter condition "${op}".`);
  }
}

function escapeLike(text) {
  return String(text).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/* ------------------------------------------------------------------ */
/* Joins                                                               */
/* ------------------------------------------------------------------ */

// JOIN clauses for the given lookup names, with each lookup's own dependencies placed first.
function joinClauses(lookups, names) {
  const ordered = [];
  const visit = (name) => {
    if (ordered.includes(name)) return;
    (lookups[name].needs || []).forEach(visit);
    ordered.push(name);
  };
  [...names].forEach(visit);
  return ordered.map((name) => lookups[name].sql).join('\n');
}

module.exports = { buildReportQuery };
