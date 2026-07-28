import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getOrBuildAuthContext, requirePermission } from '../middleware/permission.js';
import { canAccessGift, getGiftListAccessPlan } from '../policies/giftPolicy.js';
import {
  GiftDeliveryTaskCreationError,
  insertGiftDeliveryLinkedEvents,
  mapGiftDeliveryCreationDatabaseError,
} from '../services/giftDeliveryTaskCreation.js';

const router = Router();
router.use(requireAuth);

const recordSelect = `
  gr.id,
  gr.gift_definition_id AS "giftDefinitionId",
  gd.name AS "giftName",
  gd.kind AS "giftDefinitionKind",
  gd.default_unit_label AS "unitLabel",
  gr.promised_quantity AS "promisedQuantity",
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
  gr.condition_notes AS "conditionNotes",
  gr.condition_verified_by AS "conditionVerifiedBy",
  gr.condition_verified_at AS "conditionVerifiedAt",
  gr.status,
  gr.approved_by AS "approvedBy",
  gr.approved_at AS "approvedAt",
  gr.approval_notes AS "approvalNotes",
  gr.source_branch_id AS "sourceBranchId",
  sb.name AS "sourceBranchName",
  gr.responsible_branch_id AS "responsibleBranchId",
  rb.name AS "responsibleBranchName",
  gr.assigned_user_id AS "assignedUserId",
  au.name AS "assignedUserName",
  gr.delivery_task_id AS "deliveryTaskId",
  gr.manual_delivered_at AS "manualDeliveredAt",
  gr.manual_delivered_by AS "manualDeliveredBy",
  gr.manual_delivery_method_id AS "manualDeliveryMethodId",
  gr.manual_delivery_acknowledged AS "manualDeliveryAcknowledged",
  gr.manual_delivery_branch_id AS "manualDeliveryBranchId",
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
        'candidateId', src.candidate_id,
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
    promisedQuantity: Number(row.promisedQuantity ?? 1),
    approvedQuantity: row.approvedQuantity == null ? null : Number(row.approvedQuantity),
    deliveryTaskId: row.deliveryTaskId == null ? null : String(row.deliveryTaskId),
    beneficiaryOwnershipLabel: row.beneficiaryClientId
      ? 'حسب ملكية الزبون المستفيد'
      : row.beneficiaryEmployeeId
        ? 'تسليم يدوي لموظف/وسيط داخلي'
        : 'تسليم يدوي',
  };
}

type GiftBeneficiaryType =
  | 'contract_customer'
  | 'customer_referrer'
  | 'employee_referrer'
  | 'personal_referrer';

function isGiftBeneficiaryType(value: string): value is GiftBeneficiaryType {
  return [
    'contract_customer',
    'customer_referrer',
    'employee_referrer',
    'personal_referrer',
  ].includes(value);
}

async function findSimilarGiftRecords(
  db: { query: (text: string, params?: any[]) => Promise<any> },
  input: {
    giftDefinitionId: number;
    beneficiaryType: GiftBeneficiaryType;
    beneficiaryClientId: number | null;
    beneficiaryEmployeeId: number | null;
    beneficiaryName: string;
  },
) {
  const { rows } = await db.query(
    `SELECT gr.id,
            gr.status,
            gr.beneficiary_name_snapshot AS "beneficiaryName",
            gr.promised_quantity AS "promisedQuantity",
            gr.approved_quantity AS "approvedQuantity",
            gr.created_at AS "createdAt",
            gd.name AS "giftName"
       FROM gift_records gr
       JOIN gift_definitions gd ON gd.id = gr.gift_definition_id
      WHERE gr.gift_definition_id = $1
        AND gr.beneficiary_type = $2
        AND COALESCE(gr.beneficiary_client_id, 0) = COALESCE($3, 0)
        AND COALESCE(gr.beneficiary_employee_id, 0) = COALESCE($4, 0)
        AND (
          $2 <> 'personal_referrer'
          OR lower(btrim(gr.beneficiary_name_snapshot)) = lower(btrim($5))
        )
        AND gr.status IN ('promised', 'approved_for_delivery', 'delivery_task_created')
      ORDER BY gr.created_at DESC, gr.id DESC`,
    [
      input.giftDefinitionId,
      input.beneficiaryType,
      input.beneficiaryClientId,
      input.beneficiaryEmployeeId,
      input.beneficiaryName,
    ],
  );
  return rows;
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

async function loadGiftPromiseConditionByValue(value: string | null) {
  if (!value) return null;
  const { rows } = await pool.query(
    `SELECT id, value
       FROM system_lists
      WHERE value = $1
        AND category = 'gift_promise_conditions'
        AND is_active = TRUE
      LIMIT 1`,
    [value],
  );
  return rows[0] ?? null;
}

const legacyGiftConditionValues: Record<string, string> = {
  'توقيع عقد نقدي': 'cash_contract',
  'استحقاق بعد الدفعة الثانية': 'after_second_installment',
  'شراء أكثر من عقد': 'multiple_contracts',
  'وسيط بيعة من نوع زبون': 'contract_referrer_gift',
  'وسيط بيعة من نوع موظف': 'contract_referrer_gift',
  'وسيط بيعة شخصي': 'contract_referrer_gift',
  'قرار إداري': 'administrative_commitment',
  'عقد هدية معتمد': 'gift_contract',
};

const sourceGiftConditionValues: Record<string, string> = {
  name_list: 'name_list_referral_sale',
  direct_referral: 'direct_referral_sale',
  candidate: 'candidate_referral_sale',
};

async function resolveGiftDeliveryCreationReason(value: unknown) {
  const creationReason = normalizeText(value);
  const { rows } = await pool.query(
    `SELECT value
       FROM system_lists
      WHERE category = 'gift_delivery_creation_reasons'
        AND is_active = TRUE
        AND COALESCE(metadata->>'systemReason', 'gift_delivery') = 'gift_delivery'
        AND (
          NULLIF($1::text, '') IS NULL
          OR value = $1
        )
      ORDER BY
        CASE WHEN value = $1 THEN 0 ELSE 1 END,
        display_order ASC,
        id ASC
      LIMIT 1`,
    [creationReason || null],
  );
  return rows[0]?.value ? String(rows[0].value) : null;
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

router.post('/records/similar', requirePermission('contract_gifts.manage'), async (req, res) => {
  const giftDefinitionId = normalizePositiveInt(req.body?.giftDefinitionId);
  const beneficiaryType = normalizeText(req.body?.beneficiaryType);
  const beneficiaryClientId = normalizePositiveInt(req.body?.beneficiaryClientId);
  const beneficiaryEmployeeId = normalizePositiveInt(req.body?.beneficiaryEmployeeId);
  const beneficiaryName = normalizeText(req.body?.beneficiaryNameSnapshot ?? req.body?.beneficiaryName);
  const sourceBranchId = normalizePositiveInt(req.body?.sourceBranchId);
  const responsibleBranchId = normalizePositiveInt(req.body?.responsibleBranchId) ?? sourceBranchId;

  if (!giftDefinitionId || !isGiftBeneficiaryType(beneficiaryType) || !beneficiaryName) {
    return res.status(400).json({ error: 'بيانات فحص الوعود المشابهة غير مكتملة' });
  }
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

  const records = await findSimilarGiftRecords(pool, {
    giftDefinitionId,
    beneficiaryType,
    beneficiaryClientId,
    beneficiaryEmployeeId,
    beneficiaryName,
  });
  res.json({ count: records.length });
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
  const source = req.body?.source ?? {};
  const sourceType = normalizeText(source.sourceType);
  let conditionId = normalizePositiveInt(req.body?.conditionId);
  let conditionListItem = await loadGiftPromiseCondition(conditionId);
  if (!conditionListItem && !conditionId) {
    const requestedConditionLabel = normalizeText(req.body?.conditionLabel);
    conditionListItem = await loadGiftPromiseConditionByValue(
      legacyGiftConditionValues[requestedConditionLabel]
      ?? sourceGiftConditionValues[sourceType]
      ?? null,
    );
    conditionId = normalizePositiveInt(conditionListItem?.id);
  }
  if (!conditionId || !conditionListItem) {
    return res.status(400).json({ error: 'شرط وعد الهدية غير صالح' });
  }
  const conditionLabel = normalizeText(req.body?.conditionLabel) || normalizeText(conditionListItem?.value);
  const conditionNotes = normalizeText(req.body?.conditionNotes);
  if (conditionListItem?.value === 'other' && !conditionNotes) {
    return res.status(400).json({ error: 'ملاحظات الشرط إلزامية عند اختيار شرط آخر' });
  }
  const promisedQuantity = Math.max(1, normalizePositiveInt(req.body?.promisedQuantity ?? req.body?.quantity) ?? 1);

  if (!giftDefinitionId || !beneficiaryName || !conditionLabel) {
    return res.status(400).json({ error: 'تعريف الهدية والمستفيد والشرط مطلوبة' });
  }
  if (!isGiftBeneficiaryType(beneficiaryType)) {
    return res.status(400).json({ error: 'نوع المستفيد غير صالح' });
  }
  if ((beneficiaryType === 'contract_customer' || beneficiaryType === 'customer_referrer') && !beneficiaryClientId) {
    return res.status(400).json({ error: 'المستفيد الزبون يجب أن يرتبط بسجل زبون معروف' });
  }
  if (beneficiaryType === 'employee_referrer' && !beneficiaryEmployeeId) {
    return res.status(400).json({ error: 'المستفيد الموظف يجب أن يرتبط بسجل موظف معروف' });
  }
  if (
    ((beneficiaryType === 'contract_customer' || beneficiaryType === 'customer_referrer') && beneficiaryEmployeeId)
    || (beneficiaryType === 'employee_referrer' && beneficiaryClientId)
    || (beneficiaryType === 'personal_referrer' && (beneficiaryClientId || beneficiaryEmployeeId))
  ) {
    return res.status(400).json({ error: 'هوية مستفيد الهدية لا تطابق نوعه' });
  }
  if (!['contract', 'name_list', 'direct_referral', 'candidate'].includes(sourceType)) {
    return res.status(400).json({ error: 'مصدر الوعد غير صالح' });
  }
  if (sourceType === 'contract' && !(normalizePositiveInt(source.contractId) ?? normalizePositiveInt(req.body?.contractId))) {
    return res.status(400).json({ error: 'مصدر العقد مطلوب لوعد الهدية' });
  }
  if (sourceType === 'name_list' && !normalizePositiveInt(source.referralSheetId)) {
    return res.status(400).json({ error: 'مصدر لائحة الأسماء مطلوب لوعد الهدية' });
  }
  if (sourceType === 'direct_referral' && !normalizePositiveInt(source.directReferralId)) {
    return res.status(400).json({ error: 'مصدر الاقتراح المباشر مطلوب لوعد الهدية' });
  }
  if (sourceType === 'candidate' && !normalizePositiveInt(source.candidateId)) {
    return res.status(400).json({ error: 'مصدر الاسم المقترح مطلوب لوعد الهدية' });
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

  const similarRecords = await findSimilarGiftRecords(pool, {
    giftDefinitionId,
    beneficiaryType,
    beneficiaryClientId,
    beneficiaryEmployeeId,
    beneficiaryName,
  });
  const warningAcknowledged = req.body?.similarPromiseWarningAcknowledged === true;
  if (similarRecords.length > 0 && !warningAcknowledged) {
    return res.status(409).json({
      error: 'توجد وعود هدايا غير منتهية مشابهة لهذا المستفيد. يمكنك المتابعة بعد تأكيد الاطلاع على التنبيه.',
      code: 'similar_gift_promises',
      similarCount: similarRecords.length,
    });
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const recordResult = await db.query(
      `INSERT INTO gift_records (
          gift_definition_id, beneficiary_type, beneficiary_client_id,
          beneficiary_employee_id, beneficiary_name_snapshot, customer_id,
          contract_id, condition_id, condition_label, condition_status, condition_notes,
          promised_quantity, approved_quantity,
          source_branch_id, responsible_branch_id, assigned_user_id,
          created_by, updated_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',NULLIF($10,''),$11,NULL,$12,$13,$14,$15,$15)
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
        conditionNotes,
        promisedQuantity,
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
          direct_referral_id, candidate_id, source_label, quantity, notes
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        recordId,
        sourceType,
        normalizePositiveInt(source.contractId) ?? normalizePositiveInt(req.body?.contractId),
        normalizePositiveInt(source.referralSheetId),
        normalizePositiveInt(source.directReferralId),
        normalizePositiveInt(source.candidateId),
        normalizeText(source.sourceLabel ?? source.label) || 'مصدر وعد هدية',
        Math.max(1, normalizePositiveInt(source.quantity) ?? promisedQuantity),
        normalizeText(source.notes) || null,
      ],
    );
    await db.query(
      `INSERT INTO gift_record_events (
         gift_record_id, event_type, actor_user_id, previous_status, new_status, metadata
       ) VALUES ($1, 'promise_created', $2, NULL, 'promised', $3::jsonb)`,
      [
        recordId,
        req.user?.id ?? null,
        JSON.stringify({
          similarGiftRecordIds: similarRecords.map((record: any) => Number(record.id)),
          similarPromiseWarningAcknowledged: warningAcknowledged,
        }),
      ],
    );
    await db.query('COMMIT');
    const record = await getRecordById(recordId);
    res.status(201).json(record);
  } catch (error: any) {
    await db.query('ROLLBACK');
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

  const dueDate = normalizeDate(req.body?.dueDate);
  if (!dueDate) {
    return res.status(400).json({ error: 'تاريخ التسليم المطلوب إلزامي' });
  }
  const priority = normalizePriority(req.body?.priority);
  if (!priority) {
    return res.status(400).json({ error: 'أولوية مهمة التسليم إلزامية' });
  }
  const notes = normalizeText(req.body?.notes);
  const creationReason = await resolveGiftDeliveryCreationReason(req.body?.creationReason);
  if (!creationReason) {
    return res.status(400).json({ error: 'سبب إنشاء مهمة تسليم الهدية مطلوب ويجب اختياره من قائمة أسباب إنشاء مهمة تسليم الهدية' });
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows: lockedRows } = await db.query(
      `SELECT gr.id, gr.beneficiary_type, gr.beneficiary_client_id, gr.beneficiary_name_snapshot,
              gr.responsible_branch_id, gr.source_branch_id, gr.status, gr.delivery_task_id,
              gr.responsible_branch_id AS "responsibleBranchId",
              gr.source_branch_id AS "sourceBranchId",
              gr.assigned_user_id AS "assignedUserId",
              gr.beneficiary_employee_id AS "beneficiaryEmployeeId",
              EXISTS (
                SELECT 1
                  FROM client_assignments ca
                 WHERE ca.client_id = gr.beneficiary_client_id
                   AND ca.hr_user_id = $2
              ) AS "beneficiaryAssignedToCurrentUser",
              EXISTS (
                SELECT 1
                  FROM gift_delivery_task_records active_link
                 WHERE active_link.gift_record_id = gr.id
                   AND active_link.is_active = TRUE
              ) AS has_active_delivery_link,
              gd.name AS gift_name
         FROM gift_records gr
         JOIN gift_definitions gd ON gd.id = gr.gift_definition_id
        WHERE gr.id = ANY($1::int[])
        ORDER BY gr.id
        FOR UPDATE OF gr`,
      [ids, authContext.userId],
    );
    if (lockedRows.length !== ids.length) {
      throw new GiftDeliveryTaskCreationError(
        'بعض سجلات الهدايا غير موجودة',
        404,
        'GIFT_RECORD_NOT_FOUND',
      );
    }
    if (lockedRows.some((subject: any) => !canAccessGift(
      authContext,
      'contract_gifts.create_delivery_task',
      subject,
      req.user?.employeeId ?? null,
    ))) {
      throw new GiftDeliveryTaskCreationError(
        'غير مسموح إنشاء مهمة تسليم لهذه الهدية',
        403,
        'GIFT_DELIVERY_ACCESS_DENIED',
      );
    }
    const changedRecord = lockedRows.find(
      (row: any) => row.status !== 'approved_for_delivery'
        || row.delivery_task_id != null
        || row.has_active_delivery_link === true,
    );
    if (changedRecord) {
      throw new GiftDeliveryTaskCreationError(
        `سجل الهدية ${changedRecord.id} لم يعد متاحاً لإنشاء مهمة تسليم`,
        409,
        'GIFT_DELIVERY_GROUP_CHANGED',
        {
          giftRecordId: Number(changedRecord.id),
          deliveryTaskId: changedRecord.delivery_task_id == null
            ? null
            : Number(changedRecord.delivery_task_id),
        },
      );
    }
    const beneficiaryClientId = lockedRows[0].beneficiary_client_id
      ? Number(lockedRows[0].beneficiary_client_id)
      : null;
    if (!beneficiaryClientId || lockedRows.some(
      (row: any) => Number(row.beneficiary_client_id) !== beneficiaryClientId,
    )) {
      throw new GiftDeliveryTaskCreationError(
        'مهمة تسليم الهدية تتطلب مستفيداً واحداً مرتبطاً بزبون معروف',
        400,
        'GIFT_DELIVERY_BENEFICIARY_REQUIRED',
      );
    }
    if (lockedRows.some(
      (row: any) => !['contract_customer', 'customer_referrer'].includes(row.beneficiary_type),
    )) {
      throw new GiftDeliveryTaskCreationError(
        'الوسطاء الموظفون أو الشخصيون يؤكد تسليمهم يدوياً ولا تنشأ لهم مهمة تسليم',
        400,
        'GIFT_DELIVERY_BENEFICIARY_NOT_ELIGIBLE',
      );
    }
    const branchId = Number(
      lockedRows[0].responsible_branch_id ?? lockedRows[0].source_branch_id,
    );
    if (!branchId || lockedRows.some(
      (row: any) => Number(row.responsible_branch_id ?? row.source_branch_id) !== branchId,
    )) {
      throw new GiftDeliveryTaskCreationError(
        'كل سجلات مهمة التسليم يجب أن تتبع فرع مسؤولية واحداً',
        400,
        'GIFT_DELIVERY_BRANCH_MISMATCH',
      );
    }
    const giftLabel = lockedRows.length === 1
      ? lockedRows[0].gift_name
      : `${lockedRows.length} سجلات هدايا`;
    const sourceContextType = lockedRows.length === 1 ? 'gift_records' : null;
    const sourceContextId = lockedRows.length === 1 ? Number(lockedRows[0].id) : null;

    const { rows: taskRows } = await db.query(
      `INSERT INTO open_tasks (
         client_id, branch_id, task_type, task_family, reason, status,
         due_date, expected_date, priority, source, notes, created_by, origin,
         source_context_type, source_context_id, creation_origin, creation_reason
       ) VALUES ($1, $2, 'gift_delivery', 'delivery', 'gift_delivery', 'open',
         $3::date, $3::date, $4, 'manual', $5, $6, 'manual_entry',
         $7, $8, 'manual_creation', $9)
       RETURNING id`,
      [
        beneficiaryClientId,
        branchId,
        dueDate,
        priority,
        notes || `تسليم ${giftLabel} للمستفيد: ${lockedRows[0].beneficiary_name_snapshot}`,
        authContext.userId ?? null,
        sourceContextType,
        sourceContextId,
        creationReason,
      ],
    );
    const taskId = Number(taskRows[0].id);

    const updatedRecords = await db.query(
      `UPDATE gift_records
          SET status = 'delivery_task_created',
              delivery_task_id = $2,
              updated_by = $3,
              updated_at = NOW()
        WHERE id = ANY($1::int[])
          AND status = 'approved_for_delivery'
          AND delivery_task_id IS NULL`,
      [ids, taskId, authContext.userId ?? null],
    );
    if (updatedRecords.rowCount !== ids.length) {
      throw new GiftDeliveryTaskCreationError(
        'تغيرت حالة إحدى الهدايا أثناء إنشاء المهمة؛ حدّث الصفحة وحاول مجدداً',
        409,
        'GIFT_DELIVERY_GROUP_CHANGED',
      );
    }
    await db.query(
      `INSERT INTO gift_delivery_task_records (
         open_task_id, gift_record_id, is_active, linked_by
       )
       SELECT $2, unnest($1::int[]), TRUE, $3`,
      [ids, taskId, authContext.userId ?? null],
    );
    await insertGiftDeliveryLinkedEvents(
      db,
      ids,
      taskId,
      authContext.userId ?? null,
    );
    const refreshed = await db.query(
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
    await db.query('COMMIT');
    return res.status(201).json({ deliveryTaskId: taskId, records: refreshed.rows.map(mapRecord) });
  } catch (error: unknown) {
    await db.query('ROLLBACK');
    const handledError = error instanceof GiftDeliveryTaskCreationError
      ? error
      : mapGiftDeliveryCreationDatabaseError(error);
    if (handledError) {
      return res.status(handledError.status).json({
        code: handledError.code,
        error: handledError.message,
        ...handledError.details,
      });
    }
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

  if (!['pending', 'met', 'not_met'].includes(req.body?.conditionStatus)) {
    return res.status(400).json({ error: 'حالة تحقق الشرط غير صالحة' });
  }
  const conditionStatus = normalizeConditionStatus(req.body?.conditionStatus);
  const conditionNotes = normalizeText(req.body?.conditionNotes ?? req.body?.notes);
  const result = await pool.query(
    `WITH current AS (
       SELECT id, condition_status
         FROM gift_records
        WHERE id = $1
          AND status IN ('promised', 'approved_for_delivery')
        FOR UPDATE
     ),
     updated AS (
       UPDATE gift_records gr
          SET condition_status = $2,
              condition_notes = NULLIF($3, ''),
              condition_verified_by = $4,
              condition_verified_at = NOW(),
              updated_by = $4,
              updated_at = NOW()
         FROM current
        WHERE gr.id = current.id
       RETURNING gr.id
     )
     INSERT INTO gift_record_events (
       gift_record_id, event_type, actor_user_id, reason, metadata
     )
     SELECT updated.id,
            'condition_verified',
            $4,
            NULLIF($3, ''),
            jsonb_build_object(
              'previousConditionStatus', current.condition_status,
              'newConditionStatus', $2
            )
       FROM updated
       JOIN current ON current.id = updated.id
     RETURNING gift_record_id`,
    [id, conditionStatus, conditionNotes, req.user?.id ?? null],
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
    `SELECT condition_status, status FROM gift_records WHERE id = $1 LIMIT 1`,
    [id],
  );
  const approvalNotes = normalizeText(req.body?.approvalNotes ?? req.body?.notes);
  if (currentRows[0]?.condition_status === 'not_met' && !approvalNotes) {
    return res.status(400).json({ error: 'ملاحظات الاعتماد إلزامية عند اعتماد سجل شرطه غير محقق' });
  }

  const approval = await pool.query(
    `WITH updated AS (
       UPDATE gift_records
          SET status = 'approved_for_delivery',
              approved_quantity = COALESCE($2, promised_quantity),
              approval_notes = NULLIF($4, ''),
              approved_by = $3,
              approved_at = NOW(),
              updated_by = $3,
              updated_at = NOW()
        WHERE id = $1
          AND status = 'promised'
       RETURNING id
     )
     INSERT INTO gift_record_events (
       gift_record_id, event_type, actor_user_id, previous_status, new_status, reason,
       metadata
     )
     SELECT id,
            'delivery_approved',
            $3,
            'promised',
            'approved_for_delivery',
            NULLIF($4, ''),
            jsonb_build_object('approvedQuantity', COALESCE($2, (
              SELECT promised_quantity FROM gift_records WHERE id = $1
            )))
       FROM updated
     RETURNING gift_record_id`,
    [id, normalizePositiveInt(req.body?.approvedQuantity), req.user?.id ?? null, approvalNotes],
  );
  if (approval.rowCount === 0) {
    return res.status(409).json({ error: 'لا يمكن اعتماد الهدية إلا مرة واحدة ومن حالة وعد' });
  }
  res.json(await getRecordById(id));
});

