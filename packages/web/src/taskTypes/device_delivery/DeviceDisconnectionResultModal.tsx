import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Loader2, Unplug, XCircle } from 'lucide-react';
import { api } from '../../lib/api';
import Modal from '../../components/ui/Modal';

type DisconnectionDecision = 'disconnected_successfully' | 'rescheduled' | 'disconnection_failed';

const DECISION_CARDS: Array<{
  value: DisconnectionDecision;
  title: string;
  desc: string;
  Icon: typeof CheckCircle2;
  cls: string;
}> = [
  {
    value: 'disconnected_successfully',
    title: 'تم الفك',
    desc: 'تم تنفيذ فك الجهاز في الموقع',
    Icon: CheckCircle2,
    cls: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  {
    value: 'rescheduled',
    title: 'إعادة الجدولة',
    desc: 'لم ينفذ الفك ويحتاج موعد متابعة',
    Icon: Clock,
    cls: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  {
    value: 'disconnection_failed',
    title: 'فشل الفك',
    desc: 'تعذر تنفيذ الفك وسيتم إغلاق المهمة',
    Icon: XCircle,
    cls: 'border-rose-200 bg-rose-50 text-rose-700',
  },
];

const FALLBACK_RETRIEVAL_REASONS = [
  { value: 'workshop_repair', label: 'صيانة في الورشة' },
  { value: 'replacement', label: 'تبديل جهاز' },
  { value: 'final_retrieval', label: 'استرجاع نهائي' },
  { value: 'other', label: 'أخرى' },
];

function listLabel(item: any) {
  return item?.metadata?.label || item?.label || item?.value || `#${item?.id}`;
}

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
  const [deviceLeftOnSite, setDeviceLeftOnSite] = useState(true);
  const [waterDisconnected, setWaterDisconnected] = useState(true);
  const [electricityDisconnected, setElectricityDisconnected] = useState(false);
  const [accessoriesRemoved, setAccessoriesRemoved] = useState(false);
  const [customerAcknowledged, setCustomerAcknowledged] = useState(true);
  const [requiresRetrieval, setRequiresRetrieval] = useState(false);
  const [retrievalReason, setRetrievalReason] = useState('workshop_repair');
  const [rescheduleReasonId, setRescheduleReasonId] = useState('');
  const [failureReasonId, setFailureReasonId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [expectedTime, setExpectedTime] = useState('');
  const [technicalNotes, setTechnicalNotes] = useState('');
  const [retrievalReasonOptions, setRetrievalReasonOptions] = useState<any[]>([]);
  const [rescheduleReasons, setRescheduleReasons] = useState<any[]>([]);
  const [failureReasons, setFailureReasons] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.systemLists.getItemsByCode('device_disconnection_retrieval_reasons')
      .then((rows: any[]) => setRetrievalReasonOptions(Array.isArray(rows) ? rows.filter((r) => r.isActive !== false) : []))
      .catch(() => setRetrievalReasonOptions([]));
    api.systemLists.getItemsByCode('device_disconnection_reschedule_reasons')
      .then((rows: any[]) => setRescheduleReasons(Array.isArray(rows) ? rows.filter((r) => r.isActive !== false) : []))
      .catch(() => setRescheduleReasons([]));
    api.systemLists.getItemsByCode('device_disconnection_failure_reasons')
      .then((rows: any[]) => setFailureReasons(Array.isArray(rows) ? rows.filter((r) => r.isActive !== false) : []))
      .catch(() => setFailureReasons([]));
  }, []);

  const isSuccess = decision === 'disconnected_successfully';
  const isRescheduled = decision === 'rescheduled';
  const isFailed = decision === 'disconnection_failed';
  const retrievalReasons = retrievalReasonOptions.length ? retrievalReasonOptions : FALLBACK_RETRIEVAL_REASONS;

  async function submit() {
    setError(null);

    if (isSuccess && !waterDisconnected && !electricityDisconnected && !accessoriesRemoved) {
      setError('وثق إجراء فني واحد على الأقل عند نجاح الفك');
      return;
    }
    if (isSuccess && requiresRetrieval && !retrievalReason) {
      setError('سبب السحب اللاحق مطلوب');
      return;
    }
    if (isRescheduled && !rescheduleReasonId) {
      setError('سبب إعادة الجدولة مطلوب');
      return;
    }
    if (isRescheduled && !expectedDate) {
      setError('تاريخ إعادة الجدولة مطلوب');
      return;
    }
    if (isFailed && !failureReasonId) {
      setError('سبب فشل الفك مطلوب');
      return;
    }

    setSaving(true);
    try {
      await api.fieldVisits.recordTaskResult(visitId, taskId, {
        final_decision: decision,
        reason_code: null,
        expected_date: isRescheduled ? expectedDate : null,
        expected_time: isRescheduled && expectedTime ? expectedTime : null,
        reschedule_reason_id: isRescheduled ? Number(rescheduleReasonId) : null,
        failure_reason_id: isFailed ? Number(failureReasonId) : null,
        device_left_on_site: deviceLeftOnSite,
        water_disconnected: isSuccess ? waterDisconnected : false,
        electricity_disconnected: isSuccess ? electricityDisconnected : false,
        accessories_removed: isSuccess ? accessoriesRemoved : false,
        customer_acknowledged: isSuccess ? customerAcknowledged : null,
        requires_retrieval_task: isSuccess ? requiresRetrieval : false,
        retrieval_reason: isSuccess && requiresRetrieval ? retrievalReason : null,
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

          {isSuccess && (
            <>
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
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                  <input type="checkbox" checked={customerAcknowledged} onChange={(e) => setCustomerAcknowledged(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                  تم إبلاغ الزبون بنتيجة الفك
                </label>
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                  <input type="checkbox" checked={requiresRetrieval} onChange={(e) => setRequiresRetrieval(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                  يحتاج سحب لاحق
                </label>
              </div>

              {requiresRetrieval && (
                <label className="block space-y-1.5 rounded-lg border border-sky-200 bg-sky-50/60 p-4">
                  <span className="text-xs font-bold text-slate-500">سبب السحب اللاحق</span>
                  <select value={retrievalReason} onChange={(e) => setRetrievalReason(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                    {retrievalReasons.map((reason) => <option key={reason.value ?? reason.id} value={reason.value}>{listLabel(reason)}</option>)}
                  </select>
                </label>
              )}
            </>
          )}

          {isRescheduled && (
            <div className="grid gap-4 rounded-lg border border-amber-200 bg-amber-50/60 p-4 md:grid-cols-2">
              <label className="space-y-1.5 md:col-span-2">
                <span className="text-xs font-bold text-slate-500">سبب إعادة الجدولة</span>
                <select value={rescheduleReasonId} onChange={(e) => setRescheduleReasonId(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  <option value="">اختر السبب</option>
                  {rescheduleReasons.map((reason) => <option key={reason.id} value={reason.id}>{listLabel(reason)}</option>)}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">تاريخ الموعد الجديد</span>
                <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">وقت الموعد الجديد</span>
                <input type="time" value={expectedTime} onChange={(e) => setExpectedTime(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
              </label>
            </div>
          )}

          {isFailed && (
            <label className="block space-y-1.5 rounded-lg border border-rose-200 bg-rose-50/60 p-4">
              <span className="text-xs font-bold text-slate-500">سبب فشل الفك</span>
              <select value={failureReasonId} onChange={(e) => setFailureReasonId(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="">اختر السبب</option>
                {failureReasons.map((reason) => <option key={reason.id} value={reason.id}>{listLabel(reason)}</option>)}
              </select>
            </label>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-500">ملاحظات فنية</span>
            <textarea value={technicalNotes} onChange={(e) => setTechnicalNotes(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>

        </div>
    </Modal>
  );
}
