import DateField from '../ui/DateField';
import Select from '../ui/Select';

export type ServiceAgreementDraft = {
  agreementNumber: string;
  agreementDate: string;
  maintenancePlan: string;
  visitsCount: string;
  startDate: string;
  endDate: string;
  notes: string;
  /** Agreement fee — booked to the customer's ledger on activation (migr 485). */
  feeSyp: string;
  /** Collected at signing, recorded as the agreement's first payment. */
  paidAtSigning: string;
  paymentMethod: string;
};

export const todayYmd = () => new Date().toISOString().slice(0, 10);

export function emptyServiceAgreementDraft(): ServiceAgreementDraft {
  const today = todayYmd();
  return {
    agreementNumber: '',
    agreementDate: today,
    maintenancePlan: 'quarterly',
    visitsCount: '',
    startDate: today,
    endDate: '',
    notes: '',
    feeSyp: '',
    paidAtSigning: '',
    paymentMethod: 'cash',
  };
}

export function serviceAgreementPayloadFromDraft(draft: ServiceAgreementDraft) {
  return {
    agreementNumber: draft.agreementNumber.trim() || null,
    agreementDate: draft.agreementDate || todayYmd(),
    maintenancePlan: draft.maintenancePlan || null,
    visitsCount: draft.visitsCount ? Number(draft.visitsCount) : null,
    feeSyp: draft.feeSyp ? Number(draft.feeSyp) : 0,
    payments: Number(draft.paidAtSigning) > 0
      ? [{ method: draft.paymentMethod || 'cash', amountValue: Number(draft.paidAtSigning) }]
      : [],
    status: 'active',
    startDate: draft.startDate || null,
    endDate: draft.endDate || null,
    notes: draft.notes.trim() || null,
  };
}

const PAYMENT_METHOD_OPTIONS = [
  { value: 'cash', label: 'نقدي' },
  { value: 'sham_cash', label: 'شام كاش' },
  { value: 'syriatel_cash', label: 'سيرياتيل كاش' },
  { value: 'mtn_cash', label: 'إم تي إن كاش' },
  { value: 'alharam', label: 'الهرم' },
  { value: 'bank_transfer', label: 'حوالة بنكية' },
];

const MAINTENANCE_PLAN_OPTIONS = [
  { value: 'monthly', label: 'شهري' },
  { value: 'quarterly', label: 'كل 3 أشهر' },
  { value: 'semi_annual', label: 'كل 6 أشهر' },
  { value: 'annual', label: 'سنوي' },
];

type Props = {
  value: ServiceAgreementDraft;
  onChange: (value: ServiceAgreementDraft) => void;
  disabled?: boolean;
};

export default function ServiceAgreementForm({ value, onChange, disabled = false }: Props) {
  const set = (patch: Partial<ServiceAgreementDraft>) => onChange({ ...value, ...patch });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label className="space-y-1.5">
        <span className="text-xs font-bold text-slate-500">رقم الاتفاق</span>
        <input
          value={value.agreementNumber}
          disabled={disabled}
          onChange={(event) => set({ agreementNumber: event.target.value })}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-60"
        />
      </label>

      <label className="space-y-1.5">
        <span className="text-xs font-bold text-slate-500">تاريخ الاتفاق</span>
        <DateField
          value={value.agreementDate}
          disabled={disabled}
          onChange={(agreementDate) => set({ agreementDate })}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
        />
      </label>

      <label className="space-y-1.5">
        <span className="text-xs font-bold text-slate-500">خطة الصيانة</span>
        <Select<string>
          value={value.maintenancePlan}
          disabled={disabled}
          onChange={(maintenancePlan) => set({ maintenancePlan })}
          ariaLabel="خطة الصيانة"
          className="w-full"
          options={MAINTENANCE_PLAN_OPTIONS}
        />
      </label>

      <label className="space-y-1.5">
        <span className="text-xs font-bold text-slate-500">عدد الزيارات</span>
        <input
          type="number"
          min={1}
          value={value.visitsCount}
          disabled={disabled}
          onChange={(event) => set({ visitsCount: event.target.value })}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-60"
        />
      </label>

      <label className="space-y-1.5">
        <span className="text-xs font-bold text-slate-500">بداية السريان</span>
        <DateField
          value={value.startDate}
          disabled={disabled}
          onChange={(startDate) => set({ startDate })}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
        />
      </label>

      <label className="space-y-1.5">
        <span className="text-xs font-bold text-slate-500">نهاية السريان</span>
        <DateField
          value={value.endDate}
          disabled={disabled}
          onChange={(endDate) => set({ endDate })}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
        />
      </label>

      <label className="space-y-1.5">
        <span className="text-xs font-bold text-slate-500">رسوم الاتفاقية (ل.س)</span>
        <input
          type="number"
          min={0}
          value={value.feeSyp}
          disabled={disabled}
          onChange={(event) => set({ feeSyp: event.target.value })}
          placeholder="0"
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-60"
          dir="ltr"
        />
        <span className="block text-[11px] text-slate-400">تغطي أجور الزيارات الدورية؛ القطع على الزبون. تُقفل بعد التفعيل.</span>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1.5">
          <span className="text-xs font-bold text-slate-500">المدفوع عند التوقيع</span>
          <input
            type="number"
            min={0}
            value={value.paidAtSigning}
            disabled={disabled || !(Number(value.feeSyp) > 0)}
            onChange={(event) => set({ paidAtSigning: event.target.value })}
            placeholder="0"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-60"
            dir="ltr"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-bold text-slate-500">طريقة الدفع</span>
          <Select<string>
            value={value.paymentMethod}
            disabled={disabled || !(Number(value.paidAtSigning) > 0)}
            onChange={(paymentMethod) => set({ paymentMethod })}
            ariaLabel="طريقة الدفع"
            className="w-full"
            options={PAYMENT_METHOD_OPTIONS}
          />
        </label>
      </div>

      <label className="space-y-1.5 md:col-span-2">
        <span className="text-xs font-bold text-slate-500">ملاحظات الاتفاق</span>
        <textarea
          value={value.notes}
          disabled={disabled}
          onChange={(event) => set({ notes: event.target.value })}
          rows={3}
          className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-60"
        />
      </label>
    </div>
  );
}
