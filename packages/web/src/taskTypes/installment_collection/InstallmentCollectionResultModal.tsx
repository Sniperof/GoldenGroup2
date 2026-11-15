import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CircleCheck, CircleX, CreditCard, Loader2, Wallet } from '../../components/ui/icons';
import { api } from '../../lib/api';
import Modal from '../../components/ui/Modal';
import DateField from '../../components/ui/DateField';
import type { TaskResultModalProps } from '../../components/tasks/types';
import PaymentEntriesList, { newEntry, type PaymentEntry } from '../../components/emergency/PaymentEntriesList';

type Mode = 'paid_full' | 'paid_partial' | 'rescheduled' | 'refused_to_pay';

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// القسط المربوط بالدولار (migr 493): المستحق اليوم يحسبه الخادم.
interface UsdDue {
  amountUsd: number;
  remainingUsd: number;
  contractRate: number;
  dayRate: number | null;
  rawDueSyp: number | null;
  dueTodaySyp: number | null;
  roundingUnit: number;
  differenceSyp: number | null;
  remainingBalanceSyp: number;
}

// قيمة جزء الدفع بالليرة (مطابقة للباك-إند): مقايضة = القيمة، دولار = القيمة × الصرف.
// للقسط المربوط بالدولار يُعتمد سعر اليوم المركزي لا السعر المكتوب.
function partSyp(e: PaymentEntry, fixedUsdRate?: number | null): number {
  const v = Number(e.amountValue) || 0;
  if (e.method === 'barter') return v;
  if (e.currency !== 'usd') return v;
  return v * (fixedUsdRate && fixedUsdRate > 0 ? fixedUsdRate : (Number(e.exchangeRate) || 0));
}

// لا يُقبل الجزء إلا مكتملاً.
function partComplete(e: PaymentEntry, fixedUsdRate?: number | null): boolean {
  if (!e.method) return false;
  if (!(Number(e.amountValue) > 0)) return false;
  if (e.method === 'transfer' && !e.paymentInstrument) return false;
  if (e.method !== 'barter' && e.currency === 'usd' && !fixedUsdRate && !(Number(e.exchangeRate) > 0)) return false;
  if (e.method === 'barter' && !e.barterDescription.trim()) return false;
  return true;
}

function money(n: number): string {
  return n.toLocaleString('ar-SY');
}

