import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../../../../migrations/429_complaints_crm_client_entry_point.sql', import.meta.url),
  'utf8',
);
const service = fs.readFileSync(new URL('./complaintService.ts', import.meta.url), 'utf8');
const webForm = fs.readFileSync(
  new URL('../../../web/src/pages/complaints/NewComplaintPage.tsx', import.meta.url),
  'utf8',
);

test('CRM client complaint entry point is accepted by UI, service and database constraint', () => {
  assert.match(webForm, /requesterMode==='linked'\?'crm_client'/);
  assert.match(service, /'crm_general', 'crm_client', 'crm_visit', 'crm_device'/);
  assert.match(migration, /'crm_client'/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS complaints_entry_point_ck/);
  assert.match(migration, /ADD CONSTRAINT complaints_entry_point_ck CHECK/);
});
