import fs from 'node:fs';
import pool from '../packages/api/db.js';

const filename = new URL('../migrations/435_device_delivery_suspension.sql', import.meta.url);
const raw = fs.readFileSync(filename, 'utf8');
const sql = raw.replace(/^\uFEFF?\s*BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');
const client = await pool.connect();

const permissionKey = 'installed_devices.delivery_suspension.manage';
const reasonValue = 'delivery_suspended_customer_absent';

async function snapshot() {
  const constraint = await client.query(
    `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'public.installed_devices'::regclass
          AND conname = 'installed_devices_status_check'`,
  );
  const permission = await client.query(
    `SELECT key, module, sub_module, action, display_name, display_order, allowed_scopes
         FROM permissions
        WHERE key = $1`,
    [permissionKey],
  );
  const reasons = await client.query(
    `SELECT category, value, is_active, display_order, metadata
         FROM system_lists
        WHERE value = $1
          AND category IN ('device_delivery_failure_reasons', 'visit_cancellation_reasons')
        ORDER BY category`,
    [reasonValue],
  );
  const trigger = await client.query(
    `SELECT tgname
       FROM pg_trigger
      WHERE tgrelid = 'public.open_tasks'::regclass
        AND tgname = 'trg_guard_suspended_device_delivery_task'
        AND NOT tgisinternal`,
  );
  const guardFunction = await client.query(
    `SELECT proname
       FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname = 'guard_suspended_device_delivery_task'`,
  );
  return {
    constraint: constraint.rows,
    permission: permission.rows,
    reasons: reasons.rows,
    trigger: trigger.rows,
    guardFunction: guardFunction.rows,
  };
}

try {
  const before = await snapshot();
  await client.query('BEGIN');
  await client.query(sql);

  const applied = await snapshot();
  const definition = String(applied.constraint[0]?.definition ?? '');
  if (!definition.includes('delivery_suspended')) {
    throw new Error('installed_devices status constraint does not include delivery_suspended');
  }
  if (applied.permission.length !== 1) {
    throw new Error(`expected one suspension permission, got ${applied.permission.length}`);
  }
  const scopes = applied.permission[0].allowed_scopes as string[];
  if (JSON.stringify(scopes) !== JSON.stringify(['GLOBAL', 'BRANCH'])) {
    throw new Error(`unexpected permission scopes: ${JSON.stringify(scopes)}`);
  }
  if (applied.reasons.length !== 2) {
    throw new Error(`expected two fixed suspension reasons, got ${applied.reasons.length}`);
  }
  if (applied.trigger.length !== 1 || applied.guardFunction.length !== 1) {
    throw new Error('concurrent delivery-task guard was not installed');
  }

  await client.query('ROLLBACK');
  const after = await snapshot();
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error('rollback did not restore the previous schema and catalog state');
  }

  console.log(JSON.stringify({
    migration: '435 rollback dry-run OK',
    permission: permissionKey,
    scopes,
    fixedReasonCount: applied.reasons.length,
    concurrentTaskGuard: true,
    schemaRestored: true,
  }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
