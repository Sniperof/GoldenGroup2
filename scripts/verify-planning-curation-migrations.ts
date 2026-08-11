import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pool from '../packages/api/db.js';

function migrationBody(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/^BEGIN;\s*/i, '')
    .replace(/\s*COMMIT;\s*$/i, '');
}

async function main() {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(migrationBody('./migrations/398_planning_task_exclusion_scopes.sql'));
    await db.query(migrationBody('./migrations/399_client_contact_control_audit.sql'));

    const { rows: backfillRows } = await db.query<{ missing: number }>(
      `SELECT COUNT(*)::int AS missing
         FROM open_tasks ot
        WHERE ot.excluded_for_date IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
              FROM planning_task_exclusions exclusion
             WHERE exclusion.open_task_id = ot.id
               AND exclusion.branch_id = ot.branch_id
               AND exclusion.planning_date = ot.excluded_for_date
               AND exclusion.exclusion_scope = 'all_teams'
               AND exclusion.revoked_at IS NULL
          )`,
    );
    assert.equal(Number(backfillRows[0]?.missing ?? -1), 0, 'legacy backfill has gaps');

    const { rows: taskRows } = await db.query<{
      id: number;
      branchId: number;
      clientId: number;
      clientBranchId: number;
    }>(
      `SELECT
         ot.id,
         ot.branch_id AS "branchId",
         c.id AS "clientId",
         c.branch_id AS "clientBranchId"
       FROM open_tasks ot
       JOIN clients c ON c.id = ot.client_id
        ORDER BY ot.id
        LIMIT 1`,
    );
    const task = taskRows[0];
    if (task) {
      const { rows: operationRows } = await db.query<{ id: number }>(
        `INSERT INTO planning_curation_operations (
           branch_id, planning_date, team_key, action, layer, selector,
           selection_fingerprint
         )
         VALUES (
           $1, CURRENT_DATE, 'team_0', 'exclude', 'team_day', '{}'::jsonb,
           repeat('a', 64)
         )
         RETURNING id`,
        [task.branchId],
      );
      const operationId = operationRows[0]?.id;
      assert.ok(operationId, 'curation operation was not created');

      await db.query(
        `INSERT INTO planning_task_exclusions (
           open_task_id, branch_id, planning_date, exclusion_scope, team_key,
           team_snapshot, operation_id
         )
         VALUES ($1, $2, CURRENT_DATE, 'team', 'team_0', '{}'::jsonb, $3)`,
        [task.id, task.branchId, operationId],
      );
      await db.query(
        `INSERT INTO planning_task_exclusions (
           open_task_id, branch_id, planning_date, exclusion_scope
         )
         VALUES ($1, $2, CURRENT_DATE, 'all_teams')
         ON CONFLICT DO NOTHING`,
        [task.id, task.branchId],
      );

      await db.query('SAVEPOINT duplicate_check');
      let duplicateRejected = false;
      try {
        await db.query(
          `INSERT INTO planning_task_exclusions (
             open_task_id, branch_id, planning_date, exclusion_scope, team_key,
             team_snapshot
           )
           VALUES ($1, $2, CURRENT_DATE, 'team', 'team_0', '{}'::jsonb)`,
          [task.id, task.branchId],
        );
      } catch {
        duplicateRejected = true;
        await db.query('ROLLBACK TO SAVEPOINT duplicate_check');
      }
      assert.equal(duplicateRejected, true, 'active team exclusion must be unique');

      await db.query('SAVEPOINT invalid_shape_check');
      let invalidShapeRejected = false;
      try {
        await db.query(
          `INSERT INTO planning_task_exclusions (
             open_task_id, branch_id, planning_date, exclusion_scope, team_key
           )
           VALUES ($1, $2, CURRENT_DATE, 'team', 'team_1')`,
          [task.id, task.branchId],
        );
      } catch {
        invalidShapeRejected = true;
        await db.query('ROLLBACK TO SAVEPOINT invalid_shape_check');
      }
      assert.equal(invalidShapeRejected, true, 'team exclusion requires a team snapshot');

      await db.query(
        `UPDATE planning_task_exclusions
            SET revoked_at = NOW()
          WHERE open_task_id = $1
            AND exclusion_scope = 'team'
            AND team_key = 'team_0'
            AND revoked_at IS NULL`,
        [task.id],
      );
      await db.query(
        `INSERT INTO planning_task_exclusions (
           open_task_id, branch_id, planning_date, exclusion_scope, team_key,
           team_snapshot
         )
         VALUES ($1, $2, CURRENT_DATE, 'team', 'team_0', '{}'::jsonb)`,
        [task.id, task.branchId],
      );

      await db.query(
        `INSERT INTO client_contact_control_events (
           client_id, branch_id, control_type, action, reason_code, reason_text
         )
         VALUES (
           $1, $2, 'do_not_contact', 'enabled', 'migration_verification',
           'Rollback-backed verification'
         )`,
        [task.clientId, task.clientBranchId],
      );
    }

    console.log('planning curation migration verification: OK');
    await db.query('ROLLBACK');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
    await pool.end();
  }
}

void main();
