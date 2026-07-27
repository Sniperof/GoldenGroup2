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
import { canViewClient } from '../policies/clientPolicy.js';
import { eligibleHrUserWithPermissionCondition } from '../services/assigneeEligibility.js';
import { buildClientLifecycleStatusSql } from '../services/customerOwnership.js';
import {
  assertEligibleCandidateResponsible,
  CandidateOwnershipError,
  hasCandidateOwnershipPayload,
  replaceCandidateOwnership,
  resolveCandidateOwnershipInput,
  validateCandidateOwnershipDecision,
  type CandidateOwnershipDecision,
} from '../services/candidateOwnershipService.js';
import {
  getCanonicalContactNumber,
  normalizeContactsForWrite,
  normalizePhone,
} from '../utils/contactValidation.js';

const router = Router();
router.use(requireAuth);

function currentDateKey(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Damascus',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const valueByType = new Map(parts.map(part => [part.type, part.value]));
  return `${valueByType.get('year')}-${valueByType.get('month')}-${valueByType.get('day')}`;
}

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
  CASE
    WHEN EXISTS (SELECT 1 FROM candidate_assignments ownership_ca WHERE ownership_ca.candidate_id = c.id)
      THEN 'PERSONAL'
    ELSE 'BRANCH'
  END AS "ownershipType",
  (SELECT ownership_ca.hr_user_id
     FROM candidate_assignments ownership_ca
    WHERE ownership_ca.candidate_id = c.id
    ORDER BY ownership_ca.assigned_at, ownership_ca.id
    LIMIT 1) AS "responsibleUserId",
  CASE
    WHEN EXISTS (SELECT 1 FROM candidate_assignments ownership_ca WHERE ownership_ca.candidate_id = c.id)
      THEN (SELECT ownership_u.name
              FROM candidate_assignments ownership_ca
              JOIN hr_users ownership_u ON ownership_u.id = ownership_ca.hr_user_id
             WHERE ownership_ca.candidate_id = c.id
             ORDER BY ownership_ca.assigned_at, ownership_ca.id
             LIMIT 1)
    ELSE CONCAT('ملكية فرع ', COALESCE(b.name, 'غير محدد'))
  END AS "ownershipLabel",
  c.created_by AS "createdByUserId",
  cb.name AS "createdByUserName",
  COALESCE(r.display_name, cb.role) AS "createdByRoleDisplayName",
  COALESCE(
    (SELECT json_agg(json_build_object(
         'userId',          u2.id,
         'userName',        u2.name,
         'roleDisplayName', COALESCE(r2.display_name, u2.role)
       ) ORDER BY ca.assigned_at)
     FROM candidate_assignments ca
     JOIN hr_users u2  ON u2.id  = ca.hr_user_id
     LEFT JOIN roles r2 ON r2.id = u2.role_id
     WHERE ca.candidate_id = c.id),
    '[]'::json
  ) AS "assignments"
