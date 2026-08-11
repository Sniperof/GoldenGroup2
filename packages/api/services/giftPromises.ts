import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

export type GiftBeneficiaryType =
  | 'contract_customer'
  | 'customer_referrer'
  | 'employee_referrer'
  | 'personal_referrer';

export interface DraftGiftPromise {
  giftDefinitionId?: number | string | null;
  beneficiaryKind?: GiftBeneficiaryType;
  referrerId?: string | number | null;
  conditionId?: number | string | null;
  conditionLabel?: string | null;
  conditionNotes?: string | null;
  quantity?: number | string | null;
  similarPromiseWarningAcknowledged?: boolean;
  similarGiftRecordIds?: Array<number | string>;
}

const LEGACY_CONDITION_VALUES: Record<string, string> = {
  'توقيع عقد نقدي': 'cash_contract',
  'استحقاق بعد الدفعة الثانية': 'after_second_installment',
  'شراء أكثر من عقد': 'multiple_contracts',
  'وسيط بيعة من نوع زبون': 'contract_referrer_gift',
  'وسيط بيعة من نوع موظف': 'contract_referrer_gift',
  'وسيط بيعة شخصي': 'contract_referrer_gift',
  'قرار إداري': 'administrative_commitment',
  'عقد هدية معتمد': 'gift_contract',
};

interface ContractGiftContext {
  customer_id?: number | string | null;
  customer_name?: string | null;
  contract_referrers?: unknown;
}

interface ResolvedBeneficiary {
  beneficiaryType: GiftBeneficiaryType;
  beneficiaryClientId: number | null;
  beneficiaryEmployeeId: number | null;
  beneficiaryName: string;
}

function positiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeReferrerType(value: unknown): Exclude<GiftBeneficiaryType, 'contract_customer'> | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'client' || normalized === 'customer' || normalized === 'customer_referrer') {
    return 'customer_referrer';
  }
  if (normalized === 'employee' || normalized === 'employee_referrer') {
    return 'employee_referrer';
  }
  if (normalized === 'personal' || normalized === 'person' || normalized === 'personal_referrer') {
    return 'personal_referrer';
  }
  return null;
}

/**
 * Resolves beneficiary identity from the persisted contract-referrer shape.
 * `referrerId` is the actual referenced entity id. `id` may only be the UI-row id,
 * so it is accepted for matching but is never used as the beneficiary identity.
 */
export function resolveDraftGiftBeneficiary(
  contract: ContractGiftContext,
  promise: DraftGiftPromise,
): ResolvedBeneficiary {
  const kind = promise.beneficiaryKind ?? 'contract_customer';
  if (kind === 'contract_customer') {
    const clientId = positiveInt(contract.customer_id);
    if (!clientId) {
      throw new Error('تعذر تحديد زبون العقد المستفيد من وعد الهدية');
    }
    return {
      beneficiaryType: kind,
      beneficiaryClientId: clientId,
      beneficiaryEmployeeId: null,
      beneficiaryName: String(contract.customer_name ?? '').trim() || 'زبون العقد',
    };
  }

  if (!['customer_referrer', 'employee_referrer', 'personal_referrer'].includes(kind)) {
    throw new Error(`نوع مستفيد وعد الهدية غير مدعوم: ${String(kind)}`);
  }

  const referrers = Array.isArray(contract.contract_referrers) ? contract.contract_referrers as any[] : [];
  const wantedId = String(promise.referrerId ?? '').trim();
  if (!wantedId) {
    throw new Error('وسيط العقد المستفيد من وعد الهدية غير محدد');
  }
  const referrer = referrers.find((candidate) => (
    String(candidate?.id ?? '') === wantedId
    || String(candidate?.referrerId ?? '') === wantedId
  ));
  if (!referrer) {
    throw new Error(`وسيط العقد المحدد لوعد الهدية غير موجود: ${wantedId}`);
  }

  const actualType = normalizeReferrerType(referrer.referrerType);
  if (actualType !== kind) {
    throw new Error('نوع وسيط العقد لا يطابق نوع مستفيد وعد الهدية');
  }

  const referencedEntityId = positiveInt(referrer.referrerId ?? referrer.referralEntityId);
  if (kind === 'customer_referrer' && !referencedEntityId) {
    throw new Error('وسيط البيع الزبون لا يرتبط بسجل زبون معروف');
  }
  if (kind === 'employee_referrer' && !referencedEntityId) {
    throw new Error('وسيط البيع الموظف لا يرتبط بسجل موظف معروف');
  }

  return {
    beneficiaryType: kind,
    beneficiaryClientId: kind === 'customer_referrer' ? referencedEntityId : null,
    beneficiaryEmployeeId: kind === 'employee_referrer' ? referencedEntityId : null,
    beneficiaryName: String(referrer.referrerName ?? '').trim()
      || (kind === 'customer_referrer' ? 'وسيط زبون' : kind === 'employee_referrer' ? 'وسيط موظف' : 'وسيط شخصي'),
  };
}

