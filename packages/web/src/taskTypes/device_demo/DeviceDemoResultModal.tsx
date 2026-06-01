import { useState, useEffect } from 'react';
import { X, ShoppingCart, CheckCircle2, RotateCcw, XCircle, Loader2, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';

// ============================================================
// DeviceDemoResultModal
// ============================================================
// First-iteration result-entry UI for device_demo tasks. Submits to
//   POST /field-visits/:visitId/tasks/:taskId/result
// per docs/constitution/features/tasks/device-demo.md (axis 9-13).
//
// Covers all 4 outcomes with minimal-but-complete forms:
//   1. offer_presented (multi-offer with per-offer customer_response)
//   2. device_sold
//   3. rescheduled
//   4. cancelled
//
// The full multi-step wizard pattern lives in MarketingVisitOutcomeModal —
// we intentionally keep this one focused on the new endpoint integration
// so it can be wired into the standard task detail tab quickly. The fancy
// wizard can be re-routed onto the same endpoint in a follow-up.
// ============================================================

type Outcome = '' | 'offer_presented' | 'device_sold' | 'rescheduled' | 'cancelled';

interface Props {
  visitId: number;
  taskId: number;
  onClose: () => void;
  onSaved: () => void;
}

interface OfferRow {
  device_model_id: number | '';
  offer_type: 'cash' | 'installment';
  quantity: number;
  total_amount: number | '';
  currency: string;
  first_payment_amount: number | '';
  installment_months: number | '';
  discount_percentage: number | '';
  customer_response: 'accepted' | 'rejected' | 'extension_requested';
  no_closing_reason: string;
}

const EMPTY_OFFER: OfferRow = {
  device_model_id: '',
  offer_type: 'cash',
  quantity: 1,
  total_amount: '',
  currency: 'SYP',
  first_payment_amount: '',
  installment_months: '',
  discount_percentage: '',
  customer_response: 'accepted',
  no_closing_reason: '',
};

const OUTCOMES: Array<{ value: Outcome; label: string; desc: string; Icon: any; cls: string }> = [
  { value: 'offer_presented', label: 'تقديم عرض', desc: 'عروض متعدّدة مع رد الزبون لكل واحد', Icon: ShoppingCart, cls: 'border-sky-200 hover:bg-sky-50 text-sky-700' },
  { value: 'device_sold',     label: 'تم البيع',  desc: 'بيع مباشر بدون عروض متعدّدة',         Icon: CheckCircle2, cls: 'border-emerald-200 hover:bg-emerald-50 text-emerald-700' },
  { value: 'rescheduled',     label: 'إعادة جدولة', desc: 'الزبون طلب موعداً آخر',              Icon: RotateCcw,    cls: 'border-amber-200 hover:bg-amber-50 text-amber-700' },
  { value: 'cancelled',       label: 'إلغاء',     desc: 'الزيارة لم تتم — لا متابعة',         Icon: XCircle,      cls: 'border-rose-200 hover:bg-rose-50 text-rose-700' },
];

export default function DeviceDemoResultModal({ visitId, taskId, onClose, onSaved }: Props) {
  const [outcome, setOutcome] = useState<Outcome>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // shared
  const [closingNotes, setClosingNotes] = useState('');
  const [closedByEmployeeId, setClosedByEmployeeId] = useState<number | ''>('');
  const [employees, setEmployees] = useState<Array<{ id: number; name: string }>>([]);

  // offer_presented
  const [offers, setOffers] = useState<OfferRow[]>([{ ...EMPTY_OFFER }]);
  const [deviceModels, setDeviceModels] = useState<Array<{ id: number; nameAr: string | null; nameEn: string }>>([]);

  // device_sold
  const [soldDeviceModelId, setSoldDeviceModelId] = useState<number | ''>('');
  const [soldOfferType, setSoldOfferType] = useState<'cash' | 'installment'>('cash');
  const [soldAmount, setSoldAmount] = useState<number | ''>('');
  const [soldInstallmentMonths, setSoldInstallmentMonths] = useState<number | ''>('');

  // rescheduled
  const [rescheduleReasonId, setRescheduleReasonId] = useState<number | ''>('');
  const [rescheduleReasons, setRescheduleReasons] = useState<Array<{ id: number; value: string }>>([]);
  const [expectedDate, setExpectedDate] = useState('');
  const [expectedTime, setExpectedTime] = useState('');

  // cancelled
  const [cancellationReasonId, setCancellationReasonId] = useState<number | ''>('');
  const [cancellationReasons, setCancellationReasons] = useState<Array<{ id: number; value: string }>>([]);

  useEffect(() => {
    (async () => {
      try {
        const [models, closers, rResched, rCancel] = await Promise.all([
          api.deviceModels.list?.().catch(() => []) ?? [],
          api.employees.closers?.().catch(() => []) ?? [],
          api.systemLists.getItemsByCode?.('customer_followup_reasons').catch(() => []) ?? [],
          api.systemLists.getItemsByCode?.('visit_cancellation_reasons').catch(() => []) ?? [],
        ]);
        setDeviceModels(Array.isArray(models) ? models : []);
        setEmployees(Array.isArray(closers) ? closers : []);
        setRescheduleReasons(Array.isArray(rResched) ? rResched : []);
        setCancellationReasons(Array.isArray(rCancel) ? rCancel : []);
      } catch {
        // fallback silently — the dropdowns just stay empty
      }
    })();
  }, []);

  function buildBody(): any {
    if (outcome === 'offer_presented') {
      return {
        final_decision: 'offer_presented',
        closed_by_employee_id: closedByEmployeeId || null,
        closing_notes: closingNotes || null,
        offers: offers.map(o => ({
          device_model_id: Number(o.device_model_id),
          offer_type: o.offer_type,
          quantity: Number(o.quantity),
          total_amount: Number(o.total_amount),
          currency: o.currency,
          first_payment_amount: o.first_payment_amount === '' ? null : Number(o.first_payment_amount),
          installment_months: o.installment_months === '' ? null : Number(o.installment_months),
          discount_percentage: o.discount_percentage === '' ? null : Number(o.discount_percentage),
          customer_response: o.customer_response,
          no_closing_reason: o.no_closing_reason.trim() || null,
        })),
        expected_date: offers.some(o => o.customer_response === 'extension_requested') ? expectedDate || null : null,
      };
    }
    if (outcome === 'device_sold') {
      return {
        final_decision: 'device_sold',
        sold_device_model_id: Number(soldDeviceModelId),
        offer_type: soldOfferType,
        offer_amount: Number(soldAmount),
        installment_months: soldInstallmentMonths === '' ? null : Number(soldInstallmentMonths),
        closed_by_employee_id: closedByEmployeeId || null,
        closing_notes: closingNotes || null,
      };
    }
    if (outcome === 'rescheduled') {
      return {
        final_decision: 'rescheduled',
        reason_code_id: Number(rescheduleReasonId),
        expected_date: expectedDate,
        expected_time: expectedTime || null,
        closing_notes: closingNotes || null,
      };
    }
    if (outcome === 'cancelled') {
      return {
        final_decision: 'cancelled',
        reason_code_id: Number(cancellationReasonId),
        closing_notes: closingNotes || null,
      };
    }
    return null;
  }

  async function handleSubmit() {
    const body = buildBody();
    if (!body) { setError('اختر النتيجة أولاً'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/field-visits/${visitId}/tasks/${taskId}/result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token') ?? ''}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'فشل تسجيل النتيجة');
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? 'خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">تسجيل نتيجة عرض الجهاز</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Step 1 — outcome selection */}
          <div>
            <p className="text-xs font-bold text-slate-500 mb-2">ما نتيجة هذه الزيارة؟</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {OUTCOMES.map(o => {
                const Icon = o.Icon;
                const isActive = outcome === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setOutcome(o.value)}
                    className={`text-right border rounded-xl p-3 transition-all ${o.cls} ${
                      isActive ? 'ring-2 ring-offset-1 ring-current' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="w-5 h-5" />
                      <span className="font-bold">{o.label}</span>
                    </div>
                    <p className="text-xs mt-1 opacity-80">{o.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2 — outcome-specific fields */}
          {outcome === 'offer_presented' && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-500">البائع</label>
                <select value={closedByEmployeeId} onChange={e => setClosedByEmployeeId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1">
                  <option value="">— اختر —</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div className="space-y-3">
                {offers.map((o, i) => (
                  <div key={i} className="border border-slate-200 rounded-lg p-3 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-slate-600">عرض #{i + 1}</span>
                      {offers.length > 1 && (
                        <button type="button" onClick={() => setOffers(offers.filter((_, j) => j !== i))}
                          className="text-rose-500 hover:text-rose-700">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <select value={o.device_model_id}
                        onChange={e => setOffers(offers.map((x, j) => j === i ? { ...x, device_model_id: e.target.value ? Number(e.target.value) : '' } : x))}
                        className="border rounded px-2 py-1">
                        <option value="">— الجهاز —</option>
                        {deviceModels.map(m => <option key={m.id} value={m.id}>{m.nameAr ?? m.nameEn}</option>)}
                      </select>
                      <select value={o.offer_type}
                        onChange={e => setOffers(offers.map((x, j) => j === i ? { ...x, offer_type: e.target.value as any } : x))}
                        className="border rounded px-2 py-1">
                        <option value="cash">كاش</option>
                        <option value="installment">تقسيط</option>
                      </select>
                      <input type="number" placeholder="المبلغ الكلي" value={o.total_amount}
                        onChange={e => setOffers(offers.map((x, j) => j === i ? { ...x, total_amount: e.target.value === '' ? '' : Number(e.target.value) } : x))}
                        className="border rounded px-2 py-1" />
                      {o.offer_type === 'installment' && (
                        <input type="number" placeholder="عدد الأشهر" value={o.installment_months}
                          onChange={e => setOffers(offers.map((x, j) => j === i ? { ...x, installment_months: e.target.value === '' ? '' : Number(e.target.value) } : x))}
                          className="border rounded px-2 py-1" />
                      )}
                      <select value={o.customer_response}
                        onChange={e => setOffers(offers.map((x, j) => j === i ? { ...x, customer_response: e.target.value as any } : x))}
                        className="border rounded px-2 py-1 col-span-2">
                        <option value="accepted">قَبِل</option>
                        <option value="rejected">رفض</option>
                        <option value="extension_requested">طلب مهلة</option>
                      </select>
                      {o.customer_response === 'rejected' && (
                        <input type="text" placeholder="سبب الرفض" value={o.no_closing_reason}
                          onChange={e => setOffers(offers.map((x, j) => j === i ? { ...x, no_closing_reason: e.target.value } : x))}
                          className="border rounded px-2 py-1 col-span-2" />
                      )}
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => setOffers([...offers, { ...EMPTY_OFFER }])}
                  className="inline-flex items-center gap-1 text-sm text-sky-600 hover:underline">
                  <Plus className="w-4 h-4" /> إضافة عرض آخر
                </button>
              </div>
              {offers.some(o => o.customer_response === 'extension_requested') && (
                <div>
                  <label className="text-xs font-bold text-slate-500">موعد المتابعة</label>
                  <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)}
                    className="w-full border rounded px-2 py-1 mt-1" />
                </div>
              )}
            </div>
          )}

          {outcome === 'device_sold' && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <label className="text-xs font-bold text-slate-500">الجهاز المباع</label>
                <select value={soldDeviceModelId} onChange={e => setSoldDeviceModelId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full border rounded px-2 py-1 mt-1">
                  <option value="">— اختر —</option>
                  {deviceModels.map(m => <option key={m.id} value={m.id}>{m.nameAr ?? m.nameEn}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500">طريقة الدفع</label>
                <select value={soldOfferType} onChange={e => setSoldOfferType(e.target.value as any)}
                  className="w-full border rounded px-2 py-1 mt-1">
                  <option value="cash">كاش</option>
                  <option value="installment">تقسيط</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500">المبلغ الكلي</label>
                <input type="number" value={soldAmount}
                  onChange={e => setSoldAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full border rounded px-2 py-1 mt-1" />
              </div>
              {soldOfferType === 'installment' && (
                <div>
                  <label className="text-xs font-bold text-slate-500">عدد الأشهر</label>
                  <input type="number" value={soldInstallmentMonths}
                    onChange={e => setSoldInstallmentMonths(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full border rounded px-2 py-1 mt-1" />
                </div>
              )}
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-500">البائع</label>
                <select value={closedByEmployeeId} onChange={e => setClosedByEmployeeId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full border rounded px-2 py-1 mt-1">
                  <option value="">— اختر —</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
            </div>
          )}

          {outcome === 'rescheduled' && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-500">سبب إعادة الجدولة</label>
                <select value={rescheduleReasonId} onChange={e => setRescheduleReasonId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full border rounded px-2 py-1 mt-1">
                  <option value="">— اختر —</option>
                  {rescheduleReasons.map(r => <option key={r.id} value={r.id}>{r.value}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500">موعد المتابعة</label>
                <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)}
                  className="w-full border rounded px-2 py-1 mt-1" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500">الوقت (اختياري)</label>
                <input type="text" placeholder="مثلاً 14:00-16:00" value={expectedTime}
                  onChange={e => setExpectedTime(e.target.value)}
                  className="w-full border rounded px-2 py-1 mt-1" />
              </div>
            </div>
          )}

          {outcome === 'cancelled' && (
            <div className="space-y-3 text-sm">
              <div>
                <label className="text-xs font-bold text-slate-500">سبب الإلغاء</label>
                <select value={cancellationReasonId} onChange={e => setCancellationReasonId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full border rounded px-2 py-1 mt-1">
                  <option value="">— اختر —</option>
                  {cancellationReasons.map(r => <option key={r.id} value={r.id}>{r.value}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* shared notes */}
          {outcome && (
            <div>
              <label className="text-xs font-bold text-slate-500">ملاحظات (اختياري)</label>
              <textarea value={closingNotes} onChange={e => setClosingNotes(e.target.value)}
                rows={3} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
          )}

          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded text-sm">{error}</div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">إلغاء</button>
          <button onClick={handleSubmit} disabled={!outcome || saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-50">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            حفظ النتيجة
          </button>
        </div>
      </div>
    </div>
  );
}
