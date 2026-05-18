import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { getPlanningWorkScope } from '../services/planningMarketingTargets.js';
import { syncAssignedTasks } from '../services/assignedTasks.js';

const router = Router();
router.use(requireAuth);

function getAuthContext(req: any) {
  if (!req.authContext) throw new Error('AuthContext is required');
  return req.authContext as {
    userId: number;
    isSuperAdmin: boolean;
    actingBranchId: number | null;
    [key: string]: any;
  };
}

// POST /api/work-scopes — create or upsert a work scope for a team/date
router.post('/', requirePermission('marketing_visits.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const branchId = authContext.isSuperAdmin
      ? Number(req.body?.branchId)
      : authContext.actingBranchId;

    if (!branchId) return res.status(400).json({ error: 'يجب تحديد الفرع' });

    const { date, teamKey, zoneIds, scopeType } = req.body ?? {};
    if (!date || !teamKey) return res.status(400).json({ error: 'date و teamKey مطلوبان' });

    const { rows } = await pool.query(
      `INSERT INTO work_scopes (branch_id, date, team_key, zone_ids, scope_type, generated_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (date, team_key, branch_id) DO UPDATE SET
         zone_ids = EXCLUDED.zone_ids,
         scope_type = EXCLUDED.scope_type,
         generated_at = NOW(),
         generated_by = EXCLUDED.generated_by
       RETURNING *`,
      [
        branchId, date, teamKey,
        Array.isArray(zoneIds) ? zoneIds : [],
        scopeType || 'mixed',
        authContext.userId,
      ],
    );

    res.json(rows[0]);
  } catch (err: any) {
    console.error('[work-scopes] POST / error:', err);
    res.status(500).json({ error: 'فشل في إنشاء نطاق العمل' });
  }
});

// GET /api/work-scopes/:date/:teamKey — fetch scope + tasks
router.get('/:date/:teamKey', requirePermission('marketing_visits.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const branchId = authContext.isSuperAdmin
      ? Number(req.query.branchId)
      : authContext.actingBranchId;

    if (!branchId) return res.status(400).json({ error: 'يجب تحديد الفرع' });

    const date = Array.isArray(req.params.date) ? req.params.date[0]! : req.params.date;
    const teamKey = Array.isArray(req.params.teamKey) ? req.params.teamKey[0]! : req.params.teamKey;
    const result = await getPlanningWorkScope({ date, teamKey, branchId });
    res.json(result);
  } catch (err: any) {
    console.error('[work-scopes] GET /:date/:teamKey error:', err);
    res.status(500).json({ error: 'فشل في تحميل نطاق العمل' });
  }
});

// PUT /api/work-scopes/:id/activate — set scope status to active
router.put('/:id/activate', requirePermission('marketing_visits.update_result'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'معرف النطاق غير صالح' });

    const { rows } = await pool.query(
      `UPDATE work_scopes SET status = 'active' WHERE id = $1 RETURNING *`,
      [id],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'النطاق غير موجود' });

    res.json(rows[0]);
  } catch (err: any) {
    console.error('[work-scopes] PUT /:id/activate error:', err);
    res.status(500).json({ error: 'فشل في تفعيل النطاق' });
  }
});

// POST /api/work-scopes/:id/generate-tasks — populate scope_tasks from matching open_tasks
router.post('/:id/generate-tasks', requirePermission('marketing_visits.update_result'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const scopeId = Number(req.params.id);
    if (!Number.isFinite(scopeId)) return res.status(400).json({ error: 'معرف النطاق غير صالح' });

    const { rows: scopeRows } = await pool.query(
      'SELECT * FROM work_scopes WHERE id = $1',
      [scopeId],
    );
    if (scopeRows.length === 0) return res.status(404).json({ error: 'النطاق غير موجود' });

    const scope = scopeRows[0];
    const branchId: number = scope.branch_id;
    const teamKey: string = scope.team_key;
    const date: string = scope.date instanceof Date
      ? scope.date.toISOString().split('T')[0]
      : String(scope.date).split('T')[0];

    const workScope = await getPlanningWorkScope({ date, teamKey, branchId });

    // FIX-2: wrap sync + scope_tasks writes in a single transaction
    const pgClient = await pool.connect();
    let syncResult: Awaited<ReturnType<typeof syncAssignedTasks>>;
    try {
      await pgClient.query('BEGIN');
      syncResult = await syncAssignedTasks({
        date,
        teamKey,
        branchId,
        scopeId,
        performedBy: authContext.userId,
        db: pgClient,
      });

      let inserted = 0;
      for (const taskId of syncResult.eligibleTaskIds) {
        const { rowCount } = await pgClient.query(
          `INSERT INTO scope_tasks (scope_id, open_task_id, team_key, branch_id, added_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (scope_id, open_task_id) DO NOTHING`,
          [scopeId, taskId, teamKey, branchId, authContext.userId],
        );
        inserted += rowCount ?? 0;
      }

      if (syncResult.releasedIds.length > 0) {
        await pgClient.query(
          `DELETE FROM scope_tasks WHERE scope_id = $1 AND open_task_id = ANY($2::int[])`,
          [scopeId, syncResult.releasedIds],
        );
      }

      await pgClient.query('COMMIT');

      res.json({
        scopeId,
        totalTasks: syncResult.plannedTaskIds.length,
        newlyInserted: inserted,
        counts: workScope.counts,
      });
    } catch (innerErr) {
      await pgClient.query('ROLLBACK');
      throw innerErr;
    } finally {
      pgClient.release();
    }
  } catch (err: any) {
    console.error('[work-scopes] POST /:id/generate-tasks error:', err);
    res.status(500).json({ error: 'فشل في توليد مهام النطاق' });
  }
});

export default router;
