import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

test('golden warranty migration declares the request contract and permissions', () => {
  const sql = read('migrations/415_golden_warranty_service_request_v1.sql');
  assert.match(sql, /'golden_warranty'/);
  assert.match(sql, /requested_warranty_months/);
  assert.match(sql, /beneficiary_contact_consent_confirmed/);
  assert.match(sql, /taskOutcomeChangesRequest"\s*:\s*false/);
  for (const action of ['view', 'review', 'decide', 'resolve_escalation', 'archive', 'create']) {
    assert.match(sql, new RegExp(`golden_warranty\\.${action}`));
  }
});

test('handoff creates one linked offer task and closes the request independently', () => {
  const source = read('packages/api/services/serviceRequests/goldenWarrantyHandoffService.ts');
  assert.match(source, /task_type = 'golden_warranty_offer'/);
  assert.match(source, /source_service_request_id/);
  assert.match(source, /status = 'promoted'/);
  assert.match(source, /closed_at = NOW\(\)/);
  assert.match(source, /active_golden_warranty_offer_exists/);
});

test('offer completion locks device and months to the originating request', () => {
  const source = read('packages/api/services/visitTaskResultReflection.ts');
  assert.match(source, /sr\.request_type AS source_request_type/);
  assert.match(source, /sr\.requested_warranty_months/);
  assert.match(source, /source_request_type === 'golden_warranty'/);
  assert.match(source, /lockedMonths/);
});
