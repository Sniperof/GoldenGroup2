import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getOrBuildAuthContext, requirePermission } from '../middleware/permission.js';
import { canAccessGift, getGiftListAccessPlan } from '../policies/giftPolicy.js';

const router = Router();
router.use(requireAuth);

const recordSelect = `
  gr.id,
  gr.gift_definition_id AS "giftDefinitionId",
  gd.name AS "giftName",
  gd.kind AS "giftDefinitionKind",
  gd.default_unit_label AS "unitLabel",
  gr.approved_quantity AS "approvedQuantity",
  gr.beneficiary_name_snapshot AS "beneficiaryName",
  gr.beneficiary_type AS "beneficiaryType",
  gr.beneficiary_client_id AS "beneficiaryClientId",
  gr.beneficiary_employee_id AS "beneficiaryEmployeeId",
  gr.customer_id AS "customerId",
  gr.contract_id AS "contractId",
  c.contract_number AS "contractNumber",
  gr.condition_id AS "conditionId",
  gr.condition_label AS "conditionLabel",
  gr.condition_status AS "conditionStatus",
  gr.status,
  gr.source_branch_id AS "sourceBranchId",
  sb.name AS "sourceBranchName",
  gr.responsible_branch_id AS "responsibleBranchId",
  rb.name AS "responsibleBranchName",
  gr.assigned_user_id AS "assignedUserId",
  au.name AS "assignedUserName",
  gr.delivery_task_id AS "deliveryTaskId",
  gr.manual_delivered_at AS "manualDeliveredAt",
  gr.manual_delivered_by AS "manualDeliveredBy",
  gr.manual_delivery_notes AS "manualDeliveryNotes",
  gr.cancellation_reason AS "cancellationReason",
  gr.created_by AS "createdBy",
  gr.created_at AS "createdAt",
  gr.updated_at AS "updatedAt",
  COALESCE(
    (
      SELECT json_agg(json_build_object(
        'id', src.id,
        'sourceType', src.source_type,
        'contractId', src.contract_id,
        'referralSheetId', src.referral_sheet_id,
        'directReferralId', src.direct_referral_id,
        'label', src.source_label,
        'quantity', src.quantity,
        'notes', src.notes
      ) ORDER BY src.id)
      FROM gift_record_sources src
      WHERE src.gift_record_id = gr.id
    ),
    '[]'::json
  ) AS sources
`;

