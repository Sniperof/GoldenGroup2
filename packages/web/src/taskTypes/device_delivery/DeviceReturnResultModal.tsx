import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Loader2, PackageCheck, X, XCircle } from 'lucide-react';
import { api } from '../../lib/api';

type ReturnDecision =
  | 'returned_successfully'
  | 'reschedule'
  | 'customer_refused_return';

const DECISION_CARDS: Array<{ value: ReturnDecision; title: string; desc: string; Icon: any; cls: string }> = [
  { value: 'returned_successfully', title: 'تم الإرجاع', desc: 'تم تسليم الجهاز للزبون بعد الصيانة', Icon: CheckCircle2, cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  { value: 'reschedule', title: 'إعادة جدولة', desc: 'لم يتم الإرجاع وتحتاج المهمة لموعد جديد', Icon: Clock, cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  { value: 'customer_refused_return', title: 'رفض الإرجاع', desc: 'رفض الزبون استلام الجهاز', Icon: XCircle, cls: 'border-rose-200 bg-rose-50 text-rose-700' },
];

function listLabel(item: any) {
  return item?.metadata?.label || item?.label || item?.value || `#${item?.id}`;
}

export default function DeviceReturnResultModal({
  visitId,
  taskId,
  onClose,
  onSaved,
}: {
  visitId: number;
  taskId: number;
  task: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [decision, setDecision] = useState<ReturnDecision>('returned_successfully');
  const [customerAcknowledged, setCustomerAcknowledged] = useState(true);
  const [technicalNotes, setTechnicalNotes] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [expectedTime, setExpectedTime] = useState('');
  const [refusalReasonId, setRefusalReasonId] = useState('');
  const [rescheduleReasonId, setRescheduleReasonId] = useState('');
  const [refusalReasons, setRefusalReasons] = useState<any[]>([]);
  const [rescheduleReasons, setRescheduleReasons] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.allSettled([
      api.systemLists.getItemsByCode('device_return_refusal_reasons'),
      api.systemLists.getItemsByCode('device_return_reschedule_reasons'),
    ]).then(([refusal, reschedule]) => {
      const refusalRows = refusal.status === 'fulfilled' ? refusal.value.filter((r: any) => r.isActive !== false) : [];
      const rescheduleRows = reschedule.status === 'fulfilled' ? reschedule.value.filter((r: any) => r.isActive !== false) : [];
      setRefusalReasons(refusalRows);
      setRescheduleReasons(rescheduleRows);
      setRefusalReasonId(refusalRows[0]?.id ? String(refusalRows[0].id) : '');
      setRescheduleReasonId(rescheduleRows[0]?.id ? String(rescheduleRows[0].id) : '');
    });
  }, []);

  async function submit() {
    setError(null);
    if (decision === 'returned_successfully' && !customerAcknowledged) {
      setError('تأكيد الزبون مطلوب عند نجاح الإرجاع');
      return;
    }
    if (decision === 'reschedule') {
      if (!rescheduleReasonId) {
        setError('سبب إعادة الجدولة مطلوب');
        return;
      }
      if (!expectedDate) {
        setError('تاريخ إعادة الجدولة مطلوب');
        return;
      }
    }
    if (decision === 'customer_refused_return' && !refusalReasonId) {
      setError('سبب رفض الإرجاع مطلوب');
      return;
    }

    setSaving(true);
    try {
      await api.fieldVisits.recordTaskResult(visitId, taskId, {
        final_decision: decision,
        refusal_reason_id: decision === 'customer_refused_return' ? Number(refusalReasonId) : null,
        reschedule_reason_id: decision === 'reschedule' ? Number(rescheduleReasonId) : null,
        expected_date: decision === 'reschedule' ? expectedDate : null,
        expected_time: decision === 'reschedule' && expectedTime ? expectedTime : null,
        customer_acknowledged: decision === 'returned_successfully' ? customerAcknowledged : null,
        technical_notes: technicalNotes.trim() || null,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? 'فشل حفظ نتيجة إرجاع الجهاز');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" dir="rtl">
      <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-slate-700" />
            <h2 className="text-base font-black text-slate-900">تسجيل نتيجة إرجاع الجهاز</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[75vh] space-y-4 overflow-y-auto px-5 py-4">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            {DECISION_CARDS.map(({ value, title, desc, Icon, cls }) => {
              const selected = decision === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDecision(value)}
                  className={`min-h-[112px] rounded-lg border p-3 text-right transition ${
                    selected ? `${cls} shadow-sm ring-2 ring-offset-1 ring-current/20` : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="mb-2 h-5 w-5" />
                  <div className="text-sm font-black">{title}</div>
                  <div className="mt-1 text-xs opacity-80">{desc}</div>
                </button>
              );
            })}
          </div>

          {decision === 'reschedule' && (
            <div className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-4 md:grid-cols-3">
              <label className="space-y-1.5 md:col-span-3">
                <span className="text-xs font-bold text-slate-500">سبب إعادة الجدولة</span>
                <select value={rescheduleReasonId} onChange={(e) => setRescheduleReasonId(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  {rescheduleReasons.map((reason) => <option key={reason.id} value={reason.id}>{listLabel(reason)}</option>)}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">تاريخ الموعد الجديد</span>
                <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">وقت الموعد</span>
                <input type="time" value={expectedTime} onChange={(e) => setExpectedTime(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
              </label>
            </div>
          )}

          {decision === 'customer_refused_return' && (
            <label className="block space-y-1.5 rounded-lg border border-rose-200 bg-rose-50/60 p-4">
              <span className="text-xs font-bold text-slate-500">سبب رفض الإرجاع</span>
              <select value={refusalReasonId} onChange={(e) => setRefusalReasonId(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                {refusalReasons.map((reason) => <option key={reason.id} value={reason.id}>{listLabel(reason)}</option>)}
              </select>
            </label>
          )}

          {decision === 'returned_successfully' && (
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm font-bold text-slate-700">
              <input type="checkbox" checked={customerAcknowledged} onChange={(e) => setCustomerAcknowledged(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              تم تأكيد الزبون على استلام الجهاز
            </label>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-500">ملاحظات فنية</span>
            <textarea value={technicalNotes} onChange={(e) => setTechnicalNotes(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
            إلغاء
          </button>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            حفظ النتيجة
          </button>
        </div>
      </div>
    </div>
  );
}
