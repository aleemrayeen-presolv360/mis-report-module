/**
 * SCHEDULER — runs once a minute and does three housekeeping jobs:
 *
 *   1. Sends due schedule emails (queues an Email export for each; the export worker sends it).
 *   2. Marks exports whose server died mid-way as failed, so they don't show "running" forever.
 *   3. Deletes files past MIS_FILE_RETENTION_DAYS (the History row stays).
 *
 * Every step is safe to run on several servers at once.
 */

const env = require('../config/env');
const scheduleService = require('../services/schedule.service');
const historyService = require('../services/history.service');
const { removeFile } = require('../services/file-storage');
const { nudgeExportWorker } = require('./export-worker');

const TICK_MS = 60 * 1000;
const STALE_JOB_MINUTES = 15;
const MAX_SCHEDULES_PER_TICK = 100;

let timer = null;
let busy = false;

async function sendDueSchedules() {
  let sent = 0;
  while (sent < MAX_SCHEDULES_PER_TICK && (await scheduleService.claimDueSchedule())) sent += 1;
  if (sent) {
    console.log(`[scheduler] queued ${sent} scheduled email(s)`);
    nudgeExportWorker();
  }
}

async function deleteExpiredFiles() {
  const expired = await historyService.listExpiredFiles(env.exports.retentionDays);
  for (const { id, file_key: fileKey } of expired) {
    await removeFile(fileKey);
    await historyService.clearFile(id);
  }
  if (expired.length) console.log(`[scheduler] deleted ${expired.length} expired file(s)`);
}

async function tick() {
  if (busy) return; // previous tick still running
  busy = true;
  try {
    await sendDueSchedules();
    const stale = await historyService.failStaleJobs(STALE_JOB_MINUTES);
    if (stale) console.log(`[scheduler] marked ${stale} stalled export(s) as failed`);
    await deleteExpiredFiles();
  } catch (err) {
    console.error('[scheduler] tick failed:', err.message || err.code);
  } finally {
    busy = false;
  }
}

function startScheduler() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  tick();
  console.log('[scheduler] started (every minute)');
}

module.exports = { startScheduler };
