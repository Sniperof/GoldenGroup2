// ============================================================
// WarrantyPaymentEntries — three-axis payment editor (DEC-CT-17).
// Constitution: 02b §13.6. Mirrors the ContractForm payment model so golden
// warranty payments map 1:1 onto device_warranty_payments columns.
//
// The three orthogonal axes (see analysis):
//   1. category  : hand / transfer / barter   (how the money arrived)
//   2. method    : cash | sham_cash | ... | bank_transfer | barter (the instrument)
//   3. currency  : SYP | USD (+ exchange_rate)
//
// `usd_cash` from the legacy DB enum is intentionally NOT exposed — currency is
// always its own axis.
// ============================================================
import { Plus, X } from 'lucide-react';

export type WarrantyPaymentCategory = 'hand' | 'transfer' | 'barter';
export type WarrantyPaymentMethod =
  | 'cash' | 'sham_cash' | 'syriatel_cash' | 'mtn_cash' | 'alharam' | 'bank_transfer' | 'barter';

export interface WarrantyPaymentRow {
  _key: string;
  paymentCategory: WarrantyPaymentCategory;
  method: WarrantyPaymentMethod;
  currency: 'SYP' | 'USD';
  amountValue: string;
  exchangeRate: string;
  referenceNumber: string;
  barterName: string;
  barterValueSyp: string;
}

const TRANSFER_METHODS: Array<{ value: WarrantyPaymentMethod; label: string }> = [
  { value: 'sham_cash', label: 'شام كاش' },
  { value: 'syriatel_cash', label: 'سيرياتيل كاش' },
  { value: 'mtn_cash', label: 'MTN كاش' },
  { value: 'alharam', label: 'الهرم' },
  { value: 'bank_transfer', label: 'حوالة بنكية' },
];

const CATEGORY_META: Array<{ value: WarrantyPaymentCategory; label: string; icon: string }> = [
  { value: 'hand', label: 'يد', icon: '🤝' },
  { value: 'transfer', label: 'حوالة', icon: '📲' },
  { value: 'barter', label: 'مقايضة', icon: '🔄' },
];

let keyCounter = 0;
export function newWarrantyPaymentRow(): WarrantyPaymentRow {
  return {
    _key: String(++keyCounter),
    paymentCategory: 'hand', method: 'cash', currency: 'SYP',
    amountValue: '', exchangeRate: '', referenceNumber: '', barterName: '', barterValueSyp: '',
  };
}

export function warrantyEntrySyp(e: WarrantyPaymentRow): number {
  if (e.paymentCategory === 'barter') return Number(e.barterValueSyp) || 0;
  const v = Number(e.amountValue) || 0;
  return e.currency === 'USD' ? v * (Number(e.exchangeRate) || 0) : v;
}

/** Map a UI row to the API payment payload (device_warranty_payments columns). */
export function warrantyPaymentPayload(e: WarrantyPaymentRow) {
  const isBarter = e.paymentCategory === 'barter';
  return {
    method: e.method,
    currency: e.currency,
    amountValue: isBarter ? 0 : (Number(e.amountValue) || 0),
    exchangeRate: e.currency === 'USD' && !isBarter ? (Number(e.exchangeRate) || null) : null,
    amountSyp: warrantyEntrySyp(e),
    referenceNumber: e.paymentCategory === 'transfer' ? (e.referenceNumber.trim() || null) : null,
    barterName: isBarter ? (e.barterName.trim() || null) : null,
    barterValueSyp: isBarter ? (Number(e.barterValueSyp) || 0) : null,
  };
}

const inp = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 bg-white';

interface Props {
  entries: WarrantyPaymentRow[];
  onChange: (entries: WarrantyPaymentRow[]) => void;
  grandTotal?: number | null;   // total value, for the coverage summary
  disabled?: boolean;
}

