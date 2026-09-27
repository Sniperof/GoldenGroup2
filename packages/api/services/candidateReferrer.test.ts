import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildReferrerFromCandidate,
  stripBrowserReferralInput,
} from './candidateReferrer.js';

const unknownTypedCandidateWithRealMediator = {
  id: 60116,
  referralType: 'Unknown',
  referralOriginChannel: 'Acquaintance',
  referralNameSnapshot: 'وائل الحسن',
  referralEntityId: null,
  referralDate: null,
  referralReason: 'ترحيل — الأسماء المقترحة',
  referralSheetId: null,
  addressText: 'المنطقة الهندسية',
};

test('an Unknown mediator type keeps the real name snapshot instead of becoming مجهول', () => {
  const referrer = buildReferrerFromCandidate(unknownTypedCandidateWithRealMediator, {
    referralDate: null,
  });

  assert.equal(referrer.referrerName, 'وائل الحسن');
  assert.equal(referrer.name, 'وائل الحسن');
  assert.equal(referrer.referrerType, 'Unknown');
  assert.notEqual(referrer.referrerName, 'مجهول');
});

test('the source suggested name is always stamped so the network tab can link back', () => {
  const referrer = buildReferrerFromCandidate(unknownTypedCandidateWithRealMediator, {
    referralDate: null,
  });

  assert.equal(referrer.sourceCandidateId, 60116);
});

test('sheet, reason and referral address survive the conversion', () => {
  const referrer = buildReferrerFromCandidate({
    ...unknownTypedCandidateWithRealMediator,
    referralSheetId: 15,
  }, { referralDate: '2026-09-20' });

  assert.equal(referrer.referralSheetId, 15);
  assert.equal(referrer.referralReason, 'ترحيل — الأسماء المقترحة');
  assert.equal(referrer.referralAddressText, 'المنطقة الهندسية');
  assert.equal(referrer.address, 'المنطقة الهندسية');
  assert.equal(referrer.referralDate, '2026-09-20');
});

test('a missing referral date stays unknown rather than defaulting to today', () => {
  const referrer = buildReferrerFromCandidate(unknownTypedCandidateWithRealMediator, {
    referralDate: null,
  });

  assert.equal(referrer.referralDate, null);
});

test('the mediator entity id is carried only for Client and Employee mediators', () => {
  const clientMediator = buildReferrerFromCandidate({
    id: 1,
    referralType: 'Client',
    referralNameSnapshot: 'فادي عيد',
    referralEntityId: 1238985,
  }, { referralDate: null });
  assert.equal(clientMediator.referralEntityId, 1238985);
  assert.equal(clientMediator.id, 1238985);

  const employeeMediator = buildReferrerFromCandidate({
    id: 2,
    referralType: 'Employee',
    referralNameSnapshot: 'اريج نضال درويش',
    referralEntityId: 44,
  }, { referralDate: null });
  assert.equal(employeeMediator.referralEntityId, 44);

  // A stale id under a Personal/Unknown type would render a mediator link to an
  // unrelated client record.
  const personalMediator = buildReferrerFromCandidate({
    id: 3,
    referralType: 'Personal',
    referralNameSnapshot: 'سميرة زيتون',
    referralEntityId: 1238985,
  }, { referralDate: null });
  assert.equal(personalMediator.referralEntityId, null);
  assert.equal(personalMediator.id, null);
});

test('blank candidate fields normalise to null instead of empty strings', () => {
  const referrer = buildReferrerFromCandidate({
    id: 4,
    referralType: '   ',
    referralNameSnapshot: '',
    referralOriginChannel: null,
    addressText: '  ',
  }, { referralDate: '' });

  assert.equal(referrer.referrerType, null);
  assert.equal(referrer.referrerName, null);
  assert.equal(referrer.sourceChannel, null);
  assert.equal(referrer.referralAddressText, null);
  assert.equal(referrer.referralDate, null);
  // The row stays explicit: it is still identified by its source name.
  assert.equal(referrer.sourceCandidateId, 4);
});

