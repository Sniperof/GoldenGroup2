import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  assertBroadcastDestinationResolvable,
  listBroadcastCatalogDevices,
} from './broadcastDestinations.js';

test('catalog_device accepts only an active, non-deleted public model', async () => {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const db = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      return { rows: [{ '?column?': 1 }] };
    },
  } as any;

  await assertBroadcastDestinationResolvable('catalog_device', '42', db);
  assert.deepEqual(calls[0].params, [42]);
  assert.match(calls[0].sql, /is_active = TRUE/);
  assert.match(calls[0].sql, /deleted_at IS NULL/);
});

test('catalog_device rejects malformed and unavailable ids', async () => {
  const noRows = { query: async () => ({ rows: [] }) } as any;
  await assert.rejects(
    () => assertBroadcastDestinationResolvable('catalog_device', 'model-4', noRows),
    (err: any) => err.status === 400 && err.details?.code === 'invalid_catalog_device_id',
  );
  await assert.rejects(
    () => assertBroadcastDestinationResolvable('catalog_device', '404', noRows),
    (err: any) => err.status === 400 && err.details?.code === 'catalog_device_unavailable',
  );
});

test('catalog options use the same public visibility predicate', async () => {
  let sql = '';
  const db = { query: async (text: string) => { sql = text; return { rows: [] }; } } as any;
  await listBroadcastCatalogDevices(db);
  assert.match(sql, /is_active = TRUE/);
  assert.match(sql, /deleted_at IS NULL/);
});

test('migration admits both request-form and catalog-device destinations', () => {
  const migration = readFileSync(
    new URL('../../../../migrations/460_app_notification_catalog_device_destination.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /'service_request_form'/);
  assert.match(migration, /'catalog_device'/);
  assert.match(migration, /app_notification_broadcasts_destination_ck/);
});
