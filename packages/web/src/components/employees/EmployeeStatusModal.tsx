import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import Modal from '../ui/Modal';
import Select from '../ui/Select';

// Employee status as an explicit operation (migration 479). The consequences
// are shown before confirming, because suspended/terminated switch the
// employee's system account off immediately.

export type EmployeeStatus = 'active' | 'vacation' | 'suspended' | 'terminated';

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: 'نشط',
  vacation: 'إجازة',
  suspended: 'موقوف',
  terminated: 'منتهي الخدمة',
};

// Client ownership needs an ACTIVE owner, so it falls to the branch while the
// employee is not active and returns with them. Open suggested names are
// different: suspension or termination hands them to the branch for good
// (release_candidates_when_employee_inactive); a vacation keeps them (migration 479 D6).
const RELEASE_NOTE = 'وتُحرَّر الأسماء المقترحة المفتوحة المسندة إليه إلى ملكية الفرع نهائياً (لا تعود عند رجوعه).';

const EFFECT_TEXT: Record<EmployeeStatus, string> = {
  active: 'يعود الموظف للعمل، ويُعاد تفعيل حسابه في النظام إن كان موقوفاً بسبب حالته، وتعود إليه ملكية زبائنه.',
  vacation: 'يبقى حسابه فعّالاً، لكنه يُستثنى من التخطيط والميدان، وتنتقل ملكية زبائنه مؤقتاً إلى ملكية الفرع. تبقى الأسماء المقترحة المسندة إليه معه.',
  suspended: `يُوقف حسابه في النظام فوراً ويُسجَّل خروجه، وتنتقل ملكية زبائنه مؤقتاً إلى ملكية الفرع، ${RELEASE_NOTE}`,
  terminated: `يُوقف حسابه في النظام فوراً ويُسجَّل خروجه، وتنتقل ملكية زبائنه إلى ملكية الفرع، ${RELEASE_NOTE} يمكن إعادته لاحقاً إلى «نشط» بسبب.`,
};

export default function EmployeeStatusModal({
  open,
  employeeId,
  currentStatus,
  onClose,
  onDone,
}: {
  open: boolean;
  employeeId: number;
  currentStatus: EmployeeStatus;
  onClose: () => void;
  onDone: () => void;
}) {
  const [toStatus, setToStatus] = useState<EmployeeStatus | ''>('');
  const [reasons, setReasons] = useState<Array<{ id: number; value: string; metadata?: { label?: string } | null }>>([]);
  const [reasonId, setReasonId] = useState('');
  const [note, setNote] = useState('');
  // Migration 480: the dates of the employment period.
  const today = new Date().toISOString().slice(0, 10);
  const [endOfServiceDate, setEndOfServiceDate] = useState(today);
  const [newStartDate, setNewStartDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setToStatus('');
    setReasonId('');
    setNote('');
    setEndOfServiceDate(today);
    setNewStartDate(today);
    setError('');
    setLoading(true);
    api.systemLists.list({ category: 'employee_status_change_reasons', activeOnly: true })
      .then((rows) => setReasons(Array.isArray(rows) ? rows : []))
      .catch((err: any) => setError(err?.message ?? 'تعذر تحميل قائمة الأسباب'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const needsEndDate = toStatus === 'terminated';
  const needsStartDate = currentStatus === 'terminated' && toStatus === 'active';
  const datesValid = (!needsEndDate || (Boolean(endOfServiceDate) && endOfServiceDate <= today))
    && (!needsStartDate || Boolean(newStartDate));

  const submit = async () => {
    if (!toStatus || !reasonId || !datesValid) return;
    setSaving(true);
    setError('');
    try {
      await api.employees.changeStatus(employeeId, {
        status: toStatus,
        reasonId: Number(reasonId),
        note: note.trim() || null,
        endOfServiceDate: needsEndDate ? endOfServiceDate : null,
        newStartDate: needsStartDate ? newStartDate : null,
      });
      onDone();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر تغيير حالة الموظف');
    } finally {
      setSaving(false);
    }
  };

  const statusOptions = (Object.keys(EMPLOYEE_STATUS_LABELS) as EmployeeStatus[])
    .filter((s) => s !== currentStatus)
    .map((s) => ({ value: s, label: EMPLOYEE_STATUS_LABELS[s] }));

  return (
    <Modal
      isOpen={open}
      onClose={saving ? () => undefined : onClose}
      title="تغيير حالة الموظف"
      subtitle={`الحالة الحالية: ${EMPLOYEE_STATUS_LABELS[currentStatus]}`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 disabled:opacity-50">
            رجوع
          </button>
          <button type="button" onClick={submit} disabled={saving || loading || !toStatus || !reasonId || !datesValid}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            تأكيد تغيير الحالة
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <label className="block">
          <span className="mb-2 block text-sm font-bold text-slate-700">الحالة الجديدة</span>
          <Select
            value={toStatus}
            onChange={(v) => setToStatus(v as EmployeeStatus)}
            disabled={saving}
            placeholder="اختر الحالة"
            ariaLabel="الحالة الجديدة"
            options={statusOptions}
          />
        </label>

        {toStatus ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
            {EFFECT_TEXT[toStatus]}
          </p>
        ) : null}

        {needsEndDate ? (
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-700">تاريخ إيقاف الخدمة</span>
            <input type="date" value={endOfServiceDate} max={today} disabled={saving}
              onChange={(e) => setEndOfServiceDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 p-2.5 text-sm outline-none focus:border-sky-400" />
            <span className="mt-1 block text-xs text-slate-400">التاريخ الفعلي لانتهاء الخدمة، ولا يمكن أن يكون في المستقبل.</span>
          </label>
        ) : null}

        {needsStartDate ? (
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-700">تاريخ بدء العمل الجديد</span>
            <input type="date" value={newStartDate} disabled={saving}
              onChange={(e) => setNewStartDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 p-2.5 text-sm outline-none focus:border-sky-400" />
            <span className="mt-1 block text-xs text-slate-400">يُمسح تاريخ إيقاف الخدمة، وتبقى فترة العمل السابقة في سجل الموظف.</span>
          </label>
        ) : null}

        <label className="block">
          <span className="mb-2 block text-sm font-bold text-slate-700">السبب</span>
          <Select
            value={reasonId}
            onChange={setReasonId}
            disabled={loading || saving}
            placeholder={loading ? 'جاري تحميل الأسباب...' : 'اختر السبب'}
            ariaLabel="سبب تغيير الحالة"
            options={reasons.map((r) => ({ value: String(r.id), label: r.metadata?.label || r.value }))}
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-bold text-slate-700">ملاحظة اختيارية</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={saving} rows={2}
            className="w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-sky-400" />
        </label>
      </div>
    </Modal>
  );
}