test('browser-supplied referral fields are dropped for a conversion payload', () => {
  const stripped = stripBrowserReferralInput({
    name: 'نصوح عبد الحليم البارودي',
    mobile: '0963946777',
    referrerType: 'Unknown',
    referrerName: 'مجهول',
    referrerId: 9,
    referralEntityId: 7,
    sourceChannel: 'Acquaintance',
    referralDate: '2026-09-20',
    referralReason: '',
    referralSheetId: null,
    referralAddressText: null,
    referrers: [{ referrerName: 'مجهول' }],
  });

  assert.equal(stripped.name, 'نصوح عبد الحليم البارودي');
  assert.equal(stripped.mobile, '0963946777');
  for (const field of [
    'referrerType', 'referrerName', 'referrerId', 'referralEntityId', 'sourceChannel',
    'referralDate', 'referralReason', 'referralSheetId', 'referralAddressText', 'referrers',
  ]) {
    assert.equal(field in stripped, false, `${field} must not reach the write path`);
  }
});

test('both qualification paths build the mediator from the same helper', () => {
  const clientsRoute = readFileSync(new URL('../routes/clients.ts', import.meta.url), 'utf8');
  const candidatesRoute = readFileSync(new URL('../routes/candidates.ts', import.meta.url), 'utf8');

  // convert → POST /api/clients
  assert.match(clientsRoute, /sourceCandidateReferrer = buildReferrerFromCandidate\(sourceCandidate/);
  assert.match(
    clientsRoute,
    /hasSourceCandidate\s*\?\s*\{\s*\.\.\.stripBrowserReferralInput\(rawPayload\),\s*referrers: \[sourceCandidateReferrer!\]\s*\}/,
  );
  // link → POST /api/candidates/:id/link-client
  assert.match(candidatesRoute, /const newReferrer = buildReferrerFromCandidate\(candidate/);
});

test('linking a name materialises a legacy flat mediator before appending', () => {
  const candidatesRoute = readFileSync(new URL('../routes/candidates.ts', import.meta.url), 'utf8');
  const linkRoute = candidatesRoute.slice(candidatesRoute.indexOf("router.post('/:id/link-client'"));
  const buildArray = linkRoute.slice(
    linkRoute.indexOf('WITH existing_referrers AS'),
    linkRoute.indexOf('next_referrers AS'),
  );

  // An imported client keeps its only mediator in the scalar columns with an
  // empty array. Appending straight onto that empty array made the NEW
  // mediator element 0, and the flat-column rewrite below then destroyed the
  // historical one.
  assert.match(buildArray, /WHEN COALESCE\(jsonb_array_length\(referrers\), 0\) > 0\s*THEN referrers/);
  assert.match(buildArray, /WHEN referrer_name IS NOT NULL/);
  assert.match(buildArray, /THEN jsonb_build_array\(jsonb_build_object\(/);
  for (const column of [
    'referrer_name', 'referrer_type', 'referral_entity_id', 'source_channel',
    'referral_date', 'referral_reason', 'referral_sheet_id', 'referral_address_text',
  ]) {
    assert.match(buildArray, new RegExp(column), `legacy ${column} must be carried into element 0`);
  }
  // The append must run against the materialised array, never the raw column.
  assert.match(linkRoute, /ELSE existing_referrers\.value \|\| \$3::jsonb/);
  assert.doesNotMatch(linkRoute, /ELSE COALESCE\(referrers, '\[\]'::jsonb\) \|\| \$3::jsonb/);
});

test('the client editor no longer nulls referral provenance on save', () => {
  const modal = readFileSync(
    new URL('../../web/src/components/ClientModal.tsx', import.meta.url),
    'utf8',
  );
  const saveBlock = modal.slice(
    modal.indexOf('const resolvedPrimaryReferrer'),
    modal.indexOf('const preservedAdditionalReferrers'),
  );

  assert.doesNotMatch(saveBlock, /referralSheetId: null,/);
  assert.doesNotMatch(saveBlock, /referralReason: '',/);
  assert.match(saveBlock, /referralSheetId: existingPrimaryReferrer\?\.referralSheetId/);
  assert.match(saveBlock, /referralAddressText: inheritedReferralAddress/);
  assert.match(saveBlock, /sourceCandidateId: existingPrimaryReferrer\?\.sourceCandidateId/);
  // An inherited snapshot is not overwritten by the 'Unknown' placeholder.
  assert.match(modal, /\(referralNameSnapshot\.trim\(\) \|\| 'مجهول'\)/);
});
