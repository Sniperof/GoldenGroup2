import assert from 'node:assert/strict';
import test from 'node:test';
import { claimContactTarget } from './contactTargetLocks.js';

test('claiming a queued contact target records ownership and moves it into the call list', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    async query(sql: string, params: unknown[]) {
      calls.push({ sql, params });
      return { rows: [{ id: 42 }] };
    },
  };

  await claimContactTarget(db, 42, 7);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.params, [42, 7]);
  assert.match(calls[0]?.sql ?? '', /status = CASE WHEN status = 'queued' THEN 'in_call_list' ELSE status END/);
  assert.match(calls[0]?.sql ?? '', /locked_by_hr_user_id = COALESCE\(locked_by_hr_user_id, \$2\)/);
});

test('claiming a contact target keeps the existing lock conflict path', async () => {
  const db = {
    async query(sql: string) {
      if (sql.includes('UPDATE contact_targets')) return { rows: [] };
      return { rows: [{ name: 'موظف آخر' }] };
    },
  };

  await assert.rejects(
    () => claimContactTarget(db, 42, 7),
    (error: unknown) => error instanceof Error && error.message.includes('موظف آخر'),
  );
});
