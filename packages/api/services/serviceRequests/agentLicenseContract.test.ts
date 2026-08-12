import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const migration = read('migrations/418_agent_license_service_request_v1.sql');
const route = read('packages/api/routes/serviceRequests.ts');
const stateMachine = read('packages/api/services/serviceRequests/stateMachine.ts');
const reopen = read('packages/api/services/serviceRequests/reopenService.ts');
const intake = read('packages/api/services/serviceRequests/mobileAgentLicenseIntake.ts');

test('agent-license registry and permissions are mobile self-only and centrally scoped', () => {
  assert.match(migration, /'agent_license'/);
  assert.match(migration, /\["self_only"\]/);
  for (const action of ['view','review','decide','resolve_escalation','archive']) {
    assert.match(migration, new RegExp(`agent_license\\.${action}`));
  }
  assert.doesNotMatch(migration, /agent_license\.(?:view|review|decide|resolve_escalation|archive)'[\s\S]{0,160}'BRANCH'/);
});

test('agent-license runtime has isolated typed authorization and a dedicated completed decision', () => {
  assert.match(route, /agent_license: 'agent_license'/);
  assert.match(route, /approve-agent-license[\s\S]*requireTypedPermission\('decide'\)/);
  assert.match(stateMachine, /row\.request_type === 'agent_license' && input\.toStatus === 'completed'/);
});

test('agent-license forbids neutral close and every reopen path', () => {
  assert.match(route, /serviceRequestType === 'name_nomination' \|\| req\.serviceRequestType === 'agent_license'/);
  assert.match(reopen, /request_type === 'agent_license'[\s\S]*agent_license_cannot_be_reopened/);
});

test('agent-license treats every non-terminal review state as an open primary-phone request', () => {
  assert.match(intake, /\['received', 'in_review', 'awaiting_customer_info'\]/);
});
