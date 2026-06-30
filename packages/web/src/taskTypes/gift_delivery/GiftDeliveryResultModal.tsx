import { useEffect, useState } from 'react';
import { CalendarClock, CircleCheck, CircleX, Gift, Loader2, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { TaskResultModalProps } from '../../components/tasks/types';
import DateField from '../../components/ui/DateField';

type Mode = 'delivered_successfully' | 'refused_gift' | 'rescheduled';

export default function GiftDeliveryResultModal({ visitId, taskId, task, onClose, onSaved }: TaskResultModalProps) {
  const [mode, setMode] = useState<Mode>('delivered_successfully');
  const [acknowledged, setAcknowledged] = useState(false);
  const [refusalReasons, setRefusalReasons] = useState<any[]>([]);
  const [rescheduleReasons, setRescheduleReasons] = useState<any[]>([]);
  const [reasonId, setReasonId] = useState('');
  const [rescheduledDate, setRescheduledDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.systemLists.getItemsByCode('gift_delivery_refusal_reasons')
      .then((r: any) => setRefusalReasons(Array.isArray(r) ? r : [])).catch(() => setRefusalReasons([]));
    api.systemLists.getItemsByCode('gift_delivery_reschedule_reasons')
      .then((r: any) => setRescheduleReasons(Array.isArray(r) ? r : [])).catch(() => setRescheduleReasons([]));
  }, []);

  useEffect(() => {
    setReasonId('');
    setError('');
  }, [mode]);

  const giftLabel = task?.giftName ?? task?.gift_name ?? task?.reason ?? 'الهدية المعتمدة';

  const chooser: Array<{ key: Mode; label: string; Icon: any; cls: string }> = [
    { key: 'delivered_successfully', label: 'تم التسليم', Icon: CircleCheck, cls: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
    { key: 'refused_gift', label: 'رفض الهدية', Icon: CircleX, cls: 'border-rose-300 bg-rose-50 text-rose-800' },
    { key: 'rescheduled', label: 'إعادة جدولة', Icon: CalendarClock, cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  ];

  async function submit() {
    setError('');
    const body: any = {
      final_decision: mode,
      closing_notes: notes.trim() || null,
      notes: notes.trim() || null,
    };

    if (mode === 'delivered_successfully') {
      if (!acknowledged) { setError('يجب إقرار الزبون باستلام كامل الكمية المعتمدة'); return; }
      body.customer_acknowledged = true;
    }

    if (mode === 'refused_gift') {
      if (!reasonId) { setError('سبب رفض الهدية مطلوب'); return; }
      body.refusal_reason_id = Number(reasonId);
    }

    if (mode === 'rescheduled') {
      if (!reasonId) { setError('سبب إعادة الجدولة مطلوب'); return; }
      if (!rescheduledDate) { setError('تاريخ المتابعة مطلوب'); return; }
      body.reschedule_reason_id = Number(reasonId);
      body.rescheduled_date = rescheduledDate;
    }

    setSaving(true);
    try {
      await api.fieldVisits.recordTaskResult(visitId, taskId, body);
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? 'فشل تسجيل نتيجة تسليم الهدية');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" dir="rtl">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-rose-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-rose-200 bg-rose-50 px-5 py-4">
          <div className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-rose-600" />
            <h2 className="text-base font-black text-rose-900">نتيجة تسليم الهدية</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

          <div className="rounded-lg border border-rose-100 bg-rose-50/50 px-3 py-2 text-xs text-rose-800">
            {giftLabel} — لا يوجد تسليم جزئي؛ النجاح يعني تسليم كامل الكمية المعتمدة.
          </div>

          <div className="grid grid-cols-3 gap-2">
            {chooser.map(({ key, label, Icon, cls }) => (
              <button key={key} type="button" onClick={() => setMode(key)}
                className={`rounded-lg border-2 p-3 text-center transition ${mode === key ? cls : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                <Icon className="mx-auto mb-1 h-5 w-5" />
                <div className="text-sm font-bold">{label}</div>
              </button>
            ))}
          </div>

          {mode === 'delivered_successfully' && (
            <label className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5 h-4 w-4" />
              <span>أقر بأن كامل الكمية المعتمدة من الهدية قد تم تسليمها للمستفيد.</span>
            </label>
          )}

          {(mode === 'refused_gift' || mode === 'rescheduled') && (
            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-slate-500">
                {mode === 'refused_gift' ? 'سبب رفض الهدية *' : 'سبب إعادة الجدولة *'}
              </span>
              <select value={reasonId} onChange={(e) => setReasonId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="">— اختر —</option>
                {(mode === 'refused_gift' ? refusalReasons : rescheduleReasons).map((r: any) => (
                  <option key={r.id} value={r.id}>{r.label || r.value}</option>
                ))}
              </select>
            </label>
          )}

          {mode === 'rescheduled' && (
            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-slate-500">تاريخ المتابعة *</span>
              <DateField value={rescheduledDate} onChange={setRescheduledDate}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </label>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-500">ملاحظات</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">إلغاء</button>
          <button onClick={submit} disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            تسجيل النتيجة
          </button>
        </div>
      </div>
    </div>
  );
}
