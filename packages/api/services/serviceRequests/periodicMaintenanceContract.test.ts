import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../../../migrations/414_periodic_maintenance_service_request_v1.sql', import.meta.url),
  'utf8',
);
const route = readFileSync(new URL('../../routes/serviceRequests.ts', import.meta.url), 'utf8');
const handoff = readFileSync(new URL('./periodicMaintenanceHandoffService.ts', import.meta.url), 'utf8');

test('periodic request registry is review-gated and explicitly forbids rescheduling', () => {
  assert.match(migration, /'periodic_maintenance'/);
  assert.match(migration, /"handoffTaskType"\s*:\s*"periodic_maintenance"/i);
  assert.match(migration, /"activeTaskPolicy"\s*:\s*"resolve_at_intake"/i);
  assert.match(migration, /"rescheduleAllowed"\s*:\s*false/i);
});

test('periodic request has an isolated six-permission family with declared scopes', () => {
  for (const action of ['view', 'review', 'decide', 'resolve_escalation', 'archive', 'create']) {
    assert.match(migration, new RegExp(`periodic_maintenance\\.${action.replace('_', '[_]')}`));
  }
  assert.match(migration, /'periodic_maintenance\.view'[\s\S]*ARRAY\['GLOBAL','BRANCH','ASSIGNED'\]/);
  assert.match(migration, /'periodic_maintenance\.create'[\s\S]*ARRAY\['GLOBAL','BRANCH'\]/);
});

test('periodic request and task uniqueness guards are device and source based', () => {
  assert.match(migration, /service_requests_unique_active_periodic_per_device/);
  assert.match(migration, /status IN \('received', 'in_review'\)/);
  assert.match(migration, /open_tasks_unique_periodic_source_request/);
  assert.match(migration, /generation_origin IN \('system', 'manual', 'service_request'\)/);
});

test('creator, resolution, and rejection reasons are administrator-managed lists', () => {
  assert.match(migration, /periodic_maintenance_request_reasons/);
  assert.match(migration, /service_request_resolve_at_intake_periodic_maintenance/);
  assert.match(migration, /service_request_rejection_periodic_maintenance/);
});

test('CRM creation is call-result-only and requires both telemarketing and typed create gates', () => {
  assert.match(route, /periodic_maintenance_requires_telemarketing_call_result/g);
  assert.match(route, /internal-with-call[\s\S]*telemarketing\.calls\.create/);
  assert.match(route, /requireInternalCallRequestCreatePermission/);
  assert.match(route, /familyKeyFor\(requestType, 'create'\)/);
});

test('handoff is transactional, typed, linked both ways, and does not use manual-task permission', () => {
  assert.match(route, /handoff-periodic-maintenance[\s\S]*periodic_maintenance\.decide/);
  assert.doesNotMatch(route, /handoff-periodic-maintenance[\s\S]{0,500}tasks\.periodic\.create_manual/);
  assert.match(handoff, /linked_open_task_id = \$2/);
  assert.match(handoff, /generation_origin: 'service_request'/);
  assert.match(handoff, /commitTx\(tx\)/);
});

test('periodic requests cannot use the generic cancellation endpoint', () => {
  assert.match(route, /serviceRequestType === 'periodic_maintenance'[\s\S]{0,180}action_not_supported_for_request_type/);
});

test('unresolved request subjects are restricted to GLOBAL access', () => {
  assert.match(route, /branch_id == null && scopePlan\.scope !== 'GLOBAL'/);
  assert.match(route, /UNRESOLVED_BRANCH_REQUIRES_GLOBAL/);
});