function normalizePositiveInt(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeConditionStatus(value: unknown): 'pending' | 'met' | 'not_met' {
  return value === 'met' || value === 'not_met' ? value : 'pending';
}

function normalizeDate(value: unknown): string | null {
  const text = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizePriority(value: unknown): 'low' | 'medium' | 'high' | null {
  return value === 'low' || value === 'medium' || value === 'high' ? value : null;
}

function mapRecord(row: any) {
  return {
    ...row,
    approvedQuantity: Number(row.approvedQuantity ?? 1),
    deliveryTaskId: row.deliveryTaskId == null ? null : String(row.deliveryTaskId),
    beneficiaryOwnershipLabel: row.beneficiaryClientId
      ? 'حسب ملكية الزبون المستفيد'
      : row.beneficiaryEmployeeId
        ? 'تسليم يدوي لموظف/وسيط داخلي'
        : 'تسليم يدوي',
  };
}

function mapDefinition(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    kind: row.kind,
    defaultUnitLabel: row.defaultUnitLabel,
    isActive: row.isActive === true,
    deliveryAcknowledgementRequired: true,
    usageCount: row.usageCount == null ? 0 : Number(row.usageCount),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadRecordSubject(recordId: number, currentUserId: number) {
  const { rows } = await pool.query(
    `SELECT
        gr.id,
        gr.source_branch_id AS "sourceBranchId",
        gr.responsible_branch_id AS "responsibleBranchId",
        gr.assigned_user_id AS "assignedUserId",
        gr.beneficiary_employee_id AS "beneficiaryEmployeeId",
        EXISTS (
          SELECT 1
          FROM client_assignments ca
          WHERE ca.client_id = gr.beneficiary_client_id
            AND ca.hr_user_id = $2
        ) AS "beneficiaryAssignedToCurrentUser"
       FROM gift_records gr
      WHERE gr.id = $1`,
    [recordId, currentUserId],
  );
  return rows[0] ?? null;
}

async function requireGiftAccess(req: any, res: any, recordId: number, permission: string) {
  const authContext = await getOrBuildAuthContext(req);
  const subject = await loadRecordSubject(recordId, authContext.userId);
  if (!subject) {
    res.status(404).json({ error: 'سجل الهدية غير موجود' });
    return null;
  }
  if (!canAccessGift(authContext, permission, subject, req.user?.employeeId ?? null)) {
    res.status(403).json({ error: 'غير مسموح' });
    return null;
  }
  return { authContext, subject };
}

async function getRecordById(recordId: number) {
  const { rows } = await pool.query(
    `SELECT ${recordSelect}
       FROM gift_records gr
       JOIN gift_definitions gd ON gd.id = gr.gift_definition_id
       LEFT JOIN contracts c ON c.id = gr.contract_id
       LEFT JOIN branches sb ON sb.id = gr.source_branch_id
       LEFT JOIN branches rb ON rb.id = gr.responsible_branch_id
       LEFT JOIN hr_users au ON au.id = gr.assigned_user_id
      WHERE gr.id = $1`,
    [recordId],
  );
  return rows[0] ? mapRecord(rows[0]) : null;
}

async function loadGiftPromiseCondition(conditionId: number | null) {
  if (!conditionId) return null;
  const { rows } = await pool.query(
    `SELECT id, value
       FROM system_lists
      WHERE id = $1
        AND category = 'gift_promise_conditions'
        AND is_active = TRUE
      LIMIT 1`,
    [conditionId],
  );
  return rows[0] ?? null;
}

router.get('/definitions', requirePermission('contract_gifts.view'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT gd.id, gd.name, gd.description, gd.kind,
            gd.default_unit_label AS "defaultUnitLabel",
            gd.is_active AS "isActive",
            gd.created_at AS "createdAt",
            gd.updated_at AS "updatedAt",
            COUNT(gr.id)::int AS "usageCount"
       FROM gift_definitions gd
       LEFT JOIN gift_records gr ON gr.gift_definition_id = gd.id
      GROUP BY gd.id
      ORDER BY gd.is_active DESC, gd.kind ASC, gd.name ASC`,
  );
  res.json(rows.map(mapDefinition));
});

router.post('/definitions', requirePermission('contract_gifts.manage'), async (req, res) => {
  const name = normalizeText(req.body?.name);
  const description = normalizeText(req.body?.description);
  const kind = req.body?.kind === 'gift_contract' ? 'gift_contract' : 'standard_gift';
  const defaultUnitLabel = normalizeText(req.body?.defaultUnitLabel) || (kind === 'gift_contract' ? 'عقد' : 'هدية');
  if (!name) {
    return res.status(400).json({ error: 'اسم الهدية مطلوب' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO gift_definitions (
          name, description, kind, default_unit_label, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $5)
        RETURNING id, name, description, kind,
                  default_unit_label AS "defaultUnitLabel",
                  is_active AS "isActive",
                  created_at AS "createdAt",
                  updated_at AS "updatedAt"`,
      [name, description || null, kind, defaultUnitLabel, req.user?.id ?? null],
    );
    res.status(201).json(mapDefinition(rows[0]));
  } catch (error: any) {
    if (error?.code === '23505') {
      return res.status(409).json({ error: 'يوجد تعريف هدية بنفس الاسم' });
    }
    console.error('Create gift definition failed:', error);
    res.status(500).json({ error: 'فشل إنشاء تعريف الهدية' });
  }
});

router.patch('/definitions/:id', requirePermission('contract_gifts.manage'), async (req, res) => {
  const id = normalizePositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'معرف غير صالح' });

  const name = normalizeText(req.body?.name);
  const description = req.body?.description == null ? null : normalizeText(req.body.description);
  const defaultUnitLabel = normalizeText(req.body?.defaultUnitLabel);
  const isActive = typeof req.body?.isActive === 'boolean' ? req.body.isActive : null;
  const kind = req.body?.kind === 'gift_contract' || req.body?.kind === 'standard_gift' ? req.body.kind : null;

  const { rows } = await pool.query(
    `UPDATE gift_definitions
        SET name = COALESCE(NULLIF($2, ''), name),
            description = COALESCE($3, description),
            default_unit_label = COALESCE(NULLIF($4, ''), default_unit_label),
            is_active = COALESCE($5, is_active),
            kind = COALESCE($6, kind),
            updated_by = $7,
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, name, description, kind,
                default_unit_label AS "defaultUnitLabel",
                is_active AS "isActive",
                created_at AS "createdAt",
                updated_at AS "updatedAt"`,
    [id, name, description, defaultUnitLabel, isActive, kind, req.user?.id ?? null],
  );
  if (!rows[0]) return res.status(404).json({ error: 'تعريف الهدية غير موجود' });
  res.json(mapDefinition(rows[0]));
});

