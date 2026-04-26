import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { resolveActingBranch } from '../services/authorizationService.js';
import {
  canCreateCandidate,
  canDeleteCandidate,
  canEditCandidate,
  getCandidateListAccessPlan,
  canViewCandidate,
} from '../policies/candidatePolicy.js';

const router = Router();
router.use(requireAuth);

const selectFields = `
  id, first_name AS "firstName", last_name AS "lastName", nickname, mobile,
  contacts, address_text AS "addressText", geo_unit_id AS "geoUnitId", owner_user_id AS "ownerUserId",
  status, referral_sheet_id AS "referralSheetId",
  referral_date AS "referralDate", referral_reason AS "referralReason",
  referral_type AS "referralType", referral_origin_channel AS "referralOriginChannel",
  referral_name_snapshot AS "referralNameSnapshot", referral_entity_id AS "referralEntityId",
  referral_confirmation_status AS "referralConfirmationStatus",
  occupation, candidate_notes AS "candidateNotes",
  duplicate_flag AS "duplicateFlag", duplicate_type AS "duplicateType",
  duplicate_reference_id AS "duplicateReferenceId",
  converted_to_lead_id AS "convertedToLeadId",
  created_at AS "createdAt", created_by AS "createdBy",
  branch_id AS "branchId"
`;

const selectFieldsList = `
  c.id, c.first_name AS "firstName", c.last_name AS "lastName", c.nickname, c.mobile,
  c.contacts, c.address_text AS "addressText", c.geo_unit_id AS "geoUnitId", c.owner_user_id AS "ownerUserId",
  c.status, c.referral_sheet_id AS "referralSheetId",
  c.referral_date AS "referralDate", c.referral_reason AS "referralReason",
  c.referral_type AS "referralType", c.referral_origin_channel AS "referralOriginChannel",
  c.referral_name_snapshot AS "referralNameSnapshot", c.referral_entity_id AS "referralEntityId",
  c.referral_confirmation_status AS "referralConfirmationStatus",
  c.occupation, c.candidate_notes AS "candidateNotes",
  c.duplicate_flag AS "duplicateFlag", c.duplicate_type AS "duplicateType",
  c.duplicate_reference_id AS "duplicateReferenceId",
  c.converted_to_lead_id AS "convertedToLeadId",
  c.created_at AS "createdAt", c.created_by AS "createdBy",
  c.branch_id AS "branchId",
  b.name AS "branchName",
  rs.assigned_hr_user_id AS "assignedHrUserId",
  hu.name AS "assignedHrUserName"
`;

type CandidateSubject = {
  branchId: number | null;
  ownerUserId: number | null;
};

function getRequiredAuthContext(req: any) {
  if (!req.authContext) {
    throw new Error('AuthContext is required after requirePermission');
  }

  return req.authContext;
}

function forbidCandidateAccess(res: any, reason?: string) {
  if (reason === 'MISSING_BRANCH_CONTEXT') {
    return res.status(400).json({ error: 'يجب تحديد الفرع المطلوب لهذه العملية' });
  }

  return res.status(403).json({ error: 'غير مسموح' });
}

function resolveCandidateTargetBranch(req: any, requestedBranchId?: number | string | null): number | null {
  const authContext = getRequiredAuthContext(req);

  return resolveActingBranch({
    headerBranchId: requestedBranchId ?? req.header('x-branch-id'),
    primaryBranchId: authContext.actingBranchId ?? authContext.allowedBranchIds[0] ?? null,
    allowedBranchIds: authContext.allowedBranchIds,
    isSuperAdmin: authContext.isSuperAdmin,
  });
}

