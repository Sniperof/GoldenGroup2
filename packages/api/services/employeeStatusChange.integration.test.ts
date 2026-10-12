import assert from 'node:assert/strict';
import test from 'node:test';
import pool from '../db.js';
import { changeEmployeeStatus, EmployeeStatusChangeError } from './employeeStatusChange.js';

// Employee status as an operation (migration 479) on the live dev database,
// with a fixture employee + account removed afterwards (normal-mode deletes so
// FK cascades run).

test('employee status change: account link, open-visit block, history', async (t) => {
  const { rows: [ctx] } = await pool.query(
    `SELECT (SELECT id FROM hr_users WHERE is_super_admin AND is_active ORDER BY id LIMIT 1) AS actor,
            (SELECT id FROM branches ORDER BY id LIMIT 1) AS branch_id,
            (SELECT id FROM system_lists WHERE category = 'employee_status_change_reasons' AND is_active ORDER BY display_order LIMIT 1) AS reason_id`,
  );
  if (!ctx?.actor || !ctx?.branch_id || !ctx?.reason_id) {
    t.skip('No super admin, branch or reason list');
    return;
  }
  const actor = Number(ctx.actor);
  const reasonId = Number(ctx.reason_id);
  const allow = () => true;
  const stamp = Date.now();

  const { rows: [emp] } = await pool.query(
    `INSERT INTO employees (employee_number, name, mobile, branch_id, status) VALUES (NULL, $1, $2, $3, 'active') RETURNING id`,
    [`اختبار الحالة ${stamp}`, `09${String(stamp).slice(-8)}`, ctx.branch_id],
  );
  const employeeId = Number(emp.id);
  const { rows: [acct] } = await pool.query(
    `INSERT INTO hr_users (name, username, password_hash, role, employee_id, branch_id, is_active)
     VALUES ($1, $2, 'x', 'test', $3, $4, TRUE) RETURNING id`,
    [`اختبار الحالة ${stamp}`, `status_test_${stamp}`, employeeId, ctx.branch_id],
  );
  const accountId = Number(acct.id);
  let visitId: number | null = null;
  let candidateId: number | null = null;

  const account = async () =>
    (await pool.query('SELECT is_active FROM hr_users WHERE id = $1', [accountId])).rows[0].is_active;
  const status = async () =>
    (await pool.query('SELECT status FROM employees WHERE id = $1', [employeeId])).rows[0].status;

  try {
    // 1) suspension switches the account off and is recorded
    const r1 = await changeEmployeeStatus({ employeeId, toStatus: 'suspended', reasonId, note: 'اختبار', actorUserId: actor, canChangeInBranch: allow });
    assert.equal(r1.accountEffect, 'deactivated');
    assert.equal(await status(), 'suspended');
    assert.equal(await account(), false);

    // 2) the account cannot be switched back on from anywhere else
    await assert.rejects(
      pool.query('UPDATE hr_users SET is_active = TRUE WHERE id = $1', [accountId]),
      (e: any) => e?.constraint === 'hr_users_employee_status_active',
    );

    // 3) back to active re-enables it
    const r2 = await changeEmployeeStatus({ employeeId, toStatus: 'active', reasonId, actorUserId: actor, canChangeInBranch: allow });
    assert.equal(r2.accountEffect, 'reactivated');
    assert.equal(await account(), true);

    // 4) vacation keeps the account
    const r3 = await changeEmployeeStatus({ employeeId, toStatus: 'vacation', reasonId, actorUserId: actor, canChangeInBranch: allow });
    assert.equal(r3.accountEffect, null);
    assert.equal(await account(), true);
    await changeEmployeeStatus({ employeeId, toStatus: 'active', reasonId, actorUserId: actor, canChangeInBranch: allow });

    // 4b) D6: a vacation keeps the employee's open candidates; suspension releases them
    const { rows: [cand] } = await pool.query(
      `INSERT INTO candidates (mobile, branch_id) VALUES ($1, $2) RETURNING id`,
      [`08${String(stamp).slice(-8)}`, ctx.branch_id],
    );
    candidateId = Number(cand.id);
    await pool.query(
      `INSERT INTO candidate_assignments (candidate_id, hr_user_id, assigned_by) VALUES ($1, $2, $3)`,
      [candidateId, accountId, actor],
    );
    const assigned = async () =>
      (await pool.query('SELECT count(*)::int AS n FROM candidate_assignments WHERE candidate_id = $1', [candidateId])).rows[0].n;
    await changeEmployeeStatus({ employeeId, toStatus: 'vacation', reasonId, actorUserId: actor, canChangeInBranch: allow });
    assert.equal(await assigned(), 1, 'vacation keeps the candidate');
    await changeEmployeeStatus({ employeeId, toStatus: 'suspended', reasonId, actorUserId: actor, canChangeInBranch: allow });
    assert.equal(await assigned(), 0, 'suspension (even from vacation) releases it');
    await changeEmployeeStatus({ employeeId, toStatus: 'active', reasonId, actorUserId: actor, canChangeInBranch: allow });

    // 5) an unfinished visit with the employee in its crew blocks leaving active work
    const { rows: [client] } = await pool.query('SELECT id FROM clients WHERE branch_id = $1 ORDER BY id LIMIT 1', [ctx.branch_id]);
    if (client) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        await db.query('SET LOCAL session_replication_role = replica'); // no booking notification for a fixture
        const { rows: [v] } = await db.query(
          `INSERT INTO field_visits (visit_type, visit_family, branch_id, client_id, status, scheduled_date, scheduled_time, team_snapshot)
           VALUES ('service', 'service', $1, $2, 'scheduled', '2099-12-01', '09:00', $3::jsonb) RETURNING id`,
          [ctx.branch_id, client.id, JSON.stringify({ teamKey: 'solo_0', technicianEmployeeId: employeeId })],
        );
        await db.query('COMMIT');
        visitId = Number(v.id);
      } finally {
        db.release();
      }
      await assert.rejects(
        changeEmployeeStatus({ employeeId, toStatus: 'terminated', reasonId, actorUserId: actor, canChangeInBranch: allow }),
        (e: unknown) => e instanceof EmployeeStatusChangeError && e.statusCode === 409
          && Array.isArray((e.details as any)?.openVisits) && (e.details as any).openVisits[0].id === visitId,
      );
      assert.equal(await status(), 'active', 'nothing changed on refusal');
    }

    // 6) guards: same status, own status, foreign branch
    await assert.rejects(
      changeEmployeeStatus({ employeeId, toStatus: 'active', reasonId, actorUserId: actor, canChangeInBranch: allow }),
      /أصلاً/,
    );
    await assert.rejects(
      changeEmployeeStatus({ employeeId, toStatus: 'vacation', reasonId, actorUserId: accountId, canChangeInBranch: allow }),
      /بنفسك/,
    );
    await assert.rejects(
      changeEmployeeStatus({ employeeId, toStatus: 'vacation', reasonId, actorUserId: actor, canChangeInBranch: () => false }),
      (e: unknown) => e instanceof EmployeeStatusChangeError && e.statusCode === 403,
    );

    const { rows: history } = await pool.query(
      'SELECT from_status, to_status, account_effect, note FROM employee_status_changes WHERE employee_id = $1 ORDER BY id',
      [employeeId],
    );
    assert.deepEqual(history.map((h) => `${h.from_status}>${h.to_status}`),
      ['active>suspended', 'suspended>active', 'active>vacation', 'vacation>active',
        'active>vacation', 'vacation>suspended', 'suspended>active']);
    assert.equal(history[0].account_effect, 'deactivated');
    assert.equal(history[0].note, 'اختبار');
  } finally {
    if (visitId) await pool.query('DELETE FROM field_visits WHERE id = $1', [visitId]);
    if (candidateId) await pool.query('DELETE FROM candidates WHERE id = $1', [candidateId]);
    await pool.query('DELETE FROM hr_users WHERE id = $1', [accountId]);
    await pool.query('DELETE FROM employees WHERE id = $1', [employeeId]);
  }
});

test.after(async () => {
  await pool.end();
});