export default function InstallmentCollectionResultModal({ visitId, taskId, task, onClose, onSaved }: TaskResultModalProps) {
  const [mode, setMode] = useState<Mode>('paid_full');
  const [entries, setEntries] = useState<PaymentEntry[]>([newEntry()]);
  const [partialReasons, setPartialReasons] = useState<any[]>([]);
  const [rescheduleReasons, setRescheduleReasons] = useState<any[]>([]);
  const [refusalReasons, setRefusalReasons] = useState<any[]>([]);
  const [reasonId, setReasonId] = useState('');
  const [nextExpectedDate, setNextExpectedDate] = useState('');
  const [nextPriority, setNextPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // D5: the due and the USD rate are those of the visit's collection day (its
  // execution date), read from the server — refreshed right before submit.
  const [serverDue, setServerDue] = useState<{ rate: number | null; usdDue: UsdDue | null; collectionDay: string } | null>(null);
  useEffect(() => {
    if (!visitId || !taskId) return;
    api.fieldVisits.taskUsdDue(visitId, taskId).then(setServerDue).catch(() => setServerDue(null));
  }, [visitId, taskId]);
  const usdDue: UsdDue | null = serverDue ? serverDue.usdDue : (task?.usdDue ?? null);
  const usdLinked = usdDue != null;
  const usdRateMissing = usdLinked && !(usdDue!.dayRate && usdDue!.dayRate > 0);
  // USD cash is priced at the central rate of the collection day (golden-warranty
  // receivables keep the typed rate — out of scope).
  const centralRate = serverDue?.rate ?? null;
  const isWarranty = (task?.receivableSourceType ?? task?.receivable_source_type) === 'golden_warranty';
  const fixedUsdRate = usdLinked ? usdDue!.dayRate : (isWarranty ? null : centralRate);
  const usdLocked = !isWarranty;

  // المطلوب = الذمة (الرصيد المتبقي على القسط). للقسط المربوط بالدولار:
  // المتبقي بالدولار × سعر اليوم مقرّباً — لا القيمة المجمّدة على المهمة.
  const expectedAmount = useMemo(() => {
    if (usdDue) return usdDue.dueTodaySyp;
    return num(
      task?.expectedAmountSyp
      ?? task?.expected_amount_syp
      ?? task?.expectedAmount
      ?? task?.remainingBalance
      ?? task?.remaining_balance,
    );
  }, [task, usdDue]);

  const isPayment = mode === 'paid_full' || mode === 'paid_partial';
  const totalPaid = useMemo(() => entries.reduce((s, e) => s + partSyp(e, fixedUsdRate), 0), [entries, fixedUsdRate]);
  const due = expectedAmount ?? 0;
  const surplus = Math.max(totalPaid - due, 0);   // الباقي للزبون (الدفع الكامل)
  const shortfall = Math.max(due - totalPaid, 0); // المتبقي على الذمة (الدفع الجزئي)
  // الدفع الكامل بالدولار وحده يُقبل بين القيمة الدقيقة والقيمة المقرّبة.
  const fullLower = usdDue && usdDue.rawDueSyp != null && usdDue.dueTodaySyp != null
    ? Math.min(usdDue.rawDueSyp, usdDue.dueTodaySyp) : expectedAmount;
  const fullUpper = usdDue && usdDue.rawDueSyp != null && usdDue.dueTodaySyp != null
    ? Math.max(usdDue.rawDueSyp, usdDue.dueTodaySyp) : null;
  // D8: a partial payment leaving less than half a rounding unit closes the installment.
  const dustCloses = !!(usdDue && usdDue.dayRate && usdDue.roundingUnit > 0 && usdDue.rawDueSyp != null
    && mode === 'paid_partial' && totalPaid > 0 && totalPaid < (fullLower ?? 0)
    && (usdDue.rawDueSyp - totalPaid) < usdDue.roundingUnit / 2);

  useEffect(() => {
    api.systemLists.getItemsByCode('collection_partial_payment_reasons').then((r: any) => setPartialReasons(Array.isArray(r) ? r : [])).catch(() => setPartialReasons([]));
    api.systemLists.getItemsByCode('collection_reschedule_reasons').then((r: any) => setRescheduleReasons(Array.isArray(r) ? r : [])).catch(() => setRescheduleReasons([]));
    api.systemLists.getItemsByCode('collection_refusal_reasons').then((r: any) => setRefusalReasons(Array.isArray(r) ? r : [])).catch(() => setRefusalReasons([]));
  }, []);

  useEffect(() => { setReasonId(''); }, [mode]);

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
    const body: any = {
      final_decision: mode,
      closing_notes: notes.trim() || null,
    };

    if (isPayment && usdLinked) {
      // D5: re-read the due right before submitting; a changed due is shown, not rejected.
      try {
        const fresh = await api.fieldVisits.taskUsdDue(visitId, taskId);
        const before = usdDue?.dueTodaySyp ?? null;
        setServerDue(fresh);
        if (fresh.usdDue && before != null && fresh.usdDue.dueTodaySyp !== before) {
          setError(`تغيّر المستحق إلى ${money(Number(fresh.usdDue.dueTodaySyp))} ل.س (سعر صرف يوم الزيارة) — راجع المبلغ ثم أعد التسجيل.`);
          return;
        }
      } catch { /* the server re-validates anyway */ }
    }

    if (isPayment) {
      if (usdRateMissing) {
        setError('لا يوجد سعر صرف معتمد اليوم — لا يمكن تحصيل قسط مربوط بالدولار');
        return;
      }
      if (usdLocked && !fixedUsdRate && entries.some(e => e.method !== 'barter' && e.currency === 'usd')) {
        setError('لا يوجد سعر صرف مركزي معتمد اليوم — لا يمكن قبول دفعة بالدولار');
        return;
      }
      if (entries.length === 0 || !entries.every(e => partComplete(e, fixedUsdRate))) {
        setError('أكمل بيانات كل جزء دفع قبل القبول');
        return;
      }
      if (totalPaid <= 0) { setError('قيمة الدفعة مطلوبة'); return; }
      if (mode === 'paid_full' && fullLower != null && totalPaid + 0.5 < fullLower) {
        setError('الدفع الكامل يجب أن يغطي كامل المطلوب');
        return;
      }
      if (usdLinked && mode === 'paid_full' && fullUpper != null && totalPaid - 0.5 > fullUpper) {
        setError('المبلغ أكبر من المستحق اليوم — يُعاد الفرق للزبون ولا يُسجَّل');
        return;
      }
      if (mode === 'paid_partial' && fullLower != null && totalPaid + (usdLinked ? 0.5 : 0) >= fullLower) {
        setError('الدفع الجزئي يجب أن يكون أقل من المطلوب');
        return;
      }
      body.payment_parts = entries.map(e => ({
        paymentCategory: e.method,
        method: e.paymentInstrument,
        amountValue: Number(e.amountValue),
        currency: e.currency,
        // القسط المربوط بالدولار: الخادم يعتمد سعر اليوم ويتجاهل أي سعر مُرسَل.
        exchangeRate: usdLocked ? null : (e.exchangeRate ? Number(e.exchangeRate) : null),
        referenceNumber: e.referenceNumber.trim() || null,
        barterDescription: e.barterDescription || null,
      }));
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
    <Modal
      isOpen
      onClose={onClose}
      size="2xl"
      title={<span className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-emerald-600" />نتيجة تسديد الذمة</span>}
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">إلغاء</button>
          <button onClick={submit} disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            تسجيل النتيجة
          </button>
        </>
      }
    >
        <div className="space-y-4 px-5 py-4">
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

          {/* الذمة واضحة */}
          <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-bold text-emerald-700">{usdLinked ? 'المستحق اليوم (مربوط بالدولار)' : 'المطلوب (رصيد الذمة)'}</span>
            <span className="text-lg font-black text-emerald-900">{expectedAmount != null ? money(expectedAmount) : '—'} ل.س</span>
          </div>

          {usdDue && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm space-y-1">
              {usdRateMissing && (
                <div className="font-bold text-rose-700">لا يوجد سعر صرف معتمد اليوم — لا يمكن تسجيل دفعة حتى تُدخل الإدارة السعر.</div>
              )}
              <div className="flex justify-between"><span className="text-blue-700 font-bold">المتبقي بالدولار</span><span className="font-black text-blue-900" dir="ltr">${usdDue.remainingUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between"><span className="text-blue-700 font-bold">سعر صرف اليوم</span><span className="font-black text-blue-900">{usdDue.dayRate ? money(usdDue.dayRate) : '—'} ل.س</span></div>
              <div className="flex justify-between"><span className="text-blue-700 font-bold">سعر العقد</span><span className="font-black text-blue-900">{money(usdDue.contractRate)} ل.س</span></div>
              <div className="flex justify-between"><span className="text-blue-700 font-bold">المتبقي بالليرة الأصلية</span><span className="font-black text-blue-900">{money(usdDue.remainingBalanceSyp)} ل.س</span></div>
              {usdDue.differenceSyp != null && (
                <div className="flex justify-between border-t border-blue-200 pt-1">
                  <span className="text-blue-700 font-bold">الفرق عن القيمة الأصلية</span>
                  <span className="font-black text-blue-900" dir="ltr">{usdDue.differenceSyp > 0 ? '+' : ''}{money(usdDue.differenceSyp)} ل.س</span>
                </div>
              )}
              <div className="text-xs text-blue-600">المقرّب لأقرب {money(usdDue.roundingUnit)} ل.س. الدفع بالدولار يُخصم بقيمته الاسمية بسعر اليوم.</div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {chooser.map(({ key, label, Icon, cls }) => (
              <button key={key} type="button" onClick={() => setMode(key)}
                className={`rounded-lg border-2 p-3 text-center transition ${mode === key ? cls : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                <Icon className="mx-auto mb-1 h-5 w-5" />
                <div className="text-sm font-bold">{label}</div>
              </button>
            ))}
          </div>

          {isPayment && (
            <div className="space-y-3">
              <PaymentEntriesList
                entries={entries}
                onChange={setEntries}
                grandTotal={expectedAmount ?? undefined}
                capturePaymentInstrument
                fixedUsdRate={fixedUsdRate}
                requireCentralRate={usdLocked}
                label="دفعات الزبون (يد / حوالة / مقايضة — ل.س أو $)"
              />

              {/* الباقي في الكامل، المتبقي في الجزئي */}
              {mode === 'paid_full' && surplus > 0 && (
                <div className="rounded-xl border-2 border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between">
                  <span className="text-sm font-bold text-amber-700">الباقي للزبون (فائض)</span>
                  <span className="text-lg font-black text-amber-800">{money(surplus)} ل.س</span>
                </div>
              )}
              {dustCloses && (
                <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
                  المتبقي بعد هذه الدفعة أقل من نصف وحدة التقريب — سيُغلق القسط بالكامل ويُسجَّل الفرق في حساب فروقات سعر الصرف.
                </div>
              )}
              {mode === 'paid_partial' && !dustCloses && (
                <div className="rounded-xl border-2 border-sky-200 bg-sky-50 px-4 py-3 flex items-center justify-between">
                  <span className="text-sm font-bold text-sky-700">المتبقي على الذمة (مهمة تسديد جديدة)</span>
                  <span className="text-lg font-black text-sky-800">{money(shortfall)} ل.س</span>
                </div>
              )}
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
                <DateField value={nextExpectedDate} onChange={setNextExpectedDate}
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
    </Modal>
  );
}