function resolveCandidateListBranchFilter(req: any): number | null {
  const requestedBranchId = req.header('x-branch-id');
  if (requestedBranchId == null || requestedBranchId === '') {
    return null;
  }

  const normalized = Number(requestedBranchId);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

async function loadCandidateSubject(candidateId: string | number): Promise<CandidateSubject | null> {
  const { rows } = await pool.query(
    `SELECT branch_id AS "branchId", owner_user_id AS "ownerUserId"
       FROM candidates
      WHERE id = $1`,
    [candidateId],
  );

  return rows[0] ?? null;
}

router.get('/', requirePermission('candidates.view_list'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const requestedBranchId = resolveCandidateListBranchFilter(req);
    const listAccess = getCandidateListAccessPlan(authContext);

    if (!authContext.isSuperAdmin && authContext.allowedBranchIds.length === 0) {
      return res.status(403).json({ error: 'لا يوجد فرع فعّال متاح لهذه العملية' });
    }

    if (requestedBranchId != null && !authContext.isSuperAdmin && !authContext.allowedBranchIds.includes(requestedBranchId)) {
      return forbidCandidateAccess(res, 'BRANCH_FORBIDDEN');
    }

    if (listAccess.scope === 'NONE') {
      return forbidCandidateAccess(res, 'MISSING_PERMISSION');
    }

    const conditions: string[] = [];
    const params: any[] = [];

    if (requestedBranchId != null) {
      params.push(requestedBranchId);
      conditions.push(`c.branch_id = $${params.length}`);
    }

    if (listAccess.scope === 'BRANCH') {
      params.push(authContext.allowedBranchIds);
      conditions.push(`c.branch_id = ANY($${params.length}::int[])`);
    }

    if (listAccess.scope === 'ASSIGNED') {
      params.push(authContext.userId);
      conditions.push(`c.owner_user_id = $${params.length}`);
      params.push(authContext.allowedBranchIds);
      conditions.push(`c.branch_id = ANY($${params.length}::int[])`);
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT ${selectFieldsList}
       FROM candidates c
       LEFT JOIN branches b ON b.id = c.branch_id
       LEFT JOIN referral_sheets rs ON rs.id = c.referral_sheet_id
       LEFT JOIN hr_users hu ON hu.id = rs.assigned_hr_user_id
       ${where}
       ORDER BY c.id`,
      params,
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requirePermission('candidates.create'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const targetBranchId = resolveCandidateTargetBranch(req, req.body?.branchId);
    if (targetBranchId == null) {
      return res.status(400).json({ error: 'يجب تحديد الفرع المستهدف لهذه العملية' });
    }

    const requestedOwnerUserId = Number(req.body?.ownerUserId);
    const ownerUserId = authContext.isSuperAdmin && Number.isInteger(requestedOwnerUserId) && requestedOwnerUserId > 0
      ? requestedOwnerUserId
      : authContext.userId;

    const createAccess = canCreateCandidate(authContext, {
      branchId: targetBranchId,
      ownerUserId,
    });
    if (!createAccess.allowed) {
      return forbidCandidateAccess(res, createAccess.reason);
    }

    const c = req.body;
    const { rows } = await pool.query(
      `INSERT INTO candidates (first_name, last_name, nickname, mobile, contacts, address_text, geo_unit_id,
        owner_user_id, status, referral_sheet_id, referral_date, referral_reason,
        referral_type, referral_origin_channel, referral_name_snapshot, referral_entity_id,
        referral_confirmation_status, occupation, candidate_notes, duplicate_flag, duplicate_type,
        duplicate_reference_id, converted_to_lead_id, created_by, branch_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
      RETURNING ${selectFields}`,
      [c.firstName, c.lastName || null, c.nickname, c.mobile, JSON.stringify(c.contacts || []), c.addressText || '', c.geoUnitId || null,
       ownerUserId, c.status || 'Suggested', c.referralSheetId || null,
       c.referralDate || null, c.referralReason || null, c.referralType || null,
       c.referralOriginChannel || null, c.referralNameSnapshot || null,
       c.referralEntityId || null, c.referralConfirmationStatus || 'Pending',
       c.occupation || null, c.candidateNotes || null, c.duplicateFlag || false, c.duplicateType || null,
       c.duplicateReferenceId || null, c.convertedToLeadId || null, c.createdBy ?? authContext.userId,
       targetBranchId]
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requirePermission('candidates.edit'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const candidateId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const existing = await loadCandidateSubject(candidateId!);
    if (!existing) {
      return res.status(404).json({ message: 'المرشح غير موجود' });
    }

    const editAccess = canEditCandidate(authContext, existing);
    if (!editAccess.allowed) {
      return forbidCandidateAccess(res, editAccess.reason);
    }

    const c = req.body;
    const { rows } = await pool.query(
      `UPDATE candidates SET first_name=$1, last_name=$2, nickname=$3, mobile=$4,
        contacts=$5, address_text=$6, geo_unit_id=$7, owner_user_id=$8, status=$9, referral_sheet_id=$10,
        referral_date=$11, referral_reason=$12, referral_type=$13, referral_origin_channel=$14,
        referral_name_snapshot=$15, referral_entity_id=$16, referral_confirmation_status=$17,
        occupation=$18, candidate_notes=$19, duplicate_flag=$20, duplicate_type=$21,
        duplicate_reference_id=$22, converted_to_lead_id=$23, created_by=$24
      WHERE id=$25 RETURNING ${selectFields}`,
      [c.firstName, c.lastName || null, c.nickname, c.mobile, JSON.stringify(c.contacts || []), c.addressText || '', c.geoUnitId || null,
       c.ownerUserId || null, c.status || 'Suggested', c.referralSheetId || null,
       c.referralDate || null, c.referralReason || null, c.referralType || null,
       c.referralOriginChannel || null, c.referralNameSnapshot || null,
       c.referralEntityId || null, c.referralConfirmationStatus || 'Pending',
       c.occupation || null, c.candidateNotes || null, c.duplicateFlag || false, c.duplicateType || null,
       c.duplicateReferenceId || null, c.convertedToLeadId || null, c.createdBy || null,
       candidateId]
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requirePermission('candidates.delete'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const candidateId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const existing = await loadCandidateSubject(candidateId!);
    if (!existing) {
      return res.status(404).json({ message: 'المرشح غير موجود' });
    }

    const deleteAccess = canDeleteCandidate(authContext, existing);
    if (!deleteAccess.allowed) {
      return forbidCandidateAccess(res, deleteAccess.reason);
    }

    await pool.query('DELETE FROM candidates WHERE id = $1', [candidateId]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
