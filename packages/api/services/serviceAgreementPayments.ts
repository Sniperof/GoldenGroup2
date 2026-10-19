// Payments against a service agreement's fee (migr 485). Shared by the agreements
// routes and by external-device creation, which can open an agreement at signing.

export const PAYMENT_METHODS = ['cash', 'sham_cash', 'syriatel_cash', 'mtn_cash', 'alharam', 'bank_transfer', 'barter', 'usd_cash'] as const;
const PAYMENT_ENTRY_TYPES = ['collection', 'refund'] as const;

export type PaymentInput = {
  method?: string; currency?: string; amountValue?: number | string; exchangeRate?: number | string | null;
  amountSyp?: number | string | null; referenceNumber?: string | null; barterName?: string | null;
  barterValueSyp?: number | string | null; transferCompanyId?: number | null;
  receivedByEmployeeId?: number | null; notes?: string | null; entryType?: string;
};

/** Validates one payment and returns its column values, or an error message. */
export function normalizeServiceAgreementPayment(p: PaymentInput): { error: string } | { values: any } {
  if (!PAYMENT_METHODS.includes(p.method as any)) {
    return { error: `طريقة الدفع غير صالحة. المسموح: ${PAYMENT_METHODS.join(', ')}` };
  }
  if (p.entryType !== undefined && !PAYMENT_ENTRY_TYPES.includes(p.entryType as any)) {
    return { error: 'نوع الحركة غير صالح' };
  }
  const amountValue = Number(p.amountValue);
  if (!Number.isFinite(amountValue) || amountValue < 0) return { error: 'amountValue غير صالح' };
  const exchangeRate = p.exchangeRate != null && p.exchangeRate !== '' ? Number(p.exchangeRate) : null;
  const amountSyp = p.amountSyp != null && p.amountSyp !== '' ? Number(p.amountSyp)
    : p.method === 'barter' && p.barterValueSyp != null ? Number(p.barterValueSyp)
    : (exchangeRate ? amountValue * exchangeRate : amountValue);
  return {
    values: {
      method: p.method, currency: p.currency ?? 'SYP', amountValue, exchangeRate, amountSyp,
      referenceNumber: p.referenceNumber ?? null, barterName: p.barterName ?? null,
      barterValueSyp: p.method === 'barter' ? amountSyp : (p.barterValueSyp ?? null),
      transferCompanyId: p.transferCompanyId ?? null, receivedByEmployeeId: p.receivedByEmployeeId ?? null,
      notes: p.notes ?? null, entryType: p.entryType ?? 'collection',
    },
  };
}

export async function insertServiceAgreementPayment(db: any, agreementId: number, v: any, actorId: number | null) {
  const { rows } = await db.query(
    `INSERT INTO service_agreement_payments
       (agreement_id, method, currency, amount_value, exchange_rate, amount_syp,
        reference_number, barter_name, barter_value_syp, transfer_company_id,
        received_by_employee_id, notes, entry_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [agreementId, v.method, v.currency, v.amountValue, v.exchangeRate, v.amountSyp,
     v.referenceNumber, v.barterName, v.barterValueSyp, v.transferCompanyId,
     v.receivedByEmployeeId ?? actorId, v.notes, v.entryType],
  );
  return rows[0];
}

export function mapServiceAgreementPayment(r: any) {
  return {
    id: r.id, agreementId: r.agreement_id, method: r.method, currency: r.currency,
    amountValue: Number(r.amount_value), exchangeRate: r.exchange_rate != null ? Number(r.exchange_rate) : null,
    amountSyp: Number(r.amount_syp), referenceNumber: r.reference_number, barterName: r.barter_name,
    receivedByEmployeeId: r.received_by_employee_id, receivedAt: r.received_at, notes: r.notes,
    entryType: r.entry_type,
  };
}
