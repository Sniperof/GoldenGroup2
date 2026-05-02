import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Helper: extract branch-scoped auth context
function getAuthContext(req: any) {
  if (!req.authContext) {
    throw new Error('AuthContext is required');
  }
  return req.authContext as {
    userId: number;
    isSuperAdmin: boolean;
    grants: Array<{ key: string; scope: string }>;
    [key: string]: any;
  };
}

function getBranchId(req: any): number | null {
  const raw = req.header('x-branch-id');
  if (!raw) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

// GET /open-tasks — list open tasks filtered by branch_id (required), status, task_type
router.get('/', async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const branchId = Number(req.query.branchId);
    if (!branchId || !Number.isFinite(branchId)) {
      return res.status(400).json({ error: 'يجب تحديد الفرع' });
    }

    const statusFilter = req.query.status as string | undefined;
    const taskTypeFilter = req.query.taskType as string | undefined;

    const params: any[] = [branchId];
    let paramIdx = 2;

    let statusCondition = '';
    if (statusFilter) {
      statusCondition = `AND ot.status = $${paramIdx}`;
      params.push(statusFilter);
      paramIdx++;
    }

    let taskTypeCondition = '';
    if (taskTypeFilter) {
      taskTypeCondition = `AND ot.task_type = $${paramIdx}`;
      params.push(taskTypeFilter);
      paramIdx++;
    }

    const query = `
      SELECT ot.*,
        c.name AS "clientName",
        c.mobile AS "clientMobile",
        c.neighborhood AS "clientNeighborhood",
        c.governorate AS "clientGovernorate",
        c.district AS "clientDistrict",
        b.name AS "branchName",
        creator.name AS "createdByName",
        COALESCE(
          (SELECT json_agg(json_build_object(
             'userId', u2.id,
             'userName', u2.name,
             'roleDisplayName', COALESCE(r2.display_name, u2.role)
           ) ORDER BY ca.assigned_at)
           FROM client_assignments ca
           JOIN hr_users u2 ON u2.id = ca.hr_user_id
           LEFT JOIN roles r2 ON r2.id = u2.role_id
           WHERE ca.client_id = c.id),
          '[]'::json
        ) AS "assignments"
      FROM open_tasks ot
      JOIN clients c ON c.id = ot.client_id
      LEFT JOIN branches b ON b.id = ot.branch_id
      LEFT JOIN hr_users creator ON creator.id = ot.created_by
      WHERE ot.branch_id = $1
        ${statusCondition}
        ${taskTypeCondition}
      ORDER BY ot.created_at DESC
    `;

    const { rows } = await pool.query(query, params);

    // Convert snake_case to camelCase for frontend
    const tasks = rows.map(row => ({
      id: row.id,
      clientId: row.client_id,
      branchId: row.branch_id,
      taskType: row.task_type,
      taskFamily: row.task_family,
      reason: row.reason,
      status: row.status,
      dueDate: row.due_date,
      priority: row.priority,
      source: row.source,
      marketingVisitTaskId: row.marketing_visit_task_id,
      contactTargetId: row.contact_target_id,
      notes: row.notes,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      clientName: row.clientName,
      clientMobile: row.clientMobile,
      clientNeighborhood: row.clientNeighborhood,
      clientGovernorate: row.clientGovernorate,
      clientDistrict: row.clientDistrict,
      branchName: row.branchName,
      createdByName: row.createdByName,
      assignments: row.assignments,
    }));

    res.json(tasks);
  } catch (err: any) {
    console.error('[open-tasks] GET / error:', err);
    res.status(500).json({ error: 'فشل في تحميل المهام' });
  }
});

