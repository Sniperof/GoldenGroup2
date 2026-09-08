import test from 'node:test';
import assert from 'node:assert/strict';
import { DashboardLayoutValidationError, normalizeDashboardLayout } from './dashboardLayoutPolicy.js';

test('normalizes known widgets, removes duplicates, and applies catalog sizes', () => {
  const checked: Array<[string, number | null]> = [];
  const layout = normalizeDashboardLayout([
    { key: 'clients.new_count', scope: null },
    { key: 'clients.new_count', size: 'lg', scope: null },
    { key: 'clients.acquisition_trend', size: 'lg', scope: { branchId: 3 } },
  ], (permission, branchId) => checked.push([permission, branchId]));
  assert.deepEqual(layout, [
    { key: 'clients.new_count', size: 'sm', scope: null },
    { key: 'clients.acquisition_trend', size: 'lg', scope: { branchId: 3 } },
  ]);
  assert.deepEqual(checked, [['clients.view_list', null], ['clients.view_list', 3]]);
});

test('rejects unknown widgets and permission denials in strict mode', () => {
  assert.throws(
    () => normalizeDashboardLayout([{ key: 'unknown.metric' }], () => undefined),
    (error: unknown) => error instanceof DashboardLayoutValidationError && error.status === 400,
  );
  assert.throws(
    () => normalizeDashboardLayout([{ key: 'clients.new_count' }], () => { throw new DashboardLayoutValidationError(403, 'denied'); }),
    (error: unknown) => error instanceof DashboardLayoutValidationError && error.status === 403,
  );
});

test('drops stale or unauthorized entries when reading a saved layout', () => {
  const layout = normalizeDashboardLayout([
    { key: 'unknown.metric' },
    { key: 'clients.new_count' },
    { key: 'candidates.new_count' },
  ], permission => {
    if (permission === 'candidates.view_list') throw new Error('revoked');
  }, false);
  assert.deepEqual(layout, [{ key: 'clients.new_count', size: 'sm', scope: null }]);
});
