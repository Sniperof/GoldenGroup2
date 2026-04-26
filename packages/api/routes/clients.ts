import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { resolveActingBranch } from '../services/authorizationService.js';
import {
  canCreateClient,
  canDeleteClient,
  canEditClient,
  canViewClient,
  getClientListAccessPlan,
} from '../policies/clientPolicy.js';

const router = Router();
router.use(requireAuth);

const CLIENT_SELECT = `
  SELECT
    c.id,
    c.first_name AS "firstName",
    c.father_name AS "fatherName",
    c.last_name AS "lastName",
    c.nickname,
    c.name,
    c.mobile,
    c.contacts,
    c.governorate,
    c.district,
    c.neighborhood,
    c.detailed_address AS "detailedAddress",
    c.gps_coordinates AS "gpsCoordinates",
    c.gender,
    c.national_id AS "nationalId",
    c.birth_date AS "birthDate",
    c.occupation,
    c.spouse_occupation AS "spouseOccupation",
    c.data_quality AS "dataQuality",
    c.water_source AS "waterSource",
    c.notes,
    c.rating,
    c.source_channel AS "sourceChannel",
    c.referrer_type AS "referrerType",
    c.referrer_id AS "referrerId",
    c.referrer_name AS "referrerName",
    c.referral_notes AS "referralNotes",
    c.referrers,
    c.referral_entity_id AS "referralEntityId",
    c.referral_date AS "referralDate",
    c.referral_reason AS "referralReason",
    c.referral_sheet_id AS "referralSheetId",
    c.referral_address_text AS "referralAddressText",
    c.created_at AS "createdAt",
    c.is_candidate AS "isCandidate",
    c.target_client AS "targetClient",
    c.candidate_status AS "candidateStatus",
    c.branch_id AS "branchId",
    b.name AS "branchName",
    c.assigned_hr_user_id AS "assignedHrUserId",
    u.name AS "assignedHrUserName",
    u.username AS "assignedHrUsername"
  FROM clients c
  LEFT JOIN branches b
    ON b.id = c.branch_id
  LEFT JOIN hr_users u
    ON u.id = c.assigned_hr_user_id
`;

const CLIENT_MUTATION_RETURNING = `
  RETURNING
    id,
    first_name AS "firstName",
    father_name AS "fatherName",
    last_name AS "lastName",
    nickname,
    name,
    mobile,
    contacts,
    governorate,
    district,
    neighborhood,
    detailed_address AS "detailedAddress",
    gps_coordinates AS "gpsCoordinates",
    gender,
    national_id AS "nationalId",
    birth_date AS "birthDate",
    occupation,
    spouse_occupation AS "spouseOccupation",
    data_quality AS "dataQuality",
    water_source AS "waterSource",
    notes,
    rating,
    source_channel AS "sourceChannel",
    referrer_type AS "referrerType",
    referrer_id AS "referrerId",
    referrer_name AS "referrerName",
    referral_notes AS "referralNotes",
    referrers,
    referral_entity_id AS "referralEntityId",
    referral_date AS "referralDate",
    referral_reason AS "referralReason",
    referral_sheet_id AS "referralSheetId",
    referral_address_text AS "referralAddressText",
    created_at AS "createdAt",
    is_candidate AS "isCandidate",
    target_client AS "targetClient",
    candidate_status AS "candidateStatus",
    branch_id AS "branchId",
    assigned_hr_user_id AS "assignedHrUserId"
`;

const toJson = (value: unknown, fallback: unknown) => JSON.stringify(value ?? fallback);

type ClientSubject = {
  branchId: number | null;
  assignedHrUserId: number | null;
};

type AssignedHrUserCheckResult =
  | { ok: true; assignedHrUserId: number | null }
  | { ok: false; error: string };

type SmartMatchResponse =
  | {
      status: 'NO_MATCH';
      matched: false;
      visible: false;
      normalizedPhone: string;
      message: string;
    }
  | {
      status: 'MATCH_VISIBLE';
      matched: true;
      visible: true;
      normalizedPhone: string;
      client: {
        id: number;
        name: string;
        phone: string;
        branchName: string | null;
        assignedUserName: string | null;
      };
    }
  | {
      status: 'MATCH_RESTRICTED';
      matched: true;
      visible: false;
      normalizedPhone: string;
      reason: 'OUT_OF_SCOPE';
      message: string;
    };

type ClientContactInput = {
  number?: unknown;
  [key: string]: unknown;
};

