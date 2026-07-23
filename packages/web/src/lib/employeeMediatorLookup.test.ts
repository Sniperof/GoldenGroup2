import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEmployeeMediatorReference } from './employeeMediatorLookup.js';

const employee = {
  id: 21,
  employeeNumber: 102,
  name: 'جاسم جاسم',
  jobTitle: null,
  branchName: 'دمشق',
};

test('employee mediator reference persists the internal employee id', () => {
  assert.deepEqual(resolveEmployeeMediatorReference('102', employee), {
    employeeId: 21,
    referralEntityId: 21,
    employeeNumber: 102,
    fullName: 'جاسم جاسم',
  });
});

test('employee mediator reference rejects a stale lookup after input changes', () => {
  assert.equal(resolveEmployeeMediatorReference('103', employee), null);
});

test('employee mediator reference rejects an unresolved employee number', () => {
  assert.equal(resolveEmployeeMediatorReference('102', null), null);
});
