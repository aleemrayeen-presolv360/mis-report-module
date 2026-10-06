/**
 * Writes LITELO_COLUMNS.md (repo root) from config/column-catalog.js.
 * Run after any catalog change:   npm run docs:columns
 *
 * The file is a checklist for checking every report column against the real database.
 */

const fs = require('fs');
const path = require('path');
const { WORKFLOWS } = require('../config/workflows');
const { getCatalog } = require('../config/column-catalog');

const OUTPUT = path.join(__dirname, '..', '..', 'LITELO_COLUMNS.md');

const TYPE_LABEL = { text: 'Text', enum: 'Pick list', number: 'Number', amount: 'Amount', date: 'Date', datetime: 'Date + time', boolean: 'Yes / No' };

// Database facts the catalog relies on. Each was checked on SIT (read-only) on 05 Oct 2026.
// Re-run the check query on production before go-live.
const CHECKED_ON = '05 Oct 2026';
const ASSUMPTIONS = [
  ['`cms.litigants.case_type` is `\'section138\'` for Section 138 cases (was wrongly `\'cheque\'` — fixed)', 'Every Borrower, Proceedings and Drafts column', 'SELECT DISTINCT case_type FROM cms.litigants;'],
  ['Exactly one litigant per case has `is_primary_respondent = true` (0 duplicates, 0 missing)', 'Borrower name, email, address…', 'SELECT case_id, count(*) FROM cms.litigants WHERE is_primary_respondent GROUP BY 1 HAVING count(*) > 1;'],
  ['Other respondents have `role = \'respondent\'`; claimants have `role = \'claimant\'`', 'Co-borrower / guarantor', 'SELECT DISTINCT role FROM cms.litigants;'],
  ['`communication_mode` values are `SMS`, `EMAIL`, `WHATSAPP` — upper case (was wrongly lower case — fixed)', 'SMS / Email / WhatsApp columns', 'SELECT DISTINCT communication_mode FROM digiserve.communication_request;'],
  ['`digiserve.communication_request.case_id` holds `cms.cheque.id` as text (69 of 121 rows match a Section 138 case)', 'Communication columns', 'SELECT count(*) FROM digiserve.communication_request r JOIN cms.cheque c ON c.id::text = r.case_id;'],
  ['`cms.litigants.contact` is JSON `{"mobile": [...], "whatsapp": [...]}`', 'Mobile, WhatsApp number', 'SELECT contact FROM cms.litigants WHERE contact IS NOT NULL LIMIT 5;'],
  ['`cms.cheque.status` is ONGOING / CLOSED; `stage` is Pre-Notice / Notice / Filing / Court / Closed (kept as text so new values still work)', 'Case status, Stage', 'SELECT DISTINCT status, stage FROM cms.cheque;'],
];

// Columns that run correctly but were empty for every case on SIT on that date (data not filled yet).
const EMPTY_ON_SIT = 'File number, Drawer account number, Presentation date, Memo number, Last event, Reason, Case language, eCourts case type, Decision date, Milestone remark, Email sent at';

// Columns in the prototype (litelo-reports-v2.html) that have no database source yet.
const NOT_IN_DATABASE = [
  ['Case and batch', 'Batch ID, Loan account number (if different from Agreement number)'],
  ['Borrower', 'Preferred language'],
  ['Claimant', 'Authorised representative, Representative email'],
  ['Loan', 'Product, Sanctioned amount, EMI amount, DPD, Principal outstanding'],
  ['Location', 'Branch, Zone, State, City, Pincode (of the loan / branch)'],
  ['Cheque', 'Cheque amount, Drawer branch, Presenting (payee) branch, Cheque purpose'],
  ['Dishonour', 'Number of presentations, Dishonour date, Memo received date'],
  ['Demand notice', 'Notice language, Dispatch mode, Tracking / POD number, Courier dispatch date, Delivery status, Notice served date, Reason of undelivery, Payment due by, Paid within notice period'],
  ['Complaint filing', 'Cause of action date, Complaint limitation date, Filing status, Court city, Cognizance date'],
  ['Proceedings', 'Summons issued/status, Reissue summons, Warrant type/date/status, Proclaimed offender, First appearance, Interim compensation (143A), Lok Adalat / mediation'],
  ['Judgment', 'Judgment date and outcome, Compensation awarded, Withdrawal date/status, Appeal filed/status'],
  ['Communication and replies', 'Reply link opened, Full reply text, Supporting document (likely inside `digiserve.reply.reply_data` JSON)'],
  ['Settlement and recovery', 'Whole group: settlement status/amount, payment date, total recovered, closure date/reason'],
  ['Legal cost', 'Whole group: advocate fee, court fee, notice cost, total cost, invoice status'],
  ['Calculated timelines', 'Complaint filed after limitation, Limitation status (need limitation date first)'],
];

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

