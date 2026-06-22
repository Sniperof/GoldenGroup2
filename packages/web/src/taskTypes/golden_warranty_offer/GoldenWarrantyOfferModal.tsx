// ============================================================
// GoldenWarrantyOfferModal — field marketing task `golden_warranty_offer`.
// Constitution: 02b §13.6 + DEC-CT-17.
//
// The team presents the golden warranty in the field. On acceptance, handing the
// customer the RECEIPT activates the warranty immediately (start = receipt date,
// end = start + months). Captures the baseline 01i reading and initial payments.
// Calls POST /device-warranties/golden/offer-result.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { Award, Loader2, Plus, Trash2, X } from 'lucide-react';
import { api } from '../../lib/api';
import {
  TechnicalStateFields,
  buildTechnicalStatePayload,
  hasAnyTechnicalReading,
  type TechStateForm,
} from '../../components/devices/TechnicalStateFields';

const PAYMENT_METHODS: Array<{ value: string; label: string }> = [
  { value: 'cash', label: 'نقدي' },
  { value: 'usd_cash', label: 'دولار نقدي' },
  { value: 'bank_transfer', label: 'تحويل بنكي' },
  { value: 'sham_cash', label: 'شام كاش' },
  { value: 'syriatel_cash', label: 'سيرياتيل كاش' },
  { value: 'mtn_cash', label: 'MTN كاش' },
  { value: 'alharam', label: 'الهرم' },
  { value: 'barter', label: 'مقايضة' },
];

interface PaymentRow { method: string; amountValue: string }

function addMonthsToDate(dateStr: string, months: number): string {
  if (!dateStr || !Number.isFinite(months)) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export default function GoldenWarrantyOfferModal({
  taskId,
  customerId,
  deviceId: initialDeviceId,
  branchId,
  onClose,
  onSaved,
}: {
  taskId: number;
  customerId?: number | null;
  deviceId?: number | null;
  branchId?: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const [devices, setDevices] = useState<any[]>([]);
  const [deviceId, setDeviceId] = useState<number | null>(initialDeviceId ?? null);
  const [receiptDate, setReceiptDate] = useState(today);
  const [months, setMonths] = useState('12');
  const [totalValue, setTotalValue] = useState('');
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [reading, setReading] = useState<TechStateForm>({});
  const [showReading, setShowReading] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the customer's installed devices for selection.
  useEffect(() => {
    if (!customerId) return;
    api.installedDevices.list({ customerId, ...(branchId ? { branchId } : {}) })
      .then((rows) => setDevices(Array.isArray(rows) ? rows : []))
      .catch(() => setDevices([]));
  }, [customerId, branchId]);

  const endDate = useMemo(() => addMonthsToDate(receiptDate, Number(months)), [receiptDate, months]);

  const addPayment = () => setPayments((p) => [...p, { method: 'cash', amountValue: '' }]);
  const removePayment = (i: number) => setPayments((p) => p.filter((_, idx) => idx !== i));
  const updatePayment = (i: number, field: keyof PaymentRow, value: string) =>
    setPayments((p) => p.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));

  async function submit() {
    setError(null);
    if (!deviceId) { setError('اختر الجهاز'); return; }
    const m = Number(months);
    if (!Number.isFinite(m) || m <= 0) { setError('مدة الكفالة غير صالحة'); return; }
    if (!receiptDate) { setError('تاريخ الوصل مطلوب'); return; }

    const validPayments = payments
      .filter((p) => p.amountValue.trim() && Number(p.amountValue) > 0)
      .map((p) => ({ method: p.method, amountValue: Number(p.amountValue) }));

    setSaving(true);
    try {
      await api.deviceWarranties.offerResult({
        taskId,
        deviceId,
        receiptDate,
        months: m,
        totalValue: totalValue.trim() ? Number(totalValue) : null,
        reading: hasAnyTechnicalReading(reading)
          ? { ...buildTechnicalStatePayload(reading), additionalNotes: notes.trim() || buildTechnicalStatePayload(reading).additionalNotes }
          : null,
        payments: validPayments,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? 'فشل تسجيل عرض الكفالة الذهبية');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" dir="rtl">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-amber-200 bg-white shadow-xl">
        {/* Header — golden theme */}
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-5 py-4">
          <div className="flex items-center gap-2">
            <Award className="h-5 w-5 text-amber-600" />
            <h2 className="text-lg font-bold text-amber-900">عرض الكفالة الذهبية — مهمة #{taskId}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
          )}

          <div className="rounded-lg border border-amber-100 bg-amber-50/50 px-3 py-2 text-xs text-amber-800">
            تسليم الوصل للزبون يُفعّل الكفالة فورًا (تبدأ من تاريخ الوصل). التغطية: الصيانة الدورية + الطارئة.
          </div>

          {/* Device + dates */}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5 block">
              <span className="text-xs font-bold text-slate-500">الجهاز *</span>
              <select
                value={deviceId ?? ''}
                onChange={(e) => setDeviceId(e.target.value ? Number(e.target.value) : null)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">— اختر الجهاز —</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.deviceModelName ?? d.device_model_name ?? 'جهاز'} — {d.serialNumber ?? d.serial_number ?? `#${d.id}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 block">
              <span className="text-xs font-bold text-slate-500">تاريخ الوصل (بداية الكفالة) *</span>
              <input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-xs font-bold text-slate-500">مدة الكفالة (أشهر) *</span>
              <input type="number" min="1" value={months} onChange={(e) => setMonths(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-xs font-bold text-slate-500">تاريخ النهاية (محسوب)</span>
              <input type="text" value={endDate} readOnly
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600" />
            </label>
            <label className="space-y-1.5 block md:col-span-2">
              <span className="text-xs font-bold text-slate-500">قيمة الكفالة</span>
              <input type="number" min="0" value={totalValue} onChange={(e) => setTotalValue(e.target.value)}
                placeholder="القيمة الإجمالية" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
            </label>
          </div>

          {/* Payments */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-700">الدفعات</span>
              <button type="button" onClick={addPayment}
                className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-600 hover:text-amber-700">
                <Plus className="h-4 w-4" /> إضافة دفعة
              </button>
            </div>
            {payments.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <select value={p.method} onChange={(e) => updatePayment(i, 'method', e.target.value)}
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <input type="number" min="0" placeholder="المبلغ" value={p.amountValue}
                  onChange={(e) => updatePayment(i, 'amountValue', e.target.value)}
                  className="w-32 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                <button type="button" onClick={() => removePayment(i)}
                  className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            {payments.length === 0 && <p className="text-xs text-slate-400">لا دفعات بعد — يمكن إضافتها لاحقًا.</p>}
          </div>

          {/* Baseline technical reading (01i) */}
          <div className="rounded-lg border border-slate-200">
            <button type="button" onClick={() => setShowReading((s) => !s)}
              className="w-full text-right px-4 py-3 text-sm font-bold text-slate-700">
              الحالة الفنية المرجعية للجهاز (خط الأساس) {showReading ? '▾' : '▸'}
            </button>
            {showReading && (
              <div className="border-t border-slate-100 p-4">
                <TechnicalStateFields value={reading} onChange={setReading} />
              </div>
            )}
          </div>

          <label className="space-y-1.5 block">
            <span className="text-xs font-bold text-slate-500">ملاحظات</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
            إلغاء
          </button>
          <button onClick={submit} disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            تسجيل العرض وتسليم الوصل
          </button>
        </div>
      </div>
    </div>
  );
}
