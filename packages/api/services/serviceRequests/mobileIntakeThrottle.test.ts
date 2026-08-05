// DEC-016 — the intake caps after they stopped keying on a proven phone.
//
// The regression these lock down: the previous version built a predicate that
// matched NOTHING when an identity had no phone and no account, so the cap
// returned "0 rows, under the limit" and let every submission through with no
// error and no log line (D-WC8).

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import {
  assertNoOpenRequestForRequester,
  assertRequesterDailyQuota,
  assertRequesterIpQuota,
} from './mobileIntakeThrottle.js';
import type { MobileIntakeIdentity } from './mobileIntakeIdentity.js';

const account = { appAccountId: 7, clientId: 42, phone: '0911111111' };
const unverified: MobileIntakeIdentity = { kind: 'unverified', deviceId: 'device-1', ip: '10.0.0.4' };

function db(rows: Record<string, unknown>[], capture?: { sql: string[]; params: unknown[][] }) {
  return {
    query: async (sql: string, params: unknown[]) => {
      capture?.sql.push(sql);
      capture?.params.push(params);
      return { rows };
    },
  } as unknown as PoolClient;
}

test('the open-request rule keys on the device, not the beneficiary', async () => {
  const capture = { sql: [] as string[], params: [] as unknown[][] };
  await assertNoOpenRequestForRequester({
    db: db([], capture),
    requestType: 'water_check',
    identity: unverified,
  });
  assert.match(capture.sql[0], /requester_external->>'device_id'/);
  // The beneficiary's number must not appear: a stranger typing a real
  // customer's number would otherwise lock that customer out (D-WC4).
  assert.doesNotMatch(capture.sql[0], /beneficiary_external/);
  assert.ok(capture.params[0].includes('device-1'));
});

test('an open request from the same device blocks and names itself', async () => {
  await assert.rejects(
    () => assertNoOpenRequestForRequester({
      db: db([{ n: '1', public_ref_number: 'SR-20260803-0001' }]),
      requestType: 'water_check',
      identity: unverified,
    }),
    (err: { details?: { code?: string; publicRefNumber?: string } }) => {
      assert.equal(err.details?.code, 'open_request_exists');
      assert.equal(err.details?.publicRefNumber, 'SR-20260803-0001');
      return true;
    },
  );
});

test('each tier is capped by its own key', async () => {
  const cases: [MobileIntakeIdentity, RegExp, unknown][] = [
    [{ kind: 'customer', account }, /requester_app_account_id/, 7],
    [{ kind: 'visitor', phone: '0922222222', otpVerificationId: 9 }, /primary_phone/, '0922222222'],
    [unverified, /device_id/, 'device-1'],
  ];
  for (const [identity, pattern, key] of cases) {
    const capture = { sql: [] as string[], params: [] as unknown[][] };
    await assertRequesterDailyQuota({
      db: db([{ n: '0' }], capture),
      requestType: 'water_check',
      identity,
    });
    assert.match(capture.sql[0], pattern);
    assert.ok(capture.params[0].includes(key));
  }
});

test('an identity with no usable key is refused, not counted as zero', async () => {
  const keyless = { kind: 'unverified', deviceId: '', ip: null } as MobileIntakeIdentity;
  await assert.rejects(
    () => assertRequesterDailyQuota({ db: db([{ n: '0' }]), requestType: 'water_check', identity: keyless }),
    /requester_identity_unavailable/,
  );
  await assert.rejects(
    () => assertNoOpenRequestForRequester({ db: db([]), requestType: 'water_check', identity: keyless }),
    /requester_identity_unavailable/,
  );
});

test('the daily quota trips at the limit', async () => {
  await assert.rejects(
    () => assertRequesterDailyQuota({
      db: db([{ n: '5' }]),
      requestType: 'water_check',
      identity: unverified,
      limit: 5,
    }),
    (err: { details?: { code?: string; limit?: number } }) => {
      assert.equal(err.details?.code, 'daily_request_quota_reached');
      assert.equal(err.details?.limit, 5);
      return true;
    },
  );
});

test('the IP layer applies only above an unverified fingerprint', async () => {
  // A proven identity is already bounded by its own key; adding an IP cap on
  // top would punish a household sharing one address for no added safety.
  await assertRequesterIpQuota({
    db: db([{ n: '999' }]),
    requestType: 'water_check',
    identity: { kind: 'customer', account },
    limit: 1,
  });
  await assert.rejects(
    () => assertRequesterIpQuota({
      db: db([{ n: '20' }]),
      requestType: 'water_check',
      identity: unverified,
      limit: 20,
    }),
    (err: { details?: { scope?: string } }) => {
      assert.equal(err.details?.scope, 'ip');
      return true;
    },
  );
});

test('a zero limit disables its cap', async () => {
  const exploding = { query: async () => { throw new Error('query_not_expected'); } } as unknown as PoolClient;
  await assertRequesterDailyQuota({ db: exploding, requestType: 'water_check', identity: unverified, limit: 0 });
  await assertNoOpenRequestForRequester({ db: exploding, requestType: 'water_check', identity: unverified, limit: 0 });
  await assertRequesterIpQuota({ db: exploding, requestType: 'water_check', identity: unverified, limit: 0 });
});