router.delete('/definitions/:id', requirePermission('contract_gifts.manage'), async (req, res) => {
  const id = normalizePositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'معرف غير صالح' });

  const { rows } = await pool.query(
    `SELECT gd.id, gd.kind, COUNT(gr.id)::int AS usage_count
       FROM gift_definitions gd
       LEFT JOIN gift_records gr ON gr.gift_definition_id = gd.id
      WHERE gd.id = $1
      GROUP BY gd.id, gd.kind`,
    [id],
  );
  const definition = rows[0];
  if (!definition) return res.status(404).json({ error: 'تعريف الهدية غير موجود' });

  if (definition.kind === 'gift_contract' || Number(definition.usage_count) > 0) {
    const updated = await pool.query(
      `UPDATE gift_definitions
          SET is_active = FALSE, updated_by = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING id, name, description, kind,
                  default_unit_label AS "defaultUnitLabel",
                  is_active AS "isActive",
                  created_at AS "createdAt",
                  updated_at AS "updatedAt"`,
      [id, req.user?.id ?? null],
    );
    return res.json({ mode: 'deactivated', definition: mapDefinition(updated.rows[0]) });
  }

  await pool.query('DELETE FROM gift_definitions WHERE id = $1', [id]);
  res.json({ mode: 'deleted' });
});

