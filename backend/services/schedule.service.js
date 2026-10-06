/**
 * SCHEDULE SERVICE — repeating report emails (cms.report_schedules).
 *
 * How a schedule works:
 *   1. User runs a report for, say, 1–7 Oct and clicks Email -> createSchedule().
 *      We remember the range LENGTH (7 days), send the first email straight away,
 *      and set next_run_at to one period later at the chosen IST time.
 *   2. jobs/scheduler.js calls claimDueSchedule() every minute. Each send covers the same number of
 *      days, ending on the send date — so a weekly email always carries the latest week.
 *   3. The schedule stops after end_date, or when it is cancelled / its template is deleted.
 */

const { query, withTransaction } = require('../db/pool');
const { validateSchedule, validateDateRange } = require('../utils/validators');
const { todayIst, addDays, daysInRange, istDateTime, nextRunAfter } = require('../utils/dates');
const { badRequest, notFound } = require('../utils/http-error');
const templateService = require('./template.service');
const enterpriseService = require('./enterprise.service');
const historyService = require('./history.service');

const SELECT_SCHEDULE = `
  SELECT s.*, to_char(s.send_time, 'HH24:MI') AS send_time_hhmm
  FROM cms.report_schedules s`;

function toSchedule(row) {
  return {
    id: row.id,
    templateId: row.template_id,
    frequency: row.frequency,
    sendTime: row.send_time_hhmm,
    endDate: row.end_date,
    recipients: row.recipients,
    format: row.format,
    rangeDays: row.range_days,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
  };
}

async function getScheduleRow(id) {
  const { rows } = await query(`${SELECT_SCHEDULE} WHERE s.id = $1`, [id]);
  if (!rows.length) throw notFound('This schedule no longer exists.');
  return rows[0];
}

async function getSchedule(id) {
  return toSchedule(await getScheduleRow(id));
}

async function listSchedules(templateId) {
  const { rows } = await query(`${SELECT_SCHEDULE} WHERE s.template_id = $1 ORDER BY s.created_at DESC`, [templateId]);
  return rows.map(toSchedule);
}

/**
 * Creates the schedule and queues the first email immediately.
 * `input` = { templateId, recipients, frequency, sendTime, endDate, format, dateFrom, dateTo }
 */
async function createSchedule(input, user) {
  const { value, errors } = validateSchedule(input);
  const range = validateDateRange(input);
  errors.push(...range.errors);
  if (errors.length) throw badRequest('Fix these before sending', errors);

  const template = await templateService.getTemplate(input.templateId);
  if (template.status !== 'Active') throw badRequest('Only Active reports can be emailed.');

  const now = new Date();
  const nextRunAt = nextRunAfter(istDateTime(todayIst(now), value.sendTime), value.frequency, now);

  const { rows } = await query(
    `INSERT INTO cms.report_schedules
       (template_id, frequency, send_time, end_date, recipients, format, range_days, next_run_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     RETURNING id`,
    [template.id, value.frequency, value.sendTime, value.endDate, value.recipients, value.format,
      daysInRange(input.dateFrom, input.dateTo), nextRunAt, user.id]
  );
  const schedule = await getScheduleRow(rows[0].id);

  // First email: exactly the range the user just looked at.
  const firstJob = await historyService.queueExport({
    template,
    enterpriseName: await enterpriseService.getEnterpriseName(template.enterpriseId),
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    format: value.format,
    delivery: 'Email',
    recipients: value.recipients,
    scheduleId: schedule.id,
    userId: user.id,
  });

  return { schedule: toSchedule(schedule), firstJob };
}

// Changes when/where it sends. Does not send an email by itself.
async function updateSchedule(id, input, user) {
  const { value, errors } = validateSchedule(input);
  if (errors.length) throw badRequest('Fix these before saving', errors);

  const existing = await getScheduleRow(id);
  const now = new Date();
  // Re-plan from today, keeping the new time and frequency.
  const nextRunAt = nextRunAfter(istDateTime(todayIst(now), value.sendTime), value.frequency, now);
  const sameTiming = existing.frequency === value.frequency && existing.send_time_hhmm === value.sendTime;

  await query(
    `UPDATE cms.report_schedules
     SET frequency = $2, send_time = $3, end_date = $4, recipients = $5, format = $6,
         next_run_at = $7, updated_by = $8, updated_at = now()
     WHERE id = $1`,
    [id, value.frequency, value.sendTime, value.endDate, value.recipients, value.format,
      sameTiming ? existing.next_run_at : nextRunAt, user.id]
  );
  return toSchedule(await getScheduleRow(id));
}

// Stops future emails. Emails already sent stay in History.
async function deleteSchedule(id) {
  const { rowCount } = await query('DELETE FROM cms.report_schedules WHERE id = $1', [id]);
  if (!rowCount) throw notFound('This schedule no longer exists.');
}

/**
 * Takes one schedule that is due, moves its next_run_at forward, and queues its email.
 * Returns false when nothing is due. Locked with SKIP LOCKED, so two servers never send the same email.
 */
async function claimDueSchedule() {
  const claimed = await withTransaction(async (client) => {
    const { rows } = await query(
      `${SELECT_SCHEDULE}
       WHERE s.next_run_at <= now() AND s.end_date >= $1
       ORDER BY s.next_run_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [todayIst()],
      client
    );
    if (!rows.length) return null;

    const schedule = rows[0];
    const next = nextRunAfter(schedule.next_run_at, schedule.frequency);
    await query('UPDATE cms.report_schedules SET next_run_at = $2, last_run_at = now() WHERE id = $1', [schedule.id, next], client);
    return schedule;
  });
  if (!claimed) return false;

  const template = await templateService.getTemplate(claimed.template_id).catch(() => null);
  if (!template || template.status !== 'Active') {
    console.log(`[scheduler] skipped schedule ${claimed.id}: report is missing or not Active`);
    return true;
  }

  const dateTo = todayIst();
  await historyService.queueExport({
    template,
    enterpriseName: await enterpriseService.getEnterpriseName(template.enterpriseId),
    dateFrom: addDays(dateTo, -(claimed.range_days - 1)),
    dateTo,
    format: claimed.format,
    delivery: 'Email',
    recipients: claimed.recipients,
    scheduleId: claimed.id,
    userId: claimed.created_by,
  });
  return true;
}

module.exports = { getSchedule, listSchedules, createSchedule, updateSchedule, deleteSchedule, claimDueSchedule };
