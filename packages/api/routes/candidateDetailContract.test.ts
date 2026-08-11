import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./candidates.ts', import.meta.url), 'utf8');

test('candidate detail route authorizes the loaded subject and returns read-only phone numbers', () => {
  const routeStart = source.indexOf("router.get('/:id', requirePermission('candidates.view_list')");
  const routeEnd = source.indexOf('/**', routeStart);
  assert.ok(routeStart > 0);
  assert.ok(routeEnd > routeStart);

  const route = source.slice(routeStart, routeEnd);
  assert.match(route, /canViewCandidate\(authContext/);
  assert.match(route, /\bphoneNumbers\b/);
  assert.match(route, /\btype\b/);
  assert.match(route, /\blabel\b/);
  assert.match(route, /\bhasWhatsApp\b/);
  assert.match(route, /\bstatus\b/);
  assert.match(route, /presentCandidateReferralReason\(candidate\.referralReason\)/);
  assert.doesNotMatch(route, /\bconfirmationStatus\b/);
  assert.match(route, /: \(candidate\.branchName \?\? 'غير محدد'\)/);
  assert.match(source, /'direct referral': 'ترشيح مباشر'/);
  assert.match(source, /'part of sheet': 'ضمن لائحة أسماء'/);
  assert.match(route, /canViewReferralSheet\(authContext/);
  assert.match(route, /canViewClient\(authContext/);
});

test('linking an existing client requires client edit authorization without a phone-match bypass', () => {
  const routeStart = source.indexOf("router.post('/:id/link-client'");
  const routeEnd = source.indexOf('/**', routeStart);
  const route = source.slice(routeStart, routeEnd);

  assert.match(route, /canEditClient\(authContext/);
  assert.doesNotMatch(route, /clientHasMatchingPhone/);
});

test('creating from a name list authorizes the sheet, requires an open status and inherits referral data', () => {
  const routeStart = source.indexOf("router.post('/', requirePermission('candidates.create')");
  const routeEnd = source.indexOf('/**', routeStart);
  const route = source.slice(routeStart, routeEnd);

  assert.match(route, /canViewReferralSheet\(authContext/);
  assert.match(route, /sheet\.status !== 'New' && sheet\.status !== 'In-Progress'/);
  assert.match(route, /c\.referralType = inheritedReferral\.referralType/);
  assert.match(route, /c\.referralNameSnapshot = inheritedReferral\.referralNameSnapshot/);
  assert.match(route, /c\.referralReason = 'ضمن لائحة أسماء'/);
});
