/**
 * LOCAL SERVER — the full /api/mis API without the three MIS tables. Two modes:
 *
 *   npm run demo   Fake data. No database at all.
 *   npm run sit    REAL case data from SIT, READ-ONLY. Needs backend/.env with DB_* and DB_READ_ONLY=true.
 *
 * In both modes, templates / history / schedules are kept in memory (lost on restart), because the
 * MIS tables cannot be created with a read-only database user. Everything else is production code:
 * column catalog, validation, query builder and Excel/CSV writers.
 *
 * SIT mode never writes to the database:
 *   1. it refuses to start unless DB_READ_ONLY=true (every connection opened read-only), and
 *   2. its only database calls are SELECTs (enterprises, users, report rows).
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const cors = require('cors');

const env = require('../config/env');
const { listWorkflows } = require('../config/workflows');
const { OPERATORS, OPERATOR_GROUP_BY_TYPE, NO_VALUE_OPERATORS } = require('../config/filter-operators');
const { getPublicFields, getField } = require('../config/column-catalog');
const { validateTemplate, validateDateRange, validateFormat, validateSchedule } = require('../utils/validators');
const { daysInRange } = require('../utils/dates');
const { createReportWriter } = require('../services/report-writers');
const { errorHandler, asyncHandler } = require('../middleware/error-handler');
const { badRequest, notFound } = require('../utils/http-error');
const { sampleRows } = require('./sample-rows');

const SIT_MODE = process.argv.includes('--sit');
const PORT = Number(process.env.PORT) || 5000;
const FILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-local-'));
const DEMO_ROWS_PER_REPORT = 25000; // fake mode: every report "contains" this many cases

// Loaded only in SIT mode, so fake mode never opens a database connection.
const sit = SIT_MODE
  ? {
      pool: require('../db/pool').pool,
      reports: require('../services/report.service'),
      enterprises: require('../services/enterprise.service'),
      accounts: require('../services/account.service'),
    }
  : null;

/* ------------------------------------------------------------------ */
/* In-memory data                                                      */
/* ------------------------------------------------------------------ */

let USER = { id: '00000000-0000-0000-0000-000000000001', email: 'aleem.rayeen@presolv360.com', name: 'Aleem Rayeen' };
let ENTERPRISES = [
  { id: 'a0000000-0000-0000-0000-000000000001', name: 'ABC Bank' },
  { id: 'a0000000-0000-0000-0000-000000000002', name: 'HDFC Bank' },
  { id: 'a0000000-0000-0000-0000-000000000003', name: 'Vastu Finserve' },
];
const templates = [];
const history = [];
const schedules = [];

const newId = () => crypto.randomUUID();
const column = (key) => ({ key, label: getField('section138', key).label, mv: 'latest' });
const daysAgo = (n) => new Date(Date.now() - n * 864e5);

// Three starter templates so the screens are not empty. `mainId` gets two Active ones.
function seedTemplates(mainId, otherId) {
  templates.push(
    {
      id: newId(), name: 'Notice dispatch tracker', description: 'Every notice sent, with delivery status and limitation checks.',
      enterpriseId: mainId, workflow: 'section138', dateBasis: 'memo_date', status: 'Active',
      columns: ['case_number', 'borrower_name', 'borrower_mobile', 'cheque_no', 'outstanding_amount', 'memo_date', 'notice_date', 'sms_status', 'wa_status', 'd_memo_notice', 'notice_breach'].map(column),
      filters: [], createdAt: daysAgo(10), updatedAt: daysAgo(3), updatedByEmail: USER.email,
    },
    {
      id: newId(), name: 'Court pipeline', description: 'Case-level court data for the legal desk.',
      enterpriseId: mainId, workflow: 'section138', dateBasis: 'case_created_date', status: 'Active',
      columns: ['case_number', 'borrower_name', 'outstanding_amount', 'court_name', 'jurisdiction', 'stage', 'sub_stage', 'advocate', 'next_hearing', 'ageing'].map(column),
      filters: [{ key: 'case_status', op: 'is', value: 'ONGOING' }], createdAt: daysAgo(20), updatedAt: daysAgo(1), updatedByEmail: USER.email,
    },
    {
      id: newId(), name: 'Weekly recovery snapshot', description: 'Outstanding movement for the week.',
      enterpriseId: otherId, workflow: 'section138', dateBasis: 'case_updated_date', status: 'Draft',
      columns: ['case_number', 'borrower_name', 'outstanding_amount', 'stage'].map(column),
      filters: [], createdAt: daysAgo(8), updatedAt: daysAgo(6), updatedByEmail: USER.email,
    }
  );
}

