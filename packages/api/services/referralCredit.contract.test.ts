import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { purchaseCreditSql } from './referralCredit.js';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('purchase credit: converted names need a computed OP, linked names a purchase on or after the link day', () => {
  const sql = purchaseCreditSql('can', 'cl');
  assert.match(sql, /WHEN can\.qualification_kind = 'linked'/);
  assert.match(sql, /link_ref->>'sourceCandidateId' = can\.id::text/);
  assert.match(sql, />= COALESCE\(/);
  assert.match(sql, /credit_ct\.status NOT IN \('draft', 'discarded'\)/);
  assert.doesNotMatch(sql, /candidate_status/);
});

test('gift records expose the source status read-only, behind the record access check', () => {
  const gifts = read('../routes/gifts.ts');
  const route = gifts.slice(gifts.indexOf("router.get('/records/:id/source-status'"), gifts.indexOf("router.patch('/records/:id/condition'"));
  assert.match(route, /requirePermission\('contract_gifts\.view'\)/);
  assert.match(route, /requireGiftAccess\(req, res, id, 'contract_gifts\.view'\)/);
  assert.match(route, /loadGiftSourceStatus\(pool, id\)/);
  assert.doesNotMatch(route, /UPDATE gift_records/);
  const panel = read('../../web/src/components/gifts/GiftRecordActions.tsx');
  assert.match(panel, /<GiftSourceStatusPanel recordId=\{record\.id\} \/>/);
});

test('the mediator gifts report shares the credit rule and dates a linked sale after the link', () => {
  const report = read('./reporting/mediatorGiftsReport.ts');
  assert.match(report, /import \{ linkedOnSql, purchaseCreditSql \} from '\.\.\/referralCredit\.js'/);
  assert.match(report, /eligibleNameSql\('candidate', 'converted_client'\)/);
  assert.match(report, /\$\{saleAfterLinkSql\('candidate', 'converted_client'\)\}/);
  assert.match(report, /const scope = \[eligibleNameSql\('candidate', 'client'\)/);
});

test('every sale-form customer source marks mediators added by a duplicate link', () => {
  assert.match(read('./contractCustomerLookupService.ts'), /annotateDuplicateLinkReferrers\(db, [\s\S]{0,120}rows\[0\]\.id\)/);
  assert.match(read('./contractCreationContextService.ts'), /annotateDuplicateLinkReferrers\(db, [\s\S]{0,120}visit\.client_id\)/);
  assert.match(read('../routes/contracts.ts'), /annotateDuplicateLinkReferrers\(pool, client\.referrers, client\.id\)/);
  assert.match(read('../../web/src/pages/contracts/ContractForm.tsx'), /referrer\.viaDuplicateLink && \(/);
});
