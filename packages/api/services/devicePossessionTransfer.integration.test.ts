import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import pool from '../db.js';
import { PossessionTransferError, recordFieldTransferFinances, transferDevicePossession } from './devicePossessionTransfer.js';

// Possession transfer (migration 500) on the live dev database. Every case
// runs in a transaction that is rolled back.

const authContext = { userId: 0, isSuperAdmin: true } as any;

async function inRollback<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    return await fn(db);
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
}

async function balance(db: PoolClient, clientId: number): Promise<number> {
  const { rows: [r] } = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN kind IN ('charge', 'refund') THEN amount_syp ELSE -amount_syp END), 0) AS b
       FROM financial_movements WHERE client_id = $1`,
    [clientId],
  );
  return Number(r.b);
}

async function pickContext() {
  const { rows: [device] } = await pool.query(
    `SELECT d.id, d.customer_id, c.id AS contract_id
       FROM installed_devices d JOIN contracts c ON c.id = d.contract_id
      WHERE d.status IN ('delivered', 'installed', 'active', 'faulty', 'out_of_service')
        AND c.status = 'active' AND c.sale_subtype = 'definitive' AND c.payer_client_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM open_tasks ot WHERE ot.device_id = d.id
                          AND ot.task_type <> 'installment_collection'
                          AND ot.status NOT IN ('completed', 'cancelled', 'closed'))
        AND NOT EXISTS (SELECT 1 FROM service_agreements sa WHERE sa.installed_device_id = d.id AND sa.status = 'active')
        AND EXISTS (SELECT 1 FROM contract_installments i WHERE i.contract_id = c.id AND i.remaining_balance > 0)
        AND NOT EXISTS (SELECT 1 FROM open_tasks ot WHERE ot.task_type = 'installment_collection'
                          AND ot.installment_id IN (SELECT id FROM contract_installments WHERE contract_id = c.id)
                          AND ot.status NOT IN ('completed', 'cancelled', 'closed', 'open', 'needs_follow_up'))
      ORDER BY d.id LIMIT 1`,
  );
  const { rows: [other] } = device ? await pool.query(
    `SELECT id FROM clients WHERE deleted_at IS NULL AND COALESCE(is_candidate, FALSE) = FALSE AND id <> $1 ORDER BY id LIMIT 1`,
    [device.customer_id],
  ) : { rows: [] };
  const { rows: [user] } = await pool.query(`SELECT id FROM hr_users WHERE is_active ORDER BY id LIMIT 1`);
  return { device, other, user };
}

test('the transfer moves the holder, the payer, the remaining debt and the open collection tasks', async (t) => {
  const { device, other, user } = await pickContext();
  if (!device || !other || !user) { t.skip('No transferable device with remaining installments'); return; }
  const fromId = Number(device.customer_id);
  const toId = Number(other.id);

  await inRollback(async (db) => {
    const { rows: [rem] } = await db.query(
      `SELECT COALESCE(SUM(remaining_balance), 0) AS r FROM contract_installments WHERE contract_id = $1 AND remaining_balance > 0`,
      [device.contract_id],
    );
    const { rows: tasksBefore } = await db.query(
      `SELECT id FROM open_tasks WHERE task_type = 'installment_collection'
          AND installment_id IN (SELECT id FROM contract_installments WHERE contract_id = $1)
          AND status IN ('open', 'needs_follow_up')`,
      [device.contract_id],
    );
    const fromBefore = await balance(db, fromId);
    const toBefore = await balance(db, toId);

    const result = await transferDevicePossession(db, {
      deviceId: Number(device.id), toClientId: toId, reasonCode: 'migrated_data_correction',
      notes: 'اختبار', authContext, userId: Number(user.id),
    });

    const { rows: [d] } = await db.query('SELECT customer_id FROM installed_devices WHERE id = $1', [device.id]);
    assert.equal(Number(d.customer_id), toId);
    const { rows: [c] } = await db.query('SELECT customer_id, payer_client_id FROM contracts WHERE id = $1', [device.contract_id]);
    assert.equal(Number(c.customer_id), fromId, 'the buyer stays');
    assert.equal(Number(c.payer_client_id), toId, 'the new holder pays');

    // The contract remainder (installments, plus any unpaid signing amount) moved between the two ledgers.
    assert.ok(result.contractBalanceSyp >= Number(rem.r) - 0.01);
    assert.ok(Math.abs((fromBefore - await balance(db, fromId)) - (result.contractBalanceSyp + result.warrantyBalanceSyp)) < 0.01);
    assert.ok(Math.abs((await balance(db, toId) - toBefore) - (result.contractBalanceSyp + result.warrantyBalanceSyp)) < 0.01);

    assert.deepEqual([...result.movedTaskIds].sort(), tasksBefore.map(r => Number(r.id)).sort());
    for (const id of result.movedTaskIds) {
      const { rows: [ot] } = await db.query('SELECT client_id FROM open_tasks WHERE id = $1', [id]);
      assert.equal(Number(ot.client_id), toId);
    }

    const { rows: open } = await db.query(
      `SELECT holder_id, reason, reason_code FROM device_possession_log WHERE device_id = $1 AND end_at IS NULL`,
      [device.id],
    );
    assert.equal(open.length, 1);
    assert.equal(Number(open[0].holder_id), toId);
    assert.equal(open[0].reason_code, 'migrated_data_correction');

    const { rows: [log] } = await db.query(
      `SELECT change_context, new_value FROM device_activity_log
        WHERE device_id = $1 AND field_key = 'customer_id' ORDER BY id DESC LIMIT 1`,
      [device.id],
    );
    assert.equal(log?.change_context, 'possession_transfer');
  });
});

test('an open operational device task blocks the transfer', async (t) => {
  const { rows: [device] } = await pool.query(
    `SELECT d.id, d.customer_id FROM installed_devices d
      WHERE d.status IN ('delivered', 'installed', 'active', 'faulty', 'out_of_service')
        AND EXISTS (SELECT 1 FROM open_tasks ot WHERE ot.device_id = d.id
                      AND ot.task_type <> 'installment_collection'
                      AND ot.status NOT IN ('completed', 'cancelled', 'closed'))
      ORDER BY d.id LIMIT 1`,
  );
  const { rows: [other] } = device ? await pool.query(
    `SELECT id FROM clients WHERE deleted_at IS NULL AND COALESCE(is_candidate, FALSE) = FALSE AND id <> $1 ORDER BY id LIMIT 1`,
    [device.customer_id],
  ) : { rows: [] };
  if (!device || !other) { t.skip('No device with an open task'); return; }

  await inRollback(async (db) => {
    await assert.rejects(
      transferDevicePossession(db, {
        deviceId: Number(device.id), toClientId: Number(other.id), reasonCode: 'migrated_data_correction',
        authContext, userId: 1,
      }),
      (err: unknown) => err instanceof PossessionTransferError && err.code === 'open_device_tasks',
    );
  });
});

test('«أخرى» needs a note and an unknown reason is refused', async (t) => {
  const { device, other, user } = await pickContext();
  if (!device || !other || !user) { t.skip('No transferable device'); return; }
  await inRollback(async (db) => {
    await assert.rejects(
      transferDevicePossession(db, { deviceId: Number(device.id), toClientId: Number(other.id), reasonCode: 'other', authContext, userId: Number(user.id) }),
      (err: unknown) => err instanceof PossessionTransferError && err.code === 'notes_required',
    );
  });
  await inRollback(async (db) => {
    await assert.rejects(
      transferDevicePossession(db, { deviceId: Number(device.id), toClientId: Number(other.id), reasonCode: 'nope', authContext, userId: Number(user.id) }),
      (err: unknown) => err instanceof PossessionTransferError && err.code === 'invalid_reason',
    );
  });
});

test('the field transfer moves the same finances once, even when the result is edited', async (t) => {
  const { device, other, user } = await pickContext();
  const { rows: [vtr] } = await pool.query(`SELECT id FROM visit_task_results ORDER BY id DESC LIMIT 1`);
  if (!device || !other || !user || !vtr) { t.skip('No transferable device or visit result'); return; }
  const fromId = Number(device.customer_id);
  const toId = Number(other.id);

  await inRollback(async (db) => {
    // The applier has already moved the device; the finances follow.
    await db.query('UPDATE installed_devices SET customer_id = $2 WHERE id = $1', [device.id, toId]);
    const fromBefore = await balance(db, fromId);
    const first = await recordFieldTransferFinances(db, {
      deviceId: Number(device.id), visitTaskResultId: Number(vtr.id), fromClientId: fromId, toClientId: toId, userId: Number(user.id),
    });
    assert.ok(first && first.contractBalanceSyp > 0);
    const { rows: [c] } = await db.query('SELECT payer_client_id FROM contracts WHERE id = $1', [device.contract_id]);
    assert.equal(Number(c.payer_client_id), toId);
    const afterFirst = await balance(db, fromId);
    assert.ok(Math.abs((fromBefore - afterFirst) - (first!.contractBalanceSyp + first!.warrantyBalanceSyp)) < 0.01);

    const second = await recordFieldTransferFinances(db, {
      deviceId: Number(device.id), visitTaskResultId: Number(vtr.id), fromClientId: fromId, toClientId: toId, userId: Number(user.id),
    });
    assert.equal(second, null);
    assert.equal(await balance(db, fromId), afterFirst);
    const { rows: [rec] } = await db.query(`SELECT source FROM device_possession_transfers WHERE visit_task_result_id = $1`, [vtr.id]);
    assert.equal(rec.source, 'field_task');
  });
});
