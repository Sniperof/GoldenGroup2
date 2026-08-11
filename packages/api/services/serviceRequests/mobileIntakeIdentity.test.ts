import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { executeMobileIntake } from './mobileIntakeExecution.js';
import {
  consumeMobileIntakeIdentity,
  resolveMobileIntakeIdentity,
} from './mobileIntakeIdentity.js';

const account = { appAccountId: 7, clientId: 42, phone: '0911111111' };

test('authenticated customer identity needs no visitor OTP query', async () => {
  const db = { query: async () => { throw new Error('query_not_expected'); } } as unknown as PoolClient;
  const identity = await resolveMobileIntakeIdentity({ db, appAccount: account });
  assert.deepEqual(identity, { kind: 'customer', account });
});

test('visitor service-request handle is resolved and consumed centrally', async () => {
  const queries: string[] = [];
  const db = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes('SELECT id, phone')) {
        return {
          rows: [{
            id: 9,
            phone: '0922222222',
            verified_at: new Date().toISOString(),
            consumed_at: null,
          }],
        };
      }
      return { rows: [], rowCount: 1 };
    },
  } as unknown as PoolClient;
  const identity = await resolveMobileIntakeIdentity({ db, handle: 'visitor-handle' });
  assert.deepEqual(identity, { kind: 'visitor', phone: '0922222222', otpVerificationId: 9 });
  await consumeMobileIntakeIdentity(db, identity);
  assert.equal(queries.some((sql) => sql.includes('SET consumed_at = NOW()')), true);
});

// ── DEC-016: the unverified tier ───────────────────────────────────────────

const noQuery = { query: async () => { throw new Error('query_not_expected'); } } as unknown as PoolClient;

test('a type that did not opt in still fails closed without proof', async () => {
  await assert.rejects(
    () => resolveMobileIntakeIdentity({ db: noQuery, deviceId: 'device-1' }),
    /service_request_verification_required/,
  );
});

test('an opted-in type accepts a device fingerprint instead of a handle', async () => {
  const identity = await resolveMobileIntakeIdentity({
    db: noQuery,
    deviceId: '  device-1  ',
    ip: '10.0.0.4',
    allowUnverified: true,
  });
  assert.deepEqual(identity, { kind: 'unverified', deviceId: 'device-1', ip: '10.0.0.4' });
});

test('a missing fingerprint is refused, never waved through as anonymous', async () => {
  // The caps hang on this key: accepting `null` would bypass all of them
  // silently, which is the failure mode DEC-016 D-WC8 exists to prevent.
  await assert.rejects(
    () => resolveMobileIntakeIdentity({ db: noQuery, allowUnverified: true }),
    /device_identifier_required/,
  );
  await assert.rejects(
    () => resolveMobileIntakeIdentity({ db: noQuery, deviceId: '   ', allowUnverified: true }),
    /device_identifier_required/,
  );
  await assert.rejects(
    () => resolveMobileIntakeIdentity({
      db: noQuery,
      deviceId: 'x'.repeat(129),
      allowUnverified: true,
    }),
    /invalid_device_identifier/,
  );
});

test('a handle still outranks the fingerprint during the migration window', async () => {
  const db = {
    query: async () => ({
      rows: [{
        id: 9,
        phone: '0922222222',
        verified_at: new Date().toISOString(),
        consumed_at: null,
      }],
    }),
  } as unknown as PoolClient;
  const identity = await resolveMobileIntakeIdentity({
    db,
    handle: 'visitor-handle',
    deviceId: 'device-1',
    allowUnverified: true,
  });
  assert.equal(identity.kind, 'visitor');
});

test('an unverified identity has nothing to consume', async () => {
  await consumeMobileIntakeIdentity(noQuery, { kind: 'unverified', deviceId: 'd', ip: null });
});

test('failed request handler does not consume the visitor handle', async () => {
  const queries: string[] = [];
  const db = {
    query: async (sql: string) => {
      queries.push(sql);
      return {
        rows: [{
          id: 9,
          phone: '0922222222',
          verified_at: new Date().toISOString(),
          consumed_at: null,
        }],
      };
    },
  } as unknown as PoolClient;
  await assert.rejects(() => executeMobileIntake({
    db,
    body: { handle: 'visitor-handle' },
    handler: {
      requestType: 'test',
      formVersion: 'v1',
      submit: async () => { throw new Error('handler_failed'); },
    },
  }), /handler_failed/);
  assert.equal(queries.some((sql) => sql.includes('SET consumed_at = NOW()')), false);
});
