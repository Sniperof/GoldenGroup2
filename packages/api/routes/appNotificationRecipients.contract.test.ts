import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('./adminAppNotifications.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const service = readFileSync(new URL('../services/appNotifications/broadcastService.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('recipient search needs the send permission and the same branch bounds as the send', () => {
  const block = route.slice(route.indexOf("router.get('/recipients'"), route.indexOf('/**', route.indexOf("router.get('/recipients'")));
  assert.match(block, /requirePermission\(SEND\)/);
  // resolveAudience pins a non-GLOBAL operator to their own branches (403 outside them)
  assert.match(block, /resolveAudience\(/);
});

test('recipient search only offers active app-account holders, via the shared audience filter', () => {
  const fn = service.slice(service.indexOf('export async function searchBroadcastRecipients('), service.indexOf('export interface BroadcastResult'));
  assert.match(fn, /buildAudienceSql\(/, 'must reuse the send filter (active, not deleted, branch ceiling)');
  assert.match(fn, /FROM app_accounts a\s+JOIN clients c ON c\.id = a\.linked_client_record_id/);
  assert.match(fn, /replace\(\/\[\\\\%_\]\/g/, 'LIKE wildcards in the search must be escaped');
});