router.get('/records', requirePermission('contract_gifts.view'), async (req, res) => {
  const authContext = await getOrBuildAuthContext(req as any);
  const accessPlan = getGiftListAccessPlan(authContext, 'contract_gifts.view');
  if (accessPlan.scope === 'NONE') {
    return res.status(403).json({ error: 'غير مسموح' });
  }

  const conditions: string[] = [];
  const params: any[] = [];
  const branchId = normalizePositiveInt(req.query.branchId);
  const status = normalizeText(req.query.status);
  const conditionStatus = normalizeText(req.query.conditionStatus);
  const clientId = normalizePositiveInt(req.query.clientId);
  const employeeId = normalizePositiveInt(req.query.employeeId);
  const contractId = normalizePositiveInt(req.query.contractId);

  if (branchId != null) {
    params.push(branchId);
    conditions.push(`(gr.source_branch_id = $${params.length} OR gr.responsible_branch_id = $${params.length})`);
  }
  if (status) {
    params.push(status);
    conditions.push(`gr.status = $${params.length}`);
  }
  if (conditionStatus) {
    params.push(conditionStatus);
    conditions.push(`gr.condition_status = $${params.length}`);
  }
  if (clientId != null) {
    params.push(clientId);
    conditions.push(`(gr.beneficiary_client_id = $${params.length} OR gr.customer_id = $${params.length})`);
  }
  if (employeeId != null) {
    params.push(employeeId);
    conditions.push(`gr.beneficiary_employee_id = $${params.length}`);
  }
  if (contractId != null) {
    params.push(contractId);
    conditions.push(`gr.contract_id = $${params.length}`);
  }

  if (accessPlan.scope === 'BRANCH') {
    params.push(accessPlan.allowedBranchIds);
    conditions.push(`(gr.source_branch_id = ANY($${params.length}::int[]) OR gr.responsible_branch_id = ANY($${params.length}::int[]))`);
  } else if (accessPlan.scope === 'ASSIGNED') {
    params.push(accessPlan.allowedBranchIds);
    const branchParam = params.length;
    params.push(accessPlan.userId);
    const userParam = params.length;
    params.push(req.user?.employeeId ?? null);
    const employeeParam = params.length;
    conditions.push(`(
      (gr.source_branch_id = ANY($${branchParam}::int[]) OR gr.responsible_branch_id = ANY($${branchParam}::int[]))
      AND (
        gr.assigned_user_id = $${userParam}
        OR EXISTS (
          SELECT 1 FROM client_assignments ca
          WHERE ca.client_id = gr.beneficiary_client_id
            AND ca.hr_user_id = $${userParam}
        )
        OR ($${employeeParam}::int IS NOT NULL AND gr.beneficiary_employee_id = $${employeeParam})
      )
    )`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT ${recordSelect}
       FROM gift_records gr
       JOIN gift_definitions gd ON gd.id = gr.gift_definition_id
       LEFT JOIN contracts c ON c.id = gr.contract_id
       LEFT JOIN branches sb ON sb.id = gr.source_branch_id
       LEFT JOIN branches rb ON rb.id = gr.responsible_branch_id
       LEFT JOIN hr_users au ON au.id = gr.assigned_user_id
      ${whereClause}
      ORDER BY gr.created_at DESC, gr.id DESC
      LIMIT 500`,
    params,
  );
  res.json(rows.map(mapRecord));
});

router.post('/records', requirePermission('contract_gifts.manage'), async (req, res) => {
  const giftDefinitionId = normalizePositiveInt(req.body?.giftDefinitionId);
  const beneficiaryType = normalizeText(req.body?.beneficiaryType);
  const beneficiaryClientId = normalizePositiveInt(req.body?.beneficiaryClientId);
  const beneficiaryEmployeeId = normalizePositiveInt(req.body?.beneficiaryEmployeeId);
  const beneficiaryName = normalizeText(req.body?.beneficiaryNameSnapshot ?? req.body?.beneficiaryName);
  const conditionId = normalizePositiveInt(req.body?.conditionId);
  const conditionListItem = await loadGiftPromiseCondition(conditionId);
  if (conditionId && !conditionListItem) {
    return res.status(400).json({ error: 'شرط وعد الهدية غير صالح' });
  }
  const conditionLabel = normalizeText(req.body?.conditionLabel) || normalizeText(conditionListItem?.value);
  const approvedQuantity = Math.max(1, normalizePositiveInt(req.body?.approvedQuantity ?? req.body?.quantity) ?? 1);
  const source = req.body?.source ?? {};
  const sourceType = normalizeText(source.sourceType);

  if (!giftDefinitionId || !beneficiaryName || !conditionLabel) {
    return res.status(400).json({ error: 'تعريف الهدية والمستفيد والشرط مطلوبة' });
  }
  if (!['contract_customer', 'customer_referrer', 'employee_or_personal'].includes(beneficiaryType)) {
    return res.status(400).json({ error: 'نوع المستفيد غير صالح' });
  }
  if ((beneficiaryType === 'contract_customer' || beneficiaryType === 'customer_referrer') && !beneficiaryClientId) {
    return res.status(400).json({ error: 'المستفيد الزبون يجب أن يرتبط بسجل زبون معروف' });
  }
  if (!['contract', 'name_list', 'direct_referral'].includes(sourceType)) {
    return res.status(400).json({ error: 'مصدر الوعد غير صالح' });
  }

  const sourceBranchId = normalizePositiveInt(req.body?.sourceBranchId);
  const responsibleBranchId = normalizePositiveInt(req.body?.responsibleBranchId) ?? sourceBranchId;
  if (!sourceBranchId || !responsibleBranchId) {
    return res.status(400).json({ error: 'فرع المصدر وفرع المسؤولية مطلوبان' });
  }

  const authContext = await getOrBuildAuthContext(req as any);
  if (!canAccessGift(authContext, 'contract_gifts.manage', {
    sourceBranchId,
    responsibleBranchId,
    assignedUserId: normalizePositiveInt(req.body?.assignedUserId),
  }, req.user?.employeeId ?? null)) {
    return res.status(403).json({ error: 'غير مسموح' });
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const recordResult = await db.query(
      `INSERT INTO gift_records (
          gift_definition_id, beneficiary_type, beneficiary_client_id,
          beneficiary_employee_id, beneficiary_name_snapshot, customer_id,
          contract_id, condition_id, condition_label, condition_status, approved_quantity,
          source_branch_id, responsible_branch_id, assigned_user_id,
          created_by, updated_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
        RETURNING id`,
      [
        giftDefinitionId,
        beneficiaryType,
        beneficiaryClientId,
        beneficiaryEmployeeId,
        beneficiaryName,
        normalizePositiveInt(req.body?.customerId),
        normalizePositiveInt(req.body?.contractId),
        conditionId,
        conditionLabel,
        normalizeConditionStatus(req.body?.conditionStatus),
        approvedQuantity,
        sourceBranchId,
        responsibleBranchId,
        normalizePositiveInt(req.body?.assignedUserId),
        req.user?.id ?? null,
      ],
    );
    const recordId = recordResult.rows[0].id;
    await db.query(
      `INSERT INTO gift_record_sources (
          gift_record_id, source_type, contract_id, referral_sheet_id,
          direct_referral_id, source_label, quantity, notes
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        recordId,
        sourceType,
        normalizePositiveInt(source.contractId) ?? normalizePositiveInt(req.body?.contractId),
        normalizePositiveInt(source.referralSheetId),
        normalizePositiveInt(source.directReferralId),
        normalizeText(source.sourceLabel ?? source.label) || 'مصدر وعد هدية',
        Math.max(1, normalizePositiveInt(source.quantity) ?? approvedQuantity),
        normalizeText(source.notes) || null,
      ],
    );
    await db.query('COMMIT');
    const record = await getRecordById(recordId);
    res.status(201).json(record);
  } catch (error: any) {
    await db.query('ROLLBACK');
    if (error?.code === '23505' && error?.constraint === 'uq_gift_records_open_promise') {
      return res.status(409).json({ error: 'يوجد وعد هدية مفتوح لنفس المستفيد ونفس التعريف ونفس الشرط' });
    }
    console.error('Create gift record failed:', error);
    res.status(500).json({ error: 'فشل إنشاء سجل الهدية' });
  } finally {
    db.release();
  }
});

async function createDeliveryTaskForGiftRecords(req: any, res: any, ids: number[]) {
  if (ids.length === 0) {
    return res.status(400).json({ error: 'سجل هدية واحد على الأقل مطلوب' });
  }

  const authContext = await getOrBuildAuthContext(req);
  for (const id of ids) {
    const subject = await loadRecordSubject(id, authContext.userId);
    if (!subject) return res.status(404).json({ error: `سجل الهدية ${id} غير موجود` });
    if (!canAccessGift(authContext, 'contract_gifts.create_delivery_task', subject, req.user?.employeeId ?? null)) {
      return res.status(403).json({ error: 'غير مسموح إنشاء مهمة تسليم لهذه الهدية' });
    }
  }

  const { rows } = await pool.query(
    `SELECT gr.id, gr.beneficiary_type, gr.beneficiary_client_id, gr.beneficiary_name_snapshot,
            gr.responsible_branch_id, gr.source_branch_id, gr.status, gr.delivery_task_id,
            gd.name AS gift_name
       FROM gift_records gr
       JOIN gift_definitions gd ON gd.id = gr.gift_definition_id
      WHERE gr.id = ANY($1::int[])
      ORDER BY gr.id`,
    [ids],
  );
  if (rows.length !== ids.length) {
    return res.status(404).json({ error: 'بعض سجلات الهدايا غير موجودة' });
  }

  const beneficiaryClientId = rows[0].beneficiary_client_id ? Number(rows[0].beneficiary_client_id) : null;
  if (!beneficiaryClientId || rows.some((row: any) => Number(row.beneficiary_client_id) !== beneficiaryClientId)) {
    return res.status(400).json({ error: 'مهمة تسليم الهدية تتطلب مستفيداً واحداً مرتبطاً بزبون معروف' });
  }
  if (rows.some((row: any) => !['contract_customer', 'customer_referrer'].includes(row.beneficiary_type))) {
    return res.status(400).json({ error: 'الوسطاء الموظفون/الشخصيون يؤكد تسليمهم يدوياً ولا تنشأ لهم مهمة تسليم' });
  }
  const blocked = rows.find((row: any) => row.status !== 'approved_for_delivery');
  if (blocked) {
    return res.status(409).json({ error: `سجل الهدية ${blocked.id} في حالة لا تسمح بإنشاء مهمة تسليم` });
  }
  const alreadyLinked = rows.find((row: any) => row.delivery_task_id != null);
  if (alreadyLinked) {
    return res.status(409).json({ error: `سجل الهدية ${alreadyLinked.id} مرتبط مسبقاً بمهمة تسليم`, deliveryTaskId: alreadyLinked.delivery_task_id });
  }

  const branchId = Number(rows[0].responsible_branch_id ?? rows[0].source_branch_id);
  if (!branchId || rows.some((row: any) => Number(row.responsible_branch_id ?? row.source_branch_id) !== branchId)) {
    return res.status(400).json({ error: 'كل سجلات مهمة التسليم يجب أن تتبع فرع مسؤولية واحد' });
  }

  const dueDate = normalizeDate(req.body?.dueDate);
  if (!dueDate) {
    return res.status(400).json({ error: 'تاريخ التسليم المطلوب إلزامي' });
  }
  const priority = normalizePriority(req.body?.priority);
  if (!priority) {
    return res.status(400).json({ error: 'أولوية مهمة التسليم إلزامية' });
  }
  const notes = normalizeText(req.body?.notes);
  const giftLabel = rows.length === 1
    ? rows[0].gift_name
    : `${rows.length} سجلات هدايا`;

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows: taskRows } = await db.query(
      `INSERT INTO open_tasks (
         client_id, branch_id, task_type, task_family, reason, status,
         due_date, expected_date, priority, source, notes, created_by, origin,
         source_context_type, source_context_id, creation_origin, creation_reason
       ) VALUES ($1, $2, 'gift_delivery', 'delivery', 'gift_delivery', 'open',
         $3::date, $3::date, $4, 'manual', $5, $6, 'gift_record',
         'gift_records', $7, 'gift_record', 'gift_delivery')
       RETURNING id`,
      [
        beneficiaryClientId,
        branchId,
        dueDate,
        priority,
        notes || `تسليم ${giftLabel} للمستفيد: ${rows[0].beneficiary_name_snapshot}`,
        authContext.userId ?? null,
        rows[0].id,
      ],
    );
    const taskId = Number(taskRows[0].id);

    await db.query(
      `UPDATE gift_records
          SET status = 'delivery_task_created',
              delivery_task_id = $2,
              updated_by = $3,
              updated_at = NOW()
        WHERE id = ANY($1::int[])`,
      [ids, taskId, authContext.userId ?? null],
    );
    await db.query('COMMIT');
    const refreshed = await pool.query(
      `SELECT ${recordSelect}
         FROM gift_records gr
         JOIN gift_definitions gd ON gd.id = gr.gift_definition_id
         LEFT JOIN contracts c ON c.id = gr.contract_id
         LEFT JOIN branches sb ON sb.id = gr.source_branch_id
         LEFT JOIN branches rb ON rb.id = gr.responsible_branch_id
         LEFT JOIN hr_users au ON au.id = gr.assigned_user_id
        WHERE gr.id = ANY($1::int[])
        ORDER BY gr.id`,
      [ids],
    );
    return res.status(201).json({ deliveryTaskId: taskId, records: refreshed.rows.map(mapRecord) });
  } catch (error) {
    await db.query('ROLLBACK');
    console.error('Create gift delivery task failed:', error);
    return res.status(500).json({ error: 'فشل إنشاء مهمة تسليم الهدية' });
  } finally {
    db.release();
  }
}

