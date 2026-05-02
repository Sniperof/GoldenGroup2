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
import {
  getCanonicalContactNumber,
  normalizeContactsForWrite,
  normalizePhone as normalizeContactPhone,
} from '../utils/contactValidation.js';

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
    c.created_by AS "createdByUserId",
    cb.name AS "createdByUserName",
    COALESCE(rcb.display_name, cb.role) AS "createdByRoleDisplayName",
    COALESCE(
      (SELECT json_agg(json_build_object(
           'userId',          u2.id,
           'userName',        u2.name,
           'roleDisplayName', COALESCE(r2.display_name, u2.role)
         ) ORDER BY ca.assigned_at)
       FROM client_assignments ca
       JOIN hr_users u2  ON u2.id  = ca.hr_user_id
       LEFT JOIN roles r2 ON r2.id = u2.role_id
       WHERE ca.client_id = c.id),
      '[]'::json
    ) AS "assignments"
  FROM clients c
  LEFT JOIN branches b   ON b.id  = c.branch_id
  LEFT JOIN hr_users cb  ON cb.id = c.created_by
  LEFT JOIN roles    rcb ON rcb.id = cb.role_id
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
    created_by AS "createdByUserId"
`;

const toJson = (value: unknown, fallback: unknown) => JSON.stringify(value ?? fallback);

type ClientSubject = {
  branchId: number | null;
  assignedUserIds: number[];
};

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
  return normalizeContactPhone(value);
}

function normalizeClientContacts(rawContacts: unknown): ClientContactInput[] {
  return normalizeContactsForWrite(rawContacts) as unknown as ClientContactInput[];
}

function normalizeClientPayload<T extends Record<string, any>>(payload: T): T & {
  mobile: string;
  contacts: ClientContactInput[];
} {
  const contacts = normalizeClientContacts(payload.contacts);
  const effectiveContacts: ClientContactInput[] = (contacts.length > 0
    ? contacts
    : normalizeContactsForWrite(payload.mobile
        ? [{ id: 'client-contact-1', type: 'mobile', number: payload.mobile, isPrimary: true, status: 'active' }]
        : [])) as unknown as ClientContactInput[];
  return {
    ...payload,
    mobile: effectiveContacts.length > 0 ? getCanonicalContactNumber(effectiveContacts as any) : normalizePhone(payload.mobile),
    contacts: effectiveContacts,
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
  assignedUserIds: number[];
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
        COALESCE(
          (SELECT array_agg(hr_user_id)
             FROM client_assignments
            WHERE client_id = c.id),
          '{}'::int[]
        ) AS "assignedUserIds"
      FROM clients c
      LEFT JOIN branches b ON b.id = c.branch_id
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
    assignedUserIds: duplicate.assignedUserIds,
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
    `SELECT
       c.branch_id AS "branchId",
       COALESCE(
         (SELECT array_agg(hr_user_id)
            FROM client_assignments
           WHERE client_id = c.id),
         '{}'::int[]
       ) AS "assignedUserIds"
     FROM clients c
    WHERE c.id = $1`,
    [clientId],
  );

  return rows[0] ?? null;
}

async function resolveAssignmentUserIds(
  rawIds: unknown,
  selfId: number,
  isSuperAdmin: boolean,
): Promise<number[] | { error: string }> {
  const ids: number[] = Array.isArray(rawIds)
    ? rawIds.map(Number).filter(n => Number.isInteger(n) && n > 0)
    : [];

  // Non-super-admin must always be in their own client's assignments
  if (!isSuperAdmin && !ids.includes(selfId)) {
    ids.push(selfId);
  }

  if (ids.length === 0) return [];

  const { rows } = await pool.query(
    'SELECT id FROM hr_users WHERE id = ANY($1)',
    [ids],
  );
  const validIds = new Set<number>(rows.map((r: any) => r.id));
  const invalid = ids.find(id => !validIds.has(id));
  if (invalid != null) {
    return { error: `المستخدم رقم ${invalid} غير موجود في النظام` };
  }

  return ids;
}

async function insertClientAssignments(
  clientId: number,
  userIds: number[],
  assignedBy: number,
): Promise<void> {
  if (userIds.length === 0) return;
  const values = userIds
    .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
    .join(', ');
  const params = userIds.flatMap(uid => [clientId, uid, assignedBy]);
  await pool.query(
    `INSERT INTO client_assignments (client_id, hr_user_id, assigned_by)
     VALUES ${values}
     ON CONFLICT (client_id, hr_user_id) DO NOTHING`,
    params,
  );
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
      conditions.push(`EXISTS (SELECT 1 FROM client_assignments WHERE client_id = c.id AND hr_user_id = $${params.length})`);
      params.push(authContext.allowedBranchIds);
      conditions.push(`c.branch_id = ANY($${params.length}::int[])`);
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(`${CLIENT_SELECT}${where} ORDER BY c.id`, params);

    // Defense-in-depth: ASSIGNED-scope users must not see who else is assigned to a client.
    // The column is already hidden on the frontend, but we strip it on the backend too.
    const responseRows = listAccess.scope === 'ASSIGNED'
      ? rows.map((r: any) => ({ ...r, assignments: [] }))
      : rows;

    res.json(responseRows);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/', requirePermission('clients.create'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const targetBranchId = resolveClientTargetBranch(req, req.body?.branchId);
    if (targetBranchId == null) {
      return res.status(400).json({ error: 'يجب تحديد الفرع المستهدف لهذه العملية' });
    }

    // Resolve the list of users this client will be assigned to.
    // Non-super-admin is always included in their own assignments (self-assign).
    const resolvedAssignees = await resolveAssignmentUserIds(
      req.body?.assignmentUserIds,
      authContext.userId,
      authContext.isSuperAdmin,
    );
    if ('error' in resolvedAssignees) {
      return res.status(400).json({ error: resolvedAssignees.error });
    }

    const createAccess = canCreateClient(authContext, {
      branchId: targetBranchId,
      assignedUserIds: resolvedAssignees,
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

    const { rows: [inserted] } = await pool.query(
      `INSERT INTO clients (
        first_name, father_name, last_name, nickname,
        name, mobile, contacts, governorate, district, neighborhood,
        detailed_address, gps_coordinates, gender, national_id, birth_date, occupation, spouse_occupation, data_quality, water_source, notes, rating,
        source_channel, referrer_type, referrer_id, referrer_name, referral_notes, referrers, referral_entity_id,
        referral_date, referral_reason, referral_sheet_id, referral_address_text,
        is_candidate, target_client, candidate_status,
        branch_id, created_by
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
      RETURNING id`,
      [
        c.firstName || null, c.fatherName || null, c.lastName || null, c.nickname || null,
        c.name, c.mobile, toJson(c.contacts, []), c.governorate || '', c.district || '', c.neighborhood || '',
        c.detailedAddress || null, c.gpsCoordinates ? toJson(c.gpsCoordinates, null) : null,
        c.gender || null, c.nationalId || null, c.birthDate || null, c.occupation || null,
        c.spouseOccupation || null, c.dataQuality || null, c.waterSource || null, c.notes || null, c.rating || null,
        c.sourceChannel || null, c.referrerType || null, c.referrerId || null, c.referrerName || null,
        c.referralNotes || null, toJson(c.referrers, []), c.referralEntityId || null,
        c.referralDate || null, c.referralReason || null, c.referralSheetId || null, c.referralAddressText || null,
        c.isCandidate || false, c.targetClient || null, c.candidateStatus || null,
        targetBranchId, authContext.userId,
      ],
    );

    await insertClientAssignments(inserted.id, resolvedAssignees, authContext.userId);

    // Auto-create an open device_demo task for new Lead (outside transaction — non-fatal)
    try {
      const existingTask = await pool.query(
        `SELECT 1 FROM open_tasks WHERE client_id = $1 AND task_type = 'device_demo' AND status IN ('open','in_contact_list','scheduled','in_visit','needs_reschedule')`,
        [inserted.id],
      );
      if (existingTask.rowCount === 0) {
        await pool.query(
          `INSERT INTO open_tasks (client_id, branch_id, task_type, task_family, reason, status, source, created_by)
           VALUES ($1, $2, 'device_demo', 'marketing', 'new_lead', 'open', 'system', $3)`,
          [inserted.id, targetBranchId, authContext.userId],
        );
      }
    } catch (taskErr: any) {
      // Unique constraint violation or other error — log and continue
      console.error('[clients] Failed to auto-create open_task for client', inserted.id, taskErr?.message || taskErr);
    }

    const { rows } = await pool.query(`${CLIENT_SELECT} WHERE c.id = $1`, [inserted.id]);
    res.json(rows[0]);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
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

    const duplicate = await findDuplicateClientByPhone(c.mobile, Number(clientId));
    if (duplicate) {
      return res.status(409).json({
        error: 'DUPLICATE_CLIENT_PHONE',
        ...buildSmartMatchResponse(authContext, duplicate, c.mobile),
      });
    }

    // Resolve assignment changes only if the caller explicitly provided a new list
    let newAssigneeIds: number[] | null = null;
    if (Array.isArray(req.body?.assignmentUserIds)) {
      const resolved = await resolveAssignmentUserIds(
        req.body.assignmentUserIds,
        authContext.userId,
        authContext.isSuperAdmin,
      );
      if ('error' in resolved) {
        return res.status(400).json({ error: resolved.error });
      }
      newAssigneeIds = resolved;
    }

    await pool.query(
      `UPDATE clients SET
        first_name=$1, father_name=$2, last_name=$3, nickname=$4,
        name=$5, mobile=$6, contacts=$7, governorate=$8, district=$9, neighborhood=$10,
        detailed_address=$11, gps_coordinates=$12, gender=$13, national_id=$14, birth_date=$15, occupation=$16, spouse_occupation=$17, data_quality=$18, water_source=$19, notes=$20, rating=$21,
        source_channel=$22, referrer_type=$23, referrer_id=$24, referrer_name=$25, referral_notes=$26, referrers=$27, referral_entity_id=$28,
        referral_date=$29, referral_reason=$30, referral_sheet_id=$31, referral_address_text=$32,
        is_candidate=$33, target_client=$34, candidate_status=$35
      WHERE id=$36`,
      [
        c.firstName || null, c.fatherName || null, c.lastName || null, c.nickname || null,
        c.name, c.mobile, toJson(c.contacts, []), c.governorate || '', c.district || '', c.neighborhood || '',
        c.detailedAddress || null, c.gpsCoordinates ? toJson(c.gpsCoordinates, null) : null,
        c.gender || null, c.nationalId || null, c.birthDate || null, c.occupation || null,
        c.spouseOccupation || null, c.dataQuality || null, c.waterSource || null, c.notes || null, c.rating || null,
        c.sourceChannel || null, c.referrerType || null, c.referrerId || null, c.referrerName || null,
        c.referralNotes || null, toJson(c.referrers, []), c.referralEntityId || null,
        c.referralDate || null, c.referralReason || null, c.referralSheetId || null, c.referralAddressText || null,
        c.isCandidate || false, c.targetClient || null, c.candidateStatus || null,
        clientId,
      ],
    );

    if (newAssigneeIds !== null) {
      await pool.query('DELETE FROM client_assignments WHERE client_id = $1', [clientId]);
      await insertClientAssignments(Number(clientId), newAssigneeIds, authContext.userId);
    }

    const { rows } = await pool.query(`${CLIENT_SELECT} WHERE c.id = $1`, [clientId]);
    res.json(rows[0]);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
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
      `SELECT
         c.id,
         c.branch_id AS "branchId",
         COALESCE(
           (SELECT array_agg(hr_user_id)
              FROM client_assignments
             WHERE client_id = c.id),
           '{}'::int[]
         ) AS "assignedUserIds"
       FROM clients c
      WHERE c.id = ANY($1)`,
      [ids],
    );

    for (const row of rows) {
      const access = canDeleteClient(authContext, {
        branchId: row.branchId,
        assignedUserIds: row.assignedUserIds,
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
