import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const form = readFileSync(new URL('./ContractForm.tsx', import.meta.url), 'utf8');
const visitDetail = readFileSync(new URL('../visits/VisitDetailPage.tsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8');

test('visit details gate the add-contract action through the server creation context', () => {
  assert.match(visitDetail, /api\.contracts\.getCreationContextForVisit\(visitId\)/);
  assert.match(visitDetail, /Number\(task\.id\) === Number\(contractCreationContext\.deviceDemoTask\.visitTaskId\)/);
  assert.match(visitDetail, /navigate\(`\/contracts\/new\?visitId=\$\{visit\.id\}`\)/);
});

test('contract form never downloads the general customer list and sends authoritative visit id', () => {
  assert.doesNotMatch(form, /api\.clients\.list\(\)/);
  assert.match(form, /getCreationContextForVisit\(visitCreationId\)/);
  assert.match(form, /sourceVisitId: visitCreationContext\.visitId/);
  assert.match(form, /readOnly=\{Boolean\(visitCreationContext\)\}/);
});

test('manual contract customer selection is debounced, abortable, and server-filtered', () => {
  assert.match(form, /query\.length < 2/);
  assert.match(form, /window\.setTimeout\(\(\) => \{/);
  assert.match(form, /api\.contracts\.searchCustomers\(query, controller\.signal\)/);
  assert.match(form, /controller\.abort\(\)/);
  assert.match(form, /api\.contracts\.getCustomerContext\(c\.id\)/);
  assert.match(apiSource, /`\/contracts\/customer-lookup\?\$\{qs\.toString\(\)\}`/);
  assert.match(apiSource, /`\/contracts\/customer-context\/\$\{customerId\}`/);
});

test('offer selection remains explicitly optional in the visit-driven form', () => {
  assert.match(form, /متابعة دون ربط العقد بعرض محدد/);
  assert.match(form, /setSourceTaskOfferId\(null\)/);
  assert.match(form, /ربط أحد العروض المقبولة اختياري/);
});

test('a single accepted visit offer prefills the editable contract values automatically', () => {
  assert.match(form, /visitCreationContext\.acceptedOfferCount !== 1/);
  assert.match(form, /visitCreationContext\.eligibleOffers\.length !== 1/);
  assert.match(form, /handleSelectOffer\(\{ \.\.\.onlyOffer, customerResponse: 'accepted', contractId: null \}\)/);
  assert.match(form, /const isOfferLocked = false/);
});

test('web API exposes the typed visit creation-context endpoint', () => {
  assert.match(apiSource, /export interface VisitContractCreationContext/);
  assert.match(apiSource, /`\/contracts\/creation-context\/visit\/\$\{visitId\}`/);
});
