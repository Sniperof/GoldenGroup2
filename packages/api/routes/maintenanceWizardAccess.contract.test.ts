import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const result = readFileSync(new URL('./emergencyResult.ts', import.meta.url), 'utf8');
const scopes = readFileSync(new URL('./workScopes.ts', import.meta.url), 'utf8');
const web = (path: string) => readFileSync(new URL(`../../web/src/${path}`, import.meta.url), 'utf8');

// 2026-11-04: a supervisor saved parts but could not read them, and the reads
// opened any task company-wide by id.
test('every maintenance-result read takes the record keys and a scope guard', () => {
  for (const route of ["'/:taskId'", "'/:taskId/parts'", "'/:taskId/payment-entries'", "'/:taskId/installments'"]) {
    assert.match(result, new RegExp(`router\\.get\\(${route.replace(/[/]/g, '\\/')}, requirePermission\\(\\.\\.\\.MAINTENANCE_RESULT_READ_KEYS\\), requireMaintenanceTaskRead,`), route);
  }
  assert.match(result, /router\.get\('\/device\/:contractId\/history', requirePermission\(\.\.\.MAINTENANCE_RESULT_READ_KEYS\), requireMaintenanceContractRead,/);
  assert.doesNotMatch(result, /requirePermission\('marketing_visits\.view'\)/);
});

test('work-scope writes need planning.manage on the scope branch', () => {
  assert.match(scopes, /router\.post\('\/', requirePermission\('planning\.manage'\)/);
  assert.match(scopes, /router\.put\('\/:id\/activate', requirePermission\('planning\.manage'\), requireScopeInPlanningBranch,/);
  assert.match(scopes, /router\.post\('\/:id\/generate-tasks', requirePermission\('planning\.manage'\), requireScopeInPlanningBranch,/);
  assert.doesNotMatch(scopes, /router\.(post|put)\([^)]*marketing_visits/);
});

test('the wizard never empties the parts catalog because another request failed', () => {
  const form = web('components/emergency/result-phases/MaintenanceActionsForm.tsx');
  assert.doesNotMatch(form, /Promise\.all\(\[\s*api\.spareParts\.list/);
  assert.match(form, /api\.spareParts\.list\(\{ includeInactive: true \}\)\s*\.then/);
  assert.match(form, /fail\('قائمة القطع'\)/);
});

test('an unreadable warranty stops part pricing instead of assuming none', () => {
  const wizard = web('components/emergency/EmergencyResultWizard.tsx');
  assert.match(wizard, /setWarrantyUnverified\(true\)/);
  assert.match(wizard, /warrantyUnverified=\{warrantyUnverified\}/);
  const form = web('components/emergency/result-phases/MaintenanceActionsForm.tsx');
  assert.match(form, /const partsLocked = readOnly \|\| warrantyUnverified/);
});

test('the record button follows the key the server requires', () => {
  const page = web('pages/visits/VisitDetailPage.tsx');
  assert.match(page, /const canRecordResults = hasPermission\('tasks\.results\.record'\)/);
  assert.match(page, /const canRecord = recordable && canRecordResults/);
});