const RESTRICTED_SMART_MATCH_MESSAGE =
  'هذا الرقم موجود مسبقاً في النظام ولا يمكنك عرض تفاصيله. يرجى مراجعة الإدارة أو مدير الفرع.';

const NO_MATCH_SMART_MATCH_MESSAGE = 'لا توجد نتائج مطابقة';

function normalizePhone(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return '';
  }

  const digits = String(value).replace(/\D/g, '');
  if (!digits) {
    return '';
  }

  if (/^009639\d{8}$/.test(digits)) {
    return `0${digits.slice(5)}`;
  }

  if (/^9639\d{8}$/.test(digits)) {
    return `0${digits.slice(3)}`;
  }

  if (/^9\d{8}$/.test(digits)) {
    return `0${digits}`;
  }

  return digits;
}

function normalizeClientContacts(rawContacts: unknown): ClientContactInput[] {
  if (!Array.isArray(rawContacts)) {
    return [];
  }

  return rawContacts.map(contact => {
    if (!contact || typeof contact !== 'object') {
      return { number: '' };
    }

    const typedContact = contact as ClientContactInput;
    return {
      ...typedContact,
      number: normalizePhone(typedContact.number),
    };
  });
}

function normalizeClientPayload<T extends Record<string, any>>(payload: T): T & {
  mobile: string;
  contacts: ClientContactInput[];
} {
  return {
    ...payload,
    mobile: normalizePhone(payload.mobile),
    contacts: normalizeClientContacts(payload.contacts),
  };
}