export async function materializeContractGiftPromises(
  db: Db,
  contractId: number,
  userId: number | null,
): Promise<number> {
  const { rows } = await db.query(
    `SELECT c.customer_id, c.contract_number, c.branch_id, c.service_branch_id,
            c.contract_referrers, c.draft_gift_promises,
            cl.name AS customer_name
       FROM contracts c
       LEFT JOIN clients cl ON cl.id = c.customer_id
      WHERE c.id = $1
      LIMIT 1`,
    [contractId],
  );
  const contract = rows[0];
  if (!contract) {
    throw new Error(`العقد ${contractId} غير موجود أثناء تحويل وعود الهدايا`);
  }

  const promises: DraftGiftPromise[] = Array.isArray(contract.draft_gift_promises)
    ? contract.draft_gift_promises
    : [];
  if (promises.length === 0) return 0;

  const sourceBranchId = positiveInt(contract.branch_id);
  const responsibleBranchId = positiveInt(contract.service_branch_id) ?? sourceBranchId;
  let created = 0;

  for (const [index, promise] of promises.entries()) {
    const giftDefinitionId = positiveInt(promise.giftDefinitionId);
    if (!giftDefinitionId) {
      throw new Error(`تعريف الهدية غير صالح في الوعد رقم ${index + 1}`);
    }
    const beneficiary = resolveDraftGiftBeneficiary(contract, promise);
    const promisedQuantity = positiveInt(promise.quantity) ?? 1;
    let conditionId = positiveInt(promise.conditionId);
    const conditionLabel = String(promise.conditionLabel ?? '').trim() || 'وعد هدية من العقد';
    const conditionNotes = String(promise.conditionNotes ?? '').trim();

    const condition = await db.query(
      `SELECT id, value, metadata
           FROM system_lists
          WHERE category = 'gift_promise_conditions'
            AND is_active = TRUE
            AND (
              ($1::int IS NOT NULL AND id = $1)
              OR
              ($1::int IS NULL AND value = $2)
            )
          LIMIT 1`,
      [conditionId, LEGACY_CONDITION_VALUES[conditionLabel] ?? null],
    );
    if (!condition.rows[0]) {
      throw new Error(`شرط وعد الهدية غير صالح في الوعد رقم ${index + 1}`);
    }
    conditionId = Number(condition.rows[0].id);
    if (condition.rows[0].value === 'other' && !conditionNotes) {
      throw new Error(`ملاحظات الشرط إلزامية في الوعد رقم ${index + 1}`);
    }

    const similar = await db.query(
      `SELECT id
         FROM gift_records
        WHERE gift_definition_id = $1
          AND beneficiary_type = $2
          AND COALESCE(beneficiary_client_id, 0) = COALESCE($3, 0)
          AND COALESCE(beneficiary_employee_id, 0) = COALESCE($4, 0)
          AND status IN ('promised', 'approved_for_delivery', 'delivery_task_created')
        ORDER BY id`,
      [
        giftDefinitionId,
        beneficiary.beneficiaryType,
        beneficiary.beneficiaryClientId,
        beneficiary.beneficiaryEmployeeId,
      ],
    );

    const recordResult = await db.query(
      `INSERT INTO gift_records (
          gift_definition_id, beneficiary_type, beneficiary_client_id,
          beneficiary_employee_id, beneficiary_name_snapshot, customer_id,
          contract_id, condition_id, condition_label, condition_status, condition_notes,
          promised_quantity, approved_quantity,
          source_branch_id, responsible_branch_id, assigned_user_id,
          created_by, updated_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',NULLIF($10,''),$11,NULL,$12,$13,NULL,$14,$14)
        RETURNING id`,
      [
        giftDefinitionId,
        beneficiary.beneficiaryType,
        beneficiary.beneficiaryClientId,
        beneficiary.beneficiaryEmployeeId,
        beneficiary.beneficiaryName,
        positiveInt(contract.customer_id),
        contractId,
        conditionId,
        conditionLabel,
        conditionNotes,
        promisedQuantity,
        sourceBranchId,
        responsibleBranchId,
        userId,
      ],
    );
    const giftRecordId = Number(recordResult.rows[0].id);
    await db.query(
      `INSERT INTO gift_record_sources (
          gift_record_id, source_type, contract_id, referral_sheet_id,
          direct_referral_id, source_label, quantity, notes
        )
        VALUES ($1, 'contract', $2, NULL, NULL, $3, $4, NULL)`,
      [
        giftRecordId,
        contractId,
        `وعد من العقد ${contract.contract_number ?? contractId}`,
        promisedQuantity,
      ],
    );
    await db.query(
      `INSERT INTO gift_record_events (
         gift_record_id, event_type, actor_user_id, previous_status, new_status, metadata
       ) VALUES ($1, 'promise_materialized', $2, NULL, 'promised', $3::jsonb)`,
      [
        giftRecordId,
        userId,
        JSON.stringify({
          contractId,
          similarGiftRecordIds: similar.rows.map((row: any) => Number(row.id)),
          similarPromiseWarningAcknowledged: promise.similarPromiseWarningAcknowledged === true,
          acknowledgedSimilarGiftRecordIds: Array.isArray(promise.similarGiftRecordIds)
            ? promise.similarGiftRecordIds.map(positiveInt).filter(Boolean)
            : [],
        }),
      ],
    );
    created += 1;
  }

  // Only clear the draft after every promise and its source/audit event succeeded.
  await db.query(`UPDATE contracts SET draft_gift_promises = '[]'::jsonb WHERE id = $1`, [contractId]);
  return created;
}
