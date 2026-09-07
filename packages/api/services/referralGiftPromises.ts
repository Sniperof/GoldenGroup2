import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

export type ReferralGiftPromiseSourceType = 'candidate' | 'name_list';

export interface ReferralGiftPromiseDraft {
  giftDefinitionId?: number | string | null;
  conditionLabel?: string | null;
  quantity?: number | string | null;
  similarPromiseWarningAcknowledged?: boolean;
}

export class ReferralGiftPromiseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function positiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedReferralType(value: unknown): 'client' | 'employee' | null {
  const normalized = text(value).toLowerCase();
  if (normalized === 'client' || normalized === 'customer') return 'client';
  if (normalized === 'employee') return 'employee';
  return null;
}

async function loadSource(db: Db, sourceType: ReferralGiftPromiseSourceType, sourceId: number) {
  if (sourceType === 'name_list') {
    const { rows } = await db.query(
      `SELECT rs.id, rs.referral_type, rs.referral_entity_id, rs.referral_name_snapshot,
              rs.branch_id, COALESCE(rs.assigned_hr_user_id, rs.owner_user_id) AS assigned_user_id
         FROM referral_sheets rs
        WHERE rs.id = $1
        FOR SHARE`,
      [sourceId],
    );
    return rows[0] ?? null;
  }

  const { rows } = await db.query(
    `SELECT c.id, c.referral_sheet_id, c.referral_type, c.referral_entity_id,
            c.referral_name_snapshot, c.branch_id,
            COALESCE(
              (SELECT ca.hr_user_id
                 FROM candidate_assignments ca
                WHERE ca.candidate_id = c.id
                ORDER BY ca.assigned_at, ca.id
                LIMIT 1),
              c.owner_user_id
            ) AS assigned_user_id
       FROM candidates c
      WHERE c.id = $1
      FOR SHARE`,
    [sourceId],
  );
  return rows[0] ?? null;
}

async function resolveDefinition(db: Db, giftDefinitionId: number) {
  const { rows } = await db.query(
    `SELECT id FROM gift_definitions WHERE id = $1 AND is_active = TRUE LIMIT 1`,
    [giftDefinitionId],
  );
  if (!rows[0]) {
    throw new ReferralGiftPromiseError('تعريف الهدية غير موجود أو غير فعال', 400, 'invalid_gift_definition');
  }
}

async function resolveCondition(db: Db, sourceType: ReferralGiftPromiseSourceType) {
  const conditionValue = sourceType === 'name_list'
    ? 'name_list_referral_sale'
    : 'candidate_referral_sale';
  const { rows } = await db.query(
    `SELECT id, value
       FROM system_lists
      WHERE category = 'gift_promise_conditions'
        AND value = $1
        AND is_active = TRUE
      LIMIT 1`,
    [conditionValue],
  );
  if (!rows[0]) {
    throw new ReferralGiftPromiseError('شرط وعد الهدية الخاص بالمصدر غير متاح', 400, 'gift_condition_unavailable');
  }
  return rows[0];
}

function defaultConditionLabel(sourceType: ReferralGiftPromiseSourceType): string {
  return sourceType === 'name_list'
    ? 'شراء زبون من لائحة الأسماء'
    : 'شراء الاسم المقترح مباشرة';
}

