import assert from 'node:assert/strict';
import test from 'node:test';
import { projectEmployeeLookupRow } from './employeeLookupProjection.js';

test('employee lookup projection preserves employeeNumber for mediator matching', () => {
  const projected = projectEmployeeLookupRow({
    id: 16,
    employeeNumber: '97',
    name: 'Test Employee',
    mobile: '0999999999',
    jobTitle: 'Sales',
    branchId: 6,
    departmentId: 2,
    status: 'active',
    contacts: [{ number: '0999999999' }],
  });

  assert.equal(projected.employeeNumber, '97');
  assert.equal('contacts' in projected, false);
});