const findOr404 = (list, id, message) => {
  const item = list.find((x) => x.id === id);
  if (!item) throw notFound(message);
  return item;
};
const enterpriseName = (id) => (ENTERPRISES.find((e) => e.id === id) || {}).name || 'Unknown';

// Same output columns the real query builder produces (used in fake mode).
function outputColumns(template) {
  return template.columns.map((c, i) => {
    const field = getField(template.workflow, c.key);
    const type = field.repeating && c.mv === 'count' ? 'number' : field.repeating && c.mv === 'all' ? 'text' : field.type;
    return { alias: `c${i}`, label: c.label || field.label, type, key: c.key };
  });
}

function saveTemplate(input, existingId) {
  const { value, errors } = validateTemplate(input);
  const duplicate = templates.some(
    (t) => t.id !== existingId && t.enterpriseId === value.enterpriseId && t.name.toLowerCase() === value.name.toLowerCase()
  );
  if (duplicate) errors.push('This enterprise already has a report with that name.');
  if (errors.length) throw badRequest('Fix these before saving', errors);
  return { ...value, description: value.description || '', updatedAt: new Date(), updatedByEmail: USER.email };
}

/* ------------------------------------------------------------------ */
/* Export jobs: real files written by the real writers                 */
/* ------------------------------------------------------------------ */

function queueExport(template, { dateFrom, dateTo }, format, delivery, recipients = null, scheduleId = null) {
  const job = {
    id: newId(), templateId: template.id, scheduleId, templateName: template.name, enterpriseId: template.enterpriseId,
    enterpriseName: enterpriseName(template.enterpriseId), workflow: template.workflow, dateFrom, dateTo, format, delivery,
    recipients: recipients || [], status: 'running', rowCount: 0, error: null, hasFile: false, fileSize: null,
    fileName: `${template.name.replace(/[^a-z0-9]+/gi, '_')}_${enterpriseName(template.enterpriseId).replace(/[^a-z0-9]/gi, '')}_${dateTo.replace(/-/g, '')}.${format}`,
    generatedAt: new Date(), completedAt: null, generatedByEmail: USER.email,
  };
  history.unshift(job);
  const build = SIT_MODE ? buildFileFromSit : buildFakeFile;
  build(job, template).catch((err) => {
    console.error(`[local] export failed: ${err.message}`);
    Object.assign(job, { status: 'failed', error: err.message });
  });
  return job;
}

// SIT mode: the production streaming path (cursor -> writer).
async function buildFileFromSit(job, template) {
  const report = sit.reports.prepareExport(template, { dateFrom: job.dateFrom, dateTo: job.dateTo });
  const writer = createReportWriter(job.format, path.join(FILE_DIR, `${job.id}.${job.format}`), report.columns);
  job.rowCount = await report.streamRows(async (rows, rowsSoFar) => {
    await writer.writeRows(rows);
    job.rowCount = rowsSoFar;
  });
  await writer.finish();
  finishJob(job);
}

