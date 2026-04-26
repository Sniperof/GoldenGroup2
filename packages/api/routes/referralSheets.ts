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
  total_candidates AS "totalCandidates", quality_percentage AS "qualityPercentage",
  conversion_percentage AS "conversionPercentage",
  created_at AS "createdAt", created_by AS "createdBy",
  branch_id AS "branchId"
`;

const selectFieldsList = `
  rs.id, rs.referral_type AS "referralType", rs.referral_entity_id AS "referralEntityId",
  rs.referral_name_snapshot AS "referralNameSnapshot", rs.referral_address_text AS "referralAddressText",
  rs.referral_origin_channel AS "referralOriginChannel", rs.referral_notes AS "referralNotes",
  rs.referral_date AS "referralDate", rs.owner_user_id AS "ownerUserId", rs.status,
  rs.assigned_hr_user_id AS "assignedHrUserId",
  hu.name AS "assignedHrUserName",
  rs.total_candidates AS "totalCandidates", rs.quality_percentage AS "qualityPercentage",
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

function mapRow(r: any) {
  return {
    ...r,
    stats: {
      totalCandidates: r.totalCandidates,
      qualityPercentage: r.qualityPercentage,
      conversionPercentage: r.conversionPercentage,
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
    referralOriginChannel: 'Acquaintance',
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

router.post('/', requirePermission('candidates.name_lists.create', 'referral_sheets.create'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const targetBranchId = resolveReferralSheetTargetBranch(req, req.body?.branchId);
    if (targetBranchId == null) {
      return res.status(400).json({ error: 'يجب تحديد الفرع المستهدف لهذه العملية' });
    }

    const requestedAssignedHrUserId = req.body?.assignedHrUserId;
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
    const { rows } = await pool.query(
      `INSERT INTO referral_sheets (referral_type, referral_entity_id, referral_name_snapshot,
        referral_address_text, referral_origin_channel, referral_notes, referral_date,
        owner_user_id, status, assigned_hr_user_id, total_candidates, quality_percentage, conversion_percentage, created_by, branch_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING ${selectFields}`,
      [s.referralType, s.referralEntityId || null, s.referralNameSnapshot || '',
       s.referralAddressText || '', s.referralOriginChannel || null, s.referralNotes || null,
       s.referralDate || null, s.ownerUserId ?? authContext.userId, s.status || 'New',
       assignedHrUserCheck.assignedHrUserId,
       s.stats?.totalCandidates || 0, s.stats?.qualityPercentage || 0,
       s.stats?.conversionPercentage || 0, s.createdBy ?? authContext.userId, targetBranchId],
    );
    res.json(mapRow(rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

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

    const assignedHrUserCheck = req.body?.assignedHrUserId !== undefined
      ? await assertAssignedHrUserExists(req.body.assignedHrUserId)
      : { ok: true as const, assignedHrUserId: current.assignedHrUserId };
    if ('error' in assignedHrUserCheck) {
      return res.status(400).json({ error: assignedHrUserCheck.error });
    }

    const requestedBranchId = req.body?.branchId;
    const resolvedBranchId = requestedBranchId !== undefined
      ? resolveReferralSheetTargetBranch(req, requestedBranchId)
      : current.branchId;
    if (resolvedBranchId == null) {
      return res.status(400).json({ error: 'يجب تحديد الفرع المستهدف لهذه العملية' });
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
      ownerUserId: s.ownerUserId ?? current.ownerUserId,
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
