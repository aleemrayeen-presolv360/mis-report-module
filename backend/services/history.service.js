/**
 * HISTORY SERVICE — cms.report_history.
 *
 * Every file ever built gets one row here. The same row is also the export job:
 *
 *     queued  -> running -> done
 *                        -> failed
 *
 * The API inserts a `queued` row; jobs/export-worker.js claims it, builds the file and marks it
 * `done`. Keeping the queue in Postgres means jobs survive a restart and several servers can
 * share the work without picking the same job (FOR UPDATE SKIP LOCKED).
 */

const { query } = require('../db/pool');
const { notFound } = require('../utils/http-error');
const { fileKeyFor } = require('./file-storage');

const SELECT_HISTORY = `
  SELECT h.*, a.email AS generated_by_email
  FROM cms.report_history h
  LEFT JOIN auth.account a ON a.id = h.generated_by`;

function toHistoryItem(row) {
  return {
    id: row.id,
    templateId: row.template_id,
    scheduleId: row.schedule_id,
    templateName: row.template_name,
    enterpriseId: row.enterprise_id,
    enterpriseName: row.enterprise_name,
    workflow: row.workflow,
    dateFrom: row.date_from,
    dateTo: row.date_to,
    format: row.format,
    delivery: row.delivery,
    recipients: row.recipients || [],
    status: row.status,
    rowCount: Number(row.row_count),
    fileName: row.file_name,
    fileSize: row.file_size === null ? null : Number(row.file_size),
    hasFile: Boolean(row.file_key),
    error: row.error,
    generatedAt: row.generated_at,
    completedAt: row.completed_at,
    generatedByEmail: row.generated_by_email || '',
  };
}

// "Notice dispatch tracker", "ABC Bank", "2026-09-15" -> "Notice_dispatch_tracker_ABCBank_20260915.xlsx"
function downloadFileName(templateName, enterpriseName, dateTo, format) {
  const safe = (s) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
  return `${safe(templateName)}_${enterpriseName.replace(/[^a-z0-9]/gi, '')}_${dateTo.replace(/-/g, '')}.${format}`;
}

/* ------------------------------------------------------------------ */
/* Creating and reading                                                */
/* ------------------------------------------------------------------ */

/**
 * Adds a job to the queue. Returns the new history item (status "queued").
 * `delivery` is "Download" or "Email"; for Email pass `recipients` (and `scheduleId` if it came from a schedule).
 */
async function queueExport({ template, enterpriseName, dateFrom, dateTo, format, delivery, recipients = null, scheduleId = null, userId }) {
  const { rows } = await query(
    `INSERT INTO cms.report_history
       (template_id, schedule_id, template_name, enterprise_id, enterprise_name, workflow,
        date_from, date_to, format, delivery, recipients, file_name, generated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [template.id, scheduleId, template.name, template.enterpriseId, enterpriseName, template.workflow,
      dateFrom, dateTo, format, delivery, recipients,
      downloadFileName(template.name, enterpriseName, dateTo, format), userId]
  );
  return getHistoryItem(rows[0].id);
}

async function getHistoryRow(id) {
  const { rows } = await query(`${SELECT_HISTORY} WHERE h.id = $1`, [id]);
  if (!rows.length) throw notFound('This file is not in History.');
  return rows[0];
}

async function getHistoryItem(id) {
  return toHistoryItem(await getHistoryRow(id));
}

/**
 * Newest first. `search` matches report name, file name or the person who generated it.
 * @returns {{ items, total }}
 */
async function listHistory({ enterpriseId, search, limit, offset }) {
  const params = [enterpriseId];
  let where = 'WHERE h.enterprise_id = $1';
  if (search) {
    params.push(`%${search}%`);
    const p = `$${params.length}`;
    where += ` AND (h.template_name ILIKE ${p} OR h.file_name ILIKE ${p} OR a.email ILIKE ${p})`;
  }

  const countSql = `SELECT count(*)::int AS total FROM cms.report_history h
    LEFT JOIN auth.account a ON a.id = h.generated_by ${where}`;
  const [list, count] = await Promise.all([
    query(`${SELECT_HISTORY} ${where} ORDER BY h.generated_at DESC LIMIT ${limit} OFFSET ${offset}`, params),
    query(countSql, params),
  ]);
  return { items: list.rows.map(toHistoryItem), total: count.rows[0].total };
}

/* ------------------------------------------------------------------ */
/* Job lifecycle (used by jobs/export-worker.js)                       */
/* ------------------------------------------------------------------ */

// Takes the oldest queued job, or returns null. Safe to call from many servers at once.
async function claimNextJob() {
  const { rows } = await query(
    `UPDATE cms.report_history
     SET status = 'running', started_at = now(), updated_at = now()
     WHERE id = (
       SELECT id FROM cms.report_history
       WHERE status = 'queued'
       ORDER BY generated_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING id`
  );
  return rows.length ? getHistoryRow(rows[0].id) : null;
}

// Also acts as a heartbeat: a running job that stops updating is treated as dead (see failStaleJobs).
async function updateProgress(id, rowCount) {
  await query('UPDATE cms.report_history SET row_count = $2, updated_at = now() WHERE id = $1', [id, rowCount]);
}

async function markDone(id, { rowCount, fileSize, format }) {
  await query(
    `UPDATE cms.report_history
     SET status = 'done', row_count = $2, file_size = $3, file_key = $4, error = NULL,
         completed_at = now(), updated_at = now()
     WHERE id = $1`,
    [id, rowCount, fileSize, fileKeyFor(id, format)]
  );
}

async function markFailed(id, message) {
  await query(
    `UPDATE cms.report_history SET status = 'failed', error = $2, completed_at = now(), updated_at = now()
     WHERE id = $1`,
    [id, String(message).slice(0, 1000)]
  );
}

// Jobs whose server died mid-way: no progress update for `minutes`.
async function failStaleJobs(minutes) {
  const { rowCount } = await query(
    `UPDATE cms.report_history
     SET status = 'failed', error = 'Stopped unexpectedly. Please run the report again.', completed_at = now()
     WHERE status = 'running' AND updated_at < now() - make_interval(mins => $1)`,
    [minutes]
  );
  return rowCount;
}

// Done jobs whose file is past the retention period. The row stays; only the file goes.
async function listExpiredFiles(retentionDays) {
  const { rows } = await query(
    `SELECT id, file_key FROM cms.report_history
     WHERE file_key IS NOT NULL AND completed_at < now() - make_interval(days => $1)
     LIMIT 500`,
    [retentionDays]
  );
  return rows;
}

async function clearFile(id) {
  await query('UPDATE cms.report_history SET file_key = NULL WHERE id = $1', [id]);
}

module.exports = {
  queueExport,
  getHistoryRow,
  getHistoryItem,
  listHistory,
  claimNextJob,
  updateProgress,
  markDone,
  markFailed,
  failStaleJobs,
  listExpiredFiles,
  clearFile,
};
