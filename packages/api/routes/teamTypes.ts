// Team types catalog (DEC-026). The catalog is company-wide and managed with
// planning.team_types.manage; each branch picks the types it schedules with
// under planning.manage on that branch.

import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { authorize } from '../services/authorizationService.js';
import {
  TeamTypeError,
  createTeamType,
  listBranchTeamTypeIds,
  listTeamTypes,
  setBranchTeamTypes,
  setTeamTypeActive,
  updateTeamType,
} from '../services/teamTypes.js';

const router = Router();
router.use(requireAuth);

const MANAGE = 'planning.team_types.manage';
const READ_KEYS = [MANAGE, 'planning.view', 'planning.manage'];

function getAuthContext(req: any) {
  if (!req.authContext) throw new Error('AuthContext is required');
  return req.authContext as {
    userId: number;
    isSuperAdmin: boolean;
    actingBranchId: number | null;
    [key: string]: any;
  };
}

function sendError(res: any, err: unknown, logLabel: string, fallback: string) {
  if (err instanceof TeamTypeError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  console.error(`[team-types] ${logLabel} error:`, err);
  return res.status(500).json({ error: fallback });
}

function parseId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** GET /api/team-types — the catalog. ?includeInactive=1 needs the manage key. */
router.get('/', requirePermission(...READ_KEYS), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const includeInactive = req.query.includeInactive === '1'
      && authorize(authContext as any, { permission: MANAGE }).allowed;
    res.json(await listTeamTypes(pool, { includeInactive }));
  } catch (err) {
    sendError(res, err, 'GET /', 'فشل في تحميل أنواع الفرق');
  }
});

/**
 * GET /api/team-types/options — what a type can be built from: every role (a
 * slot accepts a list of roles) and every task type grouped by family (D5).
 * Served here so editing types does not also need admin.roles.view.
 */
router.get('/options', requirePermission(MANAGE), async (_req, res) => {
  try {
    const [{ rows: roles }, { rows: taskTypes }] = await Promise.all([
      pool.query(
        `SELECT id, name, COALESCE(NULLIF(display_name, ''), name) AS "displayName", team_slot_type AS "legacySlot"
           FROM roles
          WHERE is_active IS NOT FALSE
          ORDER BY COALESCE(NULLIF(display_name, ''), name)`,
      ),
      pool.query(
        `SELECT task_type AS "taskType", task_family AS "taskFamily", arabic_label AS label, is_active AS "isActive"
           FROM task_type_config
          ORDER BY task_family, display_order, task_type`,
      ),
    ]);
    res.json({ roles, taskTypes });
  } catch (err) {
    sendError(res, err, 'GET /options', 'فشل في تحميل خيارات أنواع الفرق');
  }
});

router.post('/', requirePermission(MANAGE), async (req, res) => {
  try {
    res.status(201).json(await createTeamType(req.body, getAuthContext(req).userId));
  } catch (err) {
    sendError(res, err, 'POST /', 'فشل في إنشاء نوع الفريق');
  }
});

router.patch('/:id/active', requirePermission(MANAGE), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'معرف نوع الفريق غير صالح' });
  if (typeof req.body?.isActive !== 'boolean') {
    return res.status(400).json({ error: 'isActive مطلوب' });
  }
  try {
    res.json(await setTeamTypeActive(id, req.body.isActive, getAuthContext(req).userId));
  } catch (err) {
    sendError(res, err, 'PATCH /:id/active', 'فشل في تغيير حالة نوع الفريق');
  }
});

// Branch selection. The branch follows the switcher (actingBranchId); a super
// admin may name another branch with ?branchId, like the other planning reads.
function resolveBranchId(req: any): number | null {
  const authContext = getAuthContext(req);
  const queryBranchId = parseId(req.query.branchId);
  return authContext.isSuperAdmin && queryBranchId ? queryBranchId : authContext.actingBranchId;
}

router.get('/branch', requirePermission(...READ_KEYS), async (req, res) => {
  const branchId = resolveBranchId(req);
  if (!branchId) return res.status(400).json({ error: 'يجب تحديد الفرع' });
  try {
    res.json({ branchId, teamTypeIds: await listBranchTeamTypeIds(pool, branchId) });
  } catch (err) {
    sendError(res, err, 'GET /branch', 'فشل في تحميل أنواع فرق الفرع');
  }
});

router.put('/branch', requirePermission('planning.manage'), async (req, res) => {
  const authContext = getAuthContext(req);
  const branchId = resolveBranchId(req);
  if (!branchId) return res.status(400).json({ error: 'يجب تحديد الفرع' });
  if (!authorize(authContext as any, { permission: 'planning.manage', branchId }).allowed) {
    return res.status(403).json({ error: 'غير مسموح بتعديل أنواع فرق هذا الفرع' });
  }
  try {
    const teamTypeIds = await setBranchTeamTypes(branchId, req.body?.teamTypeIds, authContext.userId);
    res.json({ branchId, teamTypeIds });
  } catch (err) {
    sendError(res, err, 'PUT /branch', 'فشل في حفظ أنواع فرق الفرع');
  }
});

// Declared after /branch so "PUT /branch" is not taken for an id.
router.put('/:id', requirePermission(MANAGE), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'معرف نوع الفريق غير صالح' });
  try {
    res.json(await updateTeamType(id, req.body, getAuthContext(req).userId));
  } catch (err) {
    sendError(res, err, 'PUT /:id', 'فشل في تعديل نوع الفريق');
  }
});

export default router;
