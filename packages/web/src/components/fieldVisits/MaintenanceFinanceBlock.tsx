import { Wrench, Wallet } from '../ui/icons';

// Parts and money of one maintenance task inside a visit (GET /field-visits/:id →
// task.maintenanceFinance). The main figures are THIS visit; a re-attempted task adds
// one cumulative line underneath (decision 2026-10-19).

type Part = {
  name: string; code: string | null; maintenanceType: string | null;
  quantity: number; unitPrice: number; lineTotal: number;
  executionStatus: string | null; customerDecision: string | null;
  visitId?: number | string | null; visitDate?: string | null;
};

export type MaintenanceFinance = {
  source: 'live' | 'migrated';
  parts: Part[];
  previousParts: Part[];
  attempt: { charge: number; paid: number; paymentMethod: string | null };
  cumulative: { totalCost: number; totalPaid: number; remaining: number; attempts: number } | null;
  paymentType: string | null;
  installments: Array<{ installmentNumber: number; dueDate: string; amount: number; paid: number; remaining: number; status: string }>;
};

const EXECUTION_LABELS: Record<string, { label: string; cls: string }> = {
  replaced:                         { label: 'بُدّلت',            cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  delivered_to_customer_stock:      { label: 'سُلّمت للزبون',     cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  not_replaced_customer_refused:    { label: 'رفضها الزبون',      cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  not_replaced_unavailable:         { label: 'غير متوفرة',        cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  not_replaced_technician_decision: { label: 'لم تُبدّل (قرار الفني)', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};

const METHOD_LABELS: Record<string, string> = {
  cash: 'نقدي', hand: 'نقدي', usd_cash: 'نقدي دولار', barter: 'مقايضة', transfer: 'حوالة',
  sham_cash: 'شام كاش', syriatel_cash: 'سيرياتيل كاش', mtn_cash: 'إم تي إن كاش',
  alharam: 'الهرم', bank_transfer: 'حوالة بنكية',
};

const INSTALLMENT_STATUS: Record<string, string> = {
  paid: 'مدفوع', partial: 'مدفوع جزئياً', overdue: 'متأخر', pending: 'مستحق',
};

const money = (v: number) => `${Math.round(v).toLocaleString('ar-SY', { numberingSystem: 'latn' })} ل.س`;
const methodLabel = (m: string | null) =>
  m ? m.split('، ').map((x) => METHOD_LABELS[x] ?? x).join('، ') : null;
// Parts that are not installed cost nothing (refused / unavailable / not replaced).
const isCharged = (p: Part) => !p.executionStatus || ['replaced', 'delivered_to_customer_stock'].includes(p.executionStatus);

function PartRow({ p, muted }: { p: Part; muted?: boolean }) {
  const ex = p.executionStatus ? EXECUTION_LABELS[p.executionStatus] : null;
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 ${muted ? 'bg-slate-50' : 'bg-white'}`}>
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        <span className={`text-xs font-bold ${muted ? 'text-slate-500' : 'text-slate-800'}`}>{p.name}</span>
        {p.code && <span className="font-mono text-[11px] text-slate-400">{p.code}</span>}
        {ex && <span className={`rounded-full border px-1.5 py-0.5 text-[11px] font-bold ${ex.cls}`}>{ex.label}</span>}
        {muted && p.visitId && (
          <span className="text-[11px] text-slate-400">زيارة #{p.visitId}{p.visitDate ? ` · ${String(p.visitDate).slice(0, 10)}` : ''}</span>
        )}
      </div>
      <span className={`text-xs ${isCharged(p) ? 'font-bold text-slate-700' : 'text-slate-400 line-through'}`}>
        {p.quantity} × {money(p.unitPrice)}
      </span>
    </div>
  );
}

export default function MaintenanceFinanceBlock({ finance }: { finance: MaintenanceFinance }) {
  const { parts, previousParts, attempt, cumulative, installments } = finance;
  const remainingHere = Math.max(attempt.charge - attempt.paid, 0);
  const method = methodLabel(attempt.paymentMethod);

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 space-y-3">
      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-500">
          <Wrench className="h-3.5 w-3.5" /> القطع بهذه الزيارة
        </div>
        {parts.length === 0 ? (
          <p className="text-xs text-slate-400">لا توجد قطع مسجّلة بهذه الزيارة</p>
        ) : (
          <div className="space-y-1">{parts.map((p, i) => <PartRow key={i} p={p} />)}</div>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-500">
          <Wallet className="h-3.5 w-3.5" /> المبالغ بهذه الزيارة
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-white px-2 py-1.5">
            <div className="text-[11px] text-slate-400">المطلوب</div>
            <div className="text-sm font-black text-slate-800">{money(attempt.charge)}</div>
          </div>
          <div className="rounded-lg bg-white px-2 py-1.5">
            <div className="text-[11px] text-slate-400">المدفوع{method ? ` (${method})` : ''}</div>
            <div className="text-sm font-black text-emerald-700">{money(attempt.paid)}</div>
          </div>
          <div className="rounded-lg bg-white px-2 py-1.5">
            <div className="text-[11px] text-slate-400">{finance.paymentType === 'installment' ? 'مقسّط' : 'المتبقي'}</div>
            <div className={`text-sm font-black ${remainingHere > 0 ? 'text-rose-700' : 'text-slate-500'}`}>{money(remainingHere)}</div>
          </div>
        </div>
      </div>

      {installments.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-bold text-slate-500">أقساط الصيانة</div>
          <div className="space-y-1">
            {installments.map((i) => (
              <div key={i.installmentNumber} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 text-xs">
                <span className="font-bold text-slate-700">قسط {i.installmentNumber} · {String(i.dueDate).slice(0, 10)}</span>
                <span className="text-slate-500">
                  {money(i.amount)} · مدفوع {money(i.paid)} · <span className="font-bold">{INSTALLMENT_STATUS[i.status] ?? i.status}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {cumulative && (
        <div className="rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs text-slate-600">
          <span className="font-bold">المهمة كاملة ({cumulative.attempts} زيارات):</span>{' '}
          التكلفة {money(cumulative.totalCost)} · المدفوع {money(cumulative.totalPaid)} · المتبقي{' '}
          <span className={cumulative.remaining > 0 ? 'font-bold text-rose-700' : ''}>{money(cumulative.remaining)}</span>
        </div>
      )}

      {previousParts.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-bold text-slate-400">قطع من زيارات سابقة لنفس المهمة</div>
          <div className="space-y-1">{previousParts.map((p, i) => <PartRow key={i} p={p} muted />)}</div>
        </div>
      )}
    </div>
  );
}
