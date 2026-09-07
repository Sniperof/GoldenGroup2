import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeReportFilterOptions } from './reportFilterOptions.js';

test('normalizes legacy partial filter-options responses before rendering', () => {
  const result = normalizeReportFilterOptions({
    supervisors: [{ value: '4', label: 'مشرفة' }],
  });

  assert.deepEqual(result.deviceModels, []);
  assert.deepEqual(result.taskTypes, []);
  assert.deepEqual(result.candidateStatuses, []);
  assert.deepEqual(result.collectionOwners, []);
  assert.deepEqual(result.saleClosers, []);
  assert.deepEqual(result.faultTypes, []);
  assert.deepEqual(result.repairTechnicians, []);
  assert.deepEqual(result.retrievalTechnicians, []);
  assert.deepEqual(result.retrievedDeviceStatuses, []);
  assert.deepEqual(result.giftDefinitions, []);
  assert.equal(result.supervisors.length, 1);
});

test('normalizes malformed filter option values to empty arrays', () => {
  const result = normalizeReportFilterOptions({ deviceModels: null, taskTypes: 'bad' } as never);

  assert.deepEqual(result.deviceModels, []);
  assert.deepEqual(result.taskTypes, []);
});
