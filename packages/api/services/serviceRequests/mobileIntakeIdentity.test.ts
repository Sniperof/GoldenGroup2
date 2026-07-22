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
