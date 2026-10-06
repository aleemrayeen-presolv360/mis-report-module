const test = require('node:test');
const assert = require('node:assert');
const { todayIst, daysInRange, istDateTime, nextRunAfter, addDays } = require('../utils/dates');

test('today in India, not UTC', () => {
  // 20:00 UTC on 30 Sep is 01:30 on 1 Oct in India.
  assert.strictEqual(todayIst(new Date('2026-09-30T20:00:00Z')), '2026-10-01');
});

test('range length counts both ends', () => {
  assert.strictEqual(daysInRange('2026-10-01', '2026-10-07'), 7);
  assert.strictEqual(daysInRange('2026-10-05', '2026-10-05'), 1);
  assert.strictEqual(addDays('2026-03-01', -1), '2026-02-28');
});

test('09:00 IST is 03:30 UTC', () => {
  assert.strictEqual(istDateTime('2026-10-05', '09:00').toISOString(), '2026-10-05T03:30:00.000Z');
});

test('weekly schedule: next send is one week after today at the send time', () => {
  const now = new Date('2026-10-05T06:00:00Z'); // 11:30 IST, Monday
  const next = nextRunAfter(istDateTime('2026-10-05', '09:00'), 'weekly', now);
  assert.strictEqual(next.toISOString(), '2026-10-12T03:30:00.000Z');
});

test('after downtime, missed sends are skipped, not sent in a burst', () => {
  const lastPlanned = istDateTime('2026-09-01', '09:00');
  const now = new Date('2026-09-05T10:00:00Z');
  assert.strictEqual(nextRunAfter(lastPlanned, 'daily', now).toISOString(), '2026-09-06T03:30:00.000Z');
});

test('monthly keeps the day, clamped to short months', () => {
  const next = nextRunAfter(istDateTime('2026-01-31', '09:00'), 'monthly', new Date('2026-01-31T05:00:00Z'));
  assert.strictEqual(next.toISOString(), '2026-02-28T03:30:00.000Z');
});
