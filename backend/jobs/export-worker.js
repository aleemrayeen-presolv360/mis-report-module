/**
 * EXPORT WORKER — builds report files in the background.
 *
 * Why in the background: a report with millions of rows can take minutes. Doing it inside the
 * HTTP request would hit gateway timeouts and tie up the request. Instead:
 *
 *   1. POST /reports/export inserts a "queued" row in cms.report_history and returns at once.
 *   2. This worker claims queued rows (up to MIS_MAX_CONCURRENT_EXPORTS at a time per server),
 *      streams the rows from Postgres into the file, and marks the row "done".
 *   3. The browser polls GET /history/:id and downloads GET /history/:id/file when it is done.
 *   4. For Email jobs, the worker also sends the email once the file is ready.
 */

const env = require('../config/env');
const historyService = require('../services/history.service');
const templateService = require('../services/template.service');
const { prepareExport } = require('../services/report.service');
const { createReportWriter } = require('../services/report-writers');
const { fileKeyFor, pathFor, fileSize, removeFile } = require('../services/file-storage');
const { sendReportEmail } = require('../services/email.service');

const POLL_INTERVAL_MS = 2000;
const PROGRESS_EVERY_MS = 3000;

let running = 0;
let pollTimer = null;
let claiming = false;
let lastClaimError = '';
let lastClaimErrorAt = 0;

/**
 * Builds one file. The template is read fresh, so a saved change applies to the next run;
 * files already built never change.
 */
async function runExport(job) {
  const fileKey = fileKeyFor(job.id, job.format);
  let writer = null;
  let lastProgressAt = Date.now();

  try {
    const template = await templateService.getTemplate(job.template_id);
    const report = prepareExport(template, { dateFrom: job.date_from, dateTo: job.date_to });
    writer = createReportWriter(job.format, pathFor(fileKey), report.columns);

    const rowCount = await report.streamRows(async (rows, rowsSoFar) => {
      await writer.writeRows(rows);
      if (Date.now() - lastProgressAt > PROGRESS_EVERY_MS) {
        lastProgressAt = Date.now();
        await historyService.updateProgress(job.id, rowsSoFar);
      }
    });
    await writer.finish();

    await historyService.markDone(job.id, { rowCount, fileSize: await fileSize(fileKey), format: job.format });
  } catch (err) {
    console.error(`[export] job ${job.id} failed:`, err.message);
    if (writer) await writer.abort();
    await removeFile(fileKey);
    await historyService.markFailed(job.id, userMessage(err));
    return;
  }

  if (job.delivery === 'Email') await deliverEmail(job.id);
}

async function deliverEmail(jobId) {
  try {
    await sendReportEmail(await historyService.getHistoryRow(jobId));
  } catch (err) {
    console.error(`[export] email for job ${jobId} failed:`, err.message);
    await historyService.markFailed(jobId, `The file was built but the email could not be sent: ${err.message}`);
  }
}

function userMessage(err) {
  if (err.status) return err.message; // HttpError from validation / query builder
  if (err.code === '57014') return 'The report took too long and was stopped. Try a shorter date range.';
  return 'The report could not be built. Please try again, or contact support if it keeps failing.';
}

/* ------------------------------------------------------------------ */
/* Queue loop                                                          */
/* ------------------------------------------------------------------ */

// Claim jobs until this server is at its limit or the queue is empty.
async function claimJobs() {
  if (claiming) return;
  claiming = true;
  try {
    while (running < env.exports.maxConcurrent) {
      const job = await historyService.claimNextJob();
      if (!job) break;
      running += 1;
      runExport(job)
        .catch((err) => console.error(`[export] job ${job.id} crashed:`, err))
        .finally(() => {
          running -= 1;
          claimJobs();
        });
    }
  } catch (err) {
    // The poll runs every 2s; while the database is down, log the same error once a minute, not 30 times.
    const message = err.message || err.code;
    if (message !== lastClaimError || Date.now() - lastClaimErrorAt > 60000) {
      console.error('[export] could not claim jobs:', message);
      lastClaimError = message;
      lastClaimErrorAt = Date.now();
    }
  } finally {
    claiming = false;
  }
}

function startExportWorker() {
  if (pollTimer) return;
  pollTimer = setInterval(claimJobs, POLL_INTERVAL_MS);
  claimJobs();
  console.log(`[export] worker started (${env.exports.maxConcurrent} at a time)`);
}

// Call after queueing a job so it starts now instead of at the next poll.
function nudgeExportWorker() {
  if (pollTimer) claimJobs();
}

module.exports = { startExportWorker, nudgeExportWorker };