function enforcePersonalReferrer<T extends Record<string, any>>(
  payload: T,
  currentUser: { id: number; name: string },
): T {
  const referrerType = typeof payload.referrerType === 'string' ? payload.referrerType : null;
  if (referrerType !== 'Personal') {
    return payload;
  }

  return {
    ...payload,
    sourceChannel: 'Acquaintance',
    referrerName: currentUser.name,
    referrerId: null,
    referralEntityId: null,
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

async function findDuplicateClientByPhone(
  normalizedPhone: string,
  excludeClientId?: number | null,
): Promise<{
  id: number;
  name: string;
  phone: string;
  branchId: number | null;
  branchName: string | null;
  assignedHrUserId: number | null;
  assignedUserName: string | null;
} | null> {
  if (!normalizedPhone) {
    return null;
  }

  const { rows } = await pool.query(
    `
      SELECT
        c.id,
        c.name,
        c.mobile AS phone,
        c.branch_id AS "branchId",
        b.name AS "branchName",
        c.assigned_hr_user_id AS "assignedHrUserId",
        u.name AS "assignedUserName"
      FROM clients c
      LEFT JOIN branches b
        ON b.id = c.branch_id
      LEFT JOIN hr_users u
        ON u.id = c.assigned_hr_user_id
      WHERE c.is_candidate = FALSE
        AND ($2::int IS NULL OR c.id <> $2)
        AND (
          ${phoneNormalizationSql('c.mobile')} = $1
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(c.contacts, '[]'::jsonb)) AS contact
            WHERE ${phoneNormalizationSql(`contact->>'number'`)} = $1
          )
        )
      ORDER BY c.id ASC
      LIMIT 1
    `,
    [normalizedPhone, excludeClientId ?? null],
  );

  return rows[0] ?? null;
}

function buildSmartMatchResponse(authContext: any, duplicate: Awaited<ReturnType<typeof findDuplicateClientByPhone>>, normalizedPhone: string): SmartMatchResponse {
  if (!duplicate) {
    return {
      status: 'NO_MATCH',
      matched: false,
      visible: false,
      normalizedPhone,
      message: NO_MATCH_SMART_MATCH_MESSAGE,
    };
  }

  const access = canViewClient(authContext, {
    branchId: duplicate.branchId,
    assignedHrUserId: duplicate.assignedHrUserId,
  });

  if (!access.allowed) {
    return {
      status: 'MATCH_RESTRICTED',
      matched: true,
      visible: false,
      normalizedPhone,
      reason: 'OUT_OF_SCOPE',
      message: RESTRICTED_SMART_MATCH_MESSAGE,
    };
  }

  return {
    status: 'MATCH_VISIBLE',
    matched: true,
    visible: true,
    normalizedPhone,
    client: {
      id: duplicate.id,
      name: duplicate.name,
      phone: duplicate.phone,
      branchName: duplicate.branchName,
      assignedUserName: duplicate.assignedUserName,
    },
  };
}

function getRequiredAuthContext(req: any) {
  if (!req.authContext) {
    throw new Error('AuthContext is required after requirePermission');
  }

  return req.authContext;
}

function forbidClientAccess(res: any, reason?: string) {
  if (reason === 'MISSING_BRANCH_CONTEXT') {
    return res.status(400).json({ error: 'يجب تحديد الفرع المطلوب لهذه العملية' });
  }

  return res.status(403).json({ error: 'غير مسموح' });
}

function resolveClientTargetBranch(req: any, requestedBranchId?: number | string | null): number | null {
  const authContext = getRequiredAuthContext(req);

  return resolveActingBranch({
    headerBranchId: requestedBranchId ?? req.header('x-branch-id'),
    primaryBranchId: authContext.actingBranchId ?? authContext.allowedBranchIds[0] ?? null,
    allowedBranchIds: authContext.allowedBranchIds,
    isSuperAdmin: authContext.isSuperAdmin,
  });
}

function resolveClientListBranchFilter(req: any): number | null {
  const requestedBranchId = req.header('x-branch-id');
  if (requestedBranchId == null || requestedBranchId === '') {
    return null;
  }

  const normalized = Number(requestedBranchId);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

async function loadClientSubject(clientId: string | number): Promise<ClientSubject | null> {
  const { rows } = await pool.query(
    `SELECT branch_id AS "branchId",
            assigned_hr_user_id AS "assignedHrUserId"
       FROM clients
      WHERE id = $1`,
    [clientId],
  );

  return rows[0] ?? null;
}

async function assertAssignedHrUserExists(
  assignedHrUserId: unknown,
): Promise<AssignedHrUserCheckResult> {
  if (assignedHrUserId == null || assignedHrUserId === '') {
    return { ok: true, assignedHrUserId: null };
  }

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

function getPermissionScope(
  req: any,
  permission: string,
): 'GLOBAL' | 'BRANCH' | 'ASSIGNED' | null {
  const authContext = getRequiredAuthContext(req);
  if (authContext.isSuperAdmin) {
    return 'GLOBAL';
  }

  return authContext.grants.find((grant: any) => grant.permission === permission)?.scope ?? null;
}

router.get('/', requirePermission('clients.view_list'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const requestedBranchId = resolveClientListBranchFilter(req);
    const listAccess = getClientListAccessPlan(authContext);

    if (!authContext.isSuperAdmin && authContext.allowedBranchIds.length === 0) {
      return res.status(403).json({ error: 'لا يوجد فرع فعّال متاح لهذه العملية' });
    }

    if (requestedBranchId != null && !authContext.isSuperAdmin && !authContext.allowedBranchIds.includes(requestedBranchId)) {
      return forbidClientAccess(res, 'BRANCH_FORBIDDEN');
    }

    if (listAccess.scope === 'NONE') {
      return forbidClientAccess(res, 'MISSING_PERMISSION');
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
      conditions.push(`c.assigned_hr_user_id = $${params.length}`);
      params.push(authContext.allowedBranchIds);
      conditions.push(`c.branch_id = ANY($${params.length}::int[])`);
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(`${CLIENT_SELECT}${where} ORDER BY c.id`, params);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/smart-match', requirePermission('clients.create'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const rawPhoneDigits = String(req.body?.phone ?? req.body?.mobile ?? '').replace(/\D/g, '');
    const normalizedPhone = normalizePhone(rawPhoneDigits);

    if (!normalizedPhone) {
      return res.status(400).json({ error: 'رقم الموبايل مطلوب للتحقق الذكي' });
    }

    if (!/^09\d{8}$/.test(rawPhoneDigits)) {
      return res.status(400).json({ error: 'رقم الموبايل يجب أن يتألف من 10 خانات ويبدأ بـ 09' });
    }

    const duplicate = await findDuplicateClientByPhone(normalizedPhone);
    return res.json(buildSmartMatchResponse(authContext, duplicate, normalizedPhone));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:id', requirePermission('clients.view'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const clientId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const subject = await loadClientSubject(clientId!);
    if (!subject) {
      return res.status(404).json({ message: 'الزبون غير موجود' });
    }

    const access = canViewClient(authContext, subject);
    if (!access.allowed) {
      return forbidClientAccess(res, access.reason);
    }

    const { rows } = await pool.query(`${CLIENT_SELECT} WHERE c.id = $1`, [clientId]);
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requirePermission('clients.create'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const targetBranchId = resolveClientTargetBranch(req, req.body?.branchId);
    if (targetBranchId == null) {
      return res.status(400).json({ error: 'يجب تحديد الفرع المستهدف لهذه العملية' });
    }

    const createScope = getPermissionScope(req, 'clients.create');

    // ── X3.3: Assigned-owner defaulting ───────────────────────────────────
    // Only a true super-admin may create a client with no assigned owner
    // (assigned_hr_user_id = NULL). Every other user — including those whose
    // role grant carries GLOBAL scope — self-assigns by default so that the
    // ASSIGNED list filter returns their own clients.
    //
    // If the caller is not a super-admin and sends null / '' / undefined for
    // assignedHrUserId, we treat it as "self" and ignore the provided value.
    // ─────────────────────────────────────────────────────────────────────
    let assignedHrUserCheck: Awaited<ReturnType<typeof assertAssignedHrUserExists>>;

    if (req.body?.assignedHrUserId !== undefined) {
      const raw = req.body.assignedHrUserId;

      if (!authContext.isSuperAdmin && (raw == null || raw === '')) {
        // Non-super-admin sent null/empty → self-assign regardless of scope
        assignedHrUserCheck = { ok: true, assignedHrUserId: authContext.userId };
      } else {
        // Super-admin, or non-empty explicit value → validate as usual
        assignedHrUserCheck = await assertAssignedHrUserExists(raw);
      }
    } else {
      // Not provided at all:
      //   • super-admin  → null  (intentionally unassigned, e.g. HQ entry)
      //   • everyone else → self (branch-operational user always owns their entry)
      assignedHrUserCheck = {
        ok: true,
        assignedHrUserId: authContext.isSuperAdmin ? null : authContext.userId,
      };
    }
    if ('error' in assignedHrUserCheck) {
      return res.status(400).json({ error: assignedHrUserCheck.error });
    }

    const createAccess = canCreateClient(authContext, {
      branchId: targetBranchId,
      assignedHrUserId: assignedHrUserCheck.assignedHrUserId,
    });
    if (!createAccess.allowed) {
      return forbidClientAccess(res, createAccess.reason);
    }

    const c = enforcePersonalReferrer(
      normalizeClientPayload(req.body ?? {}),
      { id: authContext.userId, name: req.user?.name || '' },
    );
    if (!c.mobile) {
      return res.status(400).json({ error: 'رقم الموبايل مطلوب' });
    }
    const duplicate = await findDuplicateClientByPhone(c.mobile);
    if (duplicate) {
      return res.status(409).json({
        error: 'DUPLICATE_CLIENT_PHONE',
        ...buildSmartMatchResponse(authContext, duplicate, c.mobile),
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO clients (
        first_name, father_name, last_name, nickname,
        name, mobile, contacts, governorate, district, neighborhood,
        detailed_address, gps_coordinates, gender, national_id, birth_date, occupation, spouse_occupation, data_quality, water_source, notes, rating,
        source_channel, referrer_type, referrer_id, referrer_name, referral_notes, referrers, referral_entity_id,
        referral_date, referral_reason, referral_sheet_id, referral_address_text,
        is_candidate, target_client, candidate_status,
        branch_id, assigned_hr_user_id
      )
      VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
        $22,$23,$24,$25,$26,$27,$28,
        $29,$30,$31,$32,
        $33,$34,$35,
        $36,$37
      )
      ${CLIENT_MUTATION_RETURNING}`,
      [
        c.firstName || null,
        c.fatherName || null,
        c.lastName || null,
        c.nickname || null,
        c.name,
        c.mobile,
        toJson(c.contacts, []),
        c.governorate || '',
        c.district || '',
        c.neighborhood || '',
        c.detailedAddress || null,
        c.gpsCoordinates ? toJson(c.gpsCoordinates, null) : null,
        c.gender || null,
        c.nationalId || null,
        c.birthDate || null,
        c.occupation || null,
        c.spouseOccupation || null,
        c.dataQuality || null,
        c.waterSource || null,
        c.notes || null,
        c.rating || null,
        c.sourceChannel || null,
        c.referrerType || null,
        c.referrerId || null,
        c.referrerName || null,
        c.referralNotes || null,
        toJson(c.referrers, []),
        c.referralEntityId || null,
        c.referralDate || null,
        c.referralReason || null,
        c.referralSheetId || null,
        c.referralAddressText || null,
        c.isCandidate || false,
        c.targetClient || null,
        c.candidateStatus || null,
        targetBranchId,
        assignedHrUserCheck.assignedHrUserId,
      ],
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requirePermission('clients.edit'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const clientId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const subject = await loadClientSubject(clientId!);
    if (!subject) {
      return res.status(404).json({ message: 'الزبون غير موجود' });
    }

    const access = canEditClient(authContext, subject);
    if (!access.allowed) {
      return forbidClientAccess(res, access.reason);
    }

    const c = enforcePersonalReferrer(
      normalizeClientPayload(req.body ?? {}),
      { id: authContext.userId, name: req.user?.name || '' },
    );
    if (!c.mobile) {
      return res.status(400).json({ error: 'رقم الموبايل مطلوب' });
    }
    const assignedHrUserCheck = c.assignedHrUserId !== undefined
      ? await assertAssignedHrUserExists(c.assignedHrUserId)
      : { ok: true as const, assignedHrUserId: subject.assignedHrUserId };
    if ('error' in assignedHrUserCheck) {
      return res.status(400).json({ error: assignedHrUserCheck.error });
    }

    const targetAccess = canEditClient(authContext, {
      branchId: subject.branchId,
      assignedHrUserId: assignedHrUserCheck.assignedHrUserId,
    });
    if (!targetAccess.allowed) {
      return forbidClientAccess(res, targetAccess.reason);
    }

    const duplicate = await findDuplicateClientByPhone(c.mobile, Number(clientId));
    if (duplicate) {
      return res.status(409).json({
        error: 'DUPLICATE_CLIENT_PHONE',
        ...buildSmartMatchResponse(authContext, duplicate, c.mobile),
      });
    }

    const { rows } = await pool.query(
      `UPDATE clients SET
        first_name=$1, father_name=$2, last_name=$3, nickname=$4,
        name=$5, mobile=$6, contacts=$7, governorate=$8, district=$9, neighborhood=$10,
        detailed_address=$11, gps_coordinates=$12, gender=$13, national_id=$14, birth_date=$15, occupation=$16, spouse_occupation=$17, data_quality=$18, water_source=$19, notes=$20, rating=$21,
        source_channel=$22, referrer_type=$23, referrer_id=$24, referrer_name=$25, referral_notes=$26, referrers=$27, referral_entity_id=$28,
        referral_date=$29, referral_reason=$30, referral_sheet_id=$31, referral_address_text=$32,
        is_candidate=$33, target_client=$34, candidate_status=$35, assigned_hr_user_id=$36
      WHERE id=$37
      ${CLIENT_MUTATION_RETURNING}`,
      [
        c.firstName || null,
        c.fatherName || null,
        c.lastName || null,
        c.nickname || null,
        c.name,
        c.mobile,
        toJson(c.contacts, []),
        c.governorate || '',
        c.district || '',
        c.neighborhood || '',
        c.detailedAddress || null,
        c.gpsCoordinates ? toJson(c.gpsCoordinates, null) : null,
        c.gender || null,
        c.nationalId || null,
        c.birthDate || null,
        c.occupation || null,
        c.spouseOccupation || null,
        c.dataQuality || null,
        c.waterSource || null,
        c.notes || null,
        c.rating || null,
        c.sourceChannel || null,
        c.referrerType || null,
        c.referrerId || null,
        c.referrerName || null,
        c.referralNotes || null,
        toJson(c.referrers, []),
        c.referralEntityId || null,
        c.referralDate || null,
        c.referralReason || null,
        c.referralSheetId || null,
        c.referralAddressText || null,
        c.isCandidate || false,
        c.targetClient || null,
        c.candidateStatus || null,
        assignedHrUserCheck.assignedHrUserId,
        clientId,
      ],
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requirePermission('clients.delete'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const clientId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const subject = await loadClientSubject(clientId!);
    if (!subject) {
      return res.status(404).json({ message: 'الزبون غير موجود' });
    }

    const access = canDeleteClient(authContext, subject);
    if (!access.allowed) {
      return forbidClientAccess(res, access.reason);
    }

    await pool.query('DELETE FROM clients WHERE id = $1', [clientId]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bulk-delete', requirePermission('clients.delete'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0) {
      return res.json({ success: true });
    }

    const { rows } = await pool.query(
      `SELECT id,
              branch_id AS "branchId",
              assigned_hr_user_id AS "assignedHrUserId"
         FROM clients
        WHERE id = ANY($1)`,
      [ids],
    );

    for (const row of rows) {
      const access = canDeleteClient(authContext, {
        branchId: row.branchId,
        assignedHrUserId: row.assignedHrUserId,
      });
      if (!access.allowed) {
        return forbidClientAccess(res, access.reason);
      }
    }

    await pool.query('DELETE FROM clients WHERE id = ANY($1)', [ids]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