router.post('/records/create-delivery-task', requirePermission('contract_gifts.create_delivery_task'), async (req, res) => {
  const ids = Array.isArray(req.body?.giftRecordIds)
    ? req.body.giftRecordIds.map(normalizePositiveInt).filter((id: number | null): id is number => id != null)
    : [];
  return createDeliveryTaskForGiftRecords(req, res, Array.from(new Set(ids)));
});

router.post('/records/:id/create-delivery-task', requirePermission('contract_gifts.create_delivery_task'), async (req, res) => {
  const id = normalizePositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'معرف غير صالح' });
  const extraIds = Array.isArray(req.body?.giftRecordIds)
    ? req.body.giftRecordIds.map(normalizePositiveInt).filter((value: number | null): value is number => value != null)
    : [];
  return createDeliveryTaskForGiftRecords(req, res, Array.from(new Set([id, ...extraIds])));
});

router.patch('/records/:id/condition', requirePermission('contract_gifts.verify_condition'), async (req, res) => {
  const id = normalizePositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'معرف غير صالح' });
  const access = await requireGiftAccess(req, res, id, 'contract_gifts.verify_condition');
  if (!access) return;

  const conditionStatus = normalizeConditionStatus(req.body?.conditionStatus);
  const result = await pool.query(
    `UPDATE gift_records
        SET condition_status = $2, updated_by = $3, updated_at = NOW()
      WHERE id = $1
        AND status IN ('promised', 'approved_for_delivery')`,
    [id, conditionStatus, req.user?.id ?? null],
  );
  if (result.rowCount === 0) {
    return res.status(409).json({ error: 'لا يمكن تعديل تحقق الشرط بعد إنشاء مهمة أو إغلاق السجل' });
  }
  res.json(await getRecordById(id));
});

