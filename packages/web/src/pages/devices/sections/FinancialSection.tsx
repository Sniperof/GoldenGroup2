// DEC-CT-06/08: financials derived from the contract's installments + payment
// entries. Dues table is dismissed; balance is computed per installment.
//
// We surface 3 tiers:
//   1. summary chips (total, paid, remaining)
//   2. installments table
//   3. payment entries table (collection vs refund)
// And a link to the customer-wide statement (DEC-CT-10).

import { Link } from 'react-router-dom';
import { ListChecks, Receipt } from 'lucide-react';
import { SectionShell } from './SectionShell';
import SmartTable, { type ColumnDef } from '../../../components/SmartTable';

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

  // Columns mirror the original raw tables 1:1 (design-only migration to <SmartTable>).
  const installmentColumns: ColumnDef<any>[] = [
    { key: 'installmentNumber', label: '#', render: i => <span className="font-mono text-sm text-slate-500">{i.installmentNumber}</span> },
    { key: 'dueDate', label: 'تاريخ الاستحقاق', render: i => <span className="text-sm text-slate-700">{fmt(i.dueDate)}</span> },
    { key: 'amountSyp', label: 'المبلغ', render: i => <span className="text-sm text-slate-700">{money(i.amountSyp)} ل.س</span> },
    { key: 'paidAmount', label: 'المسدّد', render: i => <span className="text-sm text-emerald-700">{money(i.paidAmount)} ل.س</span> },
    { key: 'remainingBalance', label: 'المتبقي', render: i => <span className="text-sm text-rose-700">{money(i.remainingBalance)} ل.س</span> },
    {
      key: 'status', label: 'الحالة',
      render: i => {
        const st = INSTALLMENT_STATUS_LABEL[i.status] ?? { cls: 'bg-slate-100 text-slate-600', label: i.status };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${st.cls}`}>{st.label}</span>;
      },
    },
  ];

  const paymentColumns: ColumnDef<any>[] = [
    { key: 'receivedAt', label: 'التاريخ', render: p => <span className="text-sm text-slate-700">{fmt(p.receivedAt)}</span> },
    {
      key: 'entryType', label: 'النوع',
      render: p => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${p.entryType === 'refund' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
          {p.entryType === 'refund' ? 'مرتجع' : 'قبض'}
        </span>
      ),
    },
    { key: 'method', label: 'الطريقة', render: p => <span className="text-sm text-slate-700">{p.method}</span> },
    { key: 'amountSyp', label: 'المبلغ', render: p => <span className="text-sm font-bold text-slate-700">{money(p.amountSyp)} ل.س</span> },
    { key: 'installmentId', label: 'القسط', render: p => <span className="font-mono text-sm text-slate-500">{p.installmentId ?? '—'}</span> },
  ];

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
        <SmartTable<any>
          title="الأقساط"
          subtitle={`${installments.length} قسط`}
          icon={ListChecks}
          data={installments}
          columns={installmentColumns}
          getId={i => i.id}
          hideFilterBar
          tableMinWidth={640}
          emptyIcon={ListChecks}
          emptyMessage="لا أقساط (دفعة واحدة)."
        />
      </div>

      {/* Payment entries */}
      <div>
        <SmartTable<any>
          title="الدفعات"
          subtitle={`${payments.length} دفعة`}
          icon={Receipt}
          data={payments}
          columns={paymentColumns}
          getId={p => p.id}
          hideFilterBar
          tableMinWidth={560}
          emptyIcon={Receipt}
          emptyMessage="لا توجد دفعات بعد."
        />
      </div>
    </SectionShell>
  );
}

export default FinancialSection;
