// ============================================================
// EmergencyResultModal — 3-outcome chooser then dispatch
// ============================================================
// Mirrors device_demo lifecycle philosophy:
//   1. تطبيق الصيانة   → existing 4-phase wizard
//   2. إعادة الجَدولة → mini form (reason + expected_date + notes)
//                       → POST /visits/:vid/tasks/:tid/result
//                       → open_task = needs_follow_up + expected_date
//   3. إلغاء          → mini form (reason + notes)
//                       → same endpoint, open_task = cancelled
// ============================================================
import { useState, useEffect } from 'react';
import { X, Wrench, CalendarClock, XCircle, ChevronLeft, Loader2 } from 'lucide-react';
import IconButton from '../../components/ui/IconButton';
import Select from '../../components/ui/Select';
import { api } from '../../lib/api';
import EmergencyResultWizard from '../../components/emergency/EmergencyResultWizard';

type Mode = 'choose' | 'apply' | 'reschedule' | 'cancel';

interface Props {
  taskId: number;
  /** visit_task_id — needed for reschedule/cancel POST. */
  visitTaskId?: number | null;
  /** field_visit_id — for the POST URL. */
  visitId?: number | null;
  contractId?: number | null;
  readOnly?: boolean;
  visitTechnicianEmployeeId?: number | null;
  visitTechnicianName?: string | null;
  onClose: () => void;
  onSaved?: () => void;
}

interface ReasonItem { id: number; value: string }

