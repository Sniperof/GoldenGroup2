import assert from 'node:assert/strict';
import test from 'node:test';
import { GENERIC_APP_ERROR_MESSAGE, appError, toPublicAppError } from './appErrors.js';

test('a deliberate error keeps its message and details', () => {
  const result = toPublicAppError(appError(409, 'يوجد طلب مفتوح', { code: 'open_request_exists' }));
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'يوجد طلب مفتوح');
  assert.deepEqual(result.body.details, { code: 'open_request_exists' });
  assert.equal(result.isInternal, false);
});

test('an unexpected error never reaches the client verbatim', () => {
  const dbError = Object.assign(new Error(
    'relation "service_requests" does not exist',
  ), { code: '42P01' });
  const result = toPublicAppError(dbError);
  assert.equal(result.status, 500);
  assert.equal(result.body.error, GENERIC_APP_ERROR_MESSAGE);
  assert.deepEqual(result.body.details, { code: 'internal_error' });
  assert.equal(result.isInternal, true);
  assert.ok(!JSON.stringify(result.body).includes('service_requests'));
});

test('a bogus status is treated as internal, not forwarded', () => {
  for (const status of [0, 200, 399, 600, NaN]) {
    const result = toPublicAppError(Object.assign(new Error('leak me'), { status }));
    assert.equal(result.status, 500, `status ${status}`);
    assert.equal(result.body.error, GENERIC_APP_ERROR_MESSAGE);
  }
});

test('non-Error throws are handled', () => {
  assert.equal(toPublicAppError('boom').status, 500);
  assert.equal(toPublicAppError(null).status, 500);
  assert.equal(toPublicAppError(undefined).isInternal, true);
});