router.post('/records/:id/approve', requirePermission('contract_gifts.approve_delivery'), async (req, res) => {
  const id = normalizePositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'معرف غير صالح' });
  const access = await requireGiftAccess(req, res, id, 'contract_gifts.approve_delivery');
  if (!access) return;

  const { rows: currentRows } = await pool.query(
    `SELECT condition_status FROM gift_records WHERE id = $1 LIMIT 1`,
    [id],
  );
  const approvalNotes = normalizeText(req.body?.approvalNotes ?? req.body?.notes);
  if (currentRows[0]?.condition_status === 'not_met' && !approvalNotes) {
    return res.status(400).json({ error: 'ملاحظات الاعتماد إلزامية عند اعتماد سجل شرطه غير محقق' });
  }

  await pool.query(
    `UPDATE gift_records
        SET status = 'approved_for_delivery',
            approved_quantity = COALESCE($2, approved_quantity),
            approval_notes = COALESCE(NULLIF($4, ''), approval_notes),
            updated_by = $3,
            updated_at = NOW()
      WHERE id = $1
        AND status IN ('promised', 'approved_for_delivery')`,
    [id, normalizePositiveInt(req.body?.approvedQuantity), req.user?.id ?? null, approvalNotes],
  );
  res.json(await getRecordById(id));
});