router.post('/records/:id/withdraw-approval', requirePermission('contract_gifts.approve_delivery'), async (req, res) => {
  const id = normalizePositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'معرف غير صالح' });
  const access = await requireGiftAccess(req, res, id, 'contract_gifts.approve_delivery');
  if (!access) return;

  const reason = normalizeText(req.body?.reason);
  if (!reason) {
    return res.status(400).json({ error: 'سبب سحب الاعتماد إلزامي' });
  }
  const result = await pool.query(
    `WITH updated AS (
       UPDATE gift_records gr
          SET status = 'promised',
              approved_quantity = NULL,
              approved_by = NULL,
              approved_at = NULL,
              approval_notes = NULL,
              updated_by = $3,
              updated_at = NOW()
        WHERE gr.id = $1
          AND gr.status = 'approved_for_delivery'
          AND gr.delivery_task_id IS NULL
          AND NOT EXISTS (
            SELECT 1
              FROM gift_delivery_task_records link
             WHERE link.gift_record_id = gr.id
               AND link.is_active = TRUE
          )
       RETURNING gr.id
     )
     INSERT INTO gift_record_events (
       gift_record_id, event_type, actor_user_id, previous_status, new_status, reason
     )
     SELECT id, 'approval_withdrawn', $3, 'approved_for_delivery', 'promised', $2
       FROM updated
     RETURNING gift_record_id`,
    [id, reason, req.user?.id ?? null],
  );
  if (result.rowCount === 0) {
    return res.status(409).json({ error: 'لا يمكن سحب الاعتماد بعد إنشاء مهمة تسليم أو إغلاق السجل' });
  }
  res.json(await getRecordById(id));
});