`;

type CandidateSubject = {
  branchId: number | null;
  assignedUserIds: number[];
};

type LinkableCandidate = {
  id: number;
  branchId: number | null;
  createdBy: number | null;
  status: string | null;
  convertedToLeadId: number | null;
  mobile: string | null;
  referralType: string | null;
  referralOriginChannel: string | null;
  referralNameSnapshot: string | null;
  referralEntityId: number | null;
  referralDate: string | null;
  referralReason: string | null;
  referralSheetId: number | null;
  addressText: string | null;
  assignedUserIds: number[];
};

type LinkableClient = {
  id: number;
  branchId: number | null;
  assignedUserIds: number[];
  lifecycleStage: 'LEAD' | 'FOP' | 'OP';
};

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

function isTerminalCandidateState(status: unknown, convertedToLeadId: unknown): boolean {
  return status === 'Qualified' || status === 'Junk' || convertedToLeadId != null;
}

function normalizeCandidatePayload<T extends Record<string, any>>(payload: T): T & {
  mobile: string;
  contacts: any[];
} {
  const contacts = normalizeContactsForWrite(payload.contacts, { requireOne: true });
  return {
    ...payload,
    contacts,
    mobile: contacts.length > 0 ? getCanonicalContactNumber(contacts) : normalizePhone(payload.mobile),
  };
}

function phoneNormalizationSql(expression: string): string {
  const digits = `regexp_replace(COALESCE(${expression}, ''), '\\D', '', 'g')`;
  return `
    CASE
      WHEN ${digits} ~ '^009639\\d{8}$' THEN '0' || right(${digits}, 9)
      WHEN ${digits} ~ '^9639\\d{8}$' THEN '0' || right(${digits}, 9)
      WHEN ${digits} ~ '^9\\d{8}$' THEN '0' || ${digits}
      ELSE ${digits}
    END
  `;
}

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

function resolveCandidateTargetBranch(
  req: any,
  requestedBranchId?: number | string | null,
  globalScopePermission?: string,
): number | null {
  const authContext = getRequiredAuthContext(req);
  const raw = requestedBranchId ?? req.header('x-branch-id');
  const explicit = Number(raw);
  const hasExplicit = Number.isInteger(explicit) && explicit > 0;

  // A GLOBAL grant (or super-admin) may target any branch directly — mirrors the
  // clients/name-lists flow so a company-wide deputy can create in any branch.
  if (hasExplicit && globalScopePermission) {
    const grant = authContext.grants?.find((g: any) => g.permission === globalScopePermission);
    if (authContext.isSuperAdmin || grant?.scope === 'GLOBAL') {
      return explicit;
    }
  }

  return resolveActingBranch({
    headerBranchId: raw,
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
    `SELECT
       c.branch_id AS "branchId",
       COALESCE(
         (SELECT array_agg(hr_user_id)
            FROM candidate_assignments
           WHERE candidate_id = c.id),
         '{}'::int[]
       ) AS "assignedUserIds"
     FROM candidates c
    WHERE c.id = $1`,
    [candidateId],
  );

  return rows[0] ?? null;
}

async function loadLinkableCandidate(candidateId: string | number): Promise<LinkableCandidate | null> {
  const { rows } = await pool.query(
    `SELECT
       id,
       branch_id AS "branchId",
       created_by AS "createdBy",
       status,
       converted_to_lead_id AS "convertedToLeadId",
       mobile,
       referral_type AS "referralType",
       referral_origin_channel AS "referralOriginChannel",
       referral_name_snapshot AS "referralNameSnapshot",
       referral_entity_id AS "referralEntityId",
       referral_date AS "referralDate",
       referral_reason AS "referralReason",
       referral_sheet_id AS "referralSheetId",
       address_text AS "addressText",
       COALESCE(
         (SELECT array_agg(hr_user_id ORDER BY assigned_at, id)
            FROM candidate_assignments
           WHERE candidate_id = candidates.id),
         '{}'::int[]
       ) AS "assignedUserIds"
     FROM candidates
    WHERE id = $1`,
    [candidateId],
  );

  return rows[0] ?? null;
}

async function clientHasMatchingPhone(clientId: number, mobile: string | null): Promise<boolean> {
  const normalizedMobile = normalizePhone(mobile);
  if (!normalizedMobile) return false;

  const { rows } = await pool.query(
    `SELECT 1
      FROM clients c
     WHERE c.id = $1
       AND (
          ${phoneNormalizationSql('c.mobile')} = $2
          OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements(COALESCE(c.contacts, '[]'::jsonb)) AS contact
             WHERE ${phoneNormalizationSql(`contact->>'number'`)} = $2
          )
        )
      LIMIT 1`,
    [clientId, normalizedMobile],
  );

  return rows.length > 0;
}

async function loadLinkableClient(clientId: string | number): Promise<LinkableClient | null> {
  const { rows } = await pool.query(
    `SELECT
       c.id,
       c.branch_id AS "branchId",
       (${buildClientLifecycleStatusSql('c')}) AS "lifecycleStage",
       COALESCE(
         (SELECT array_agg(hr_user_id)
            FROM client_assignments
           WHERE client_id = c.id),
         '{}'::int[]
       ) AS "assignedUserIds"
     FROM clients c
    WHERE c.id = $1
      AND c.is_candidate = FALSE
      AND c.deleted_at IS NULL`,
    [clientId],
  );

  return rows[0] ?? null;
}

async function resolveTransferableCandidateAssignmentIds(db: Queryable, candidateId: number): Promise<number[]> {
  const { rows: assignmentRows } = await db.query(
    `SELECT DISTINCT u.id
       FROM candidate_assignments ca
       JOIN hr_users u ON u.id = ca.hr_user_id
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN employees e ON e.id = u.employee_id
      WHERE ca.candidate_id = $1
        AND ${eligibleHrUserWithPermissionCondition('u', 'r', 'e', 'clients.can_be_assigned')}`,
    [candidateId],
  );
  return assignmentRows.map((row: any) => Number(row.id)).filter(Number.isFinite);
}

async function insertLinkedClientAssignments(
  db: Queryable,
  clientId: number,
  userIds: number[],
  assignedBy: number,
): Promise<void> {
  const uniqueUserIds = Array.from(new Set(userIds.filter(id => Number.isInteger(id) && id > 0)));
  if (uniqueUserIds.length === 0) return;

  const values = uniqueUserIds
    .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
    .join(', ');
  const params = uniqueUserIds.flatMap(uid => [clientId, uid, assignedBy]);
  await db.query(
    `INSERT INTO client_assignments (client_id, hr_user_id, assigned_by)
     VALUES ${values}
     ON CONFLICT (client_id, hr_user_id) DO NOTHING`,
    params,
  );
}

/**
 * @swagger
 * components:
 *   schemas:
 *     Candidate:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         firstName:
 *           type: string
 *         lastName:
 *           type: string
 *         nickname:
 *           type: string
 *         mobile:
 *           type: string
 *         contacts:
 *           type: array
 *           items:
 *             type: object
 *         addressText:
 *           type: string
 *         geoUnitId:
 *           type: integer
 *         ownerUserId:
 *           type: integer
 *           deprecated: true
 *         ownershipType:
 *           type: string
 *           enum: [PERSONAL, BRANCH]
 *         responsibleUserId:
 *           type: integer
 *           nullable: true
 *         ownershipLabel:
 *           type: string
 *         status:
 *           type: string
 *         referralSheetId:
 *           type: integer
 *         referralDate:
 *           type: string
 *         referralReason:
 *           type: string
 *         referralType:
 *           type: string
 *         referralOriginChannel:
 *           type: string
 *         referralNameSnapshot:
 *           type: string
 *         referralEntityId:
 *           type: integer
 *         referralConfirmationStatus:
 *           type: string
 *         occupation:
 *           type: string
 *         candidateNotes:
 *           type: string
 *         duplicateFlag:
 *           type: boolean
 *         duplicateType:
 *           type: string
 *         duplicateReferenceId:
 *           type: integer
 *         convertedToLeadId:
 *           type: integer
 *         createdAt:
 *           type: string
 *         createdBy:
 *           type: integer
 *         branchId:
 *           type: integer
 */

/**
 * @swagger
 * /api/candidates:
 *   get:
 *     tags: [Candidates]
 *     summary: Retrieve list of candidates
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
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         required: false
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Candidate'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
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
      conditions.push(`EXISTS (SELECT 1 FROM candidate_assignments WHERE candidate_id = c.id AND hr_user_id = $${params.length})`);
      params.push(authContext.allowedBranchIds);
      conditions.push(`c.branch_id = ANY($${params.length}::int[])`);
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT ${selectFieldsList}
       FROM candidates c
       LEFT JOIN branches b ON b.id = c.branch_id
       LEFT JOIN referral_sheets rs ON rs.id = c.referral_sheet_id
       LEFT JOIN hr_users cb ON cb.id = c.created_by
       LEFT JOIN roles r ON r.id = cb.role_id
       ${where}
       ORDER BY c.id`,
      params,
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/candidates:
 *   post:
 *     tags: [Candidates]
 *     summary: Create new candidate
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
 *             required: [firstName]
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               nickname:
 *                 type: string
 *               mobile:
 *                 type: string
 *               branchId:
 *                 type: integer
 *               assignmentUserIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 deprecated: true
 *               ownershipType:
 *                 type: string
 *                 enum: [PERSONAL, BRANCH]
 *               responsibleUserId:
 *                 type: integer
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Candidate'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.post('/', requirePermission('candidates.create'), async (req, res) => {
  const db = await pool.connect();
  try {
    const authContext = getRequiredAuthContext(req);
    const requestedSheetId = Number(req.body?.referralSheetId);
    const hasRequestedSheet = Number.isInteger(requestedSheetId) && requestedSheetId > 0;
    let inheritedOwnership: CandidateOwnershipDecision | null = null;
    let targetBranchId = resolveCandidateTargetBranch(req, req.body?.branchId, 'candidates.create');

    if (hasRequestedSheet) {
      const { rows: sheetRows } = await db.query(
        `SELECT branch_id AS "branchId", assigned_hr_user_id AS "assignedHrUserId"
           FROM referral_sheets
          WHERE id = $1
          FOR SHARE`,
        [requestedSheetId],
      );
      const sheet = sheetRows[0];
      if (!sheet) {
        return res.status(400).json({ error: 'لائحة الأسماء المحددة غير موجودة' });
      }
      const inheritedBranchId = Number(sheet.branchId);
      if (!Number.isInteger(inheritedBranchId) || inheritedBranchId <= 0) {
        return res.status(409).json({
          error: 'لائحة الأسماء المحددة غير مرتبطة بفرع صالح',
          code: 'candidate_referral_sheet_branch_missing',
        });
      }
      targetBranchId = inheritedBranchId;
      inheritedOwnership = sheet.assignedHrUserId == null
        ? { ownershipType: 'BRANCH', responsibleUserId: null }
        : { ownershipType: 'PERSONAL', responsibleUserId: Number(sheet.assignedHrUserId) };
    }

    if (targetBranchId == null) {
      return res.status(400).json({ error: 'يجب تحديد الفرع المستهدف لهذه العملية' });
    }

    const createAccess = canCreateCandidate(authContext, {
      branchId: targetBranchId,
      assignedUserIds: [],
    });
    if (!createAccess.allowed) {
      return forbidCandidateAccess(res, createAccess.reason);
    }

    const c = normalizeCandidatePayload(req.body ?? {});
    const ownership = inheritedOwnership ?? resolveCandidateOwnershipInput(req.body ?? {}, authContext.userId);
    if (inheritedOwnership?.ownershipType === 'PERSONAL') {
      await assertEligibleCandidateResponsible(db, inheritedOwnership.responsibleUserId, targetBranchId);
    } else if (!inheritedOwnership) {
      await validateCandidateOwnershipDecision(db, authContext, targetBranchId, ownership, {
        allowImplicitSelf: true,
      });
    }

    await db.query('BEGIN');
    const { rows } = await db.query(
      `INSERT INTO candidates (first_name, last_name, nickname, mobile, contacts, address_text, geo_unit_id,
        owner_user_id, status, referral_sheet_id, referral_date, referral_reason,
        referral_type, referral_origin_channel, referral_name_snapshot, referral_entity_id,
        referral_confirmation_status, occupation, candidate_notes, duplicate_flag, duplicate_type,
        duplicate_reference_id, converted_to_lead_id, created_by, branch_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
      RETURNING id`,
      [c.firstName, c.lastName || null, c.nickname, c.mobile, JSON.stringify(c.contacts || []), c.addressText || '', c.geoUnitId || null,
       ownership.responsibleUserId, c.status || 'Suggested', hasRequestedSheet ? requestedSheetId : null,
       c.referralDate || null, c.referralReason || null, c.referralType || null,
       c.referralOriginChannel || null, c.referralNameSnapshot || null,
       c.referralEntityId || null, c.referralConfirmationStatus || 'Pending',
       c.occupation || null, c.candidateNotes || null, c.duplicateFlag || false, c.duplicateType || null,
       c.duplicateReferenceId || null, c.convertedToLeadId || null, authContext.userId,
       targetBranchId]
    );

    const candidateId = rows[0].id;
    await replaceCandidateOwnership(db, candidateId, ownership, authContext.userId);

    // Return full record with assignments and branch/user enrichment
    const { rows: full } = await db.query(
      `SELECT ${selectFieldsList}
       FROM candidates c
       LEFT JOIN branches b ON b.id = c.branch_id
       LEFT JOIN hr_users cb ON cb.id = c.created_by
       LEFT JOIN roles r ON r.id = cb.role_id
       WHERE c.id = $1`,
      [candidateId],
    );
    await db.query('COMMIT');
    res.json(full[0]);
  } catch (err: any) {
    await db.query('ROLLBACK').catch(() => undefined);
    const status = err instanceof CandidateOwnershipError ? err.status : (err.status || 500);
    res.status(status).json({ error: err.message, code: err.code });
  } finally {
    db.release();
  }
});

