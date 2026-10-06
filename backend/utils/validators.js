/**
 * Input checks for templates, report runs and schedules.
 * Each function returns { value, errors }: `value` is the cleaned input, `errors` are
 * plain-English messages shown to the user as a list ("Fix these before saving").
 */

const { getWorkflow } = require('../config/workflows');
const { getField, canBeDateBasis } = require('../config/column-catalog');
const { operatorsForType, NO_VALUE_OPERATORS } = require('../config/filter-operators');
const { isIsoDate, isTime, todayIst } = require('./dates');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const STATUSES = ['Active', 'Draft'];
const REPEAT_MODES = ['latest', 'first', 'all', 'count'];
const FORMATS = ['xlsx', 'csv'];
const FREQUENCIES = ['daily', 'weekly', 'monthly'];

const LIMITS = { name: 120, description: 500, label: 100, columns: 200, filters: 30, recipients: 50, maxRangeDays: 3660 };

const isUuid = (value) => typeof value === 'string' && UUID.test(value);
const text = (value) => (typeof value === 'string' ? value.trim() : '');

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

function validateTemplate(input = {}) {
  const errors = [];
  const workflow = getWorkflow(input.workflow);

  const value = {
    name: text(input.name),
    description: text(input.description) || null,
    enterpriseId: input.enterpriseId,
    workflow: input.workflow,
    status: STATUSES.includes(input.status) ? input.status : 'Draft',
    dateBasis: input.dateBasis || '',
    columns: [],
    filters: [],
  };

  if (!value.name) errors.push('Give the report a name.');
  else if (value.name.length > LIMITS.name) errors.push(`Keep the report name under ${LIMITS.name} characters.`);
  if (value.description && value.description.length > LIMITS.description) {
    errors.push(`Keep the description under ${LIMITS.description} characters.`);
  }
  if (!isUuid(value.enterpriseId)) errors.push('Choose an enterprise.');
  if (!workflow || !workflow.baseTable) {
    // Columns and filters can only be checked against a workflow's catalog.
    errors.push(workflow ? `${workflow.label} reports are not available yet.` : 'Choose a workflow.');
    return { value, errors };
  }

  const dateField = getField(value.workflow, value.dateBasis);
  if (!dateField || !canBeDateBasis(dateField)) errors.push('Choose the date field the date range applies to.');

  value.columns = cleanColumns(value.workflow, input.columns, errors);
  value.filters = cleanFilters(value.workflow, input.filters, errors);

  return { value, errors };
}

function cleanColumns(workflow, columns, errors) {
  if (!Array.isArray(columns) || columns.length === 0) {
    errors.push('Add at least one column.');
    return [];
  }
  if (columns.length > LIMITS.columns) errors.push(`A report can have at most ${LIMITS.columns} columns.`);

  const seen = new Set();
  const cleaned = [];
  for (const column of columns) {
    const field = getField(workflow, column && column.key);
    if (!field) {
      errors.push(`Column "${column && column.key}" does not exist for this workflow.`);
      continue;
    }
    if (seen.has(field.key)) continue; // same field ticked twice: keep the first
    seen.add(field.key);

    const label = text(column.label) || field.label;
    if (label.length > LIMITS.label) errors.push(`Heading "${label.slice(0, 30)}…" is too long.`);
    cleaned.push({
      key: field.key,
      label,
      mv: field.repeating && REPEAT_MODES.includes(column.mv) ? column.mv : 'latest',
    });
  }
  return cleaned;
}

function cleanFilters(workflow, filters, errors) {
  if (filters == null) return [];
  if (!Array.isArray(filters)) {
    errors.push('Filters are not in the right format.');
    return [];
  }
  if (filters.length > LIMITS.filters) errors.push(`A report can have at most ${LIMITS.filters} filters.`);

  return filters
    .map((filter, index) => cleanFilter(workflow, filter || {}, index + 1, errors))
    .filter(Boolean);
}

function cleanFilter(workflow, { key, op, value }, number, errors) {
  const field = getField(workflow, key);
  if (!field) {
    errors.push(`Filter ${number} needs a field.`);
    return null;
  }
  const allowed = operatorsForType(field.type).map((o) => o.key);
  if (!allowed.includes(op)) {
    errors.push(`Filter ${number} (${field.label}) needs a condition.`);
    return null;
  }
  if (NO_VALUE_OPERATORS.includes(op)) return { key, op, value: null };

  const needsValue = `Filter ${number} (${field.label}) needs a value.`;

  if (op === 'in' || op === 'notin') {
    const list = (Array.isArray(value) ? value : [value]).map(text).filter(Boolean);
    if (!list.length) errors.push(needsValue);
    return { key, op, value: list };
  }
  if (op === 'lastn' || op === 'nextn') {
    const days = Number(value);
    if (!Number.isInteger(days) || days < 1 || days > LIMITS.maxRangeDays) errors.push(`${needsValue.slice(0, -1)} in days (1 or more).`);
    return { key, op, value: days };
  }
  if (op === 'before' || op === 'after') {
    if (!isIsoDate(value)) errors.push(needsValue);
    return { key, op, value };
  }
  if (['gt', 'gte', 'lt', 'lte', 'eq'].includes(op)) {
    const numeric = Number(value);
    if (value === '' || value == null || !Number.isFinite(numeric)) errors.push(needsValue);
    return { key, op, value: numeric };
  }
  const textValue = text(value);
  if (!textValue) errors.push(needsValue);
  return { key, op, value: textValue };
}

/* ------------------------------------------------------------------ */
/* Report runs                                                         */
/* ------------------------------------------------------------------ */

function validateDateRange({ dateFrom, dateTo } = {}) {
  const errors = [];
  if (!isIsoDate(dateFrom) || !isIsoDate(dateTo)) errors.push('Choose both a start and an end date.');
  else if (dateFrom > dateTo) errors.push('The start date is after the end date.');
  return { value: { dateFrom, dateTo }, errors };
}

function validateFormat(format) {
  return FORMATS.includes(format) ? [] : ['Choose Excel or CSV.'];
}

/* ------------------------------------------------------------------ */
/* Schedules                                                           */
/* ------------------------------------------------------------------ */

function validateSchedule(input = {}) {
  const errors = [];
  const recipients = [...new Set((Array.isArray(input.recipients) ? input.recipients : []).map((e) => text(e).toLowerCase()))];

  if (!recipients.length) errors.push('Add at least one email address.');
  if (recipients.length > LIMITS.recipients) errors.push(`Send to at most ${LIMITS.recipients} addresses.`);
  recipients.filter((e) => !EMAIL.test(e)).forEach((e) => errors.push(`"${e}" is not a valid email address.`));

  if (!FREQUENCIES.includes(input.frequency)) errors.push('Choose how often to send.');
  if (!isTime(input.sendTime)) errors.push('Choose a send time.');
  if (!isIsoDate(input.endDate)) errors.push('Choose the date to keep sending until.');
  else if (input.endDate < todayIst()) errors.push('The end date is in the past.');
  errors.push(...validateFormat(input.format));

  return {
    value: {
      recipients,
      frequency: input.frequency,
      sendTime: isTime(input.sendTime) ? input.sendTime.slice(0, 5) : input.sendTime,
      endDate: input.endDate,
      format: input.format,
    },
    errors,
  };
}

module.exports = { isUuid, validateTemplate, validateDateRange, validateFormat, validateSchedule, LIMITS };