router.post('/records/:id/manual-delivery', requirePermission('contract_gifts.manual_delivery'), async (req, res) => {
  const id = normalizePositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'معرف غير صالح' });
  const access = await requireGiftAccess(req, res, id, 'contract_gifts.manual_delivery');
  if (!access) return;

  const methodId = normalizePositiveInt(req.body?.methodId ?? req.body?.manualDeliveryMethodId);
  const manualDeliveryBranchId = normalizePositiveInt(req.body?.branchId ?? req.body?.manualDeliveryBranchId);
  const acknowledged = req.body?.acknowledged === true || req.body?.manualDeliveryAcknowledged === true;
  const notes = normalizeText(req.body?.notes);
  if (!methodId || !manualDeliveryBranchId || !acknowledged) {
    return res.status(400).json({ error: 'طريقة التسليم وفرع التسليم وإقرار الاستلام مطلوبة' });
  }
  const { rows: methodRows } = await pool.query(
    `SELECT id, value, metadata
       FROM system_lists
      WHERE id = $1
        AND category = 'gift_manual_delivery_methods'
        AND is_active = TRUE
      LIMIT 1`,
    [methodId],
  );
  if (!methodRows[0]) {
    return res.status(400).json({ error: 'طريقة التسليم اليدوي غير صالحة' });
  }
  if (methodRows[0].value === 'other' && !notes) {
    return res.status(400).json({ error: 'ملاحظات التسليم إلزامية عند اختيار طريقة أخرى' });
  }

  const result = await pool.query(
    `WITH updated AS (
       UPDATE gift_records gr
          SET status = 'delivered_manually',
              manual_delivered_at = NOW(),
              manual_delivered_by = $2,
              manual_delivery_notes = NULLIF($3, ''),
              manual_delivery_method_id = $4,
              manual_delivery_acknowledged = TRUE,
              manual_delivery_branch_id = $5,
              updated_by = $2,
              updated_at = NOW()
        WHERE gr.id = $1
          AND gr.status = 'approved_for_delivery'
          AND gr.delivery_task_id IS NULL
          AND $5 IN (gr.source_branch_id, gr.responsible_branch_id)
          AND NOT EXISTS (
            SELECT 1
              FROM gift_delivery_task_records link
             WHERE link.gift_record_id = gr.id
               AND link.is_active = TRUE
          )
       RETURNING gr.id
     )
     INSERT INTO gift_record_events (
       gift_record_id, event_type, actor_user_id, previous_status, new_status, reason, metadata
     )
     SELECT id,
            'manual_delivery_recorded',
            $2,
            'approved_for_delivery',
            'delivered_manually',
            NULLIF($3, ''),
            jsonb_build_object('methodId', $4, 'branchId', $5, 'acknowledged', TRUE)
       FROM updated
     RETURNING gift_record_id`,
    [id, req.user?.id ?? null, notes, methodId, manualDeliveryBranchId],
  );
  if (result.rowCount === 0) {
    return res.status(409).json({ error: 'التسليم اليدوي يتطلب سجلاً معتمداً بلا مهمة فعالة وفرع تسليم مطابقاً' });
  }
  res.json(await getRecordById(id));
});

