import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { resolveActingBranch } from '../services/authorizationService.js';
import {
  canCreateReferralSheet,
  canEditReferralSheet,
  canListReferralSheets,
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

router.get('/', requirePermission('referral_sheets.view_list'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const targetBranchId = resolveReferralSheetTargetBranch(req);

    if (!authContext.isSuperAdmin && targetBranchId == null) {
      return res.status(403).json({ error: 'لا يوجد فرع فعّال متاح لهذه العملية' });
    }

    if (targetBranchId != null) {
      const access = canListReferralSheets(authContext, targetBranchId);
      if (!access.allowed) {
        return forbidReferralSheetAccess(res, access.reason);
      }
    }

    if (authContext.isSuperAdmin && targetBranchId == null) {
      const { rows } = await pool.query(`SELECT ${selectFields} FROM referral_sheets ORDER BY id DESC`);
      return res.json(rows.map(mapRow));
    }

    const { rows } = await pool.query(
      `SELECT ${selectFields} FROM referral_sheets WHERE branch_id = $1 ORDER BY id DESC`,
      [targetBranchId],
    );
    res.json(rows.map(mapRow));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requirePermission('referral_sheets.create'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const targetBranchId = resolveReferralSheetTargetBranch(req, req.body?.branchId);
    if (targetBranchId == null) {
      return res.status(400).json({ error: 'يجب تحديد الفرع المستهدف لهذه العملية' });
    }

    const assignedHrUserCheck = await assertAssignedHrUserExists(req.body?.assignedHrUserId);
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

    const s = req.body;
    const { rows } = await pool.query(
      `INSERT INTO referral_sheets (referral_type, referral_entity_id, referral_name_snapshot,
        referral_address_text, referral_origin_channel, referral_notes, referral_date,
        owner_user_id, status, assigned_hr_user_id, total_candidates, quality_percentage, conversion_percentage, created_by, branch_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING ${selectFields}`,
      [s.referralType, s.referralEntityId || null, s.referralNameSnapshot || '',
       s.referralAddressText || '', s.referralOriginChannel || null, s.referralNotes || null,
       s.referralDate || null, s.ownerUserId, s.status || 'New',
       assignedHrUserCheck.assignedHrUserId,
       s.stats?.totalCandidates || 0, s.stats?.qualityPercentage || 0,
       s.stats?.conversionPercentage || 0, s.createdBy || null, targetBranchId],
    );
    res.json(mapRow(rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requirePermission('referral_sheets.edit'), async (req, res) => {
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

    const s = req.body;
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
