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
import { canEditClient, canViewClient } from '../policies/clientPolicy.js';
import { canViewReferralSheet } from '../policies/referralSheetPolicy.js';
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
import { resolveReferenceValueForWrite } from '../services/referenceValueService.js';
import {
  collectCandidatePhones,
  detectCandidateDuplicate,
} from '../services/candidateDuplicateDetection.js';
import { recomputeReferralSheetStats } from '../services/referralSheetStats.js';
import {
  createReferralGiftPromise,
  ReferralGiftPromiseError,
} from '../services/referralGiftPromises.js';

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
  c.qualification_kind AS "qualificationKind",
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
    ELSE COALESCE(b.name, 'غير محدد')
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
  contacts: unknown;
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

function presentCandidateReferralReason(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const reason = value.trim();
  const legacyReasonLabels: Record<string, string> = {
    'direct referral': 'ترشيح مباشر',
    'part of sheet': 'ضمن لائحة أسماء',
  };
  return legacyReasonLabels[reason.toLowerCase()] ?? reason;
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

/**
 * The one place the candidate list scope is expressed in SQL. `GET /` and
 * `GET /paged` share it so the two can never drift apart (standard §13 SH-1) —
 * a drift here would be a silent visibility leak, not a visible bug.
 * Conditions are appended to `params` and returned; the caller adds its own
 * filters to the same arrays afterwards.
 */
function appendCandidateScopeConditions(
  authContext: any,
  requestedBranchId: number | null,
  scope: string,
  params: any[],
): string[] {
  const conditions: string[] = [];

  if (requestedBranchId != null) {
    params.push(requestedBranchId);
    conditions.push(`c.branch_id = $${params.length}`);
  }

  if (scope === 'BRANCH') {
    params.push(authContext.allowedBranchIds);
    conditions.push(`c.branch_id = ANY($${params.length}::int[])`);
  }

  if (scope === 'ASSIGNED') {
    params.push(authContext.userId);
    conditions.push(`EXISTS (SELECT 1 FROM candidate_assignments WHERE candidate_id = c.id AND hr_user_id = $${params.length})`);
    params.push(authContext.allowedBranchIds);
    conditions.push(`c.branch_id = ANY($${params.length}::int[])`);
  }

  return conditions;
}

/**
 * The search haystack for the paged list. Kept as one constant because
 * migrations/438 builds a trigram index on this exact expression — any edit here
 * must be mirrored there, or search silently degrades to a full scan.
 */
const CANDIDATE_SEARCH_EXPR =
  `(COALESCE(c.first_name, '') || ' ' || COALESCE(c.nickname, '') || ' ' || COALESCE(c.last_name, '') || ' ' || COALESCE(c.mobile, '') || ' ' || COALESCE(c.referral_name_snapshot, ''))`;

/** Sort keys the paged list accepts, mapped to SQL. Anything else falls back to createdAt. */
const CANDIDATE_SORT_COLUMNS: Record<string, string> = {
  createdAt: 'c.created_at',
  id: 'c.id',
  firstName: 'c.first_name',
  lastName: 'c.last_name',
  mobile: 'c.mobile',
  status: 'c.status',
  referralDate: 'c.referral_date',
  branchName: 'b.name',
};

function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
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
       contacts,
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

    const params: any[] = [];
    const conditions = appendCandidateScopeConditions(authContext, requestedBranchId, listAccess.scope, params);

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      // The sheets table is deliberately not joined here: selectFieldsList reads
      // nothing from it, and at 100k+ names a dead join is pure cost.
      `SELECT ${selectFieldsList}
       FROM candidates c
       LEFT JOIN branches b ON b.id = c.branch_id
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
 * /api/candidates/paged:
 *   get:
 *     tags: [Candidates]
 *     summary: Server-paginated candidate records with filters and status KPIs
 *     description: >
 *       The records surface. Same scope rules as GET /api/candidates (shared
 *       appendCandidateScopeConditions), but returns one page plus the status
 *       counts for the whole filtered set. GET /api/candidates is left untouched
 *       for its existing consumers.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 25, maximum: 100 }
 *       - in: query
 *         name: sortKey
 *         schema: { type: string, enum: [createdAt, id, firstName, lastName, mobile, status, referralDate, branchName] }
 *       - in: query
 *         name: sortDir
 *         schema: { type: string, enum: [asc, desc] }
 *       - in: query
 *         name: ids
 *         description: Comma-separated candidate ids — a scoped batch lookup for surfaces that need specific rows.
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "{ items, total, page, limit, kpis }"
 *       403:
 *         description: Out of scope or missing permission
 */
// MUST stay above `/:id` — Express would otherwise match "paged" as an id.
router.get('/paged', requirePermission('candidates.view_list'), async (req, res) => {
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

    // An id-batch lookup is bounded by the ids themselves, so it may exceed the
    // page cap — a caller asking for 300 known rows should not silently get 100.
    const idsRaw = typeof req.query.ids === 'string' ? req.query.ids.trim() : '';
    const maxLimit = idsRaw ? 500 : 100;

    const page = toPositiveInt(req.query.page) ?? 1;
    const limit = Math.min(maxLimit, Math.max(1, toPositiveInt(req.query.limit) ?? 25));
    const offset = (page - 1) * limit;

    // Default sort is createdAt DESC: it is what the page has always shown, so
    // page 1 here is the same first screen the user saw before pagination.
    const sortKey = typeof req.query.sortKey === 'string' && CANDIDATE_SORT_COLUMNS[req.query.sortKey]
      ? req.query.sortKey
      : 'createdAt';
    const sortDir = req.query.sortDir === 'asc' ? 'ASC' : 'DESC';
    const orderBy = `${CANDIDATE_SORT_COLUMNS[sortKey]} ${sortDir}, c.id ${sortDir}`;

    // Scope first — every filter below only ever narrows it further.
    const params: any[] = [];
    const conditions = appendCandidateScopeConditions(authContext, requestedBranchId, listAccess.scope, params);

    const str = (key: string): string =>
      typeof req.query[key] === 'string' ? (req.query[key] as string).trim() : '';

    // Scoped batch lookup by id — lets a surface fetch exactly the rows it
    // needs instead of holding the whole table in memory.
    if (idsRaw) {
      const ids = idsRaw.split(',').map(v => Number(v.trim())).filter(v => Number.isInteger(v) && v > 0);
      if (ids.length === 0) {
        return res.json({ items: [], total: 0, page, limit, kpis: {} });
      }
      params.push(ids.slice(0, 500));
      conditions.push(`c.id = ANY($${params.length}::int[])`);
    }

    const search = str('search');
    if (search) {
      params.push(`%${search}%`);
      // One concatenated haystack, not five ORed columns: it reproduces the old
      // in-browser search (which matched across name parts) AND it is the exact
      // expression the trigram index in migration 438 is built on — the two must
      // stay character-identical or the index is silently unused.
      conditions.push(`${CANDIDATE_SEARCH_EXPR} ILIKE $${params.length}`);
    }

    const status = str('status');
    if (status) {
      params.push(status);
      conditions.push(`c.status = $${params.length}`);
    }

    // An in-page branch filter, distinct from the X-Branch-Id scope header:
    // it only ever narrows further, never widens what the scope already allows.
    const branchFilterId = toPositiveInt(req.query.branchFilterId);
    if (branchFilterId != null) {
      params.push(branchFilterId);
      conditions.push(`c.branch_id = $${params.length}`);
    }

    const responsibleUserId = toPositiveInt(req.query.responsibleUserId);
    if (responsibleUserId != null) {
      params.push(responsibleUserId);
      conditions.push(`EXISTS (SELECT 1 FROM candidate_assignments f_ca WHERE f_ca.candidate_id = c.id AND f_ca.hr_user_id = $${params.length})`);
    }

    const createdByUserId = toPositiveInt(req.query.createdByUserId);
    if (createdByUserId != null) {
      params.push(createdByUserId);
      conditions.push(`c.created_by = $${params.length}`);
    }

    const converted = str('converted');
    if (converted === 'converted') conditions.push('c.converted_to_lead_id IS NOT NULL');
    else if (converted === 'unconverted') conditions.push('c.converted_to_lead_id IS NULL');

    const referralType = str('referralType');
    if (referralType) {
      params.push(referralType);
      conditions.push(`c.referral_type = $${params.length}`);
    }

    const channel = str('channel');
    if (channel) {
      params.push(channel);
      conditions.push(`c.referral_origin_channel = $${params.length}`);
    }

    const duplicate = str('duplicate');
    if (duplicate === 'yes') conditions.push('c.duplicate_flag = TRUE');
    else if (duplicate === 'no') conditions.push('COALESCE(c.duplicate_flag, FALSE) = FALSE');

    const confirmation = str('confirmation');
    if (confirmation) {
      params.push(confirmation);
      conditions.push(`c.referral_confirmation_status = $${params.length}`);
    }

    const source = str('source');
    if (source === 'fromSheet') conditions.push('c.referral_sheet_id IS NOT NULL');
    else if (source === 'direct') conditions.push('c.referral_sheet_id IS NULL');

    const referralSheetId = toPositiveInt(req.query.referralSheetId);
    if (referralSheetId != null) {
      params.push(referralSheetId);
      conditions.push(`c.referral_sheet_id = $${params.length}`);
    }

    // The referring entity (a client id when referralType = Client) — lets a
    // client profile list the names it referred without loading the table.
    const referralEntityId = toPositiveInt(req.query.referralEntityId);
    if (referralEntityId != null) {
      params.push(referralEntityId);
      conditions.push(`c.referral_entity_id = $${params.length}`);
    }

    const geoUnitId = toPositiveInt(req.query.geoUnitId);
    if (geoUnitId != null) {
      params.push(geoUnitId);
      conditions.push(`c.geo_unit_id = $${params.length}`);
    }

    const dateFrom = str('dateFrom');
    if (dateFrom) {
      params.push(dateFrom);
      conditions.push(`c.created_at >= $${params.length}::date`);
    }
    const dateTo = str('dateTo');
    if (dateTo) {
      params.push(dateTo);
      conditions.push(`c.created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    const pageParams = [...params];
    pageParams.push(limit);
    const limitRef = `$${pageParams.length}`;
    pageParams.push(offset);
    const offsetRef = `$${pageParams.length}`;

    // One round trip for both: the page rows and the status counts the header
    // shows. `total` is derived from the counts, so there is no third query.
    const [pageResult, statsResult] = await Promise.all([
      pool.query(
        `SELECT ${selectFieldsList}
           FROM candidates c
           LEFT JOIN branches b ON b.id = c.branch_id
           LEFT JOIN hr_users cb ON cb.id = c.created_by
           LEFT JOIN roles r ON r.id = cb.role_id
           ${where}
          ORDER BY ${orderBy}
          LIMIT ${limitRef} OFFSET ${offsetRef}`,
        pageParams,
      ),
      pool.query(
        `SELECT c.status AS status, COUNT(*)::int AS n
           FROM candidates c
           LEFT JOIN branches b ON b.id = c.branch_id
           ${where}
          GROUP BY 1`,
        params,
      ),
    ]);

    const kpis: Record<string, number> = {};
    let total = 0;
    for (const row of statsResult.rows) {
      const n = Number(row.n);
      total += n;
      kpis[row.status ?? 'Unknown'] = n;
    }

    res.json({ items: pageResult.rows, total, page, limit, kpis });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/:id', requirePermission('candidates.view_list'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const candidateId = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    if (!Number.isInteger(candidateId) || candidateId <= 0) {
      return res.status(400).json({ error: 'معرّف الاسم المقترح غير صالح' });
    }

    const { rows } = await pool.query(
      `SELECT
         c.id,
         c.first_name AS "firstName",
         c.last_name AS "lastName",
         c.nickname,
         c.mobile,
         c.contacts,
         c.status,
         c.branch_id AS "branchId",
         b.name AS "branchName",
         c.created_at AS "createdAt",
         c.address_text AS "addressText",
         c.geo_unit_id AS "geoUnitId",
         c.referral_sheet_id AS "referralSheetId",
         c.referral_date AS "referralDate",
         c.referral_reason AS "referralReason",
         c.referral_type AS "referralType",
         c.referral_origin_channel AS "referralOriginChannel",
         c.referral_name_snapshot AS "referralNameSnapshot",
         c.occupation,
         c.candidate_notes AS "candidateNotes",
         COALESCE(c.duplicate_flag, FALSE) AS "duplicateFlag",
         c.duplicate_type AS "duplicateType",
         c.duplicate_reference_id AS "duplicateReferenceId",
         c.converted_to_lead_id AS "convertedToLeadId",
         c.qualification_kind AS "qualificationKind",
         COALESCE(
           (SELECT array_agg(ca.hr_user_id ORDER BY ca.assigned_at, ca.id)
              FROM candidate_assignments ca
             WHERE ca.candidate_id = c.id),
           '{}'::int[]
         ) AS "assignedUserIds",
         responsible.id AS "responsibleUserId",
         responsible.name AS "responsibleUserName",
         COALESCE(responsible_role.display_name, responsible.role) AS "responsibleRoleDisplayName"
       FROM candidates c
       LEFT JOIN branches b ON b.id = c.branch_id
       LEFT JOIN LATERAL (
         SELECT u.id, u.name, u.role, u.role_id
           FROM candidate_assignments ca
           JOIN hr_users u ON u.id = ca.hr_user_id
          WHERE ca.candidate_id = c.id
          ORDER BY ca.assigned_at, ca.id
          LIMIT 1
       ) responsible ON TRUE
       LEFT JOIN roles responsible_role ON responsible_role.id = responsible.role_id
       WHERE c.id = $1`,
      [candidateId],
    );
    const candidate = rows[0];
    if (!candidate) {
      return res.status(404).json({ error: 'الاسم المقترح غير موجود' });
    }

    const viewAccess = canViewCandidate(authContext, {
      branchId: candidate.branchId,
      assignedUserIds: candidate.assignedUserIds,
    });
    if (!viewAccess.allowed) {
      return forbidCandidateAccess(res, viewAccess.reason);
    }

    const geoPath = candidate.geoUnitId == null
      ? []
      : (await pool.query(
        `WITH RECURSIVE chain AS (
           SELECT id, name, parent_id, level, status
             FROM geo_units
            WHERE id = $1
           UNION ALL
           SELECT parent.id, parent.name, parent.parent_id, parent.level, parent.status
             FROM geo_units parent
             JOIN chain child ON parent.id = child.parent_id
         )
         SELECT id, name, level, (status = 'active') AS "active"
           FROM chain
          ORDER BY level`,
        [candidate.geoUnitId],
      )).rows.map((unit: any) => ({
        id: Number(unit.id),
        name: String(unit.name),
        level: Number(unit.level),
        active: unit.active !== false,
      }));

    let occupationActive: boolean | null = null;
    if (candidate.occupation) {
      const occupationResult = await pool.query(
        `SELECT is_active AS "active"
           FROM system_lists
          WHERE category = 'occupation'
            AND value = $1
          ORDER BY id
          LIMIT 1`,
        [candidate.occupation],
      );
      occupationActive = occupationResult.rows[0]?.active === true;
    }

    let sourceSheet: any = null;
    if (candidate.referralSheetId != null) {
      const sheetResult = await pool.query(
        `SELECT
           rs.id,
           rs.branch_id AS "branchId",
           b.name AS "branchName",
           rs.owner_user_id AS "ownerUserId",
           rs.assigned_hr_user_id AS "assignedHrUserId",
           rs.status,
           rs.referral_date AS "referralDate",
           rs.field_visit_id AS "fieldVisitId",
           owner_user.name AS "ownerUserName",
           assigned_user.name AS "assignedHrUserName",
           team_user.name AS "teamResponsibleUserName",
           created_user.name AS "createdByUserName",
           rs.target_candidates AS "targetCandidates",
           rs.quality_percentage AS "qualityPercentage",
           rs.conversion_percentage AS "conversionPercentage",
           rs.referral_notes AS "notes",
           (SELECT COUNT(*)::int FROM candidates sheet_candidate WHERE sheet_candidate.referral_sheet_id = rs.id) AS "actualCandidates"
         FROM referral_sheets rs
         LEFT JOIN branches b ON b.id = rs.branch_id
         LEFT JOIN hr_users owner_user ON owner_user.id = rs.owner_user_id
         LEFT JOIN hr_users assigned_user ON assigned_user.id = rs.assigned_hr_user_id
         LEFT JOIN hr_users created_user ON created_user.id = rs.created_by
         LEFT JOIN field_visits fv ON fv.id = rs.field_visit_id
         LEFT JOIN hr_users team_user ON team_user.id = fv.team_responsible_user_id
         WHERE rs.id = $1`,
        [candidate.referralSheetId],
      );
      const sheet = sheetResult.rows[0];
      const sheetAccess = sheet
        ? canViewReferralSheet(authContext, {
          branchId: sheet.branchId,
          ownerUserId: sheet.ownerUserId,
          assignedHrUserId: sheet.assignedHrUserId,
        })
        : { allowed: false };
      sourceSheet = sheet && sheetAccess.allowed
        ? {
          visible: true,
          id: Number(sheet.id),
          status: sheet.status,
          referralDate: sheet.referralDate,
          branchName: sheet.branchName,
          origin: sheet.fieldVisitId == null ? 'MANUAL' : 'FIELD_VISIT',
          ownerUserName: sheet.ownerUserName,
          assignedHrUserName: sheet.assignedHrUserName,
          teamResponsibleUserName: sheet.teamResponsibleUserName,
          createdByUserName: sheet.createdByUserName,
          actualCandidates: Number(sheet.actualCandidates ?? 0),
          targetCandidates: Number(sheet.targetCandidates ?? 0),
          qualityPercentage: Number(sheet.qualityPercentage ?? 0),
          conversionPercentage: Number(sheet.conversionPercentage ?? 0),
          notes: sheet.notes,
        }
        : {
          visible: false,
          message: 'مصدر الإدخال: لائحة أسماء',
        };
    }

    let duplicateMatch: any = null;
    if (candidate.duplicateFlag) {
      const duplicateType = candidate.duplicateType;
      const duplicateReferenceId = Number(candidate.duplicateReferenceId);
      if (
        Number.isInteger(duplicateReferenceId) &&
        duplicateReferenceId > 0 &&
        (duplicateType === 'Client' || duplicateType === 'Candidate')
      ) {
        if (duplicateType === 'Client') {
          const duplicateClient = await loadLinkableClient(duplicateReferenceId);
          const access = duplicateClient && canViewClient(authContext, duplicateClient);
          if (duplicateClient && access?.allowed) {
            const nameResult = await pool.query('SELECT name FROM clients WHERE id = $1', [duplicateReferenceId]);
            duplicateMatch = {
              visible: true,
              entityType: 'Client',
              id: duplicateReferenceId,
              name: nameResult.rows[0]?.name ?? `زبون #${duplicateReferenceId}`,
            };
          }
        } else {
          const subject = await loadCandidateSubject(duplicateReferenceId);
          const access = subject && canViewCandidate(authContext, subject);
          if (subject && access?.allowed) {
            const nameResult = await pool.query(
              `SELECT COALESCE(
                 NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''),
                 NULLIF(nickname, ''),
                 CONCAT('اسم مقترح #', id)
               ) AS name
               FROM candidates
               WHERE id = $1`,
              [duplicateReferenceId],
            );
            duplicateMatch = {
              visible: true,
              entityType: 'Candidate',
              id: duplicateReferenceId,
              name: nameResult.rows[0]?.name ?? `اسم مقترح #${duplicateReferenceId}`,
            };
          }
        }
      }
      if (!duplicateMatch) {
        duplicateMatch = {
          visible: false,
          entityType: duplicateType ?? null,
          message: 'يوجد سجل مطابق خارج نطاق عرضك',
        };
      }
    }

    let conversion: any = null;
    if (candidate.convertedToLeadId != null) {
      const linkedClient = await loadLinkableClient(candidate.convertedToLeadId);
      const access = linkedClient && canViewClient(authContext, linkedClient);
      if (linkedClient && access?.allowed) {
        const clientResult = await pool.query('SELECT name FROM clients WHERE id = $1', [candidate.convertedToLeadId]);
        conversion = {
          mode: null,
          visible: true,
          client: {
            id: Number(linkedClient.id),
            name: clientResult.rows[0]?.name ?? `زبون #${linkedClient.id}`,
            lifecycleStage: linkedClient.lifecycleStage,
          },
        };
      } else {
        conversion = {
          mode: null,
          visible: false,
          message: 'مرتبط بزبون خارج نطاق عرضك',
        };
      }
    }

    const editAccess = canEditCandidate(authContext, {
      branchId: candidate.branchId,
      assignedUserIds: candidate.assignedUserIds,
    });
    const terminal = isTerminalCandidateState(candidate.status, candidate.convertedToLeadId);
    const hasClientCreate = authContext.isSuperAdmin || authContext.grants.some((grant: any) => grant.permission === 'clients.create');
    const hasClientEdit = authContext.isSuperAdmin || authContext.grants.some((grant: any) => grant.permission === 'clients.edit');
    const ownershipType = candidate.responsibleUserId == null ? 'BRANCH' : 'PERSONAL';
    const phoneNumbers = (Array.isArray(candidate.contacts) ? candidate.contacts : [])
      .map((contact: any) => {
        const rawNumber = typeof contact?.number === 'string' ? contact.number.trim() : '';
        const areaCode = typeof contact?.areaCode === 'string' ? contact.areaCode.trim() : '';
        const type = ['mobile', 'landline', 'other'].includes(contact?.type) ? contact.type : null;
        const status = ['active', 'preferred', 'out-of-coverage', 'unused', 'invalid'].includes(contact?.status)
          ? contact.status
          : null;
        return {
          number: type === 'landline' && areaCode && !rawNumber.startsWith(areaCode)
            ? `${areaCode}${rawNumber}`
            : rawNumber,
          type,
          label: typeof contact?.label === 'string' && contact.label.trim() ? contact.label.trim() : null,
          hasWhatsApp: typeof contact?.hasWhatsApp === 'boolean' ? contact.hasWhatsApp : null,
          isPrimary: contact?.isPrimary === true,
          status,
        };
      })
      .filter((contact: { number: string }) => contact.number.length > 0);
    if (
      typeof candidate.mobile === 'string' &&
      candidate.mobile.trim() &&
      !phoneNumbers.some((contact: { number: string }) => contact.number === candidate.mobile.trim())
    ) {
      phoneNumbers.unshift({
        number: candidate.mobile.trim(),
        type: 'mobile',
        label: null,
        hasWhatsApp: null,
        isPrimary: phoneNumbers.length === 0,
        status: null,
      });
    }
    phoneNumbers.sort((left: { isPrimary: boolean }, right: { isPrimary: boolean }) => Number(right.isPrimary) - Number(left.isPrimary));

    return res.json({
      id: Number(candidate.id),
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      nickname: candidate.nickname,
      phoneNumbers,
      status: candidate.status,
      branch: { id: candidate.branchId == null ? null : Number(candidate.branchId), name: candidate.branchName },
      ownership: {
        type: ownershipType,
        responsibleUserId: candidate.responsibleUserId == null ? null : Number(candidate.responsibleUserId),
        responsibleUserName: candidate.responsibleUserName,
        roleDisplayName: candidate.responsibleRoleDisplayName,
        label: ownershipType === 'PERSONAL'
          ? (candidate.responsibleUserName ?? 'مسؤول غير محدد')
          : (candidate.branchName ?? 'غير محدد'),
      },
      createdAt: candidate.createdAt,
      address: {
        geoUnitId: candidate.geoUnitId == null ? null : Number(candidate.geoUnitId),
        geoPath,
        text: candidate.addressText || null,
      },
      referral: {
        entryMode: candidate.referralSheetId == null ? 'DIRECT' : 'NAME_LIST',
        type: candidate.referralType,
        nameSnapshot: candidate.referralNameSnapshot,
        originChannel: candidate.referralOriginChannel,
        date: candidate.referralDate,
        reason: presentCandidateReferralReason(candidate.referralReason),
      },
      occupation: { value: candidate.occupation ?? null, active: occupationActive },
      candidateNotes: candidate.candidateNotes ?? null,
      duplicate: {
        flagged: candidate.duplicateFlag === true,
        type: candidate.duplicateType,
        match: duplicateMatch,
      },
      conversion,
      sourceSheet,
      permissions: {
        canEdit: editAccess.allowed && !terminal,
        canQualify: editAccess.allowed && !terminal && hasClientCreate,
        canLinkClient: editAccess.allowed && !terminal && hasClientEdit,
      },
    });
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message, code: err.code });
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
    let inheritedReferral: {
      referralType: string | null;
      referralEntityId: number | null;
      referralNameSnapshot: string | null;
      referralOriginChannel: string | null;
      referralDate: string | null;
    } | null = null;
    let targetBranchId = resolveCandidateTargetBranch(req, req.body?.branchId, 'candidates.create');

    if (hasRequestedSheet) {
      const { rows: sheetRows } = await db.query(
        `SELECT
           branch_id AS "branchId",
           owner_user_id AS "ownerUserId",
           assigned_hr_user_id AS "assignedHrUserId",
           status,
           referral_type AS "referralType",
           referral_entity_id AS "referralEntityId",
           referral_name_snapshot AS "referralNameSnapshot",
           referral_origin_channel AS "referralOriginChannel",
           referral_date AS "referralDate"
           FROM referral_sheets
          WHERE id = $1
          FOR SHARE`,
        [requestedSheetId],
      );
      const sheet = sheetRows[0];
      if (!sheet) {
        return res.status(400).json({ error: 'لائحة الأسماء المحددة غير موجودة' });
      }
      const sheetAccess = canViewReferralSheet(authContext, {
        branchId: sheet.branchId,
        ownerUserId: sheet.ownerUserId,
        assignedHrUserId: sheet.assignedHrUserId,
      });
      if (!sheetAccess.allowed) {
        return res.status(403).json({ error: 'غير مسموح بإضافة أسماء إلى هذه اللائحة' });
      }
      if (sheet.status !== 'New' && sheet.status !== 'In-Progress') {
        return res.status(409).json({
          error: 'لا يمكن إضافة أسماء إلا إلى لائحة جديدة أو قيد الجمع',
          code: 'candidate_referral_sheet_closed',
        });
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
      inheritedReferral = {
        referralType: sheet.referralType ?? null,
        referralEntityId: sheet.referralEntityId == null ? null : Number(sheet.referralEntityId),
        referralNameSnapshot: sheet.referralNameSnapshot ?? null,
        referralOriginChannel: sheet.referralOriginChannel ?? null,
        referralDate: sheet.referralDate ?? null,
      };
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
    if (inheritedReferral) {
      c.referralType = inheritedReferral.referralType;
      c.referralEntityId = inheritedReferral.referralEntityId;
      c.referralNameSnapshot = inheritedReferral.referralNameSnapshot;
      c.referralOriginChannel = inheritedReferral.referralOriginChannel;
      c.referralDate = inheritedReferral.referralDate;
      c.referralReason = 'ضمن لائحة أسماء';
    }
    c.occupation = await resolveReferenceValueForWrite(db, 'occupation', c.occupation);
    const ownership = inheritedOwnership ?? resolveCandidateOwnershipInput(req.body ?? {}, authContext.userId);
    if (inheritedOwnership?.ownershipType === 'PERSONAL') {
      await assertEligibleCandidateResponsible(db, inheritedOwnership.responsibleUserId, targetBranchId);
    } else if (!inheritedOwnership) {
      await validateCandidateOwnershipDecision(db, authContext, targetBranchId, ownership, {
        allowImplicitSelf: true,
      });
    }

    await db.query('BEGIN');

    // BR-2: the server owns duplicate detection. Anything the client sent in
    // duplicateFlag/duplicateType/duplicateReferenceId is ignored — it used to
    // be computed in the browser against whatever slice of the clients table it
    // had loaded, so the verdict changed with the caller's scope.
    const duplicate = await detectCandidateDuplicate(db, collectCandidatePhones(c));

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
       c.occupation || null, c.candidateNotes || null, duplicate.duplicateFlag, duplicate.duplicateType,
       duplicate.duplicateReferenceId, c.convertedToLeadId || null, authContext.userId,
       targetBranchId]
    );

    const candidateId = rows[0].id;
    await replaceCandidateOwnership(db, candidateId, ownership, authContext.userId);

    if (!hasRequestedSheet && req.body?.giftPromise) {
      await createReferralGiftPromise(db, {
        sourceType: 'candidate',
        sourceId: candidateId,
        draft: req.body.giftPromise,
        actorUserId: authContext.userId,
      });
    }

    if (hasRequestedSheet) {
      await recomputeReferralSheetStats(db, requestedSheetId);
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
    const status = err instanceof CandidateOwnershipError || err instanceof ReferralGiftPromiseError
      ? err.status
      : (err.status || 500);
    res.status(status).json({ error: err.message, code: err.code, ...(err.details ?? {}) });
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

    const editClientAccess = canEditClient(authContext, {
      branchId: client.branchId,
      assignedUserIds: client.assignedUserIds,
    });
    if (!editClientAccess.allowed) {
      return res.status(403).json({
        error: 'غير مسموح بتعديل علاقة هذا الزبون',
        code: editClientAccess.reason,
      });
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

    // Linking records HOW the name was qualified. `duplicate_flag` is no longer
    // asserted here: it is a detection result, not a side effect of the action.
    // It is recomputed instead — and a linked name legitimately stays flagged,
    // because the client it was attached to existed before it did.
    const linkDuplicate = await detectCandidateDuplicate(
      db,
      collectCandidatePhones(candidate),
      candidateId,
    );

    await db.query(
      `UPDATE candidates
          SET status = 'Qualified',
              converted_to_lead_id = $2,
              qualification_kind = 'linked',
              duplicate_flag = $3,
              duplicate_type = $4,
              duplicate_reference_id = $5
        WHERE id = $1`,
      [
        candidateId,
        clientId,
        linkDuplicate.duplicateFlag,
        linkDuplicate.duplicateType,
        linkDuplicate.duplicateReferenceId,
      ],
    );

    // Conversion moves the sheet's quality/conversion percentages.
    await recomputeReferralSheetStats(db, candidate.referralSheetId);

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
      'SELECT status, converted_to_lead_id AS "convertedToLeadId", occupation FROM candidates WHERE id = $1',
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
    c.occupation = await resolveReferenceValueForWrite(db, 'occupation', c.occupation, {
      currentValue: currentCandidate?.occupation ?? null,
    });
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
      `SELECT status,
              converted_to_lead_id AS "convertedToLeadId",
              referral_sheet_id AS "referralSheetId"
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

    // BR-2 re-evaluated on every edit (the numbers may have changed), excluding
    // the record itself. Client-sent duplicate fields are ignored.
    const duplicate = await detectCandidateDuplicate(
      db,
      collectCandidatePhones(c),
      Number(candidateId),
    );
    const previousSheetId = lockedCandidateRows[0].referralSheetId ?? null;

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
       c.occupation || null, c.candidateNotes || null, duplicate.duplicateFlag, duplicate.duplicateType,
       duplicate.duplicateReferenceId, c.convertedToLeadId || null, c.createdBy || null, targetBranchId,
       candidateId]
    );

    if (ownershipWasRequested && ownershipChanged) {
      await replaceCandidateOwnership(db, Number(candidateId), ownership, authContext.userId);
      await db.query(
        'UPDATE candidates SET owner_user_id = $2 WHERE id = $1',
        [candidateId, ownership.responsibleUserId],
      );
    }

    // Status / duplicate-flag / sheet membership all feed the sheet counters —
    // refresh both the sheet left behind and the one joined.
    const nextSheetId = c.referralSheetId || null;
    await recomputeReferralSheetStats(db, previousSheetId);
    if (String(nextSheetId ?? '') !== String(previousSheetId ?? '')) {
      await recomputeReferralSheetStats(db, nextSheetId);
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

    const { rows: deleted } = await pool.query(
      'DELETE FROM candidates WHERE id = $1 RETURNING referral_sheet_id AS "referralSheetId"',
      [candidateId],
    );
    // The browser never refreshed sheet counters after a delete, so a deleted
    // name kept inflating its sheet's total. The server does it now.
    await recomputeReferralSheetStats(pool, deleted[0]?.referralSheetId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
