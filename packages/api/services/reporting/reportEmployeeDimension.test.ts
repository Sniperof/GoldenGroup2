import assert from 'node:assert/strict';
import test from 'node:test';
import { employeeDimensionConditions, employmentStatusFilter } from './reportEmployeeDimension.js';

test('the dimension keys itself on the report own person expression', () => {
  const params: unknown[] = ['already there'];
  const conditions = employeeDimensionConditions(
    { departmentId: 4, jobTitle: 'فني صيانة', employmentStatus: 'active' },
    params,
    'contract.sale_owner_id',
  );

  assert.equal(conditions.length, 3);
  assert.match(conditions[0], /dimension_employee\.id = contract\.sale_owner_id/);
  assert.match(conditions[0], /dimension_employee\.department_id = \$2/);
  assert.match(conditions[1], /BTRIM\(dimension_employee\.job_title\) = \$3/);
  assert.match(conditions[2], /dimension_employee\.status = 'active'/);
  // Appended after what the caller already bound, never renumbering it.
  assert.deepEqual(params, ['already there', 4, 'فني صيانة']);
});

test('the job title is compared trimmed, because the picker offers it trimmed', () => {
  const params: unknown[] = [];
  const conditions = employeeDimensionConditions({ jobTitle: '  مشرفة  ' }, params, 'employee.id');
  assert.match(conditions[0], /BTRIM\(dimension_employee\.job_title\) = \$1/);
  assert.deepEqual(params, ['مشرفة']);
});

test('leaving service is the complement of being active, NULL included', () => {
  const params: unknown[] = [];
  const conditions = employeeDimensionConditions({ employmentStatus: 'inactive' }, params, 'employee.id');
  // IS DISTINCT FROM, not <>: an employee whose status was never set is not active,
  // and a NULL comparison would have hidden her from both sides of the filter.
  assert.match(conditions[0], /dimension_employee\.status IS DISTINCT FROM 'active'/);
  assert.deepEqual(params, []);
});

test('an empty dimension binds nothing and narrows nothing', () => {
  const params: unknown[] = [];
  assert.deepEqual(employeeDimensionConditions({}, params, 'employee.id'), []);
  assert.deepEqual(employeeDimensionConditions(
    { departmentId: '', jobTitle: '   ', employmentStatus: '' }, params, 'employee.id',
  ), []);
  assert.deepEqual(params, []);
});

test('an unknown employment status is refused rather than widened to everyone', () => {
  assert.throws(() => employmentStatusFilter('retired'), /حالة الخدمة غير صالحة/);
  assert.throws(
    () => employeeDimensionConditions({ employmentStatus: 'on_leave' }, [], 'employee.id'),
    /حالة الخدمة غير صالحة/,
  );
  assert.equal(employmentStatusFilter(null), null);
  assert.equal(employmentStatusFilter(''), null);
});

test('a non-numeric department id is dropped instead of reaching SQL', () => {
  const params: unknown[] = [];
  // positiveInt refuses it, so no predicate is produced — the run stays unfiltered
  // rather than binding a value the column could never equal.
  assert.deepEqual(employeeDimensionConditions({ departmentId: 'all' }, params, 'employee.id'), []);
  assert.deepEqual(params, []);
});
