const test = require('node:test');
const assert = require('node:assert');
const { buildReportQuery } = require('../utils/query-builder');

const ENTERPRISE = '11111111-2222-3333-4444-555555555555';
const RANGE = { dateFrom: '2026-09-01', dateTo: '2026-09-30' };

const template = (overrides = {}) => ({
  enterpriseId: ENTERPRISE,
  workflow: 'section138',
  dateBasis: 'notice_date',
  columns: [{ key: 'case_number', label: 'Case No', mv: 'latest' }],
  filters: [],
  ...overrides,
});

test('base query: enterprise and date range are parameters, newest first', () => {
  const q = buildReportQuery(template(), RANGE);
  assert.deepStrictEqual(q.params, [ENTERPRISE, '2026-09-01', '2026-09-30']);
  assert.match(q.sql, /FROM cms\.cheque c/);
  assert.match(q.sql, /c\.enterprise_id = \$1::uuid/);
  assert.match(q.sql, /c\.notice_date >= \$2::date/);
  assert.match(q.sql, /c\.notice_date < \$3::date \+ 1/);
  assert.match(q.sql, /ORDER BY c\.notice_date DESC$/);
  assert.doesNotMatch(q.sql, /GROUP BY/);
  assert.deepStrictEqual(q.columns, [{ alias: 'c0', label: 'Case No', type: 'text' }]);
});

test('user text never appears in SQL — it goes in params', () => {
  const evil = "x'; DROP TABLE cms.cheque; --";
  const q = buildReportQuery(template({ filters: [{ key: 'case_status', op: 'is', value: evil }] }), RANGE);
  assert.ok(!q.sql.includes('DROP TABLE'));
  assert.strictEqual(q.params[3], evil);
});

test('only the lookups the columns need are joined, dependencies first', () => {
  const plain = buildReportQuery(template(), RANGE);
  assert.doesNotMatch(plain.sql, /JOIN/);

  const q = buildReportQuery(template({ columns: [{ key: 'borrower_pincode', label: 'Pin' }] }), RANGE);
  const respondentAt = q.sql.indexOf(') respondent ON true');
  const addressAt = q.sql.indexOf(') respondent_address ON true');
  assert.ok(respondentAt > 0 && addressAt > respondentAt, 'respondent join must come before its address');
  assert.doesNotMatch(q.countSql, /JOIN/, 'count does not need SELECT-only joins');
});

test('filter on a joined field adds that join to the count query too', () => {
  const q = buildReportQuery(template({ filters: [{ key: 'borrower_name', op: 'contains', value: '50%_off' }] }), RANGE);
  assert.match(q.countSql, /respondent ON true/);
  assert.strictEqual(q.params[3], '%50\\%\\_off%', 'LIKE wildcards in user text are escaped');
});

test('repeating fields use sub-queries per mode, never a join', () => {
  const q = buildReportQuery(
    template({
      columns: [
        { key: 'sms_status', label: 'Latest SMS', mv: 'latest' },
        { key: 'sms_status', label: 'First SMS', mv: 'first' },
        { key: 'hearing_date', label: 'Hearings', mv: 'all' },
        { key: 'reply_channel', label: 'Replies', mv: 'count' },
      ],
    }),
    RANGE
  );
  assert.doesNotMatch(q.sql, /JOIN digiserve/);
  assert.match(q.sql, /communication_mode = 'SMS' ORDER BY x\.created_at DESC NULLS LAST LIMIT 1\)\)::text AS c0/);
  assert.match(q.sql, /ORDER BY x\.created_at ASC NULLS LAST LIMIT 1\)\)::text AS c1/);
  assert.match(q.sql, /string_agg\(DISTINCT to_char\(x\.hearing_date, 'YYYY-MM-DD'\), '; '\)/);
  assert.match(q.sql, /\(SELECT count\(\*\) FROM digiserve\.reply x WHERE x\.case_id = c\.id::text\) AS c3/);
  assert.deepStrictEqual(q.columns.map((c) => c.type), ['text', 'text', 'text', 'number']);
});

test('every filter operator produces SQL with the right parameter casts', () => {
  const cases = [
    ['case_status', 'isnot', 'Closed', /IS DISTINCT FROM \$4/],
    ['ageing', 'in', ['0–30 days'], /= ANY\(\$4::text\[\]\)/],
    ['ageing', 'notin', ['Over 1 year'], /IS NULL OR NOT/],
    ['loan_amount', 'gte', 50000, /c\.loan_amount >= \$4::numeric/],
    ['filing_date', 'before', '2026-01-01', /c\.case_filing_date < \$4::date/],
    ['filing_date', 'after', '2026-01-01', /c\.case_filing_date >= \$4::date \+ 1/],
    ['next_hearing', 'nextn', 7, /CURRENT_DATE \+ 1 \+ \$4::int/],
    ['notice_date', 'lastn', 30, /CURRENT_DATE - \$4::int \+ 1/],
    ['cnr_no', 'empty', null, /NULLIF\(c\.cnr::text, ''\) IS NULL/],
    ['awaiting_input', 'yes', null, /execution\.awaiting_input IS TRUE/],
  ];
  for (const [key, op, value, pattern] of cases) {
    const q = buildReportQuery(template({ filters: [{ key, op, value }] }), RANGE);
    assert.match(q.sql, pattern, `${key} ${op}`);
  }
});

test('a column removed from the catalog gives a clear error', () => {
  assert.throws(
    () => buildReportQuery(template({ columns: [{ key: 'gone_field', label: 'x' }] }), RANGE),
    /Column "gone_field" no longer exists/
  );
});

test('workflows without a base table refuse to build', () => {
  assert.throws(() => buildReportQuery(template({ workflow: 'sarfaesi' }), RANGE), /not available/);
});
