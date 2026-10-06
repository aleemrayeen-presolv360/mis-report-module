/**
 * MIS REPORT ROUTES — mounted at /api/mis.
 *
 * Routes stay thin: read the request, check access, call a service, send JSON.
 * Business rules live in services/, SQL in services/ and utils/query-builder.js.
 */

const express = require('express');
const { asyncHandler } = require('../middleware/error-handler');
const { requireUser, assertEnterpriseAccess } = require('../middleware/auth');
const { listWorkflows } = require('../config/workflows');
const { OPERATORS, OPERATOR_GROUP_BY_TYPE, NO_VALUE_OPERATORS } = require('../config/filter-operators');
const { getPublicFields } = require('../config/column-catalog');
const templateService = require('../services/template.service');
const enterpriseService = require('../services/enterprise.service');
const accountService = require('../services/account.service');
const historyService = require('../services/history.service');
const scheduleService = require('../services/schedule.service');
const { previewReport } = require('../services/report.service');
const { pathFor, fileExists } = require('../services/file-storage');
const { nudgeExportWorker } = require('../jobs/export-worker');
const { isUuid, validateDateRange, validateFormat } = require('../utils/validators');
const { badRequest, notFound, gone } = require('../utils/http-error');

const router = express.Router();
router.use(requireUser);

const requireUuid = (value, what) => {
  if (!isUuid(value)) throw badRequest(`${what} is missing or not valid.`);
  return value;
};

// Loads a template and checks the user may see its enterprise.
async function loadTemplate(req, id) {
  const template = await templateService.getTemplate(requireUuid(id, 'Report id'));
  assertEnterpriseAccess(req.user, template.enterpriseId);
  return template;
}

/* ------------------------------------------------------------------ */
/* Reference data                                                      */
/* ------------------------------------------------------------------ */

// Everything the UI needs that never changes per enterprise.
router.get('/config', asyncHandler(async (req, res) => {
  res.json({
    user: await accountService.describeUser(req.user),
    workflows: listWorkflows(),
    operators: OPERATORS,
    operatorGroupByType: OPERATOR_GROUP_BY_TYPE,
    noValueOperators: NO_VALUE_OPERATORS,
  });
}));

router.get('/enterprises', asyncHandler(async (req, res) => {
  res.json({ enterprises: await enterpriseService.listEnterprises() });
}));

// Columns a user can pick for one workflow.
router.get('/catalog/:workflow', (req, res) => {
  res.json({ fields: getPublicFields(req.params.workflow) });
});

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

// ?enterpriseId=...&workflow=section138&status=Active   (workflow and status are optional)
router.get('/templates', asyncHandler(async (req, res) => {
  const { enterpriseId, workflow, status } = req.query;
  assertEnterpriseAccess(req.user, requireUuid(enterpriseId, 'Enterprise'));
  res.json({ templates: await templateService.listTemplates({ enterpriseId, workflow, status }) });
}));

router.get('/templates/:id', asyncHandler(async (req, res) => {
  res.json({ template: await loadTemplate(req, req.params.id) });
}));

router.post('/templates', asyncHandler(async (req, res) => {
  assertEnterpriseAccess(req.user, req.body.enterpriseId);
  res.status(201).json({ template: await templateService.createTemplate(req.body, req.user.id) });
}));

router.put('/templates/:id', asyncHandler(async (req, res) => {
  await loadTemplate(req, req.params.id);
  assertEnterpriseAccess(req.user, req.body.enterpriseId);
  res.json({ template: await templateService.updateTemplate(req.params.id, req.body, req.user.id) });
}));

router.post('/templates/:id/duplicate', asyncHandler(async (req, res) => {
  await loadTemplate(req, req.params.id);
  res.status(201).json({ template: await templateService.duplicateTemplate(req.params.id, req.user.id) });
}));

// Response says how many email schedules were stopped, so the UI can tell the user.
router.delete('/templates/:id', asyncHandler(async (req, res) => {
  await loadTemplate(req, req.params.id);
  res.json(await templateService.deleteTemplate(req.params.id));
}));

/* ------------------------------------------------------------------ */
/* Running reports                                                     */
/* ------------------------------------------------------------------ */

