// تحويل وعود الهدايا المحفوظة كمسودة على العقد (draft_gift_promises) إلى
// gift_records فعلية عند اعتماد العقد. يُستدعى داخل معاملة الاعتماد فقط، فلا
// يُنشأ أي وعد ما دام العقد مسودة (قرار المستخدم).

import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

interface DraftGiftPromise {
  giftDefinitionId?: number | string | null;
  beneficiaryKind?: 'contract_customer' | 'customer_referrer';
  referrerId?: string | number | null;
  conditionLabel?: string | null;
  conditionStatus?: 'pending' | 'met' | 'not_met' | null;
  quantity?: number | string | null;
}

function normalizeConditionStatus(v: unknown): 'pending' | 'met' | 'not_met' {
  return v === 'met' || v === 'not_met' ? v : 'pending';
}

/**
 * ينشئ gift_records (+ gift_record_sources) لكل وعد مسودة على العقد، ثم يفرّغ
 * draft_gift_promises. كل وعد معزول بـ SAVEPOINT حتى لا يُفشل وعد واحد الاعتماد
 * كله (مثلاً تعارض قيد الوعد المفتوح الفريد).
 */
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
  const c = rows[0];
  if (!c) return 0;

  const promises: DraftGiftPromise[] = Array.isArray(c.draft_gift_promises) ? c.draft_gift_promises : [];
  if (promises.length === 0) return 0;

  const referrers: any[] = Array.isArray(c.contract_referrers) ? c.contract_referrers : [];
  const sourceBranchId = c.branch_id ?? null;
  const responsibleBranchId = c.service_branch_id ?? c.branch_id ?? null;
  let created = 0;

  for (const p of promises) {
    const giftDefinitionId = Number(p.giftDefinitionId);
    if (!Number.isInteger(giftDefinitionId) || giftDefinitionId <= 0) continue;

    const kind = p.beneficiaryKind === 'customer_referrer' ? 'customer_referrer' : 'contract_customer';
    let beneficiaryClientId: number | null = null;
    let beneficiaryName = 'زبون العقد';

    if (kind === 'customer_referrer') {
      const ref = referrers.find(r => String(r?.id) === String(p.referrerId)) ?? referrers[0];
      beneficiaryClientId = ref?.referrerClientId ?? ref?.clientId ?? null;
      beneficiaryName = ref?.referrerName ?? 'وسيط زبون';
    } else {
      beneficiaryClientId = c.customer_id ?? null;
      beneficiaryName = c.customer_name ?? 'زبون العقد';
    }
    // الدستور: المستفيد الزبون يجب أن يرتبط بسجل زبون معروف.
    if (!beneficiaryClientId) continue;

    const quantity = Math.max(1, Number(p.quantity) || 1);
    const conditionLabel = (typeof p.conditionLabel === 'string' && p.conditionLabel.trim())
      ? p.conditionLabel.trim()
      : 'وعد هدية من العقد';

    await db.query('SAVEPOINT gift_promise');
    try {
      const recordResult = await db.query(
        `INSERT INTO gift_records (
            gift_definition_id, beneficiary_type, beneficiary_client_id,
            beneficiary_employee_id, beneficiary_name_snapshot, customer_id,
            contract_id, condition_id, condition_label, condition_status, approved_quantity,
            source_branch_id, responsible_branch_id, assigned_user_id,
            created_by, updated_by
          )
          VALUES ($1,$2,$3,NULL,$4,$5,$6,NULL,$7,$8,$9,$10,$11,NULL,$12,$12)
          RETURNING id`,
        [
          giftDefinitionId,
          kind,
          beneficiaryClientId,
          beneficiaryName,
          c.customer_id ?? null,
          contractId,
          conditionLabel,
          normalizeConditionStatus(p.conditionStatus),
          quantity,
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
          `وعد من العقد ${c.contract_number ?? contractId}`,
          quantity,
        ],
      );
      await db.query('RELEASE SAVEPOINT gift_promise');
      created += 1;
    } catch (err: any) {
      await db.query('ROLLBACK TO SAVEPOINT gift_promise');
      console.warn('[gifts] materialize promise skipped for contract', contractId, ':', err?.message);
    }
  }

  await db.query(`UPDATE contracts SET draft_gift_promises = '[]'::jsonb WHERE id = $1`, [contractId]);
  return created;
}