router.post('/:id/link-client', requirePermission('candidates.edit'), async (req, res) => {
  const db = await pool.connect();
  try {
    const authContext = getRequiredAuthContext(req);
    const candidateId = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    const clientId = Number(req.body?.clientId);
    if (!Number.isInteger(candidateId) || candidateId <= 0 || !Number.isInteger(clientId) || clientId <= 0) {
      return res.status(400).json({ error: 'معرّف الاسم المقترح أو الزبون غير صالح' });
    }

    const candidateSubject = await loadCandidateSubject(candidateId);
    if (!candidateSubject) {
      return res.status(404).json({ message: 'الاسم المقترح غير موجود' });
    }

    const editAccess = canEditCandidate(authContext, candidateSubject);
    if (!editAccess.allowed) {
      return forbidCandidateAccess(res, editAccess.reason);
    }

    const client = await loadLinkableClient(clientId);
    if (!client) {
      return res.status(404).json({ message: 'الزبون غير موجود' });
    }

    const candidate = await loadLinkableCandidate(candidateId);
    if (!candidate) {
      return res.status(404).json({ message: 'الاسم المقترح غير موجود' });
    }
    if (isTerminalCandidateState(candidate.status, candidate.convertedToLeadId)) {
      return res.status(409).json({
        error: 'لا يمكن إعادة ربط اسم مقترح منتهٍ',
        code: 'candidate_terminal_locked',
      });
    }

    const viewClientAccess = canViewClient(authContext, {
      branchId: client.branchId,
      assignedUserIds: client.assignedUserIds,
    });
    if (!viewClientAccess.allowed) {
      const samePhone = await clientHasMatchingPhone(clientId, candidate.mobile);
      if (!samePhone) {
        return res.status(403).json({ error: 'غير مسموح بربط هذا الزبون' });
      }
    }

    const newReferrer = {
      id: candidate.referralType === 'Client' ? candidate.referralEntityId : null,
      sourceCandidateId: candidate.id,
      name: candidate.referralNameSnapshot,
      type: candidate.referralType,
      channel: candidate.referralOriginChannel,
      address: candidate.addressText,
      referrerType: candidate.referralType,
      referralEntityId: candidate.referralEntityId,
      referrerName: candidate.referralNameSnapshot,
      sourceChannel: candidate.referralOriginChannel,
      referralDate: currentDateKey(),
      referralReason: candidate.referralReason,
      referralSheetId: candidate.referralSheetId,
      referralAddressText: candidate.addressText,
    };

    const sameBranchLink =
      candidate.branchId != null &&
      client.branchId != null &&
      Number(candidate.branchId) === Number(client.branchId);
    const shouldTransferLeadOwnership = client.lifecycleStage === 'LEAD' && sameBranchLink;

    await db.query('BEGIN');
    const { rows: lockedCandidateRows } = await db.query(
      `SELECT status, converted_to_lead_id AS "convertedToLeadId"
         FROM candidates
        WHERE id = $1
        FOR UPDATE`,
      [candidateId],
    );
    if (
      !lockedCandidateRows[0] ||
      isTerminalCandidateState(
        lockedCandidateRows[0].status,
        lockedCandidateRows[0].convertedToLeadId,
      )
    ) {
      throw Object.assign(new Error('لا يمكن إعادة ربط اسم مقترح منتهٍ'), {
        status: 409,
        code: 'candidate_terminal_locked',
      });
    }
    const transferableAssignmentIds = shouldTransferLeadOwnership
      ? await resolveTransferableCandidateAssignmentIds(db, candidateId)
      : [];

    await db.query(
      `WITH next_referrers AS (
          SELECT CASE
                  WHEN EXISTS (
                    SELECT 1
                      FROM jsonb_array_elements(COALESCE(referrers, '[]'::jsonb)) AS existing_referrer
                     WHERE existing_referrer->>'sourceCandidateId' = $2::text
                  )
                  THEN COALESCE(referrers, '[]'::jsonb)
                  ELSE COALESCE(referrers, '[]'::jsonb) || $3::jsonb
                END AS value
            FROM clients
           WHERE id = $1
        ),
        primary_referrer AS (
          SELECT
            value,
            value->0 AS item,
            COALESCE(value->0->>'referralEntityId', value->0->>'id') AS entity_id_text,
            value->0->>'referralSheetId' AS sheet_id_text,
            value->0->>'referralDate' AS referral_date_text
          FROM next_referrers
        )
        UPDATE clients
           SET referrers = primary_referrer.value,
               referrer_name = COALESCE(primary_referrer.item->>'referrerName', primary_referrer.item->>'name'),
               referrer_type = COALESCE(primary_referrer.item->>'referrerType', primary_referrer.item->>'type'),
               source_channel = COALESCE(primary_referrer.item->>'sourceChannel', primary_referrer.item->>'channel'),
               referral_entity_id = CASE
                 WHEN primary_referrer.entity_id_text ~ '^\\d+$' THEN primary_referrer.entity_id_text::int
                 ELSE NULL
               END,
               referral_date = CASE
                 WHEN primary_referrer.referral_date_text ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN primary_referrer.referral_date_text::date
                 ELSE NULL
               END,
               referral_reason = primary_referrer.item->>'referralReason',
               referral_sheet_id = CASE
                 WHEN primary_referrer.sheet_id_text ~ '^\\d+$' THEN primary_referrer.sheet_id_text::int
                 ELSE NULL
               END,
               referral_address_text = COALESCE(primary_referrer.item->>'referralAddressText', primary_referrer.item->>'address')
          FROM primary_referrer
         WHERE clients.id = $1`,
      [
        clientId,
        String(candidate.id),
        JSON.stringify([newReferrer]),
      ],
    );

    if (shouldTransferLeadOwnership) {
      await insertLinkedClientAssignments(db, clientId, transferableAssignmentIds, authContext.userId);
    }

    await db.query(
      `UPDATE candidates
          SET status = 'Qualified',
              converted_to_lead_id = $2,
              duplicate_flag = TRUE
        WHERE id = $1`,
      [candidateId, clientId],
    );

    await db.query('COMMIT');

    res.json({
      success: true,
      clientId,
      candidateId,
      lifecycleStage: client.lifecycleStage,
      addedAssignmentUserIds: shouldTransferLeadOwnership ? transferableAssignmentIds : [],
    });
  } catch (err: any) {
    await db.query('ROLLBACK').catch(() => undefined);
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  } finally {
    db.release();
  }
});

