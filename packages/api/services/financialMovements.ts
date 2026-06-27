// سجل الحركات المالية الموحّد (financial_movements) — مصدر الحقيقة الوحيد
// لكشف حساب الزبون. كل مسار مالي يكتب حركاته عبر هذه الدوال (مرّة واحدة،
// idempotent عبر القيد uq_fm_source_ref). لا triggers، لا إعادة حساب رصيد.
//
// القاعدة: amount_syp موجب دائماً؛ الإشارة من kind:
//   charge/refund → مَدين (يرفع الرصيد) ، payment/discount → دائن (يخفضه).

import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

export type MovementKind = 'charge' | 'payment' | 'refund' | 'discount';

export interface MovementInput {
  clientId: number;
  occurredAt: Date | string;
  kind: MovementKind;
  amountSyp: number;
  sourceType: string;
  sourceId?: number | null;
  sourceRefId?: number | null;
  contractId?: number | null;
  description: string;
  referenceNo?: string | null;
  currency?: string;
  amountOriginal?: number | null;
  exchangeRate?: number | null;
  occurredBranchId?: number | null;
  recordedBy?: number | null;
  notes?: string | null;
}

/**
 * يكتب حركة مالية واحدة. يتجاهل المبالغ غير الموجبة، ولا يكرّر حركة لنفس
 * (source_type, source_ref_id, kind) بفضل ON CONFLICT DO NOTHING.
 * يعيد id الحركة المُدخلة أو null (إن تُجوهلت/كانت مكرّرة).
 */
export async function recordMovement(db: Db, m: MovementInput): Promise<number | null> {
  if (!(m.amountSyp > 0)) return null;
  const { rows } = await db.query(
    `INSERT INTO financial_movements (
       client_id, occurred_at, kind, amount_syp, currency, amount_original, exchange_rate,
       source_type, source_id, source_ref_id, contract_id, description, reference_no,
       occurred_branch_id, recorded_by, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (source_type, source_ref_id, kind) WHERE source_ref_id IS NOT NULL
     DO NOTHING
     RETURNING id`,
    [
      m.clientId,
      m.occurredAt,
      m.kind,
      m.amountSyp,
      m.currency ?? 'SYP',
      m.amountOriginal ?? null,
      m.exchangeRate ?? null,
      m.sourceType,
      m.sourceId ?? null,
      m.sourceRefId ?? null,
      m.contractId ?? null,
      m.description,
      m.referenceNo ?? null,
      m.occurredBranchId ?? null,
      m.recordedBy ?? null,
      m.notes ?? null,
    ],
  );
  return rows[0]?.id ?? null;
}

/**
 * يحوّل دفعة عقد واحدة (contract_payment_entries) إلى حركة payment/refund.
 * يُستدعى عند إنشاء أي دفعة عقد (إنشاء العقد، نتيجة تسديد الذمم...).
 */
export async function recordContractPaymentMovement(
  db: Db,
  paymentEntryId: number,
  recordedBy?: number | null,
): Promise<number | null> {
  const { rows } = await db.query(
    `SELECT p.id, p.amount_syp, p.amount_value, p.exchange_rate, p.currency,
            p.reference_number, p.received_at, p.entry_type,
            c.id AS contract_id, c.customer_id, c.contract_number, c.branch_id,
            c.status, c.sale_subtype
       FROM contract_payment_entries p
       JOIN contracts c ON c.id = p.contract_id
      WHERE p.id = $1
      LIMIT 1`,
    [paymentEntryId],
  );
  const row = rows[0];
  if (!row || !row.customer_id) return null;
  if (!['active', 'completed'].includes(row.status) || row.sale_subtype !== 'definitive') return null;
  if (!(Number(row.amount_syp) > 0)) return null;

  const isRefund = row.entry_type === 'refund';
  return recordMovement(db, {
    clientId: Number(row.customer_id),
    occurredAt: row.received_at,
    kind: isRefund ? 'refund' : 'payment',
    amountSyp: Number(row.amount_syp),
    currency: row.currency ?? 'SYP',
    amountOriginal: row.amount_value != null ? Number(row.amount_value) : null,
    exchangeRate: row.exchange_rate != null ? Number(row.exchange_rate) : null,
    sourceType: 'contract_payment',
    sourceId: Number(row.contract_id),
    sourceRefId: Number(row.id),
    contractId: Number(row.contract_id),
    description: `${isRefund ? 'مبلغ مرتجع للعقد ' : 'دفعة عقد '}${row.contract_number ?? row.contract_id}`,
    referenceNo: row.reference_number ?? null,
    occurredBranchId: row.branch_id ?? null,
    recordedBy: recordedBy ?? null,
  });
}

/**
 * يزامن كل حركات العقد عند التفعيل (idempotent):
 *   - استحقاق التوقيع = قيمة العقد − مجموع الأقساط (المقدّم/الكاش الكامل).
 *   - استحقاق لكل قسط بتاريخ أجله.
 *   - حركة لكل دفعة موجودة.
 * بهذا مجموع الاستحقاقات = قيمة العقد، فتُطرح الدفعة الأولى مرّة واحدة.
 */
export async function syncContractMovements(db: Db, contractId: number): Promise<void> {
  const { rows: cRows } = await db.query(
    `SELECT c.id, c.customer_id, c.contract_number, c.final_price, c.branch_id,
            c.status, c.sale_subtype, c.created_at,
            COALESCE((SELECT SUM(amount_syp) FROM contract_installments WHERE contract_id = c.id), 0) AS installments_total
       FROM contracts c
      WHERE c.id = $1
      LIMIT 1`,
    [contractId],
  );
  const c = cRows[0];
  if (!c || !c.customer_id) return;
  if (!['active', 'completed'].includes(c.status) || c.sale_subtype !== 'definitive') return;

  const signingAmount = Number(c.final_price) - Number(c.installments_total);
  if (signingAmount > 0) {
    await recordMovement(db, {
      clientId: Number(c.customer_id),
      occurredAt: c.created_at,
      kind: 'charge',
      amountSyp: signingAmount,
      sourceType: 'contract',
      sourceId: Number(c.id),
      sourceRefId: Number(c.id),
      contractId: Number(c.id),
      description: `استحقاق العقد ${c.contract_number ?? c.id} عند التوقيع`,
      occurredBranchId: c.branch_id ?? null,
    });
  }

  const { rows: installments } = await db.query(
    `SELECT id, installment_number, due_date, amount_syp
       FROM contract_installments
      WHERE contract_id = $1 AND amount_syp > 0
      ORDER BY installment_number`,
    [contractId],
  );
  for (const i of installments) {
    await recordMovement(db, {
      clientId: Number(c.customer_id),
      occurredAt: i.due_date,
      kind: 'charge',
      amountSyp: Number(i.amount_syp),
      sourceType: 'contract_installment',
      sourceId: Number(c.id),
      sourceRefId: Number(i.id),
      contractId: Number(c.id),
      description: `استحقاق قسط رقم ${i.installment_number} للعقد ${c.contract_number ?? c.id}`,
      occurredBranchId: c.branch_id ?? null,
    });
  }

  const { rows: payments } = await db.query(
    `SELECT id FROM contract_payment_entries WHERE contract_id = $1 AND amount_syp > 0 ORDER BY id`,
    [contractId],
  );
  for (const p of payments) {
    await recordContractPaymentMovement(db, Number(p.id));
  }
}
