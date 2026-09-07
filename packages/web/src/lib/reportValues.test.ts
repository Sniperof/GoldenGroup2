import assert from 'node:assert/strict';
import test from 'node:test';
import { formatReportTemporalValue, parseReportTemporalValue } from './reportValues.js';

test('report date accepts PostgreSQL date and ISO snapshot representations', () => {
  const sqlDate = parseReportTemporalValue('2026-08-31', 'date');
  const snapshotDate = parseReportTemporalValue('2026-08-31T00:00:00.000Z', 'date');
  assert.ok(sqlDate);
  assert.ok(snapshotDate);
  assert.equal(sqlDate.getFullYear(), 2026);
  assert.equal(sqlDate.getMonth(), 7);
  assert.equal(sqlDate.getDate(), 31);
  assert.equal(snapshotDate.getFullYear(), 2026);
  assert.equal(snapshotDate.getMonth(), 7);
  assert.equal(snapshotDate.getDate(), 31);
});

test('report temporal formatter never emits Invalid Date', () => {
  assert.notEqual(formatReportTemporalValue('2026-08-31T00:00:00.000Z', 'date'), 'Invalid Date');
  assert.equal(formatReportTemporalValue('not-a-date', 'date'), null);
  assert.equal(formatReportTemporalValue('not-a-date', 'datetime'), null);
});
