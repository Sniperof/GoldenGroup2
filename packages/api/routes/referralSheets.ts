import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { resolveActingBranch } from '../services/authorizationService.js';
import {
  canCreateReferralSheet,
  canEditReferralSheet,
  getReferralSheetListAccessPlan,
} from '../policies/referralSheetPolicy.js';

const router = Router();
router.use(requireAuth);

const selectFields = `
  id, referral_type AS "referralType", referral_entity_id AS "referralEntityId",
  referral_name_snapshot AS "referralNameSnapshot", referral_address_text AS "referralAddressText",
  referral_origin_channel AS "referralOriginChannel", referral_notes AS "referralNotes",
  referral_date AS "referralDate", owner_user_id AS "ownerUserId", status,
  assigned_hr_user_id AS "assignedHrUserId",
  field_visit_id AS "fieldVisitId",
  total_candidates AS "totalCandidates", target_candidates AS "targetCandidates",
  quality_percentage AS "qualityPercentage", conversion_percentage AS "conversionPercentage",
  created_at AS "createdAt", created_by AS "createdBy",
  branch_id AS "branchId"
`;

const selectFieldsList = `
  rs.id, rs.referral_type AS "referralType", rs.referral_entity_id AS "referralEntityId",
  rs.referral_name_snapshot AS "referralNameSnapshot", rs.referral_address_text AS "referralAddressText",
  rs.referral_origin_channel AS "referralOriginChannel", rs.referral_notes AS "referralNotes",
  rs.referral_date AS "referralDate", rs.owner_user_id AS "ownerUserId", rs.status,
  rs.assigned_hr_user_id AS "assignedHrUserId",
  rs.field_visit_id AS "fieldVisitId",
  COALESCE(hu.name, team_hu.name, owner_hu.name) AS "assignedHrUserName",
  rs.total_candidates AS "totalCandidates", rs.target_candidates AS "targetCandidates",
  rs.quality_percentage AS "qualityPercentage",
  rs.conversion_percentage AS "conversionPercentage",
  rs.created_at AS "createdAt", rs.created_by AS "createdBy",
  rs.branch_id AS "branchId",
  b.name AS "branchName"
`;

type ReferralSheetSubject = {
  branchId: number | null;
  ownerUserId: number | null;
  assignedHrUserId: number | null;
};

type AssignedHrUserCheckResult =
  | { ok: true; assignedHrUserId: number | null }
  | { ok: false; error: string };

function canManageReferralSheetAssignment(authContext: ReturnType<typeof getRequiredAuthContext>, branchId: number | null): boolean {
  if (authContext.isSuperAdmin) return true;
  const grant =
    authContext.grants.find(item => item.permission === 'candidates.name_lists.edit') ??
    authContext.grants.find(item => item.permission === 'referral_sheets.edit');
  if (grant?.scope === 'GLOBAL') return true;
  if (grant?.scope === 'BRANCH' && branchId != null) {
    return authContext.allowedBranchIds.includes(branchId);
  }
  return false;
}

function mapRow(r: any) {
  return {
    ...r,
    stats: {
      totalCandidates: r.totalCandidates ?? 0,
      targetCandidates: r.targetCandidates ?? 0,
      qualityPercentage: r.qualityPercentage ?? 0,
      conversionPercentage: r.conversionPercentage ?? 0,
    },
    assignedHrUserName: r.assignedHrUserName ?? null,
    branchName: r.branchName ?? null,
  };
}

function enforcePersonalReferralSheet<T extends Record<string, any>>(
  payload: T,
  currentUser: { name: string },
): T {
  if (payload.referralType !== 'Personal') {
    return payload;
  }

  return {
    ...payload,
    referralNameSnapshot: currentUser.name,
    referralEntityId: null,
  };
}

function getRequiredAuthContext(req: any) {
  if (!req.authContext) {
    throw new Error('AuthContext is required after requirePermission');
  }

  return req.authContext;
}

function forbidReferralSheetAccess(res: any, reason?: string) {
  if (reason === 'MISSING_BRANCH_CONTEXT') {
    return res.status(400).json({ error: 'يجب تحديد الفرع المطلوب لهذه العملية' });
  }

  return res.status(403).json({ error: 'غير مسموح' });
}

