import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Gauge, Loader2, MonitorCheck, X, XCircle } from 'lucide-react';
import IconButton from '../../components/ui/IconButton';
import { api } from '../../lib/api';
import {
  TechnicalStateFields,
  buildTechnicalStatePayload,
  hasAnyTechnicalReading,
  type TechStateForm,
} from '../../components/devices/TechnicalStateFields';

type ActivationDecision = 'activated_successfully' | 'activation_failed' | 'device_issue';

function listLabel(item: any) {
  return item?.metadata?.label || item?.label || item?.value || `#${item?.id}`;
}

const DECISION_CARDS: Array<{ value: ActivationDecision; title: string; desc: string; Icon: any; cls: string }> = [
  { value: 'activated_successfully', title: 'تم التشغيل', desc: 'الجهاز أصبح فعالاً وجاهزاً للخدمة', Icon: CheckCircle2, cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  { value: 'activation_failed', title: 'فشل التشغيل', desc: 'تبقى المهمة للمتابعة الفنية', Icon: Clock, cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  { value: 'device_issue', title: 'مشكلة بالجهاز', desc: 'يحتاج الجهاز معالجة قبل التشغيل', Icon: XCircle, cls: 'border-rose-200 bg-rose-50 text-rose-700' },
];

export default function DeviceActivationResultModal({
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
  const [decision, setDecision] = useState<ActivationDecision>('activated_successfully');
  const [techState, setTechState] = useState<TechStateForm>({});
  const [hasSterilization, setHasSterilization] = useState(true);
  const [customerTrained, setCustomerTrained] = useState(true);
  const [trainingNotes, setTrainingNotes] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [expectedTime, setExpectedTime] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [followupReasons, setFollowupReasons] = useState<any[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve the device's sterilization capability to gate that block.
  const deviceId = Number(task?.device_id ?? task?.deviceId);
  useEffect(() => {
    if (!Number.isInteger(deviceId) || deviceId <= 0) return;
    api.installedDevices.get(deviceId)
      .then((d: any) => setHasSterilization(d?.hasSterilization !== false))
      .catch(() => { /* default: show the block */ });
  }, [deviceId]);

  // Admin-managed follow-up reasons (migration 325). The selected item's
  // `value` is sent as `reason_code` — same text contract as before.
  useEffect(() => {
    api.systemLists.getItemsByCode('device_activation_followup_reasons')
      .then((rows: any[]) => setFollowupReasons(Array.isArray(rows) ? rows.filter((r) => r.isActive !== false) : []))
      .catch(() => setFollowupReasons([]));
  }, []);

  const needsFollowUp = decision !== 'activated_successfully';

  async function submit() {
    setError(null);
    if (decision === 'activated_successfully' && !customerTrained) {
      setError('تأكيد تدريب الزبون مطلوب عند نجاح التشغيل');
      return;
    }
    if (needsFollowUp && !expectedDate) {
      setError('تاريخ المتابعة مطلوب عند فشل التشغيل أو وجود مشكلة بالجهاز');
      return;
    }

    setSaving(true);
    try {
      await api.fieldVisits.recordTaskResult(visitId, taskId, {
        final_decision: decision,
        closing_notes: notes.trim() || null,
        notes: notes.trim() || null,
        reason_code: needsFollowUp ? reasonCode.trim() || null : null,
        expected_date: needsFollowUp ? expectedDate : null,
        expected_time: needsFollowUp && expectedTime ? expectedTime : null,
        // Integrated technical health reading (constitution 01i) — baseline phase
        // is set server-side; null when the technician recorded no measurement.
        technical_state: hasAnyTechnicalReading(techState) ? buildTechnicalStatePayload(techState) : null,
        customer_trained: decision === 'activated_successfully' ? customerTrained : false,
        training_notes: trainingNotes.trim() || null,
        activation_photos: [],
      });
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? 'فشل حفظ نتيجة التشغيل');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" dir="rtl">
      <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <MonitorCheck className="h-5 w-5 text-sky-600" />
            <h2 className="text-lg font-bold text-slate-800">تسجيل نتيجة تشغيل الجهاز</h2>
          </div>
          <IconButton icon={X} label="إغلاق" onClick={onClose} />
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
                  className={`min-h-[108px] rounded-lg border p-3 text-right transition ${
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

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-800">
              <Gauge className="h-4 w-4 text-sky-600" />
              الحالة الفنية للجهاز
              <span className="text-xs font-bold rounded-full border border-slate-200 bg-slate-50 text-slate-500 px-2 py-0.5">قراءة مرجعية</span>
            </div>
            <TechnicalStateFields value={techState} onChange={setTechState} hasSterilization={hasSterilization} />
          </div>

          {decision === 'activated_successfully' && (
            <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
              <label className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                <input type="checkbox" checked={customerTrained} onChange={(e) => setCustomerTrained(e.target.checked)} className="h-4 w-4 rounded border-emerald-300" />
                تم تدريب الزبون على استخدام الجهاز
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-bold text-slate-500">ملاحظات التدريب</span>
                <textarea value={trainingNotes} onChange={(e) => setTrainingNotes(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
              </label>
            </div>
          )}

          {needsFollowUp && (
            <div className="grid gap-4 rounded-lg border border-amber-200 bg-amber-50/60 p-4 md:grid-cols-3">
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">تاريخ المتابعة</span>
                <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">وقت المتابعة</span>
                <input type="time" value={expectedTime} onChange={(e) => setExpectedTime(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">سبب مختصر</span>
                <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  <option value="">— اختر سبباً —</option>
                  {followupReasons.map((reason) => <option key={reason.id} value={reason.value}>{listLabel(reason)}</option>)}
                </select>
              </label>
            </div>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-500">ملاحظات</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
            إلغاء
          </button>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            حفظ النتيجة
          </button>
        </div>
      </div>
    </div>
  );
}