export async function createReferralGiftPromise(
  db: Db,
  input: {
    sourceType: ReferralGiftPromiseSourceType;
    sourceId: number;
    draft?: ReferralGiftPromiseDraft | null;
    actorUserId: number | null;
  },
): Promise<number | null> {
  if (!input.draft) return null;

  const giftDefinitionId = positiveInt(input.draft.giftDefinitionId);
  if (!giftDefinitionId) {
    throw new ReferralGiftPromiseError('تعريف الهدية مطلوب', 400, 'gift_definition_required');
  }
  const source = await loadSource(db, input.sourceType, input.sourceId);
  if (!source) {
    throw new ReferralGiftPromiseError('مصدر وعد الهدية غير موجود', 404, 'referral_gift_source_not_found');
  }
  if (input.sourceType === 'candidate' && source.referral_sheet_id != null) {
    throw new ReferralGiftPromiseError(
      'وعد الاسم التابع للائحة يجب أن يُنشأ من اللائحة نفسها',
      400,
      'candidate_gift_source_is_name_list',
    );
  }

  const referralType = normalizedReferralType(source.referral_type);
  if (
    referralType == null
    || (input.sourceType === 'name_list' && referralType !== 'client')
  ) {
    throw new ReferralGiftPromiseError(
      input.sourceType === 'name_list'
        ? 'وعد هدية اللائحة يحتاج وسيطاً من نوع زبون مرتبطاً بسجل معروف'
        : 'وعد هدية الاقتراح المباشر يحتاج وسيطاً من نوع زبون أو موظف مرتبطاً بسجل معروف',
      400,
      'ineligible_referral_gift_beneficiary',
    );
  }

  const referralEntityId = positiveInt(source.referral_entity_id);
  const sourceBranchId = positiveInt(source.branch_id);
  if (!referralEntityId || !sourceBranchId) {
    throw new ReferralGiftPromiseError('هوية الوسيط أو فرع المصدر غير مكتملين', 400, 'invalid_referral_gift_source');
  }

  const entityTable = referralType === 'client' ? 'clients' : 'employees';
  const entity = await db.query(`SELECT id FROM ${entityTable} WHERE id = $1 LIMIT 1`, [referralEntityId]);
  if (!entity.rows[0]) {
    throw new ReferralGiftPromiseError('سجل الوسيط المرتبط غير موجود', 400, 'referral_gift_beneficiary_not_found');
  }

  await resolveDefinition(db, giftDefinitionId);
  const condition = await resolveCondition(db, input.sourceType);
  const beneficiaryType = referralType === 'client' ? 'customer_referrer' : 'employee_referrer';
  const beneficiaryClientId = referralType === 'client' ? referralEntityId : null;
  const beneficiaryEmployeeId = referralType === 'employee' ? referralEntityId : null;
  const beneficiaryName = text(source.referral_name_snapshot) || (referralType === 'client' ? 'وسيط زبون' : 'وسيط موظف');
  const promisedQuantity = positiveInt(input.draft.quantity) ?? 1;
  const conditionLabel = text(input.draft.conditionLabel) || defaultConditionLabel(input.sourceType);

  const similar = await db.query(
    `SELECT id
       FROM gift_records
      WHERE gift_definition_id = $1
        AND beneficiary_type = $2
        AND COALESCE(beneficiary_client_id, 0) = COALESCE($3, 0)
        AND COALESCE(beneficiary_employee_id, 0) = COALESCE($4, 0)
        AND status IN ('promised', 'approved_for_delivery', 'delivery_task_created')
      ORDER BY id`,
    [giftDefinitionId, beneficiaryType, beneficiaryClientId, beneficiaryEmployeeId],
  );
  if (similar.rows.length > 0 && input.draft.similarPromiseWarningAcknowledged !== true) {
    throw new ReferralGiftPromiseError(
      'توجد وعود هدايا غير منتهية مشابهة لهذا المستفيد. يمكنك المتابعة بعد تأكيد الاطلاع على التنبيه.',
      409,
      'similar_gift_promises',
      { similarCount: similar.rows.length },
    );
  }

  const record = await db.query(
    `INSERT INTO gift_records (
       gift_definition_id, beneficiary_type, beneficiary_client_id,
       beneficiary_employee_id, beneficiary_name_snapshot, customer_id,
       condition_id, condition_label, condition_status,
       promised_quantity, approved_quantity,
       source_branch_id, responsible_branch_id, assigned_user_id,
       created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,NULL,$10,$10,$11,$12,$12)
     RETURNING id`,
    [
      giftDefinitionId,
      beneficiaryType,
      beneficiaryClientId,
      beneficiaryEmployeeId,
      beneficiaryName,
      beneficiaryClientId,
      Number(condition.id),
      conditionLabel,
      promisedQuantity,
      sourceBranchId,
      positiveInt(source.assigned_user_id),
      input.actorUserId,
    ],
  );
  const giftRecordId = Number(record.rows[0].id);
  await db.query(
    `INSERT INTO gift_record_sources (
       gift_record_id, source_type, referral_sheet_id, candidate_id,
       source_label, quantity
     ) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      giftRecordId,
      input.sourceType,
      input.sourceType === 'name_list' ? input.sourceId : null,
      input.sourceType === 'candidate' ? input.sourceId : null,
      input.sourceType === 'name_list'
        ? `وعد من لائحة الأسماء #${input.sourceId}`
        : `وعد من اسم مقترح مباشر #${input.sourceId}`,
      promisedQuantity,
    ],
  );
  await db.query(
    `INSERT INTO gift_record_events (
       gift_record_id, event_type, actor_user_id, previous_status, new_status, metadata
     ) VALUES ($1,'promise_created',$2,NULL,'promised',$3::jsonb)`,
    [
      giftRecordId,
      input.actorUserId,
      JSON.stringify({
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        similarGiftRecordIds: similar.rows.map((row: any) => Number(row.id)),
        similarPromiseWarningAcknowledged: input.draft.similarPromiseWarningAcknowledged === true,
      }),
    ],
  );
  return giftRecordId;
}