function resolveReferralSheetTargetBranch(req: any, requestedBranchId?: number | string | null): number | null {
  const authContext = getRequiredAuthContext(req);

  return resolveActingBranch({
    headerBranchId: requestedBranchId ?? req.header('x-branch-id'),
    primaryBranchId: authContext.actingBranchId ?? authContext.allowedBranchIds[0] ?? null,
    allowedBranchIds: authContext.allowedBranchIds,
    isSuperAdmin: authContext.isSuperAdmin,
  });
}

function resolveReferralSheetListBranchFilter(req: any): number | null {
  const requestedBranchId = req.header('x-branch-id');
  if (requestedBranchId == null || requestedBranchId === '') {
    return null;
  }

  const normalized = Number(requestedBranchId);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

async function loadReferralSheetSubject(referralSheetId: string | number): Promise<ReferralSheetSubject | null> {
  const { rows } = await pool.query(
    `SELECT branch_id AS "branchId",
            owner_user_id AS "ownerUserId",
            assigned_hr_user_id AS "assignedHrUserId"
       FROM referral_sheets
      WHERE id = $1`,
    [referralSheetId],
  );

  return rows[0] ?? null;
}

async function assertAssignedHrUserExists(
  assignedHrUserId: unknown,
): Promise<AssignedHrUserCheckResult> {
  const normalized = Number(assignedHrUserId);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    return { ok: false, error: 'يجب تحديد assigned_hr_user_id صالح' };
  }

  const { rows } = await pool.query(
    'SELECT id FROM hr_users WHERE id = $1',
    [normalized],
  );

  if (!rows[0]) {
    return { ok: false, error: 'assigned_hr_user_id لا يشير إلى مستخدم HR صالح' };
  }

  return { ok: true, assignedHrUserId: normalized };
}

/**
 * @swagger
 * components:
 *   schemas:
 *     ReferralSheet:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         referralType:
 *           type: string
 *         referralEntityId:
 *           type: integer
 *         referralNameSnapshot:
 *           type: string
 *         referralAddressText:
 *           type: string
 *         referralOriginChannel:
 *           type: string
 *         referralNotes:
 *           type: string
 *         referralDate:
 *           type: string
 *         ownerUserId:
 *           type: integer
 *         status:
 *           type: string
 *         assignedHrUserId:
 *           type: integer
 *         totalCandidates:
 *           type: integer
 *         targetCandidates:
 *           type: integer
 *         qualityPercentage:
 *           type: number
 *         conversionPercentage:
 *           type: number
 *         createdAt:
 *           type: string
 *         createdBy:
 *           type: integer
 *         branchId:
 *           type: integer
 */

/**
 * @swagger
 * /api/referral-sheets:
 *   get:
 *     tags: [Referral Sheets]
 *     summary: Retrieve list of referral sheets
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ReferralSheet'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (No permission or outside branch scope)
 *       500:
 *         description: Server error
 */
