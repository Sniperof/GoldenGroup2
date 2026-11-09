import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./clients.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../migrations/489_client_activity_log.sql', import.meta.url), 'utf8');

// The trigger (489) labels each line with app.change_context: the write paths
// must set it before they touch the clients row, or the line has no source.
test('client create labels the «created» line before inserting the row', () => {
  const create = source.slice(source.indexOf("router.post('/', requirePermission('clients.create')"));
  const context = create.indexOf("set_config('app.change_context', $1, true)");
  const insert = create.indexOf('INSERT INTO clients (');
  assert.ok(context > 0 && insert > 0 && context < insert);
});

test('client edit and contacts-only edit carry their own context', () => {
  assert.match(source, /set_config\('app\.change_context', 'client_edit', true\)/);
  assert.match(source, /runWithChangeContext\(\{ changeContext: 'client_contacts_edit' \}/);
});

test('the activity endpoint is gated by its own permission on the client branch', () => {
  assert.match(source, /router\.get\('\/:id\/activity', requirePermission\('clients\.activity_log\.view'\)/);
  assert.match(source, /permission: 'clients\.activity_log\.view',\s*branchId: subject\.branchId/);
});

test('the log trigger skips histories kept elsewhere and labels nested writes', () => {
  assert.match(migration, /AFTER INSERT OR UPDATE ON public\.clients/);
  for (const own of ['rating', 'cooldown_until', 'do_not_contact']) {
    assert.match(migration, new RegExp(`'${own}'`));
  }
  assert.match(migration, /pg_trigger_depth\(\) > 1 THEN 'mediator_renamed'/);
});