router.post(
  '/records/:id/reopen-manual-delivery',
  requirePermission('contract_gifts.reopen_manual_delivery'),
  async (req, res) => {
    const id = normalizePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'معرف غير صالح' });
    const access = await requireGiftAccess(req, res, id, 'contract_gifts.reopen_manual_delivery');
    if (!access) return;

    const reason = normalizeText(req.body?.reason);
    if (!reason) {
      return res.status(400).json({ error: 'سبب إعادة فتح التسليم اليدوي إلزامي' });
    }
    const result = await pool.query(
      `WITH current AS (
         SELECT id,
                manual_delivered_at,
                manual_delivered_by,
                manual_delivery_notes,
                manual_delivery_method_id,
                manual_delivery_branch_id,
                manual_delivery_acknowledged
           FROM gift_records
          WHERE id = $1
            AND status = 'delivered_manually'
          FOR UPDATE
       ),
       updated AS (
         UPDATE gift_records gr
            SET status = 'approved_for_delivery',
                manual_delivered_at = NULL,
                manual_delivered_by = NULL,
                manual_delivery_notes = NULL,
                manual_delivery_method_id = NULL,
                manual_delivery_acknowledged = FALSE,
                manual_delivery_branch_id = NULL,
                updated_by = $3,
                updated_at = NOW()
           FROM current
          WHERE gr.id = current.id
         RETURNING gr.id
       )
       INSERT INTO gift_record_events (
         gift_record_id, event_type, actor_user_id, previous_status, new_status, reason, metadata
       )
       SELECT updated.id,
              'manual_delivery_reopened',
              $3,
              'delivered_manually',
              'approved_for_delivery',
              $2,
              jsonb_build_object(
                'manualDeliveredAt', current.manual_delivered_at,
                'manualDeliveredBy', current.manual_delivered_by,
                'manualDeliveryNotes', current.manual_delivery_notes,
                'manualDeliveryMethodId', current.manual_delivery_method_id,
                'manualDeliveryBranchId', current.manual_delivery_branch_id,
                'manualDeliveryAcknowledged', current.manual_delivery_acknowledged
              )
         FROM updated
         JOIN current ON current.id = updated.id
       RETURNING gift_record_id`,
      [id, reason, req.user?.id ?? null],
    );
    if (result.rowCount === 0) {
      return res.status(409).json({ error: 'السجل ليس في حالة تسليم يدوي قابلة لإعادة الفتح' });
    }
    res.json(await getRecordById(id));
  },
);

