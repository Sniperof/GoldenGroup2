import assert from 'node:assert/strict';
import test from 'node:test';
import pool from '../db.js';
import {
  buildPlanningTaskAvailablePredicate,
  buildPlanningTaskExcludedPredicate,
} from './planningContactTargetScope.js';

type PredicateState = {
  excluded: boolean;
  available: boolean;
};

test('planning availability remains boolean for NULL legacy dates and respects every active layer', async () => {
  const db = await pool.connect();
  const excludedPredicate = buildPlanningTaskExcludedPredicate('ot', '$1', '$2');
  const availablePredicate = buildPlanningTaskAvailablePredicate('ot', '$1', '$2');
  const teamKey = 'team_0';
  const planningDate = '2026-07-30';

  async function evaluate(excludedForDate: string | null): Promise<PredicateState> {
    const { rows } = await db.query<PredicateState>(
      `SELECT
         (${excludedPredicate}) AS excluded,
         (${availablePredicate}) AS available
       FROM (
         VALUES (900001::int, 2::int, $3::date)
       ) AS ot(id, branch_id, excluded_for_date)`,
      [teamKey, planningDate, excludedForDate],
    );
    return rows[0]!;
  }

  try {
    await db.query('BEGIN');
    await db.query(
      `CREATE TEMP TABLE planning_task_exclusions (
         open_task_id INTEGER NOT NULL,
         branch_id INTEGER NOT NULL,
         planning_date DATE NOT NULL,
         revoked_at TIMESTAMPTZ,
         exclusion_scope VARCHAR(20) NOT NULL,
         team_key VARCHAR(50)
       ) ON COMMIT DROP`,
    );

    assert.deepEqual(await evaluate(null), {
      excluded: false,
      available: true,
    });
    assert.deepEqual(await evaluate('2026-07-29'), {
      excluded: false,
      available: true,
    });
    assert.deepEqual(await evaluate(planningDate), {
      excluded: true,
      available: false,
    });

    await db.query(
      `INSERT INTO planning_task_exclusions (
         open_task_id, branch_id, planning_date, revoked_at,
         exclusion_scope, team_key
       )
       VALUES (900001, 2, $1::date, NULL, 'team', 'team_1')`,
      [planningDate],
    );
    assert.deepEqual(await evaluate(null), {
      excluded: false,
      available: true,
    });

    await db.query(
      `INSERT INTO planning_task_exclusions (
         open_task_id, branch_id, planning_date, revoked_at,
         exclusion_scope, team_key
       )
       VALUES (900001, 2, $1::date, NULL, 'team', $2)`,
      [planningDate, teamKey],
    );
    assert.deepEqual(await evaluate(null), {
      excluded: true,
      available: false,
    });

    await db.query(
      `UPDATE planning_task_exclusions
          SET revoked_at = NOW()
        WHERE team_key = $1`,
      [teamKey],
    );
    assert.deepEqual(await evaluate(null), {
      excluded: false,
      available: true,
    });

    await db.query(
      `INSERT INTO planning_task_exclusions (
         open_task_id, branch_id, planning_date, revoked_at,
         exclusion_scope, team_key
       )
       VALUES (900001, 2, $1::date, NULL, 'all_teams', NULL)`,
      [planningDate],
    );
    assert.deepEqual(await evaluate(null), {
      excluded: true,
      available: false,
    });

    const { rowCount: typedInsertCount } = await db.query(
      `INSERT INTO planning_task_exclusions (
         open_task_id, branch_id, planning_date, revoked_at,
         exclusion_scope, team_key
       )
       SELECT 900002, 2, $1::date, NULL, $2::varchar, $3::varchar
       WHERE NOT EXISTS (
         SELECT 1
           FROM planning_task_exclusions active
          WHERE active.open_task_id = 900002
            AND active.exclusion_scope = $2::varchar
            AND active.team_key IS NOT DISTINCT FROM $3::varchar
       )`,
      [planningDate, 'team', teamKey],
    );
    assert.equal(
      typedInsertCount,
      1,
      'reused INSERT/NOT EXISTS parameters must have one explicit SQL type',
    );

    await db.query('ROLLBACK');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
    await pool.end();
  }
});
