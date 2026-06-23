import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CircleCheck, CircleX, CreditCard, Loader2, Wallet, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { TaskResultModalProps } from '../../components/tasks/types';

type Mode = 'paid_full' | 'paid_partial' | 'rescheduled' | 'refused_to_pay';

const PAYMENT_METHODS = [
  ['cash', 'نقداً'],
  ['sham_cash', 'شام كاش'],
  ['syriatel_cash', 'سيريتل كاش'],
  ['mtn_cash', 'MTN كاش'],
  ['alharam', 'الهرم'],
  ['bank_transfer', 'حوالة بنكية'],
] as const;

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default function InstallmentCollectionResultModal({ visitId, taskId, task, onClose, onSaved }: TaskResultModalProps) {
  const [mode, setMode] = useState<Mode>('paid_full');
  const [paidAmount, setPaidAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [partialReasons, setPartialReasons] = useState<any[]>([]);
  const [rescheduleReasons, setRescheduleReasons] = useState<any[]>([]);
  const [refusalReasons, setRefusalReasons] = useState<any[]>([]);
  const [reasonId, setReasonId] = useState('');
  const [nextExpectedDate, setNextExpectedDate] = useState('');
  const [nextPriority, setNextPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const expectedAmount = useMemo(() => {
    return num(task?.expectedAmountSyp ?? task?.expected_amount_syp ?? task?.remainingBalance ?? task?.remaining_balance);
  }, [task]);

  useEffect(() => {
    api.systemLists.getItemsByCode('collection_partial_payment_reasons').then((r: any) => setPartialReasons(Array.isArray(r) ? r : [])).catch(() => setPartialReasons([]));
    api.systemLists.getItemsByCode('collection_reschedule_reasons').then((r: any) => setRescheduleReasons(Array.isArray(r) ? r : [])).catch(() => setRescheduleReasons([]));
    api.systemLists.getItemsByCode('collection_refusal_reasons').then((r: any) => setRefusalReasons(Array.isArray(r) ? r : [])).catch(() => setRefusalReasons([]));
  }, []);

  useEffect(() => {
    setReasonId('');
    if ((mode === 'paid_full' || mode === 'paid_partial') && expectedAmount && !paidAmount) {
      setPaidAmount(String(expectedAmount));
    }
  }, [mode, expectedAmount]);

  const chooser: Array<{ key: Mode; label: string; Icon: any; cls: string }> = [
    { key: 'paid_full', label: 'دفع كامل', Icon: CircleCheck, cls: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
    { key: 'paid_partial', label: 'دفع جزئي', Icon: Wallet, cls: 'border-sky-300 bg-sky-50 text-sky-800' },
    { key: 'rescheduled', label: 'إعادة جدولة', Icon: CalendarClock, cls: 'border-amber-300 bg-amber-50 text-amber-800' },
    { key: 'refused_to_pay', label: 'رفض الدفع', Icon: CircleX, cls: 'border-rose-300 bg-rose-50 text-rose-800' },
  ];

  const activeReasons =
    mode === 'paid_partial' ? partialReasons
    : mode === 'rescheduled' ? rescheduleReasons
    : mode === 'refused_to_pay' ? refusalReasons
    : [];

  async function submit() {
    setError('');
    const amount = Number(paidAmount);
    const body: any = {
      final_decision: mode,
      closing_notes: notes.trim() || null,
    };

    if (mode === 'paid_full' || mode === 'paid_partial') {
      if (!Number.isFinite(amount) || amount <= 0) {
        setError('قيمة الدفعة مطلوبة');
        return;
      }
      if (!paymentMethod) {
        setError('طريقة الدفع مطلوبة');
        return;
      }
      body.paid_amount_syp = amount;
      body.payment_method = paymentMethod;
      body.payment_reference = paymentReference.trim() || null;
    }

    if (mode === 'paid_partial') {
      if (!reasonId) { setError('سبب الدفعة الجزئية مطلوب'); return; }
      if (!nextExpectedDate) { setError('تاريخ المتابعة مطلوب'); return; }
      body.partial_payment_reason_id = Number(reasonId);
      body.next_expected_date = nextExpectedDate;
      body.next_priority = nextPriority;
    }

    if (mode === 'rescheduled') {
      if (!reasonId) { setError('سبب إعادة الجدولة مطلوب'); return; }
      if (!nextExpectedDate) { setError('تاريخ المتابعة مطلوب'); return; }
      body.reschedule_reason_id = Number(reasonId);
      body.next_expected_date = nextExpectedDate;
      body.next_priority = nextPriority;
    }

    if (mode === 'refused_to_pay') {
      if (!reasonId) { setError('سبب رفض الدفع مطلوب'); return; }
      body.refusal_reason_id = Number(reasonId);
    }

    setSaving(true);
    try {
      await api.fieldVisits.recordTaskResult(visitId, taskId, body);
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? 'فشل تسجيل نتيجة تسديد الذمة');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" dir="rtl">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-emerald-200 bg-emerald-50 px-5 py-4">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-600" />
            <h2 className="text-base font-black text-emerald-900">نتيجة تسديد الذمة</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

          <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2 text-xs text-emerald-800">
            المبلغ المتوقع: {expectedAmount != null ? expectedAmount.toLocaleString('ar-SY') : '—'} ل.س
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {chooser.map(({ key, label, Icon, cls }) => (
              <button key={key} type="button" onClick={() => setMode(key)}
                className={`rounded-lg border-2 p-3 text-center transition ${mode === key ? cls : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                <Icon className="mx-auto mb-1 h-5 w-5" />
                <div className="text-sm font-bold">{label}</div>
              </button>
            ))}
          </div>

          {(mode === 'paid_full' || mode === 'paid_partial') && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">قيمة الدفعة *</span>
                <input type="number" min="0" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">طريقة الدفع *</span>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  {PAYMENT_METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-xs font-bold text-slate-500">رقم المرجع</span>
                <input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </label>
            </div>
          )}

          {(mode === 'paid_partial' || mode === 'rescheduled' || mode === 'refused_to_pay') && (
            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-slate-500">
                {mode === 'paid_partial' ? 'سبب الدفعة الجزئية *' : mode === 'rescheduled' ? 'سبب إعادة الجدولة *' : 'سبب رفض الدفع *'}
              </span>
              <select value={reasonId} onChange={(e) => setReasonId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="">— اختر —</option>
                {activeReasons.map((r: any) => <option key={r.id} value={r.id}>{r.label || r.value}</option>)}
              </select>
            </label>
          )}

          {(mode === 'paid_partial' || mode === 'rescheduled') && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">تاريخ المتابعة *</span>
                <input type="date" value={nextExpectedDate} onChange={(e) => setNextExpectedDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">أولوية المهمة الجديدة *</span>
                <select value={nextPriority} onChange={(e) => setNextPriority(e.target.value as any)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  <option value="high">عالية</option>
                  <option value="medium">متوسطة</option>
                  <option value="low">منخفضة</option>
                </select>
              </label>
            </div>
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
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            تسجيل النتيجة
          </button>
        </div>
      </div>
    </div>
  );
}
