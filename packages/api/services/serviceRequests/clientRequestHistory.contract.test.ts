import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const clientsRoute = fs.readFileSync(new URL('../../routes/clients.ts', import.meta.url), 'utf8');
const clientProfile = fs.readFileSync(new URL('../../../web/src/pages/ClientProfile.tsx', import.meta.url), 'utf8');

test('client request history preserves client subject authorization and request-family isolation', () => {
  assert.match(clientsRoute, /router\.get\('\/:id\/service-requests', requirePermission\('clients\.view'\)/);
  assert.match(clientsRoute, /canViewClient\(authContext, subject\)/);
  assert.match(clientsRoute, /emergency_maintenance: 'service_requests\.view'/);
  assert.match(clientsRoute, /water_check: 'water_check\.view'/);
  assert.match(clientsRoute, /account_creation: 'account_requests\.view'/);
  assert.match(clientsRoute, /sr\.request_type = ANY\(\$2::text\[\]\)/);
});

test('client request history reports every matching party role and gates the tab by request permissions', () => {
  assert.match(clientsRoute, /sr\.requester_client_id = \$1 THEN 'requester'/);
  assert.match(clientsRoute, /sr\.beneficiary_client_id = \$1 THEN 'beneficiary'/);
  assert.match(clientsRoute, /sr\.referrer_client_id = \$1 THEN 'referrer'/);
  assert.match(clientProfile, /hasAnyPermission\('service_requests\.view', 'water_check\.view', 'account_requests\.view'\)/);
});
