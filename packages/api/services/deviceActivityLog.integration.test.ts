import assert from 'node:assert/strict';
import test from 'node:test';
import pool from '../db.js';
import { runWithChangeContext } from '../auditContext.js';
import { labelDeviceChange } from './deviceActivityContext.js';

// Device activity log (migration 498) on the live dev database. Every write
// runs in a transaction that is rolled back, so no device is changed.

async function pickDevice(status: string): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT id FROM installed_devices WHERE status = $1 ORDER BY id LIMIT 1`,
    [status],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

test('a labelled operation logs the status move, the readable field change, the reason and the actor', async (t) => {
  const deviceId = await pickDevice('pending_delivery');
  const { rows: [ctx] } = await pool.query(
    `SELECT (SELECT id FROM hr_users WHERE is_active ORDER BY id LIMIT 1) AS actor,
            (SELECT id FROM branches ORDER BY id DESC LIMIT 1) AS branch_id,
            (SELECT name FROM branches ORDER BY id DESC LIMIT 1) AS branch_name`,
  );
  if (!deviceId || !ctx?.actor) {
    t.skip('No pending_delivery device or active user');
    return;
  }

  await runWithChangeContext({}, async () => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(`SELECT set_config('app.actor_id', $1, true)`, [String(ctx.actor)]);
      await labelDeviceChange(db, 'delivery_suspended', '  الزبون مسافر  ');
      await db.query(
        `UPDATE installed_devices SET status = 'delivery_suspended', branch_id = $2 WHERE id = $1`,
        [deviceId, ctx.branch_id],
      );
      const { rows } = await db.query(
        `SELECT event_type, field_key, new_value, change_context, reason, performed_by
           FROM device_activity_log WHERE device_id = $1 AND source = 'trigger' ORDER BY id`,
        [deviceId],
      );
      const status = rows.find(r => r.event_type === 'status_changed');
      assert.equal(status?.new_value, 'delivery_suspended');
      assert.equal(status?.change_context, 'delivery_suspended');
      assert.equal(status?.reason, 'الزبون مسافر');
      assert.equal(Number(status?.performed_by), Number(ctx.actor));

      const branch = rows.find(r => r.field_key === 'branch_id');
      // An unchanged branch writes no line; a changed one shows the name, not the id.
      if (branch) assert.equal(branch.new_value, ctx.branch_name);
      assert.equal(rows.some(r => r.field_key === 'updated_at'), false);
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  });

  // The label is transaction-local: the next transaction on any connection is unlabelled.
  const { rows: [after] } = await pool.query(`SELECT NULLIF(current_setting('app.device_context', true), '') AS v`);
  assert.equal(after.v, null);
});

test('a visit result names its task type through app.visit_task_id', async (t) => {
  const deviceId = await pickDevice('delivered');
  const { rows: [vt] } = await pool.query(
    `SELECT id FROM visit_tasks WHERE task_type = 'device_installation' ORDER BY id DESC LIMIT 1`,
  );
  if (!deviceId || !vt) {
    t.skip('No delivered device or installation visit task');
    return;
  }

  await runWithChangeContext({ changeContext: 'visit_result', visitTaskId: Number(vt.id) }, async () => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(`UPDATE installed_devices SET status = 'installed' WHERE id = $1`, [deviceId]);
      const { rows: [row] } = await db.query(
        `SELECT change_context, task_type, visit_task_id FROM device_activity_log
          WHERE device_id = $1 AND event_type = 'status_changed' AND source = 'trigger' ORDER BY id DESC LIMIT 1`,
        [deviceId],
      );
      assert.equal(row?.change_context, 'visit_result');
      assert.equal(row?.task_type, 'device_installation');
      assert.equal(Number(row?.visit_task_id), Number(vt.id));
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  });
});