/**
 * @swagger
 * /api/candidates/{id}:
 *   put:
 *     tags: [Candidates]
 *     summary: Update candidate details by ID
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
 *         description: Candidate ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               nickname:
 *                 type: string
 *               mobile:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Candidate'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
router.put('/:id', requirePermission('candidates.edit'), async (req, res) => {
  const db = await pool.connect();
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

    const { rows: currentRows } = await pool.query(
      'SELECT status, converted_to_lead_id AS "convertedToLeadId" FROM candidates WHERE id = $1',
      [candidateId],
    );
    const currentCandidate = currentRows[0];
    if (isTerminalCandidateState(currentCandidate?.status, currentCandidate?.convertedToLeadId)) {
      return res.status(409).json({
        error: 'لا يمكن تعديل الاسم المقترح بعد الربط أو الرفض أو التحويل',
        code: 'candidate_terminal_locked',
      });
    }

    const c = normalizeCandidatePayload(req.body ?? {});
    const targetBranchId = req.body?.branchId !== undefined
      ? resolveCandidateTargetBranch(req, req.body?.branchId, 'candidates.edit')
      : existing.branchId;
    if (targetBranchId == null) {
      return res.status(400).json({ error: 'يجب تحديد الفرع المستهدف لهذه العملية' });
    }
    const ownershipWasRequested = hasCandidateOwnershipPayload(req.body ?? {});
    const existingOwnership: CandidateOwnershipDecision = existing.assignedUserIds.length === 0
      ? { ownershipType: 'BRANCH', responsibleUserId: null }
      : { ownershipType: 'PERSONAL', responsibleUserId: Number(existing.assignedUserIds[0]) };
    const ownership = ownershipWasRequested
      ? resolveCandidateOwnershipInput(req.body ?? {}, authContext.userId)
      : existingOwnership;
    const ownershipChanged =
      ownership.ownershipType !== existingOwnership.ownershipType ||
      ownership.responsibleUserId !== existingOwnership.responsibleUserId;

    if (ownershipWasRequested && ownershipChanged) {
      await validateCandidateOwnershipDecision(db, authContext, targetBranchId, ownership);
    } else if (ownership.ownershipType === 'PERSONAL' && targetBranchId !== existing.branchId) {
      await assertEligibleCandidateResponsible(db, ownership.responsibleUserId, targetBranchId);
    }

    await db.query('BEGIN');
    const { rows: lockedCandidateRows } = await db.query(
      `SELECT status, converted_to_lead_id AS "convertedToLeadId"
         FROM candidates
        WHERE id = $1
        FOR UPDATE`,
      [candidateId],
    );
    if (
      !lockedCandidateRows[0] ||
      isTerminalCandidateState(
        lockedCandidateRows[0].status,
        lockedCandidateRows[0].convertedToLeadId,
      )
    ) {
      throw Object.assign(
        new Error('لا يمكن تعديل الاسم المقترح بعد الربط أو الرفض أو التحويل'),
        { status: 409, code: 'candidate_terminal_locked' },
      );
    }
    await db.query(
      `UPDATE candidates SET first_name=$1, last_name=$2, nickname=$3, mobile=$4,
        contacts=$5, address_text=$6, geo_unit_id=$7, status=$8, referral_sheet_id=$9,
        referral_date=$10, referral_reason=$11, referral_type=$12, referral_origin_channel=$13,
        referral_name_snapshot=$14, referral_entity_id=$15, referral_confirmation_status=$16,
        occupation=$17, candidate_notes=$18, duplicate_flag=$19, duplicate_type=$20,
        duplicate_reference_id=$21, converted_to_lead_id=$22, created_by=$23, branch_id=$24
      WHERE id=$25`,
      [c.firstName, c.lastName || null, c.nickname, c.mobile, JSON.stringify(c.contacts || []), c.addressText || '', c.geoUnitId || null,
       c.status || 'Suggested', c.referralSheetId || null,
       c.referralDate || null, c.referralReason || null, c.referralType || null,
       c.referralOriginChannel || null, c.referralNameSnapshot || null,
       c.referralEntityId || null, c.referralConfirmationStatus || 'Pending',
       c.occupation || null, c.candidateNotes || null, c.duplicateFlag || false, c.duplicateType || null,
       c.duplicateReferenceId || null, c.convertedToLeadId || null, c.createdBy || null, targetBranchId,
       candidateId]
    );

    if (ownershipWasRequested && ownershipChanged) {
      await replaceCandidateOwnership(db, Number(candidateId), ownership, authContext.userId);
      await db.query(
        'UPDATE candidates SET owner_user_id = $2 WHERE id = $1',
        [candidateId, ownership.responsibleUserId],
      );
    }

    // Return full record with assignments and branch/user enrichment
    const { rows: full } = await db.query(
      `SELECT ${selectFieldsList}
       FROM candidates c
       LEFT JOIN branches b ON b.id = c.branch_id
       LEFT JOIN hr_users cb ON cb.id = c.created_by
       LEFT JOIN roles r ON r.id = cb.role_id
       WHERE c.id = $1`,
      [candidateId],
    );
    await db.query('COMMIT');
    res.json(full[0]);
  } catch (err: any) {
    await db.query('ROLLBACK').catch(() => undefined);
    const status = err instanceof CandidateOwnershipError ? err.status : (err.status || 500);
    res.status(status).json({ error: err.message, code: err.code });
  } finally {
    db.release();
  }
});

/**
 * @swagger
 * /api/candidates/{id}:
 *   delete:
 *     tags: [Candidates]
 *     summary: Delete candidate by ID
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
 *         description: Candidate ID
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
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