router.get('/', requirePermission('candidates.name_lists.view_list', 'referral_sheets.view_list'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const requestedBranchId = resolveReferralSheetListBranchFilter(req);
    const listAccess = getReferralSheetListAccessPlan(authContext);

    if (!authContext.isSuperAdmin && authContext.allowedBranchIds.length === 0) {
      return res.status(403).json({ error: 'لا يوجد فرع فعّال متاح لهذه العملية' });
    }

    if (requestedBranchId != null && !authContext.isSuperAdmin && !authContext.allowedBranchIds.includes(requestedBranchId)) {
      return forbidReferralSheetAccess(res, 'BRANCH_FORBIDDEN');
    }

    if (listAccess.scope === 'NONE') {
      return forbidReferralSheetAccess(res, 'MISSING_PERMISSION');
    }

    const conditions: string[] = [];
    const params: any[] = [];

    if (requestedBranchId != null) {
      params.push(requestedBranchId);
      conditions.push(`rs.branch_id = $${params.length}`);
    }

    if (listAccess.scope === 'BRANCH') {
      params.push(authContext.allowedBranchIds);
      conditions.push(`rs.branch_id = ANY($${params.length}::int[])`);
    }

    if (listAccess.scope === 'ASSIGNED') {
      params.push(authContext.userId);
      conditions.push(`rs.assigned_hr_user_id = $${params.length}`);
      params.push(authContext.allowedBranchIds);
      conditions.push(`rs.branch_id = ANY($${params.length}::int[])`);
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT ${selectFieldsList}
       FROM referral_sheets rs
       LEFT JOIN hr_users hu ON hu.id = rs.assigned_hr_user_id
       LEFT JOIN field_visits fv ON fv.id = rs.field_visit_id
       LEFT JOIN hr_users team_hu ON team_hu.id = fv.team_responsible_user_id
       LEFT JOIN hr_users owner_hu ON owner_hu.id = rs.owner_user_id
       LEFT JOIN branches b ON b.id = rs.branch_id
       ${where}
       ORDER BY rs.id DESC`,
      params,
    );
    res.json(rows.map(mapRow));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/referral-sheets:
 *   post:
 *     tags: [Referral Sheets]
 *     summary: Create new referral sheet
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [referralType]
 *             properties:
 *               referralType:
 *                 type: string
 *               referralEntityId:
 *                 type: integer
 *               referralNameSnapshot:
 *                 type: string
 *               branchId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReferralSheet'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (No permission or outside branch scope)
 *       500:
 *         description: Server error
 */
router.post('/', requirePermission('candidates.name_lists.create', 'referral_sheets.create'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const targetBranchId = resolveReferralSheetTargetBranch(req, req.body?.branchId);
    if (targetBranchId == null) {
      return res.status(400).json({ error: 'يجب تحديد الفرع المستهدف لهذه العملية' });
    }

    const canManageAssignment = canManageReferralSheetAssignment(authContext, targetBranchId);
    const requestedAssignedHrUserId = canManageAssignment ? req.body?.assignedHrUserId : authContext.userId;
    const assignedHrUserCheck = requestedAssignedHrUserId == null || requestedAssignedHrUserId === ''
      ? { ok: true as const, assignedHrUserId: authContext.userId }
      : await assertAssignedHrUserExists(requestedAssignedHrUserId);
    if ('error' in assignedHrUserCheck) {
      return res.status(400).json({ error: assignedHrUserCheck.error });
    }

    const createAccess = canCreateReferralSheet(authContext, {
      branchId: targetBranchId,
      assignedHrUserId: assignedHrUserCheck.assignedHrUserId,
    });
    if (!createAccess.allowed) {
      return forbidReferralSheetAccess(res, createAccess.reason);
    }

    const s = enforcePersonalReferralSheet(req.body ?? {}, { name: req.user?.name || '' });
    const targetCandidates = Number.isInteger(req.body?.targetCandidates) ? req.body.targetCandidates : 0;
    const referralDate = s.referralDate || new Date().toISOString();
    const { rows } = await pool.query(
      `INSERT INTO referral_sheets (referral_type, referral_entity_id, referral_name_snapshot,
        referral_address_text, referral_origin_channel, referral_notes, referral_date,
        owner_user_id, status, assigned_hr_user_id, total_candidates, target_candidates,
        quality_percentage, conversion_percentage, created_by, branch_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING ${selectFields}, target_candidates AS "targetCandidates"`,
      [s.referralType, s.referralEntityId || null, s.referralNameSnapshot || '',
       s.referralAddressText || '', s.referralOriginChannel || null, s.referralNotes || null,
       referralDate, canManageAssignment ? (s.ownerUserId ?? authContext.userId) : authContext.userId, s.status || 'New',
       assignedHrUserCheck.assignedHrUserId,
       s.stats?.totalCandidates || 0, targetCandidates,
       s.stats?.qualityPercentage || 0,
       s.stats?.conversionPercentage || 0, s.createdBy ?? authContext.userId, targetBranchId],
    );
    res.json(mapRow(rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/referral-sheets/{id}:
 *   put:
 *     tags: [Referral Sheets]
 *     summary: Update referral sheet details by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Referral Sheet ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               referralType:
 *                 type: string
 *               status:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReferralSheet'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (No permission or outside branch scope)
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
router.put('/:id', requirePermission('candidates.name_lists.edit', 'referral_sheets.edit'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const referralSheetId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const existingSubject = await loadReferralSheetSubject(referralSheetId!);
    if (!existingSubject) {
      return res.status(404).json({ error: 'Referral sheet not found' });
    }

    const editAccess = canEditReferralSheet(authContext, existingSubject);
    if (!editAccess.allowed) {
      return forbidReferralSheetAccess(res, editAccess.reason);
    }

    const { rows: existingRows } = await pool.query(
      `SELECT ${selectFields} FROM referral_sheets WHERE id=$1`,
      [referralSheetId],
    );
    const current = existingRows[0];
    if (!current) {
      return res.status(404).json({ error: 'Referral sheet not found' });
    }

    const requestedBranchId = req.body?.branchId;
    const resolvedBranchId = requestedBranchId !== undefined
      ? resolveReferralSheetTargetBranch(req, requestedBranchId)
      : current.branchId;
    if (resolvedBranchId == null) {
      return res.status(400).json({ error: 'يجب تحديد الفرع المستهدف لهذه العملية' });
    }

    const canManageAssignment = canManageReferralSheetAssignment(authContext, resolvedBranchId);
    const assignedHrUserCheck = canManageAssignment && req.body?.assignedHrUserId !== undefined
      ? await assertAssignedHrUserExists(req.body.assignedHrUserId)
      : { ok: true as const, assignedHrUserId: current.assignedHrUserId };
    if ('error' in assignedHrUserCheck) {
      return res.status(400).json({ error: assignedHrUserCheck.error });
    }

    const targetAccess = canEditReferralSheet(authContext, {
      branchId: resolvedBranchId,
      assignedHrUserId: assignedHrUserCheck.assignedHrUserId ?? null,
    });
    if (!targetAccess.allowed) {
      return forbidReferralSheetAccess(res, targetAccess.reason);
    }

    const s = enforcePersonalReferralSheet(req.body ?? {}, { name: req.user?.name || '' });
    const merged = {
      referralType: s.referralType ?? current.referralType,
      referralEntityId: s.referralEntityId !== undefined ? s.referralEntityId : current.referralEntityId,
      referralNameSnapshot: s.referralNameSnapshot ?? current.referralNameSnapshot,
      referralAddressText: s.referralAddressText ?? current.referralAddressText,
      referralOriginChannel: s.referralOriginChannel ?? current.referralOriginChannel,
      referralNotes: s.referralNotes ?? current.referralNotes,
      referralDate: s.referralDate ?? current.referralDate,
      ownerUserId: canManageAssignment ? (s.ownerUserId ?? current.ownerUserId) : current.ownerUserId,
      assignedHrUserId: assignedHrUserCheck.assignedHrUserId ?? null,
      status: s.status ?? current.status,
      totalCandidates: s.stats?.totalCandidates ?? current.totalCandidates,
      qualityPercentage: s.stats?.qualityPercentage ?? current.qualityPercentage,
      conversionPercentage: s.stats?.conversionPercentage ?? current.conversionPercentage,
      branchId: resolvedBranchId,
    };

    const { rows } = await pool.query(
      `UPDATE referral_sheets SET referral_type=$1, referral_entity_id=$2, referral_name_snapshot=$3,
        referral_address_text=$4, referral_origin_channel=$5, referral_notes=$6, referral_date=$7,
        owner_user_id=$8, status=$9, assigned_hr_user_id=$10, total_candidates=$11, quality_percentage=$12,
        conversion_percentage=$13, branch_id=$14
      WHERE id=$15 RETURNING ${selectFields}`,
      [merged.referralType, merged.referralEntityId || null, merged.referralNameSnapshot || '',
       merged.referralAddressText || '', merged.referralOriginChannel || null, merged.referralNotes || null,
       merged.referralDate || null, merged.ownerUserId, merged.status || 'New',
       merged.assignedHrUserId,
       merged.totalCandidates || 0, merged.qualityPercentage || 0,
       merged.conversionPercentage || 0, merged.branchId, referralSheetId],
    );
    res.json(mapRow(rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