// GET /open-tasks/:id — single task
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'معرف المهمة غير صالح' });
    }

    const query = `
      SELECT ot.*,
        c.name AS "clientName",
        c.mobile AS "clientMobile",
        c.neighborhood AS "clientNeighborhood",
        c.governorate AS "clientGovernorate",
        c.district AS "clientDistrict",
        b.name AS "branchName",
        creator.name AS "createdByName",
        COALESCE(
          (SELECT json_agg(json_build_object(
             'userId', u2.id,
             'userName', u2.name,
             'roleDisplayName', COALESCE(r2.display_name, u2.role)
           ) ORDER BY ca.assigned_at)
           FROM client_assignments ca
           JOIN hr_users u2 ON u2.id = ca.hr_user_id
           LEFT JOIN roles r2 ON r2.id = u2.role_id
           WHERE ca.client_id = c.id),
          '[]'::json
        ) AS "assignments"
      FROM open_tasks ot
      JOIN clients c ON c.id = ot.client_id
      LEFT JOIN branches b ON b.id = ot.branch_id
      LEFT JOIN hr_users creator ON creator.id = ot.created_by
      WHERE ot.id = $1
    `;

    const { rows } = await pool.query(query, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'المهمة غير موجودة' });
    }

    const row = rows[0];
    const task = {
      id: row.id,
      clientId: row.client_id,
      branchId: row.branch_id,
      taskType: row.task_type,
      taskFamily: row.task_family,
      reason: row.reason,
      status: row.status,
      dueDate: row.due_date,
      priority: row.priority,
      source: row.source,
      marketingVisitTaskId: row.marketing_visit_task_id,
      contactTargetId: row.contact_target_id,
      notes: row.notes,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      clientName: row.clientName,
      clientMobile: row.clientMobile,
      clientNeighborhood: row.clientNeighborhood,
      clientGovernorate: row.clientGovernorate,
      clientDistrict: row.clientDistrict,
      branchName: row.branchName,
      createdByName: row.createdByName,
      assignments: row.assignments,
    };

    res.json(task);
  } catch (err: any) {
    console.error('[open-tasks] GET /:id error:', err);
    res.status(500).json({ error: 'فشل في تحميل المهمة' });
  }
});

// PATCH /open-tasks/:id — update status, notes, due_date, priority
router.patch('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'معرف المهمة غير صالح' });
    }

    const allowedFields = ['status', 'notes', 'due_date', 'priority'];
    const updates: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${paramIdx}`);
        values.push(req.body[field]);
        paramIdx++;
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'لا توجد حقول للتحديث' });
    }

    // Always update updated_at
    updates.push(`updated_at = NOW()`);
    values.push(id);

    const updateQuery = `UPDATE open_tasks SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`;
    const { rows: [updated] } = await pool.query(updateQuery, values);

    if (!updated) {
      return res.status(404).json({ error: 'المهمة غير موجودة' });
    }

    // Fetch the full task with joins
    const { rows: [fullTask] } = await pool.query(`
      SELECT ot.*,
        c.name AS "clientName",
        c.mobile AS "clientMobile",
        c.neighborhood AS "clientNeighborhood",
        c.governorate AS "clientGovernorate",
        c.district AS "clientDistrict",
        b.name AS "branchName",
        creator.name AS "createdByName",
        COALESCE(
          (SELECT json_agg(json_build_object(
             'userId', u2.id,
             'userName', u2.name,
             'roleDisplayName', COALESCE(r2.display_name, u2.role)
           ) ORDER BY ca.assigned_at)
           FROM client_assignments ca
           JOIN hr_users u2 ON u2.id = ca.hr_user_id
           LEFT JOIN roles r2 ON r2.id = u2.role_id
           WHERE ca.client_id = c.id),
          '[]'::json
        ) AS "assignments"
      FROM open_tasks ot
      JOIN clients c ON c.id = ot.client_id
      LEFT JOIN branches b ON b.id = ot.branch_id
      LEFT JOIN hr_users creator ON creator.id = ot.created_by
      WHERE ot.id = $1
    `, [updated.id]);

    const row = fullTask || updated;
    res.json({
      id: row.id,
      clientId: row.client_id,
      branchId: row.branch_id,
      taskType: row.task_type,
      taskFamily: row.task_family,
      reason: row.reason,
      status: row.status,
      dueDate: row.due_date,
      priority: row.priority,
      source: row.source,
      marketingVisitTaskId: row.marketing_visit_task_id,
      contactTargetId: row.contact_target_id,
      notes: row.notes,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      clientName: row.clientName ?? null,
      clientMobile: row.clientMobile ?? null,
      clientNeighborhood: row.clientNeighborhood ?? null,
      clientGovernorate: row.clientGovernorate ?? null,
      clientDistrict: row.clientDistrict ?? null,
      branchName: row.branchName ?? null,
      createdByName: row.createdByName ?? null,
      assignments: row.assignments ?? [],
    });
  } catch (err: any) {
    console.error('[open-tasks] PATCH /:id error:', err);
    res.status(500).json({ error: 'فشل في تحديث المهمة' });
  }
});

export default router;