export async function updateReferralGiftPromise(
  db: Db,
  input: {
    giftRecordId: number;
    giftDefinitionId: number;
    conditionLabel?: string | null;
    quantity: number;
    actorUserId: number | null;
  },
) {
  await resolveDefinition(db, input.giftDefinitionId);
  const current = await db.query(
    `SELECT gr.id, gr.status, gr.gift_definition_id, gr.condition_label,
            gr.promised_quantity,
            EXISTS (
              SELECT 1 FROM gift_record_sources contract_source
               WHERE contract_source.gift_record_id=gr.id
                 AND contract_source.source_type='contract'
            ) AS has_contract_source
       FROM gift_records gr
      WHERE gr.id=$1
      FOR UPDATE`,
    [input.giftRecordId],
  );
  const record = current.rows[0];
  if (!record) {
    throw new ReferralGiftPromiseError('سجل وعد الهدية غير موجود', 404, 'gift_record_not_found');
  }
  if (record.status !== 'promised' || record.has_contract_source === true) {
    throw new ReferralGiftPromiseError(
      'لا يمكن تعديل الوعد بعد اعتماده أو ربطه بعقد معتمد',
      409,
      'referral_gift_promise_locked',
    );
  }
  const conditionLabel = text(input.conditionLabel) || text(record.condition_label);
  const updated = await db.query(
    `UPDATE gift_records
        SET gift_definition_id=$2,
            condition_label=$3,
            promised_quantity=$4,
            updated_by=$5,
            updated_at=NOW()
      WHERE id=$1
      RETURNING id`,
    [input.giftRecordId, input.giftDefinitionId, conditionLabel, input.quantity, input.actorUserId],
  );
  await db.query(
    `UPDATE gift_record_sources
        SET quantity=$2
      WHERE gift_record_id=$1
        AND source_type IN ('candidate','name_list')`,
    [input.giftRecordId, input.quantity],
  );
  await db.query(
    `INSERT INTO gift_record_events (
       gift_record_id,event_type,actor_user_id,previous_status,new_status,metadata
     ) VALUES ($1,'promise_updated',$2,'promised','promised',$3::jsonb)`,
    [
      input.giftRecordId,
      input.actorUserId,
      JSON.stringify({
        previousGiftDefinitionId: Number(record.gift_definition_id),
        previousConditionLabel: record.condition_label,
        previousPromisedQuantity: Number(record.promised_quantity),
      }),
    ],
  );
  return Number(updated.rows[0].id);
}
