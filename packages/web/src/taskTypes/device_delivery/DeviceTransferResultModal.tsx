import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Loader2, Repeat, X, XCircle } from 'lucide-react';
import { api } from '../../lib/api';
import DateField from '../../components/ui/DateField';

type TransferDecision =
  | 'transferred_successfully'
  | 'reschedule'
  | 'customer_refused_transfer';

type TransferKind = 'same_customer_new_address' | 'another_customer';

const DECISION_CARDS: Array<{ value: TransferDecision; title: string; desc: string; Icon: any; cls: string }> = [
  { value: 'transferred_successfully', title: 'تم النقل', desc: 'تم نقل الجهاز إلى العنوان المبدئي الجديد', Icon: CheckCircle2, cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  { value: 'reschedule', title: 'إعادة جدولة', desc: 'لم يتم النقل وتحتاج المهمة لموعد جديد', Icon: Clock, cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  { value: 'customer_refused_transfer', title: 'رفض النقل', desc: 'رفض الطرف المعني إتمام النقل', Icon: XCircle, cls: 'border-rose-200 bg-rose-50 text-rose-700' },
];

function listLabel(item: any) {
  return item?.metadata?.label || item?.label || item?.value || `#${item?.id}`;
}

export default function DeviceTransferResultModal({
  visitId,
  taskId,
  task,
  onClose,
  onSaved,
}: {
  visitId: number;
  taskId: number;
  task: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const transferKind: TransferKind = (task?.transfer_kind ?? task?.transferKind) === 'another_customer'
    ? 'another_customer'
    : 'same_customer_new_address';
  const [decision, setDecision] = useState<TransferDecision>('transferred_successfully');
  const [customerAcknowledged, setCustomerAcknowledged] = useState(true);
  const [targetCustomerAcknowledged, setTargetCustomerAcknowledged] = useState(transferKind === 'another_customer');
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
      api.systemLists.getItemsByCode('device_transfer_refusal_reasons'),
      api.systemLists.getItemsByCode('device_transfer_reschedule_reasons'),
    ]).then(([refusal, reschedule]) => {
      const refusalRows = refusal.status === 'fulfilled' ? refusal.value.filter((r: any) => r.isActive !== false) : [];
      const rescheduleRows = reschedule.status === 'fulfilled' ? reschedule.value.filter((r: any) => r.isActive !== false) : [];
      setRefusalReasons(refusalRows);
      setRescheduleReasons(rescheduleRows);
      setRefusalReasonId(refusalRows[0]?.id ? String(refusalRows[0].id) : '');
      setRescheduleReasonId(rescheduleRows[0]?.id ? String(rescheduleRows[0].id) : '');
    });
  }, []);

  const targetLabel = useMemo(
    () => task?.target_client_name || task?.targetClientName || (task?.target_client_id || task?.targetClientId ? `زبون #${task?.target_client_id ?? task?.targetClientId}` : ''),
    [task],
  );

  async function submit() {
    setError(null);
    if (decision === 'transferred_successfully' && !customerAcknowledged) {
      setError('تأكيد الزبون مطلوب عند نجاح النقل');
      return;
    }
    if (decision === 'transferred_successfully' && transferKind === 'another_customer' && !targetCustomerAcknowledged) {
      setError('تأكيد الزبون الجديد مطلوب عند نقل الجهاز إلى زبون آخر');
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
    if (decision === 'customer_refused_transfer' && !refusalReasonId) {
      setError('سبب رفض النقل مطلوب');
      return;
    }

    setSaving(true);
    try {
      await api.fieldVisits.recordTaskResult(visitId, taskId, {
        final_decision: decision,
        transfer_kind: transferKind,
        target_client_id: task?.target_client_id ?? task?.targetClientId ?? null,
        planned_geo_unit_id: task?.planned_transfer_geo_unit_id ?? task?.plannedTransferGeoUnitId ?? null,
        planned_address_text: task?.planned_transfer_address_text ?? task?.plannedTransferAddressText ?? null,
        planned_lat: task?.planned_transfer_lat ?? task?.plannedTransferLat ?? null,
        planned_lng: task?.planned_transfer_lng ?? task?.plannedTransferLng ?? null,
        refusal_reason_id: decision === 'customer_refused_transfer' ? Number(refusalReasonId) : null,
        reschedule_reason_id: decision === 'reschedule' ? Number(rescheduleReasonId) : null,
        expected_date: decision === 'reschedule' ? expectedDate : null,
        expected_time: decision === 'reschedule' && expectedTime ? expectedTime : null,
        customer_acknowledged: decision === 'transferred_successfully' ? customerAcknowledged : null,
        target_customer_acknowledged: decision === 'transferred_successfully' && transferKind === 'another_customer' ? targetCustomerAcknowledged : null,
        technical_notes: technicalNotes.trim() || null,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? 'فشل حفظ نتيجة نقل الجهاز');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" dir="rtl">
      <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Repeat className="h-5 w-5 text-slate-700" />
            <h2 className="text-base font-black text-slate-900">تسجيل نتيجة نقل الجهاز</h2>
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

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
            <div className="font-black">{transferKind === 'another_customer' ? 'نقل إلى زبون آخر' : 'نقل إلى عنوان جديد لنفس الزبون'}</div>
            {targetLabel && <div className="mt-1 text-xs text-slate-500">الزبون الجديد: {targetLabel}</div>}
          </div>

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
                <DateField value={expectedDate} onChange={setExpectedDate} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">وقت الموعد</span>
                <input type="time" value={expectedTime} onChange={(e) => setExpectedTime(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
              </label>
            </div>
          )}

          {decision === 'customer_refused_transfer' && (
            <label className="block space-y-1.5 rounded-lg border border-rose-200 bg-rose-50/60 p-4">
              <span className="text-xs font-bold text-slate-500">سبب رفض النقل</span>
              <select value={refusalReasonId} onChange={(e) => setRefusalReasonId(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                {refusalReasons.map((reason) => <option key={reason.id} value={reason.id}>{listLabel(reason)}</option>)}
              </select>
            </label>
          )}

          {decision === 'transferred_successfully' && (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <input type="checkbox" checked={customerAcknowledged} onChange={(e) => setCustomerAcknowledged(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                تم تأكيد الزبون على نقل الجهاز
              </label>
              {transferKind === 'another_customer' && (
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                  <input type="checkbox" checked={targetCustomerAcknowledged} onChange={(e) => setTargetCustomerAcknowledged(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                  تم تأكيد الزبون الجديد على استلام الجهاز
                </label>
              )}
            </div>
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