router.post('/records/:id/cancel', requirePermission('contract_gifts.cancel'), async (req, res) => {
  const id = normalizePositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'معرف غير صالح' });
  const access = await requireGiftAccess(req, res, id, 'contract_gifts.cancel');
  if (!access) return;

  const reason = normalizeText(req.body?.reason);
  if (!reason) {
    return res.status(400).json({ error: 'سبب إلغاء وعد الهدية إلزامي' });
  }
  const result = await pool.query(
    `WITH current AS (
       SELECT id, status
         FROM gift_records
         WHERE id = $1
           AND status IN ('promised', 'approved_for_delivery')
           AND delivery_task_id IS NULL
           AND NOT EXISTS (
             SELECT 1
               FROM gift_delivery_task_records active_link
              WHERE active_link.gift_record_id = gift_records.id
                AND active_link.is_active = TRUE
           )
         FOR UPDATE
     ),
     updated AS (
       UPDATE gift_records gr
          SET status = 'cancelled',
              cancellation_reason = $2,
              updated_by = $3,
              updated_at = NOW()
         FROM current
        WHERE gr.id = current.id
       RETURNING gr.id
     )
     INSERT INTO gift_record_events (
       gift_record_id, event_type, actor_user_id, previous_status, new_status, reason
     )
     SELECT updated.id, 'promise_cancelled', $3, current.status, 'cancelled', $2
       FROM updated
       JOIN current ON current.id = updated.id
     RETURNING gift_record_id`,
    [id, reason, req.user?.id ?? null],
  );
  if (result.rowCount === 0) {
    return res.status(409).json({ error: 'لا يمكن إلغاء سجل الهدية بعد إنشاء مهمة أو إغلاق السجل' });
  }
  res.json(await getRecordById(id));
});

export default router;
