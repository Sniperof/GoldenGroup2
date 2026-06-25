import { useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Loader2, ShieldAlert, Unplug, XCircle } from 'lucide-react';
import { api } from '../../lib/api';
import Modal from '../../components/ui/Modal';

type DisconnectionDecision =
  | 'disconnected_successfully'
  | 'not_disconnected'
  | 'customer_refused_disconnection'
  | 'requires_retrieval'
  | 'unsafe_to_disconnect';

const DECISION_CARDS: Array<{ value: DisconnectionDecision; title: string; desc: string; Icon: any; cls: string }> = [
  { value: 'disconnected_successfully', title: 'تم الفك', desc: 'تم فصل الجهاز أو إيقاف تشغيله في الموقع', Icon: CheckCircle2, cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  { value: 'requires_retrieval', title: 'يحتاج سحباً', desc: 'تم توثيق الفك مع حاجة لمهمة سحب مستقلة', Icon: Unplug, cls: 'border-sky-200 bg-sky-50 text-sky-700' },
  { value: 'not_disconnected', title: 'لم يتم الفك', desc: 'تبقى المهمة للمتابعة', Icon: Clock, cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  { value: 'unsafe_to_disconnect', title: 'غير آمن', desc: 'تعذر الفك بسبب ظرف فني أو أمان', Icon: ShieldAlert, cls: 'border-orange-200 bg-orange-50 text-orange-700' },
  { value: 'customer_refused_disconnection', title: 'رفض الزبون', desc: 'رفض الزبون تنفيذ الفك', Icon: XCircle, cls: 'border-rose-200 bg-rose-50 text-rose-700' },
];

const REASONS = [
  { value: 'contract_cancelled', label: 'إلغاء عقد' },
  { value: 'temporary_stop', label: 'إيقاف مؤقت' },
  { value: 'customer_request', label: 'طلب الزبون' },
  { value: 'technical_safety', label: 'سلامة فنية' },
  { value: 'replacement_preparation', label: 'تحضير تبديل' },
  { value: 'maintenance_preparation', label: 'تحضير صيانة' },
  { value: 'other', label: 'أخرى' },
];

const RETRIEVAL_REASONS = [
  { value: 'workshop_repair', label: 'صيانة في الورشة' },
  { value: 'replacement', label: 'تبديل جهاز' },
  { value: 'final_retrieval', label: 'استرجاع نهائي' },
  { value: 'other', label: 'أخرى' },
];

export default function DeviceDisconnectionResultModal({
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
  const [decision, setDecision] = useState<DisconnectionDecision>('disconnected_successfully');
  const [reasonCode, setReasonCode] = useState('customer_request');
  const [deviceLeftOnSite, setDeviceLeftOnSite] = useState(true);
  const [waterDisconnected, setWaterDisconnected] = useState(true);
  const [electricityDisconnected, setElectricityDisconnected] = useState(false);
  const [accessoriesRemoved, setAccessoriesRemoved] = useState(false);
  const [customerAcknowledged, setCustomerAcknowledged] = useState(true);
  const [retrievalReason, setRetrievalReason] = useState('workshop_repair');
  const [expectedDate, setExpectedDate] = useState('');
  const [expectedTime, setExpectedTime] = useState('');
  const [technicalNotes, setTechnicalNotes] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsFollowUp = decision === 'not_disconnected' || decision === 'unsafe_to_disconnect';
  const needsRetrieval = decision === 'requires_retrieval';

  async function submit() {
    setError(null);
    if (!reasonCode) {
      setError('سبب نتيجة الفك مطلوب');
      return;
    }
    if (decision === 'disconnected_successfully' && !waterDisconnected && !electricityDisconnected && !accessoriesRemoved) {
      setError('وثّق إجراء فني واحد على الأقل عند نجاح الفك');
      return;
    }
    if (needsFollowUp && !expectedDate) {
      setError('تاريخ المتابعة مطلوب عند عدم تنفيذ الفك');
      return;
    }
    if (needsRetrieval && !retrievalReason) {
      setError('سبب السحب اللاحق مطلوب');
      return;
    }

    setSaving(true);
    try {
      await api.fieldVisits.recordTaskResult(visitId, taskId, {
        final_decision: decision,
        reason_code: reasonCode,
        closing_notes: notes.trim() || null,
        notes: notes.trim() || null,
        expected_date: needsFollowUp ? expectedDate : null,
        expected_time: needsFollowUp && expectedTime ? expectedTime : null,
        device_left_on_site: deviceLeftOnSite,
        water_disconnected: waterDisconnected,
        electricity_disconnected: electricityDisconnected,
        accessories_removed: accessoriesRemoved,
        customer_acknowledged: customerAcknowledged,
        requires_retrieval_task: needsRetrieval,
        retrieval_reason: needsRetrieval ? retrievalReason : null,
        technical_notes: technicalNotes.trim() || null,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? 'فشل حفظ نتيجة فك الجهاز');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="3xl"
      title={<span className="flex items-center gap-2"><Unplug className="h-5 w-5 text-slate-700" />تسجيل نتيجة فك الجهاز</span>}
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
            إلغاء
          </button>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            حفظ النتيجة
          </button>
        </>
      }
    >
        <div className="space-y-4 px-5 py-4">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-5">
            {DECISION_CARDS.map(({ value, title, desc, Icon, cls }) => {
              const selected = decision === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDecision(value)}
                  className={`min-h-[118px] rounded-lg border p-3 text-right transition ${
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

          <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-slate-500">سبب الفك</span>
              <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                {REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
              </select>
            </label>
            {needsRetrieval && (
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">سبب السحب اللاحق</span>
                <select value={retrievalReason} onChange={(e) => setRetrievalReason(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  {RETRIEVAL_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
                </select>
              </label>
            )}
          </div>

          <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4 md:grid-cols-2">
            <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <input type="checkbox" checked={deviceLeftOnSite} onChange={(e) => setDeviceLeftOnSite(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              الجهاز بقي في الموقع
            </label>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <input type="checkbox" checked={waterDisconnected} onChange={(e) => setWaterDisconnected(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              تم فصل الماء
            </label>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <input type="checkbox" checked={electricityDisconnected} onChange={(e) => setElectricityDisconnected(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              تم فصل الكهرباء
            </label>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <input type="checkbox" checked={accessoriesRemoved} onChange={(e) => setAccessoriesRemoved(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              تم فك الملحقات
            </label>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-700 md:col-span-2">
              <input type="checkbox" checked={customerAcknowledged} onChange={(e) => setCustomerAcknowledged(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              تم إبلاغ الزبون بنتيجة الفك
            </label>
          </div>

          {needsFollowUp && (
            <div className="grid gap-4 rounded-lg border border-amber-200 bg-amber-50/60 p-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">تاريخ المتابعة</span>
                <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">وقت المتابعة</span>
                <input type="time" value={expectedTime} onChange={(e) => setExpectedTime(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
              </label>
            </div>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-500">ملاحظات فنية</span>
            <textarea value={technicalNotes} onChange={(e) => setTechnicalNotes(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-500">ملاحظات الإغلاق</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
        </div>
    </Modal>
  );
}
