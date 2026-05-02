import { useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import type {
  Employee,
  MarketingVisit,
  MarketingVisitResultUpdateRequest,
  MarketingVisitStatus,
  MarketingVisitTaskResult,
} from '@golden-crm/shared';

interface MarketingVisitResultModalProps {
  isOpen: boolean;
  visit: MarketingVisit | null;
  employees: Employee[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (payload: MarketingVisitResultUpdateRequest) => Promise<void>;
}

const STATUS_OPTIONS: Array<{ value: MarketingVisitStatus; label: string }> = [
  { value: 'completed', label: 'تمت' },
  { value: 'not_completed', label: 'لم تتم' },
  { value: 'postponed_by_company', label: 'مؤجلة من الشركة' },
  { value: 'postponed_by_customer', label: 'مؤجلة من الزبون' },
  { value: 'cancelled', label: 'ملغاة' },
  { value: 'needs_reschedule', label: 'بحاجة إعادة جدولة' },
];

const TASK_RESULT_OPTIONS: Array<{ value: MarketingVisitTaskResult; label: string }> = [
  { value: 'cash_offer_closed', label: 'تم تقديم عرض كاش - تم الإغلاق' },
  { value: 'installment_offer_closed', label: 'تم تقديم عرض تقسيط - تم الإغلاق' },
  { value: 'cash_offer_not_closed', label: 'تم تقديم عرض كاش - لم يتم الإغلاق' },
  { value: 'installment_offer_not_closed', label: 'تم تقديم عرض تقسيط - لم يتم الإغلاق' },
  { value: 'demo_not_completed', label: 'لم يتم تقديم العرض' },
];

const CLOSED_RESULTS = new Set<MarketingVisitTaskResult>([
  'cash_offer_closed',
  'installment_offer_closed',
]);

const CASH_RESULTS = new Set<MarketingVisitTaskResult>([
  'cash_offer_closed',
  'cash_offer_not_closed',
]);

const INSTALLMENT_RESULTS = new Set<MarketingVisitTaskResult>([
  'installment_offer_closed',
  'installment_offer_not_closed',
]);

const NON_COMPLETED_STATUSES = new Set<MarketingVisitStatus>([
  'not_completed',
  'postponed_by_company',
  'postponed_by_customer',
  'cancelled',
  'needs_reschedule',
]);

function parsePositiveNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveInteger(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function MarketingVisitResultModal({
  isOpen,
  visit,
  employees,
  saving,
  error,
  onClose,
  onSubmit,
}: MarketingVisitResultModalProps) {
  const [status, setStatus] = useState<MarketingVisitStatus | ''>('');
  const [taskResult, setTaskResult] = useState<MarketingVisitTaskResult | ''>('');
  const [cashOfferAmount, setCashOfferAmount] = useState('');
  const [installmentAmount, setInstallmentAmount] = useState('');
  const [installmentMonths, setInstallmentMonths] = useState('');
  const [closedByEmployeeId, setClosedByEmployeeId] = useState('');
  const [notes, setNotes] = useState('');
  const [validationError, setValidationError] = useState('');

  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.status === 'active'),
    [employees],
  );

  useEffect(() => {
    if (!isOpen || !visit) return;
    setStatus('');
    setTaskResult('');
    setCashOfferAmount('');
    setInstallmentAmount('');
    setInstallmentMonths('');
    setClosedByEmployeeId('');
    setNotes('');
    setValidationError('');
  }, [isOpen, visit]);

  if (!isOpen || !visit) return null;

  const requiresTaskResult = status === 'completed';
  const selectedTaskResult = taskResult || null;
  const requiresCashAmount = selectedTaskResult != null && CASH_RESULTS.has(selectedTaskResult);
  const requiresInstallment = selectedTaskResult != null && INSTALLMENT_RESULTS.has(selectedTaskResult);
  const requiresClosedBy = selectedTaskResult != null && CLOSED_RESULTS.has(selectedTaskResult);
  const requiresNotes =
    (status !== '' && NON_COMPLETED_STATUSES.has(status)) ||
    selectedTaskResult === 'demo_not_completed';

  const handleSubmit = async () => {
    setValidationError('');

    if (!status) {
      setValidationError('يرجى اختيار حالة الزيارة');
      return;
    }

    if (requiresTaskResult && !taskResult) {
      setValidationError('يرجى اختيار نتيجة عرض الجهاز');
      return;
    }

    if (requiresCashAmount && parsePositiveNumber(cashOfferAmount) == null) {
      setValidationError('يرجى إدخال قيمة العرض الكاش');
      return;
    }

    if (
      requiresInstallment &&
      (parsePositiveNumber(installmentAmount) == null || parsePositiveInteger(installmentMonths) == null)
    ) {
      setValidationError('يرجى إدخال قيمة القسط وعدد الأشهر');
      return;
    }

    if (requiresClosedBy && parsePositiveInteger(closedByEmployeeId) == null) {
      setValidationError('يرجى اختيار الموظف الذي تم الإغلاق معه');
      return;
    }

    if (requiresNotes && !notes.trim()) {
      setValidationError('يرجى إدخال سبب أو ملاحظات');
      return;
    }

    await onSubmit({
      status,
      taskResult: taskResult || null,
      cashOfferAmount: requiresCashAmount ? parsePositiveNumber(cashOfferAmount) : null,
      installmentAmount: requiresInstallment ? parsePositiveNumber(installmentAmount) : null,
      installmentMonths: requiresInstallment ? parsePositiveInteger(installmentMonths) : null,
      closedByEmployeeId: requiresClosedBy ? parsePositiveInteger(closedByEmployeeId) : null,
      notes: notes.trim() || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" dir="rtl">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">تسجيل نتيجة زيارة التسويق</h2>
            <p className="mt-1 text-xs text-slate-500">احفظ نتيجة الزيارة ومهمة عرض الجهاز فقط</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
            <div>
              <p className="text-xs font-bold text-slate-500">الزبون</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{visit.customerName || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500">وقت الزيارة</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{visit.scheduledTime || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500">الجهاز المطلوب عرضه</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{visit.requestedDeviceName || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500">مصدر المياه</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{visit.waterSource || '—'}</p>
            </div>
            <div className="md:col-span-2">
              <p className="text-xs font-bold text-slate-500">ملاحظات الفني</p>
              <p className="mt-1 text-sm leading-6 text-slate-700">{visit.technicianNotes || '—'}</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">
              حالة الزيارة <span className="text-red-500">*</span>
            </label>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as MarketingVisitStatus)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
            >
              <option value="">اختر حالة الزيارة...</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {requiresTaskResult && (
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">
                نتيجة عرض الجهاز <span className="text-red-500">*</span>
              </label>
              <select
                value={taskResult}
                onChange={(event) => setTaskResult(event.target.value as MarketingVisitTaskResult)}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
              >
                <option value="">اختر نتيجة عرض الجهاز...</option>
                {TASK_RESULT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {requiresCashAmount && (
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">
                قيمة العرض الكاش <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={cashOfferAmount}
                onChange={(event) => setCashOfferAmount(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
                placeholder="أدخل قيمة العرض الكاش"
              />
            </div>
          )}

          {requiresInstallment && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">
                  قيمة القسط <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={installmentAmount}
                  onChange={(event) => setInstallmentAmount(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
                  placeholder="أدخل قيمة القسط"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">
                  عدد الأشهر <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={installmentMonths}
                  onChange={(event) => setInstallmentMonths(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
                  placeholder="أدخل عدد الأشهر"
                />
              </div>
            </div>
          )}

          {requiresClosedBy && (
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">
                تم الإغلاق مع <span className="text-red-500">*</span>
              </label>
              <select
                value={closedByEmployeeId}
                onChange={(event) => setClosedByEmployeeId(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
              >
                <option value="">اختر الموظف...</option>
                {activeEmployees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {requiresClosedBy && (
            <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              تم حفظ الإغلاق، وسيتم إنشاء العقد لاحقاً من خطوة منفصلة.
            </p>
          )}

          {requiresNotes && (
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">
                السبب / الملاحظات <span className="text-red-500">*</span>
              </label>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={4}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
                placeholder="اكتب السبب أو الملاحظات..."
              />
            </div>
          )}

          {(validationError || error) && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {validationError || error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-200"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? 'جاري الحفظ...' : 'حفظ النتيجة'}
          </button>
        </div>
      </div>
    </div>
  );
}