export default function WarrantyPaymentEntries({ entries, onChange, grandTotal, disabled }: Props) {
  const update = (key: string, patch: Partial<WarrantyPaymentRow>) =>
    onChange(entries.map(e => (e._key === key ? { ...e, ...patch } : e)));
  const remove = (key: string) => onChange(entries.filter(e => e._key !== key));
  const add = () => onChange([...entries, newWarrantyPaymentRow()]);

  const setCategory = (key: string, cat: WarrantyPaymentCategory) =>
    update(key, {
      paymentCategory: cat,
      method: cat === 'barter' ? 'barter' : cat === 'transfer' ? 'sham_cash' : 'cash',
      currency: 'SYP', amountValue: '', exchangeRate: '', referenceNumber: '', barterName: '', barterValueSyp: '',
    });

  const totalSyp = entries.reduce((s, e) => s + warrantyEntrySyp(e), 0);
  const gap = grandTotal != null ? totalSyp - grandTotal : null;

  return (
    <div className="space-y-2">
      {entries.map((e, idx) => {
        const syp = warrantyEntrySyp(e);
        return (
          <div key={e._key} className="rounded-xl border border-slate-200 bg-slate-50/40 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400">دفعة #{idx + 1}</span>
              {!disabled && (
                <button type="button" onClick={() => remove(e._key)}
                  className="h-5 w-5 rounded-full bg-slate-200 text-slate-400 hover:bg-rose-100 hover:text-rose-600 flex items-center justify-center transition-colors">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* axis 1: category */}
            <div className="flex gap-1.5">
              {CATEGORY_META.map(m => (
                <button key={m.value} type="button" disabled={disabled}
                  onClick={() => setCategory(e._key, m.value)}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-lg border-2 text-xs font-bold transition-all ${
                    e.paymentCategory === m.value
                      ? 'border-amber-400 bg-amber-50 text-amber-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                  }`}>
                  <span className="text-sm">{m.icon}</span><span>{m.label}</span>
                </button>
              ))}
            </div>

            {/* barter branch */}
            {e.paymentCategory === 'barter' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2 space-y-1">
                  <label className="block text-xs font-bold text-slate-500">ماذا تمت المقايضة عليه</label>
                  <input type="text" value={e.barterName} disabled={disabled}
                    onChange={ev => update(e._key, { barterName: ev.target.value })}
                    placeholder="وصف الشيء المقايض..." className={inp} />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-500">القيمة (ل.س)</label>
                  <input type="number" min="0" value={e.barterValueSyp} disabled={disabled}
                    onChange={ev => update(e._key, { barterValueSyp: ev.target.value })}
                    placeholder="0" className={inp} dir="ltr" />
                </div>
                {syp > 0 && (
                  <div className="flex items-end">
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700 w-full text-center">
                      {syp.toLocaleString('ar-SY')} ل.س
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* hand / transfer branch */}
            {(e.paymentCategory === 'hand' || e.paymentCategory === 'transfer') && (
              <div className="space-y-2">
                {e.paymentCategory === 'transfer' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-500">أداة الحوالة</label>
                      <select value={e.method} disabled={disabled}
                        onChange={ev => update(e._key, { method: ev.target.value as WarrantyPaymentMethod })}
                        className={inp + ' appearance-none cursor-pointer'}>
                        {TRANSFER_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-500">رقم الحوالة</label>
                      <input type="text" value={e.referenceNumber} disabled={disabled}
                        onChange={ev => update(e._key, { referenceNumber: ev.target.value })}
                        placeholder="—" className={inp} dir="ltr" />
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-500">العملة</label>
                    <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                      {(['SYP', 'USD'] as const).map(c => (
                        <button key={c} type="button" disabled={disabled}
                          onClick={() => update(e._key, { currency: c, exchangeRate: '' })}
                          className={`flex-1 py-2 text-xs font-bold transition-all ${
                            e.currency === c
                              ? c === 'SYP' ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white'
                              : 'bg-white text-slate-500 hover:bg-slate-50'
                          }`}>
                          {c === 'SYP' ? 'ل.س' : '$'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-500">
                      المبلغ {e.currency === 'USD' ? '($)' : '(ل.س)'}
                    </label>
                    <input type="number" min="0" value={e.amountValue} disabled={disabled}
                      onChange={ev => update(e._key, { amountValue: ev.target.value })}
                      placeholder="0" className={inp} dir="ltr" />
                  </div>
                </div>
                {e.currency === 'USD' && (
                  <div className="grid grid-cols-2 gap-2 items-end">
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-500">سعر الصرف</label>
                      <input type="number" min="0" value={e.exchangeRate} disabled={disabled}
                        onChange={ev => update(e._key, { exchangeRate: ev.target.value })}
                        placeholder="ل.س / $" className={inp} dir="ltr" />
                    </div>
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-center">
                      <div className="text-xs text-blue-500 font-bold">يعادل</div>
                      <div className="text-xs font-black text-blue-700">
                        {syp > 0 ? syp.toLocaleString('ar-SY') : '—'} ل.س
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {!disabled && (
        <button type="button" onClick={add}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-bold text-slate-400 hover:border-amber-300 hover:text-amber-600 transition-colors">
          <Plus className="h-3.5 w-3.5" /> إضافة دفعة
        </button>
      )}

      {(totalSyp > 0 || (grandTotal != null && grandTotal > 0)) && (
        <div className={`rounded-lg border-2 p-3 space-y-1 ${
          gap === null ? 'border-slate-200 bg-slate-50'
          : gap >= 0 ? 'border-emerald-200 bg-emerald-50'
          : 'border-amber-200 bg-amber-50'
        }`}>
          {grandTotal != null && grandTotal > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-slate-500 font-bold">قيمة الكفالة</span>
              <span className="font-black text-slate-700">{grandTotal.toLocaleString('ar-SY')} ل.س</span>
            </div>
          )}
          <div className="flex justify-between text-xs">
            <span className="text-slate-600 font-bold">المدفوع</span>
            <span className="font-black text-slate-800">{totalSyp.toLocaleString('ar-SY')} ل.س</span>
          </div>
          {gap !== null && (
            <div className={`flex justify-between text-sm font-black border-t pt-1 ${
              gap >= 0 ? 'text-emerald-700 border-emerald-200' : 'text-amber-700 border-amber-200'
            }`}>
              <span>{gap >= 0 ? 'مكتمل ✓' : 'المتبقّي'}</span>
              <span>{gap >= 0 ? `+${gap.toLocaleString('ar-SY')}` : Math.abs(gap).toLocaleString('ar-SY')} ل.س</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
