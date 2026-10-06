const test = require('node:test');
const assert = require('node:assert');
const { validateTemplate, validateSchedule, validateDateRange } = require('../utils/validators');
const { addDays, todayIst } = require('../utils/dates');

const valid = {
  name: '  Court pipeline ',
  enterpriseId: '11111111-2222-3333-4444-555555555555',
  workflow: 'section138',
  status: 'Active',
  dateBasis: 'filing_date',
  columns: [{ key: 'case_number', label: '' }, { key: 'sms_status', mv: 'count' }, { key: 'case_number' }],
  filters: [{ key: 'loan_amount', op: 'gt', value: '1000' }],
};

test('a good template is cleaned up', () => {
  const { value, errors } = validateTemplate(valid);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(value.name, 'Court pipeline');
  assert.deepStrictEqual(value.columns, [
    { key: 'case_number', label: 'Case number', mv: 'latest' }, // empty label -> catalog label; duplicate dropped
    { key: 'sms_status', label: 'SMS status', mv: 'count' },
  ]);
  assert.deepStrictEqual(value.filters, [{ key: 'loan_amount', op: 'gt', value: 1000 }]);
});

test('missing pieces are listed in plain words', () => {
  const { errors } = validateTemplate({ ...valid, name: '', dateBasis: 'sms_sent_at', columns: [], filters: [{ key: 'case_status', op: 'is', value: '' }] });
  assert.deepStrictEqual(errors, [
    'Give the report a name.',
    'Choose the date field the date range applies to.', // repeating date cannot be the basis
    'Add at least one column.',
    'Filter 1 (Case status) needs a value.',
  ]);
});

test('filter operators must match the field type', () => {
  const { errors } = validateTemplate({ ...valid, filters: [{ key: 'loan_amount', op: 'contains', value: '5' }] });
  assert.deepStrictEqual(errors, ['Filter 1 (Loan amount) needs a condition.']);
});

test('date range checks', () => {
  assert.deepStrictEqual(validateDateRange({ dateFrom: '2026-10-05', dateTo: '2026-10-01' }).errors, ['The start date is after the end date.']);
  assert.deepStrictEqual(validateDateRange({ dateFrom: '2026-02-30', dateTo: '2026-03-01' }).errors, ['Choose both a start and an end date.']);
});

test('schedule checks name the bad address', () => {
  const { errors, value } = validateSchedule({
    recipients: ['Ops@Bank.com', 'not-an-email', 'ops@bank.com'],
    frequency: 'weekly',
    sendTime: '09:00',
    endDate: addDays(todayIst(), -1),
    format: 'xlsx',
  });
  assert.deepStrictEqual(value.recipients, ['ops@bank.com', 'not-an-email']);
  assert.deepStrictEqual(errors, ['"not-an-email" is not a valid email address.', 'The end date is in the past.']);
});