// Fake mode: generated rows, slowed down so the progress bar is visible.
async function buildFakeFile(job, template) {
  const columns = outputColumns(template);
  const writer = createReportWriter(job.format, path.join(FILE_DIR, `${job.id}.${job.format}`), columns);
  for (let start = 0; start < DEMO_ROWS_PER_REPORT; start += 2500) {
    await writer.writeRows(sampleRows(columns, start, 2500, { dateFrom: job.dateFrom, dateTo: job.dateTo }));
    job.rowCount = start + 2500;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  await writer.finish();
  finishJob(job);
}

function finishJob(job) {
  Object.assign(job, { status: 'done', hasFile: true, completedAt: new Date() });
  if (job.delivery === 'Email') console.log(`[local] would email "${job.fileName}" to ${job.recipients.join(', ')} (no email is sent locally)`);
}

/* ------------------------------------------------------------------ */
/* Routes (same paths and shapes as routes/report.routes.js)           */
/* ------------------------------------------------------------------ */

const api = express.Router();

api.get('/config', (req, res) => res.json({ user: USER, workflows: listWorkflows(), operators: OPERATORS, operatorGroupByType: OPERATOR_GROUP_BY_TYPE, noValueOperators: NO_VALUE_OPERATORS }));
api.get('/enterprises', (req, res) => res.json({ enterprises: ENTERPRISES }));
api.get('/catalog/:workflow', (req, res) => res.json({ fields: getPublicFields(req.params.workflow) }));

api.get('/templates', (req, res) => {
  const { enterpriseId, workflow, status } = req.query;
  res.json({
    templates: templates
      .filter((t) => t.enterpriseId === enterpriseId && (!workflow || t.workflow === workflow) && (!status || t.status === status))
      .sort((a, b) => b.updatedAt - a.updatedAt),
  });
});
api.get('/templates/:id', (req, res) => res.json({ template: findOr404(templates, req.params.id, 'This report no longer exists.') }));
api.post('/templates', (req, res) => {
  const template = { id: newId(), createdAt: new Date(), ...saveTemplate(req.body) };
  templates.push(template);
  res.status(201).json({ template });
});
api.put('/templates/:id', (req, res) => {
  const template = findOr404(templates, req.params.id, 'This report no longer exists.');
  Object.assign(template, saveTemplate(req.body, template.id));
  res.json({ template });
});
api.post('/templates/:id/duplicate', (req, res) => {
  const original = findOr404(templates, req.params.id, 'This report no longer exists.');
  const copy = { ...JSON.parse(JSON.stringify(original)), id: newId(), name: `${original.name} (copy)`, status: 'Draft', updatedAt: new Date(), updatedByEmail: USER.email };
  templates.push(copy);
  res.status(201).json({ template: copy });
});
api.delete('/templates/:id', (req, res) => {
  const template = findOr404(templates, req.params.id, 'This report no longer exists.');
  templates.splice(templates.indexOf(template), 1);
  const before = schedules.length;
  schedules.splice(0, schedules.length, ...schedules.filter((s) => s.templateId !== template.id));
  history.filter((h) => h.templateId === template.id).forEach((h) => (h.templateId = null));
  res.json({ name: template.name, stoppedSchedules: before - schedules.length });
});

function runnable(body) {
  const template = findOr404(templates, body.templateId, 'This report no longer exists.');
  if (template.status !== 'Active') throw badRequest('This report is a Draft. Set it to Active to run it.');
  const range = validateDateRange(body);
  if (range.errors.length) throw badRequest(range.errors[0], range.errors);
  return { template, range: range.value };
}

api.post('/reports/preview', asyncHandler(async (req, res) => {
  const { template, range } = runnable(req.body);
  if (SIT_MODE) return res.json(await sit.reports.previewReport(template, range));

  const columns = outputColumns(template);
  res.json({
    columns: columns.map(({ alias, label, type }) => ({ alias, label, type })),
    rows: sampleRows(columns, 0, 50, range),
    totalCount: DEMO_ROWS_PER_REPORT,
  });
}));
api.post('/reports/export', (req, res) => {
  const { template, range } = runnable(req.body);
  const errors = validateFormat(req.body.format);
  if (errors.length) throw badRequest(errors[0], errors);
  res.status(202).json({ job: queueExport(template, range, req.body.format, 'Download') });
});

api.get('/history', (req, res) => {
  const term = (req.query.search || '').trim().toLowerCase();
  const limit = Number(req.query.limit) || 20;
  const offset = Number(req.query.offset) || 0;
  const items = history.filter(
    (h) => h.enterpriseId === req.query.enterpriseId && (!term || `${h.templateName} ${h.fileName} ${h.generatedByEmail}`.toLowerCase().includes(term))
  );
  res.json({ items: items.slice(offset, offset + limit), total: items.length });
});
api.get('/history/:id', (req, res) => res.json({ item: findOr404(history, req.params.id, 'This file is not in History.') }));
api.get('/history/:id/file', (req, res) => {
  const job = findOr404(history, req.params.id, 'This file is not in History.');
  if (job.status !== 'done') throw notFound('This file is not ready yet.');
  res.download(path.join(FILE_DIR, `${job.id}.${job.format}`), job.fileName);
});

api.get('/schedules', (req, res) => res.json({ schedules: schedules.filter((s) => s.templateId === req.query.templateId) }));
api.post('/schedules', (req, res) => {
  const { value, errors } = validateSchedule(req.body);
  const range = validateDateRange(req.body);
  errors.push(...range.errors);
  if (errors.length) throw badRequest('Fix these before sending', errors);
  const { template } = runnable(req.body);
  const schedule = { id: newId(), templateId: template.id, ...value, rangeDays: daysInRange(req.body.dateFrom, req.body.dateTo) };
  schedules.push(schedule);
  const firstJob = queueExport(template, range.value, value.format, 'Email', value.recipients, schedule.id);
  res.status(201).json({ schedule, firstJob });
});
api.put('/schedules/:id', (req, res) => {
  const schedule = findOr404(schedules, req.params.id, 'This schedule no longer exists.');
  const { value, errors } = validateSchedule(req.body);
  if (errors.length) throw badRequest('Fix these before saving', errors);
  Object.assign(schedule, value);
  res.json({ schedule });
});
api.delete('/schedules/:id', (req, res) => {
  const schedule = findOr404(schedules, req.params.id, 'This schedule no longer exists.');
  schedules.splice(schedules.indexOf(schedule), 1);
  res.json({ deleted: true });
});

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

// SIT mode: load real enterprises and user (SELECT only), and seed templates for the busiest enterprise.
async function loadFromSit() {
  if (!env.readOnly) {
    console.error('[local] SIT mode needs DB_READ_ONLY=true in backend/.env, so nothing can ever be written. Not starting.');
    process.exit(1);
  }
  try {
    ENTERPRISES = await sit.enterprises.listEnterprises();
    if (env.devUser) USER = await sit.accounts.describeUser(env.devUser);
    const { rows } = await sit.pool.query('SELECT enterprise_id FROM cms.cheque GROUP BY 1 ORDER BY count(*) DESC LIMIT 2');
    const main = rows[0] ? rows[0].enterprise_id : ENTERPRISES[0].id;
    const other = rows[1] ? rows[1].enterprise_id : main;
    seedTemplates(main, other);
    console.log(`[local] SIT mode, READ-ONLY: ${ENTERPRISES.length} enterprises; sample templates added for "${enterpriseName(main)}"`);
  } catch (err) {
    console.error(`[local] Cannot read SIT at ${env.db.host}:${env.db.port}: ${err.message || err.code}`);
    console.error('[local] Is the kubectl port-forward running? Are DB_* values in backend/.env right?');
    process.exit(1);
  }
}

async function start() {
  if (SIT_MODE) await loadFromSit();
  else seedTemplates(ENTERPRISES[0].id, ENTERPRISES[1].id);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/mis', api); // sync handlers: Express passes thrown HttpErrors to errorHandler
  app.use(errorHandler);

  app.listen(PORT, () => {
    console.log(`[local] MIS API on http://localhost:${PORT}/api/mis — ${SIT_MODE ? 'REAL SIT data, read-only' : 'fake sample data, no database'}`);
    console.log(`[local] templates and history are in memory only; generated files go to ${FILE_DIR}`);
  }).on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `[local] Port ${PORT} is in use. Stop the other backend first.` : err);
    process.exit(1);
  });
}

start();
