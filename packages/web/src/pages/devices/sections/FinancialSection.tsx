// DEC-CT-06/08: financials derived from the contract's installments + payment
// entries. Dues table is dismissed; balance is computed per installment.
//
// We surface 3 tiers:
//   1. summary chips (total, paid, remaining)
//   2. installments table
//   3. payment entries table (collection vs refund)
// And a link to the customer-wide statement (DEC-CT-10).

import { Link } from 'react-router-dom';
import { SectionShell } from './SectionShell';

interface Props {
  contract: any | null;
  customerId: number | null;
}

function fmt(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ar-SY'); } catch { return d; }
}
function money(v: any) {
  return Number(v || 0).toLocaleString('ar-SY', { numberingSystem: 'latn' });
}

const INSTALLMENT_STATUS_LABEL: Record<string, { cls: string; label: string }> = {
  pending: { cls: 'bg-slate-100 text-slate-600',     label: 'بانتظار' },
  partial: { cls: 'bg-amber-100 text-amber-700',     label: 'جزئي' },
  paid:    { cls: 'bg-emerald-100 text-emerald-700', label: 'مدفوع' },
  overdue: { cls: 'bg-rose-100 text-rose-700',       label: 'متأخر' },
};

export function FinancialSection({ contract, customerId }: Props) {
  if (!contract) {
    return (
      <SectionShell id="financial" title="الوضع المالي">
        <p className="text-xs text-slate-400 italic">لا يوجد عقد مرتبط لعرض حالته المالية.</p>
      </SectionShell>
    );
  }

  const installments: any[] = contract.installments ?? [];
  const payments:     any[] = contract.paymentEntries ?? [];

  const totalDue = installments.reduce((s, i) => s + Number(i.amountSyp || 0), 0);
  const totalPaid = installments.reduce((s, i) => s + Number(i.paidAmount || 0), 0);
  const totalRemaining = installments.reduce((s, i) => s + Number(i.remainingBalance || 0), 0);

  return (
    <SectionShell
      id="financial"
      title="الوضع المالي"
      subtitle="الأقساط والدفعات والرصيد المتبقي"
      actions={
        customerId && (
          <Link
            to={`/clients/${customerId}#statement`}
            className="text-xs font-bold text-sky-600 hover:underline"
          >
            كشف حساب الزبون ↗
          </Link>
        )
      }
    >
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-2xl border border-slate-100 p-4">
          <div className="text-xs text-slate-400 font-bold">إجمالي الأقساط</div>
          <div className="text-lg font-black text-slate-800 mt-1">{money(totalDue)} ل.س</div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
          <div className="text-xs text-emerald-700 font-bold">المسدّد</div>
          <div className="text-lg font-black text-emerald-700 mt-1">{money(totalPaid)} ل.س</div>
        </div>
        <div className="rounded-2xl border border-rose-100 bg-rose-50/50 p-4">
          <div className="text-xs text-rose-700 font-bold">المتبقي</div>
          <div className="text-lg font-black text-rose-700 mt-1">{money(totalRemaining)} ل.س</div>
        </div>
      </div>

      {/* Installments table */}
      <div className="mb-6">
        <h4 className="text-xs font-black text-slate-500 mb-2">الأقساط ({installments.length})</h4>
        {installments.length === 0 ? (
          <p className="text-xs text-slate-400 italic">لا أقساط (دفعة واحدة).</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-slate-400 font-bold">
              <tr className="border-b border-slate-100">
                <th className="text-right py-2 px-2">#</th>
                <th className="text-right py-2 px-2">تاريخ الاستحقاق</th>
                <th className="text-right py-2 px-2">المبلغ</th>
                <th className="text-right py-2 px-2">المسدّد</th>
                <th className="text-right py-2 px-2">المتبقي</th>
                <th className="text-right py-2 px-2">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {installments.map((i: any) => {
                const st = INSTALLMENT_STATUS_LABEL[i.status] ?? { cls: 'bg-slate-100 text-slate-600', label: i.status };
                return (
                  <tr key={i.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 px-2 font-mono text-slate-500">{i.installmentNumber}</td>
                    <td className="py-2 px-2 text-slate-700">{fmt(i.dueDate)}</td>
                    <td className="py-2 px-2 text-slate-700">{money(i.amountSyp)} ل.س</td>
                    <td className="py-2 px-2 text-emerald-700">{money(i.paidAmount)} ل.س</td>
                    <td className="py-2 px-2 text-rose-700">{money(i.remainingBalance)} ل.س</td>
                    <td className="py-2 px-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${st.cls}`}>
                        {st.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Payment entries */}
      <div>
        <h4 className="text-xs font-black text-slate-500 mb-2">الدفعات ({payments.length})</h4>
        {payments.length === 0 ? (
          <p className="text-xs text-slate-400 italic">لا توجد دفعات بعد.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-slate-400 font-bold">
              <tr className="border-b border-slate-100">
                <th className="text-right py-2 px-2">التاريخ</th>
                <th className="text-right py-2 px-2">النوع</th>
                <th className="text-right py-2 px-2">الطريقة</th>
                <th className="text-right py-2 px-2">المبلغ</th>
                <th className="text-right py-2 px-2">القسط</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p: any) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 px-2 text-slate-700">{fmt(p.receivedAt)}</td>
                  <td className="py-2 px-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                      p.entryType === 'refund' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {p.entryType === 'refund' ? 'مرتجع' : 'قبض'}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-slate-700">{p.method}</td>
                  <td className="py-2 px-2 font-bold text-slate-700">{money(p.amountSyp)} ل.س</td>
                  <td className="py-2 px-2 text-slate-500 font-mono">{p.installmentId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </SectionShell>
  );
}

export default FinancialSection;