async function loadRunnableTemplate(req) {
  const template = await loadTemplate(req, req.body.templateId);
  if (template.status !== 'Active') throw badRequest('This report is a Draft. Set it to Active to run it.');
  const range = validateDateRange(req.body);
  if (range.errors.length) throw badRequest(range.errors[0], range.errors);
  return { template, range: range.value };
}

// Body: { templateId, dateFrom, dateTo } -> first rows of real data + total count
router.post('/reports/preview', asyncHandler(async (req, res) => {
  const { template, range } = await loadRunnableTemplate(req);
  res.json(await previewReport(template, range));
}));

/**
 * Body: { templateId, dateFrom, dateTo, format: 'xlsx' | 'csv' }
 * Starts building the file and returns the History item at once (status "queued").
 * Poll GET /history/:id until status is "done", then download GET /history/:id/file.
 */
router.post('/reports/export', asyncHandler(async (req, res) => {
  const { template, range } = await loadRunnableTemplate(req);
  const formatErrors = validateFormat(req.body.format);
  if (formatErrors.length) throw badRequest(formatErrors[0], formatErrors);

  const job = await historyService.queueExport({
    template,
    enterpriseName: await enterpriseService.getEnterpriseName(template.enterpriseId),
    ...range,
    format: req.body.format,
    delivery: 'Download',
    userId: req.user.id,
  });
  nudgeExportWorker();
  res.status(202).json({ job });
}));

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

// ?enterpriseId=...&search=...&limit=20&offset=0
router.get('/history', asyncHandler(async (req, res) => {
  const { enterpriseId, search } = req.query;
  assertEnterpriseAccess(req.user, requireUuid(enterpriseId, 'Enterprise'));
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  res.json(await historyService.listHistory({ enterpriseId, search: (search || '').trim(), limit, offset }));
}));

router.get('/history/:id', asyncHandler(async (req, res) => {
  const item = await historyService.getHistoryItem(requireUuid(req.params.id, 'History id'));
  assertEnterpriseAccess(req.user, item.enterpriseId);
  res.json({ item });
}));

// The exact file built at that time. Streams from disk, so file size does not matter.
router.get('/history/:id/file', asyncHandler(async (req, res) => {
  const row = await historyService.getHistoryRow(requireUuid(req.params.id, 'History id'));
  assertEnterpriseAccess(req.user, row.enterprise_id);

  if (row.status !== 'done') throw notFound('This file is not ready yet.');
  if (!fileExists(row.file_key)) {
    throw gone('This file is older than the retention period and has been removed. Use "Run with latest data" to build it again.');
  }
  res.download(pathFor(row.file_key), row.file_name);
}));

/* ------------------------------------------------------------------ */
/* Email schedules                                                     */
/* ------------------------------------------------------------------ */

router.get('/schedules', asyncHandler(async (req, res) => {
  const template = await loadTemplate(req, req.query.templateId);
  res.json({ schedules: await scheduleService.listSchedules(template.id) });
}));

// Body: { templateId, recipients[], frequency, sendTime 'HH:MM', endDate, format, dateFrom, dateTo }
// Sends the first email straight away.
router.post('/schedules', asyncHandler(async (req, res) => {
  await loadTemplate(req, req.body.templateId);
  const result = await scheduleService.createSchedule(req.body, req.user);
  nudgeExportWorker();
  res.status(201).json(result);
}));

// Access is checked through the schedule's own template, not anything the client sends.
async function loadSchedule(req, id) {
  const schedule = await scheduleService.getSchedule(requireUuid(id, 'Schedule id'));
  await loadTemplate(req, schedule.templateId);
  return schedule;
}

router.put('/schedules/:id', asyncHandler(async (req, res) => {
  const schedule = await loadSchedule(req, req.params.id);
  res.json({ schedule: await scheduleService.updateSchedule(schedule.id, req.body, req.user) });
}));

router.delete('/schedules/:id', asyncHandler(async (req, res) => {
  const schedule = await loadSchedule(req, req.params.id);
  await scheduleService.deleteSchedule(schedule.id);
  res.json({ deleted: true });
}));

module.exports = router;