router.post('/records/:id/manual-delivery', requirePermission('contract_gifts.manual_delivery'), async (req, res) => {
  const id = normalizePositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'معرف غير صالح' });
  const access = await requireGiftAccess(req, res, id, 'contract_gifts.manual_delivery');
  if (!access) return;

  const result = await pool.query(
    `UPDATE gift_records
        SET status = 'delivered_manually',
            manual_delivered_at = NOW(),
            manual_delivered_by = $2,
            manual_delivery_notes = NULLIF($3, ''),
            updated_by = $2,
            updated_at = NOW()
      WHERE id = $1
        AND status = 'approved_for_delivery'
        AND delivery_task_id IS NULL
        AND beneficiary_type = 'employee_or_personal'`,
    [id, req.user?.id ?? null, normalizeText(req.body?.notes)],
  );
  if (result.rowCount === 0) {
    return res.status(409).json({ error: 'التسليم اليدوي متاح فقط لسجل معتمد بلا مهمة ولوسيط موظف/شخصي' });
  }
  res.json(await getRecordById(id));
});

router.post('/records/:id/cancel', requirePermission('contract_gifts.cancel'), async (req, res) => {
  const id = normalizePositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'معرف غير صالح' });
  const access = await requireGiftAccess(req, res, id, 'contract_gifts.cancel');
  if (!access) return;

  const result = await pool.query(
    `UPDATE gift_records
        SET status = 'cancelled',
            cancellation_reason = NULLIF($2, ''),
            updated_by = $3,
            updated_at = NOW()
      WHERE id = $1
        AND status IN ('promised', 'approved_for_delivery')`,
    [id, normalizeText(req.body?.reason), req.user?.id ?? null],
  );
  if (result.rowCount === 0) {
    return res.status(409).json({ error: 'لا يمكن إلغاء سجل الهدية بعد إنشاء مهمة أو إغلاق السجل' });
  }
  res.json(await getRecordById(id));
});

export default router;
