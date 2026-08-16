import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function read(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

test('migration 407 creates immutable identity-based referral attribution', () => {
  const migration = read('../../../../migrations/407_client_referral_attributions.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.client_referral_attributions/);
  assert.match(migration, /beneficiary_client_id, referrer_client_id/);
  assert.match(migration, /WHERE referrer_type = 'Client'/);
  assert.match(migration, /WHERE is_primary/);
  assert.match(migration, /client_referral_attributions_no_update/);
  assert.match(migration, /client_referral_attributions_no_delete/);
});

test('reporting groups top referrers by stable type and identity', () => {
  const catalog = read('../reporting/breakdownCatalog.ts');
  assert.match(catalog, /client_referral_attributions/);
  assert.match(catalog, /referrer_type \|\| ':' \|\| identity_key AS k/);
  assert.match(catalog, /COUNT\(DISTINCT beneficiary_client_id\)/);
  assert.match(catalog, /a\.is_primary/);
});

test('unlinked request mediator is not submitted as acting-user Personal referrer', () => {
  const page = read('../../../web/src/pages/service-requests/ServiceRequestDetailPage.tsx');
  assert.match(page, /referrerType: req\.referrerClientId \? 'Client' : null/);
  assert.match(page, /referrerName: req\.referrerClientId \? \(req\.referrerClientName \|\| mediatorName \|\| null\) : null/);
});
