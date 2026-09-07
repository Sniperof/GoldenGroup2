import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CALL_DATE_SQL } from './customerCalls.js';

const SOURCE = readFileSync('packages/api/routes/customerCalls.ts', 'utf8');
const MIGRATION = readFileSync('migrations/454_call_task_link_snapshot_and_call_time.sql', 'utf8');

test('a zone-less call time is pinned to Damascus instead of the session timezone', () => {
  // The whole point: the meaning of the string is stated in SQL, not inherited.
  assert.match(CALL_DATE_SQL, /AT TIME ZONE 'Asia\/Damascus'/);
  // A string that names its own zone keeps its meaning.
  assert.match(CALL_DATE_SQL, /THEN \$8::timestamptz/);
  // And no value at all still falls back to the server clock.
  assert.match(CALL_DATE_SQL, /NOW\(\)\)/);
  // The bare cast that made the meaning session-dependent must be gone.
  assert.doesNotMatch(SOURCE, /COALESCE\(\$8::timestamptz, NOW\(\)\)/);
});

test('the timezone rule is applied at every call-insert site', () => {
  const inserts = SOURCE.match(/INSERT INTO customer_call_logs/g) ?? [];
  const pinned = SOURCE.match(/\$\{CALL_DATE_SQL\}/g) ?? [];
  assert.ok(inserts.length > 0, 'there is at least one call insert');
  assert.equal(pinned.length, inserts.length, 'every call insert uses the pinned expression');
});

test('every call-task link freezes the task state and declares whether it is the subject', () => {
  const links = SOURCE.match(/INSERT INTO call_task_links/g) ?? [];
  assert.equal(links.length, 3, 'the three link sites are still the only ones');
  const snapshots = SOURCE.match(/task_due_date_snapshot, task_status_snapshot, is_primary/g) ?? [];
  assert.equal(snapshots.length, links.length);
  // Read from the task in the same statement, so the value cannot drift between
  // reading it and writing the link.
  assert.match(SOURCE, /SELECT \$1, task\.id, task\.due_date, task\.status, \$3\s*\n\s*FROM open_tasks task WHERE task\.id = \$2/);
});

test('a sibling link can never demote the subject link', () => {
  // The sibling loop runs BEFORE the explicit task is linked, so DO NOTHING would
  // have dropped the explicit insert and left is_primary false forever.
  assert.doesNotMatch(SOURCE, /INSERT INTO call_task_links[\s\S]{0,400}ON CONFLICT DO NOTHING/);
  const raises = SOURCE.match(/DO UPDATE SET is_primary = call_task_links\.is_primary OR EXCLUDED\.is_primary/g) ?? [];
  assert.equal(raises.length, 3);
  // The subject is decided by identity, not by insert order.
  assert.match(SOURCE, /\[call\.id, open_task_id, open_task_id === openTaskId\]/);
});

test('the migration adds the snapshot columns and documents what the old rows mean', () => {
  assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS task_due_date_snapshot\s+DATE/);
  assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS task_status_snapshot\s+VARCHAR\(50\)/);
  assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS is_primary\s+BOOLEAN NOT NULL DEFAULT FALSE/);
  // The historical rows must not pretend to be frozen or to know the subject.
  assert.match(MIGRATION, /COMMENT ON COLUMN public\.call_task_links\.task_due_date_snapshot/);
  assert.match(MIGRATION, /COMMENT ON COLUMN public\.call_task_links\.is_primary/);
});

test('the call-time correction only touches rows another table can prove', () => {
  // The correction is anchored on the server-generated timestamp, not on a constant.
  assert.match(MIGRATION, /FROM public\.telemarketing_call_logs tm/);
  assert.match(MIGRATION, /SET call_date = shifted\.measured_at/);
  // It records what it overwrote, so the change is auditable on the row itself.
  assert.match(MIGRATION, /'callDateCorrectedFrom', shifted\.stored_at/);
  assert.match(MIGRATION, /'callDateCorrectedBy', 'migration_454'/);
  // Re-running must not correct an already corrected row.
  assert.match(MIGRATION, /NOT COALESCE\(call_log\.action_log \? 'callDateCorrectedFrom', FALSE\)/);
  // No blanket shift of the rows with no counterpart.
  assert.doesNotMatch(MIGRATION, /SET call_date = call_date [+-] INTERVAL/);
});
