import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const route = read('packages/api/routes/serviceRequests.ts');
const atomicLink = read('packages/api/services/serviceRequests/atomicClientLink.ts');
const clientsRoute = read('packages/api/routes/clients.ts');
const detailPage = read('packages/web/src/pages/service-requests/ServiceRequestDetailPage.tsx');
const clientModal = read('packages/web/src/components/ClientModal.tsx');

test('emergency, periodic, and golden-warranty details use the shared party linkage section', () => {
  assert.match(detailPage, /const hasPartyLinkage = isEmergencyMaintenance \|\| isWaterCheck \|\| isDeviceRequest/);
  assert.match(detailPage, /\|\| isPeriodicMaintenance \|\| isGoldenWarranty/);
  assert.match(detailPage, /\{hasPartyLinkage && \(/);
  assert.match(detailPage, /\{!hasPartyLinkage && \(/);
  assert.match(detailPage, /المستفيد من الصيانة الطارئة/);
  assert.match(detailPage, /المستفيد من الصيانة الدورية/);
  assert.match(detailPage, /المستفيد من الكفالة الذهبية/);
});

test('requester linkage accepts every shared-party request type', () => {
  const start = route.indexOf("router.post('/:id/link-requester'");
  const section = route.slice(start, start + 4_500);
  for (const requestType of [
    'water_check',
    'device_request',
    'emergency_maintenance',
    'periodic_maintenance',
    'golden_warranty',
  ]) {
    assert.match(section, new RegExp(`'${requestType}'`));
  }
});

test('atomic client creation uses the typed review permission for every shared-party request type', () => {
  assert.match(atomicLink, /emergency_maintenance: 'service_requests\.review'/);
  assert.match(atomicLink, /water_check: 'water_check\.review'/);
  assert.match(atomicLink, /device_request: 'service_requests\.review'/);
  assert.match(atomicLink, /periodic_maintenance: 'periodic_maintenance\.review'/);
  assert.match(atomicLink, /golden_warranty: 'golden_warranty\.review'/);
  assert.match(atomicLink, /agent_license: 'agent_license\.review'/);
});

test('request-party client creation is protected in the UI and in both server serialization layers', () => {
  assert.match(clientModal, /saveInFlightRef\.current/);
  assert.match(clientModal, /disabled=\{Boolean\(primaryDup\) \|\| isSaving\}/);
  assert.match(clientModal, /await onSave\(clientPayload\)/);

  const createRouteStart = clientsRoute.indexOf("router.post('/', requirePermission('clients.create')");
  const createRoute = clientsRoute.slice(createRouteStart, createRouteStart + 10_000);
  const beginAt = createRoute.indexOf("await db.query('BEGIN')");
  const phoneLockAt = createRoute.indexOf('pg_advisory_xact_lock');
  const duplicateRecheckAt = createRoute.indexOf('findDuplicateClientByPhone(c.mobile, null, db)');
  const insertAt = createRoute.indexOf('INSERT INTO clients');
  assert.ok(beginAt >= 0 && beginAt < phoneLockAt);
  assert.ok(phoneLockAt < duplicateRecheckAt);
  assert.ok(duplicateRecheckAt < insertAt);

  assert.match(atomicLink, /beneficiary_client_id,\s*referrer_client_id, referrer_external/);
  assert.match(atomicLink, /service_request_party_already_linked/);
});

test('golden-warranty mediator remains excluded pending its separate contract decision', () => {
  assert.match(detailPage, /hasPartyLinkage\s*\n\s*&& !isGoldenWarranty/);
  assert.match(route, /request_type === 'golden_warranty'[\s\S]{0,180}golden_warranty_referrer_not_supported/);
  assert.match(atomicLink, /request_type === 'golden_warranty' && party === 'referrer'/);
});
