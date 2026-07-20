import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPLOYEE_USERNAME_CONFLICT_MESSAGE,
  isEmployeeUsernameConflict,
} from './employeeSystemAccountErrors.js';

test('recognizes the hr_users username unique violation', () => {
  assert.equal(isEmployeeUsernameConflict({ code: '23505', constraint: 'hr_users_username_key' }), true);
  assert.equal(EMPLOYEE_USERNAME_CONFLICT_MESSAGE, 'اسم الدخول مستخدم مسبقاً، اختر اسماً آخر');
});

test('does not translate unrelated database errors', () => {
  assert.equal(isEmployeeUsernameConflict({ code: '23505', constraint: 'another_unique_constraint' }), false);
  assert.equal(isEmployeeUsernameConflict({ code: '23503', constraint: 'hr_users_username_key' }), false);
  assert.equal(isEmployeeUsernameConflict(new Error('unexpected failure')), false);
});