function sourceOf(field) {
  if (!field.repeating) return `\`${cell(field.sql)}\``;
  const { from, where, value, orderBy } = field.repeating;
  return `\`${cell(value)}\` from \`${cell(from)}\` where \`${cell(where)}\` (ordered by \`${orderBy}\`)`;
}

function workflowSection(key, workflow) {
  const catalog = getCatalog(key);
  const lines = [`## ${workflow.label} (\`${key}\`)`, ''];

  if (!catalog.fields.length) {
    lines.push(
      `**Not available yet.** Base table not confirmed. To switch it on, set \`baseTable\` in \`backend/config/workflows.js\` and add its groups in \`backend/config/column-catalog.js\`.`,
      ''
    );
    return lines;
  }

  lines.push(`Base table: \`${workflow.baseTable} c\` — one row per case. ${catalog.fields.length} columns.`, '');

  const groups = [...new Set(catalog.fields.map((f) => f.group))];
  for (const group of groups) {
    lines.push(`### ${group}`, '', '| ✓ | Key | Column | Type | Source | Notes |', '|---|---|---|---|---|---|');
    for (const f of catalog.fields.filter((x) => x.group === group)) {
      const notes = [
        f.repeating && 'Repeats — user picks latest / first / all / count',
        f.calculated && 'Calculated',
        f.needs.length && `Needs join: ${f.needs.join(', ')}`,
        f.options && `Options: ${f.options.join(', ')}`,
        f.description,
      ].filter(Boolean);
      lines.push(`| ☐ | \`${f.key}\` | ${cell(f.label)} | ${TYPE_LABEL[f.type]} | ${sourceOf(f)} | ${cell(notes.join('. '))} |`);
    }
    lines.push('');
  }

  lines.push('### Joins (lookups)', '', 'Added to the query only when a chosen column or filter needs them.', '');
  for (const [name, lookup] of Object.entries(catalog.lookups)) {
    lines.push(`**${name}** — ${lookup.description}`, '', '```sql', lookup.sql, '```', '');
  }
  return lines;
}

const doc = [
  '# Litelo MIS — Report Columns',
  '',
  '> Generated from `backend/config/column-catalog.js` by `npm run docs:columns`. Do not edit by hand — change the catalog and regenerate.',
  '',
  'Use this file to check every report column against the real database (`sit_lwms`).',
  'Tick ☐ → ☑ once a column is verified on SIT data.',
  '',
  '**How a column becomes SQL:** every report is `SELECT … FROM <base table> c [joins] WHERE c.enterprise_id = $1 AND <date basis> BETWEEN $2 AND $3 AND <filters>`.',
  'A *repeating* column is read with a sub-query, so a case is always exactly one row.',
  '',
  '## Database facts the columns rely on',
  '',
  `All checked on SIT (read-only) on ${CHECKED_ON}. Re-run the check queries on production before go-live.`,
  '',
  '| ✓ | Fact | Affects | Check with |',
  '|---|---|---|---|',
  ...ASSUMPTIONS.map(([what, affects, sql]) => `| ☑ | ${what} | ${affects} | \`${cell(sql)}\` |`),
  '',
  `**Run test on SIT, ${CHECKED_ON}:** every column below ran without error on real data. These columns were empty for every case (data not filled in on SIT yet, not a mapping error): ${EMPTY_ON_SIT}.`,
  '',
  ...Object.entries(WORKFLOWS).flatMap(([key, wf]) => workflowSection(key, wf)),
  '## In the prototype but not in the database yet',
  '',
  'These appear in `litelo-reports-v2.html` but no table/column was found for them in `LITELO_CONTEXT.md`.',
  'Each needs either a column added to the platform or a pointer to where it is stored (often inside a `meta` / JSON column).',
  '',
  '| Group | Columns |',
  '|---|---|',
  ...NOT_IN_DATABASE.map(([group, cols]) => `| ${group} | ${cols} |`),
  '',
];

fs.writeFileSync(OUTPUT, doc.join('\n'), 'utf8');
console.log(`Wrote ${path.relative(process.cwd(), OUTPUT)}`);
