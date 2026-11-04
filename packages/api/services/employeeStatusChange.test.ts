import assert from 'node:assert/strict';
import test from 'node:test';
import { accountEffectFor, isEmployeeStatus } from './employeeStatusChange.js';

test('suspended and terminated switch the account off, active switches it back on', () => {
  assert.equal(accountEffectFor('active', 'suspended'), 'deactivated');
  assert.equal(accountEffectFor('vacation', 'terminated'), 'deactivated');
  assert.equal(accountEffectFor('suspended', 'active'), 'reactivated');
  assert.equal(accountEffectFor('terminated', 'active'), 'reactivated');
});

test('vacation and moves between blocking statuses leave the account as it is', () => {
  assert.equal(accountEffectFor('active', 'vacation'), null);
  assert.equal(accountEffectFor('vacation', 'active'), null);
  assert.equal(accountEffectFor('suspended', 'terminated'), null);
  // Leaving a blocking status for vacation keeps the account off: only «نشط» re-enables it.
  assert.equal(accountEffectFor('suspended', 'vacation'), null);
});

test('only the four known statuses are accepted', () => {
  assert.ok(isEmployeeStatus('terminated'));
  assert.equal(isEmployeeStatus('inactive'), false);
  assert.equal(isEmployeeStatus(undefined), false);
});