export default function EmergencyResultModal({
  taskId,
  visitTaskId,
  visitId,
  contractId = null,
  readOnly = false,
  visitTechnicianEmployeeId = null,
  visitTechnicianName = null,
  onClose,
  onSaved,
}: Props) {
  const [mode, setMode] = useState<Mode>('choose');
  const close = () => { onSaved?.(); onClose(); };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80]" dir="rtl">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl mx-4 max-h-[94vh] overflow-hidden flex flex-col">
        <header className="flex items-center justify-between p-4 border-b border-slate-200 bg-white sticky top-0 z-10">
          <div className="flex items-center gap-2">
            {mode !== 'choose' && mode !== 'apply' && (
              <button
                onClick={() => setMode('choose')}
                className="text-slate-500 hover:text-slate-700 inline-flex items-center gap-1 text-sm"
              >
                <ChevronLeft className="h-4 w-4" /> رجوع
              </button>
            )}
            <h2 className="text-lg font-semibold text-slate-800">
              {mode === 'choose'     && `نتيجة الصيانة الطارئة — مهمة #${taskId}`}
              {mode === 'apply'      && `تطبيق الصيانة — مهمة #${taskId}`}
              {mode === 'reschedule' && `إعادة جَدولة المهمة #${taskId}`}
              {mode === 'cancel'     && `إلغاء المهمة #${taskId}`}
            </h2>
          </div>
          <IconButton icon={X} label="إغلاق" onClick={close} />
        </header>

        <div className="overflow-auto p-4">
          {mode === 'choose' && <ChooserScreen onPick={setMode} />}

          {mode === 'apply' && (
            <EmergencyResultWizard
              taskId={taskId}
              contractId={contractId}
              readOnly={readOnly}
              visitTechnicianEmployeeId={visitTechnicianEmployeeId}
              visitTechnicianName={visitTechnicianName}
              onCostsSaved={close}
            />
          )}

          {mode === 'reschedule' && (
            <LifecycleForm
              kind="reschedule"
              visitId={visitId ?? null}
              visitTaskId={visitTaskId ?? null}
              onDone={close}
              onCancel={() => setMode('choose')}
            />
          )}

          {mode === 'cancel' && (
            <LifecycleForm
              kind="cancel"
              visitId={visitId ?? null}
              visitTaskId={visitTaskId ?? null}
              onDone={close}
              onCancel={() => setMode('choose')}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Chooser screen ────────────────────────────────────────────────
function ChooserScreen({ onPick }: { onPick: (m: Mode) => void }) {
  const options = [
    {
      key: 'apply' as const,
      title: 'تَطبيق الصيانة',
      desc: 'الفني نَفَّذ العَمل ميدانياً — تَسجيل الحالة قَبل/بعد، الأعطال، القطع، التَكاليف.',
      icon: Wrench,
      iconBg: 'bg-emerald-100',
      iconText: 'text-emerald-700',
      border: 'border-emerald-200 hover:bg-emerald-50',
    },
    {
      key: 'reschedule' as const,
      title: 'إعادة جَدولة',
      desc: 'تَعَذَّر التَنفيذ ميدانياً — تَعود المهمة لمَرحلة الانتظار بحالة "بحاجة متابعة" مع تاريخ مُتوقَّع.',
      icon: CalendarClock,
      iconBg: 'bg-amber-100',
      iconText: 'text-amber-700',
      border: 'border-amber-200 hover:bg-amber-50',
    },
    {
      key: 'cancel' as const,
      title: 'إلغاء',
      desc: 'المهمة لم تَعُد ذات قيمة — تُغلق المهمة بحالة "ملغاة" مع توضيح السبب.',
      icon: XCircle,
      iconBg: 'bg-rose-100',
      iconText: 'text-rose-700',
      border: 'border-rose-200 hover:bg-rose-50',
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        ما الذي حَصل ميدانياً؟ اختر مَسار النتيجة:
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {options.map((o) => (
          <button
            key={o.key}
            onClick={() => onPick(o.key)}
            className={`text-right p-4 rounded-2xl border-2 ${o.border} transition-colors flex flex-col items-start gap-3`}
          >
            <div className={`w-10 h-10 rounded-xl ${o.iconBg} flex items-center justify-center`}>
              <o.icon className={`w-5 h-5 ${o.iconText}`} />
            </div>
            <div className="text-base font-bold text-slate-800">{o.title}</div>
            <div className="text-xs text-slate-500 leading-relaxed">{o.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Reschedule / Cancel lifecycle form ────────────────────────────
function LifecycleForm({
  kind,
  visitId,
  visitTaskId,
  onDone,
  onCancel,
}: {
  kind: 'reschedule' | 'cancel';
  visitId: number | null;
  visitTaskId: number | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [reasons, setReasons] = useState<ReasonItem[]>([]);
  const [reasonId, setReasonId] = useState<string>('');
  const [expectedDate, setExpectedDate] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listCode = kind === 'reschedule' ? 'customer_followup_reasons' : 'visit_cancellation_reasons';

  useEffect(() => {
    setLoading(true);
    api.systemLists.getItemsByCode(listCode)
      .then((rows: any) => setReasons(Array.isArray(rows) ? rows : []))
      .catch(() => setReasons([]))
      .finally(() => setLoading(false));
  }, [listCode]);

  const submit = async () => {
    setError(null);
    if (!visitId || !visitTaskId) {
      setError('ربط الزيارة غير مَتوفِّر — لا يُمكن إرسال النتيجة');
      return;
    }
    if (!reasonId) { setError('اختر السَبب'); return; }
    if (kind === 'reschedule' && !expectedDate) { setError('التاريخ المُتوقَّع مطلوب'); return; }

    setSaving(true);
    try {
      const body: any = {
        final_decision: kind === 'reschedule' ? 'rescheduled' : 'cancelled',
        reason_code_id: Number(reasonId),
        closing_notes: notes.trim() || null,
      };
      if (kind === 'reschedule') body.expected_date = expectedDate;

      await api.fieldVisits.recordTaskResult(visitId, visitTaskId, body);
      onDone();
    } catch (e: any) {
      setError(e?.message ?? 'فَشل تَسجيل النتيجة');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-rose-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">{error}</div>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-bold text-slate-700">
          {kind === 'reschedule' ? 'سَبب إعادة الجَدولة' : 'سَبب الإلغاء'}
          <span className="text-rose-500"> *</span>
        </label>
        <Select
          value={reasonId}
          onChange={v => setReasonId(v)}
          placeholder="— اختر —"
          ariaLabel={kind === 'reschedule' ? 'سَبب إعادة الجَدولة' : 'سَبب الإلغاء'}
          className="w-full"
          options={reasons.map((r) => ({ value: String(r.id), label: r.value }))}
        />
      </div>

      {kind === 'reschedule' && (
        <div className="space-y-1.5">
          <label className="text-sm font-bold text-slate-700">
            التاريخ المُتوقَّع للزيارة القادمة
            <span className="text-rose-500"> *</span>
          </label>
          <input
            type="date"
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
            min={new Date().toISOString().split('T')[0]}
            className="w-full text-sm border border-slate-300 rounded-lg p-2.5 bg-white"
          />
          <p className="text-xs text-slate-500">
            المهمة سَتَعود إلى pool "بانتظار جَدولة" بحالة "بحاجة متابعة" مع هذا التاريخ كَإشارة لمَسؤول الجَدولة.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-bold text-slate-700">ملاحظات (اختياري)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="تَفاصيل إضافية..."
          className="w-full text-sm border border-slate-300 rounded-lg p-2.5 bg-white resize-none"
        />
      </div>

      <div className="flex gap-2 justify-end pt-2 border-t border-slate-200">
        <button
          onClick={onCancel}
          className="text-sm bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg font-bold"
        >
          رجوع
        </button>
        <button
          disabled={saving}
          onClick={submit}
          className={`text-sm text-white px-4 py-2 rounded-lg font-bold disabled:opacity-50 ${
            kind === 'reschedule' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-rose-600 hover:bg-rose-700'
          }`}
        >
          {saving ? 'جاري الحفظ...' : (kind === 'reschedule' ? 'تأكيد إعادة الجَدولة' : 'تأكيد الإلغاء')}
        </button>
      </div>
    </div>
  );
}
