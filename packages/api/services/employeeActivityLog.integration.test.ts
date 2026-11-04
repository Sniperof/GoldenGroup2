import assert from 'node:assert/strict';
import test from 'node:test';
import pool from '../db.js';
import { changeEmployeeStatus, EmployeeStatusChangeError } from './employeeStatusChange.js';
import { listEmployeeActivity } from './employeeActivityLog.js';

// Employee activity log (migration 480) on the live dev database, with a
// fixture employee/account/visit removed afterwards (normal-mode deletes).

test('employee activity log records fields, dates, status, account and visit crew', async (t) => {
  const { rows: [ctx] } = await pool.query(
    `SELECT (SELECT id FROM hr_users WHERE is_super_admin AND is_active ORDER BY id LIMIT 1) AS actor,
            (SELECT id FROM branches ORDER BY id LIMIT 1) AS branch_id,
            (SELECT id FROM departments ORDER BY id LIMIT 1) AS department_id,
            (SELECT id FROM roles ORDER BY id LIMIT 1) AS role_a,
            (SELECT id FROM roles ORDER BY id OFFSET 1 LIMIT 1) AS role_b,
            (SELECT id FROM system_lists WHERE category = 'employee_status_change_reasons' AND is_active ORDER BY display_order LIMIT 1) AS reason_id`,
  );
  if (!ctx?.actor || !ctx?.branch_id || !ctx?.reason_id || !ctx?.role_a || !ctx?.role_b) {
    t.skip('Missing super admin, branch, roles or reason list');
    return;
  }
  const actor = Number(ctx.actor);
  const reasonId = Number(ctx.reason_id);
  const allow = () => true;
  const stamp = Date.now();
  let employeeId: number | null = null;
  let accountId: number | null = null;
  let visitId: number | null = null;

  const events = async () => (await listEmployeeActivity(employeeId!)).reverse();

  try {
    const { rows: [emp] } = await pool.query(
      `INSERT INTO employees (employee_number, name, mobile, branch_id, status, job_title, start_work_date)
       VALUES (NULL, $1, $2, $3, 'active', 'فني', '2026-01-01') RETURNING id`,
      [`log test ${stamp}`, `07${String(stamp).slice(-8)}`, ctx.branch_id],
    );
    employeeId = Number(emp.id);

    // field edits (with a name resolved for the department)
    await pool.query(`UPDATE employees SET job_title = 'مشرف', department_id = $2 WHERE id = $1`, [employeeId, ctx.department_id]);

    // system account: created, role changed, password changed
    const { rows: [acct] } = await pool.query(
      `INSERT INTO hr_users (name, username, password_hash, role, role_id, employee_id, branch_id, is_active)
       VALUES ($1, $2, 'x', 'test', $3, $4, $5, TRUE) RETURNING id`,
      [`log test ${stamp}`, `log_test_${stamp}`, ctx.role_a, employeeId, ctx.branch_id],
    );
    accountId = Number(acct.id);
    await pool.query(`UPDATE hr_users SET role_id = $2, password_hash = 'y' WHERE id = $1`, [accountId, ctx.role_b]);

    // visit crew: put the employee in as the replacement technician
    const { rows: [client] } = await pool.query('SELECT id FROM clients WHERE branch_id = $1 ORDER BY id LIMIT 1', [ctx.branch_id]);
    if (client) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        await db.query('SET LOCAL session_replication_role = replica');
        const { rows: [v] } = await db.query(
          `INSERT INTO field_visits (visit_type, visit_family, branch_id, client_id, status, scheduled_date, scheduled_time, team_snapshot)
           VALUES ('service', 'service', $1, $2, 'completed', '2099-12-02', '09:00', '{"teamKey":"solo_0"}'::jsonb) RETURNING id`,
          [ctx.branch_id, client.id],
        );
        await db.query('COMMIT');
        visitId = Number(v.id);
      } finally {
        db.release();
      }
      await pool.query('UPDATE field_visits SET reassigned_technician_id = $2 WHERE id = $1', [visitId, employeeId]);
    }

    // terminated: needs a past effective date
    await assert.rejects(
      changeEmployeeStatus({ employeeId, toStatus: 'terminated', reasonId, actorUserId: actor, canChangeInBranch: allow }),
      (e: unknown) => e instanceof EmployeeStatusChangeError && /تاريخ إيقاف الخدمة مطلوب/.test(e.message),
    );
    await assert.rejects(
      changeEmployeeStatus({ employeeId, toStatus: 'terminated', endOfServiceDate: '2999-01-01', reasonId, actorUserId: actor, canChangeInBranch: allow }),
      /المستقبل/,
    );
    await changeEmployeeStatus({ employeeId, toStatus: 'terminated', endOfServiceDate: '2026-10-01', reasonId, actorUserId: actor, canChangeInBranch: allow });
    let { rows: [state] } = await pool.query(
      `SELECT to_char(end_of_service_date, 'YYYY-MM-DD') AS eos, to_char(start_work_date, 'YYYY-MM-DD') AS sw FROM employees WHERE id = $1`,
      [employeeId],
    );
    assert.equal(state.eos, '2026-10-01');

    // rehire: needs a new start date; end date cleared
    await assert.rejects(
      changeEmployeeStatus({ employeeId, toStatus: 'active', reasonId, actorUserId: actor, canChangeInBranch: allow }),
      /تاريخ بدء العمل الجديد مطلوب/,
    );
    await changeEmployeeStatus({ employeeId, toStatus: 'active', newStartDate: '2026-10-10', reasonId, actorUserId: actor, canChangeInBranch: allow });
    ({ rows: [state] } = await pool.query(
      `SELECT to_char(end_of_service_date, 'YYYY-MM-DD') AS eos, to_char(start_work_date, 'YYYY-MM-DD') AS sw FROM employees WHERE id = $1`,
      [employeeId],
    ));
    assert.equal(state.eos, null);
    assert.equal(state.sw, '2026-10-10');

    const log = await events();
    const has = (type: string, pred: (r: any) => boolean = () => true) => log.some((r) => r.eventType === type && pred(r));

    assert.ok(has('created'));
    assert.ok(has('field_changed', (r) => r.fieldKey === 'job_title' && r.oldValue === 'فني' && r.newValue === 'مشرف'));
    if (ctx.department_id) assert.ok(has('field_changed', (r) => r.fieldKey === 'department_id' && r.newValue && !/^\d+$/.test(r.newValue)), 'department shown by name');
    assert.ok(has('account_created', (r) => String(r.newValue).startsWith(`log_test_${stamp}`)));
    assert.ok(has('account_role_changed'));
    assert.ok(has('account_password_changed', (r) => r.newValue == null && r.oldValue == null), 'password value never stored');
    if (visitId) assert.ok(has('visit_crew_added', (r) => String(r.newValue).includes(`#${visitId}`)));
    assert.ok(has('status_changed', (r) => r.oldValue === 'active' && r.newValue === 'terminated' && Boolean(r.reason)));
    assert.ok(has('field_changed', (r) => r.fieldKey === 'end_of_service_date' && r.newValue === '2026-10-01'));
    assert.ok(has('account_deactivated'));
    assert.ok(has('account_activated'));
    assert.ok(has('field_changed', (r) => r.fieldKey === 'start_work_date' && r.oldValue === '2026-01-01' && r.newValue === '2026-10-10'));
    assert.ok(!has('field_changed', (r) => r.fieldKey === 'status'), 'status is logged as status_changed, not as a raw field');
    assert.ok(log.filter((r) => r.eventType === 'status_changed').every((r) => r.performedByName), 'actor attributed');

    await assert.rejects(
      pool.query('UPDATE employee_activity_log SET reason = $2 WHERE employee_id = $1', [employeeId, 'x']),
      /append-only/,
    );
  } finally {
    if (visitId) await pool.query('DELETE FROM field_visits WHERE id = $1', [visitId]);
    if (accountId) await pool.query('DELETE FROM hr_users WHERE id = $1', [accountId]);
    if (employeeId) await pool.query('DELETE FROM employees WHERE id = $1', [employeeId]);
  }
});

test.after(async () => {
  await pool.end();
});
