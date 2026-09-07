import assert from 'node:assert/strict';
import test from 'node:test';
import { completeTabularReportFilterOptions } from './tabularReportFilterOptions.js';

test('filter-options contract fills fields omitted by a report-specific query', () => {
  const supervisors = [{ value: '7', label: 'مشرفة' }];
  const result = completeTabularReportFilterOptions({ supervisors });

  assert.equal(result.supervisors, supervisors);
  assert.deepEqual(result.deviceModels, []);
  assert.deepEqual(result.taskTypes, []);
  assert.deepEqual(Object.keys(result).sort(), [
    'accompanyingTechnicians', 'callEmployees', 'callOutcomes', 'candidateStatuses', 'collectionOwners', 'contactEmployees', 'contractSales',
    'contractSellerDepartments', 'contractSellers', 'contractStatuses', 'customerRatings',
    'departmentTypes', 'deviceModels', 'deviceStatuses',
    'faultTypes', 'giftDefinitions', 'giftPromiseStatuses', 'repairTechnicians', 'retrievalTechnicians', 'retrievedDeviceStatuses',
    'saleClosers', 'supervisors', 'taskTypes', 'technicians', 'telemarketers', 'visitStatuses', 'warrantyStatuses',
  ]);
});

test('filter-options contract replaces malformed non-array fields safely', () => {
  const malformed = { deviceModels: null, taskTypes: {} } as never;
  const result = completeTabularReportFilterOptions(malformed);

  assert.deepEqual(result.deviceModels, []);
  assert.deepEqual(result.taskTypes, []);
});
