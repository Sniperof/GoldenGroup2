import { Plus, X } from 'lucide-react';
import { useSystemListItems } from '../../hooks/useSystemListItems';

export interface PaymentEntry {
  _key: string;       // client-side unique key
  method: 'hand' | 'transfer' | 'barter' | '';
  amountValue: string;
  currency: 'syp' | 'usd';
  exchangeRate: string;
  transferCompanyId: string;
  barterDescription: string;
}

interface Props {
  entries: PaymentEntry[];
  onChange: (entries: PaymentEntry[]) => void;
  disabled?: boolean;
  grandTotal?: number;   // for comparison display
  label?: string;
}

const inp = "w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 bg-white";

let keyCounter = 0;
export function newEntry(): PaymentEntry {
  return { _key: String(++keyCounter), method: '', amountValue: '', currency: 'syp', exchangeRate: '', transferCompanyId: '', barterDescription: '' };
}

function entrySyp(e: PaymentEntry): number {
  const v = Number(e.amountValue) || 0;
  if (e.method === 'barter') return v;
  return e.currency === 'usd' ? v * (Number(e.exchangeRate) || 0) : v;
}

const METHOD_META = [
  { value: 'hand',     label: 'يد',      icon: '🤝' },
  { value: 'transfer', label: 'حوالة',   icon: '📲' },
  { value: 'barter',   label: 'مقايضة',  icon: '🔄' },
] as const;

export default function PaymentEntriesList({ entries, onChange, disabled, grandTotal, label }: Props) {
  const transferCompanies = useSystemListItems('transfer_company');

  const update = (key: string, patch: Partial<PaymentEntry>) =>
    onChange(entries.map(e => e._key === key ? { ...e, ...patch } : e));

  const remove = (key: string) => onChange(entries.filter(e => e._key !== key));

  const add = () => onChange([...entries, newEntry()]);

  const totalSyp = entries.reduce((s, e) => s + entrySyp(e), 0);
  const gap       = grandTotal != null ? totalSyp - grandTotal : null;

  return (
    <div className="space-y-2">
      {label && <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>}

      {entries.map((e, idx) => {
        const syp = entrySyp(e);
        return (
          <div key={e._key} className="rounded-2xl border border-slate-200 bg-slate-50/40 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400">جزء #{idx + 1}</span>
              {!disabled && entries.length > 1 && (
                <button type="button" onClick={() => remove(e._key)}
                  className="h-5 w-5 rounded-full bg-slate-200 hover:bg-red-100 hover:text-red-600 text-slate-400 flex items-center justify-center transition-colors">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* طريقة الجزء */}
            <div className="flex gap-1.5">
              {METHOD_META.map(m => (
                <button key={m.value} type="button" disabled={disabled}
                  onClick={() => update(e._key, { method: m.value, amountValue: '', currency: 'syp', exchangeRate: '', transferCompanyId: '', barterDescription: '' })}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-xl border-2 text-[10px] font-bold transition-all ${
                    e.method === m.value
                      ? 'border-rose-400 bg-rose-50 text-rose-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                  }`}>
                  <span className="text-sm">{m.icon}</span>
                  <span>{m.label}</span>
                </button>
              ))}
            </div>

            {/* حقول حسب الطريقة */}
            {e.method === 'barter' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2 space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500">ماذا تم المقايضة عليه</label>
                  <input type="text" value={e.barterDescription}
                    onChange={ev => update(e._key, { barterDescription: ev.target.value })}
                    placeholder="وصف الشيء المقايض..." disabled={disabled} className={inp} />
                </div>
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500">القيمة (ل.س)</label>
                  <input type="number" min="0" value={e.amountValue}
                    onChange={ev => update(e._key, { amountValue: ev.target.value })}
                    placeholder="0" disabled={disabled} className={inp} dir="ltr" />
                </div>
                {syp > 0 && (
                  <div className="flex items-end">
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700 w-full text-center">
                      {syp.toLocaleString('ar-SY')} ل.س
                    </div>
                  </div>
                )}
              </div>
            )}

            {(e.method === 'hand' || e.method === 'transfer') && (
              <div className="space-y-2">
                {e.method === 'transfer' && (
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-500">شركة الحوالة</label>
                    <select value={e.transferCompanyId}
                      onChange={ev => update(e._key, { transferCompanyId: ev.target.value })}
                      disabled={disabled || transferCompanies.loading}
                      className={inp + ' appearance-none cursor-pointer'}>
                      <option value="">— اختر —</option>
                      {transferCompanies.items.map(r => <option key={r.id} value={r.id}>{r.value}</option>)}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-500">العملة</label>
                    <div className="flex rounded-xl border border-slate-200 overflow-hidden">
                      {(['syp', 'usd'] as const).map(c => (
                        <button key={c} type="button" disabled={disabled}
                          onClick={() => update(e._key, { currency: c, exchangeRate: '' })}
                          className={`flex-1 py-2 text-xs font-bold transition-all ${
                            e.currency === c
                              ? c === 'syp' ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white'
                              : 'bg-white text-slate-500 hover:bg-slate-50'
                          }`}>
                          {c === 'syp' ? 'ل.س' : '$'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-500">
                      المبلغ {e.currency === 'usd' ? '($)' : '(ل.س)'}
                    </label>
                    <input type="number" min="0" value={e.amountValue}
                      onChange={ev => update(e._key, { amountValue: ev.target.value })}
                      placeholder="0" disabled={disabled} className={inp} dir="ltr" />
                  </div>
                </div>
                {e.currency === 'usd' && (
                  <div className="grid grid-cols-2 gap-2 items-end">
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-slate-500">سعر الصرف</label>
                      <input type="number" min="0" value={e.exchangeRate}
                        onChange={ev => update(e._key, { exchangeRate: ev.target.value })}
                        placeholder="ل.س / $" disabled={disabled} className={inp} dir="ltr" />
                    </div>
                    <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-center">
                      <div className="text-[9px] text-blue-500 font-bold">يعادل</div>
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
          className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-2 text-xs font-bold text-slate-400 hover:border-rose-300 hover:text-rose-500 transition-colors">
          <Plus className="h-3.5 w-3.5" /> إضافة جزء دفع
        </button>
      )}

      {/* ملخص */}
      {(totalSyp > 0 || (grandTotal != null && grandTotal > 0)) && (
        <div className={`rounded-xl border-2 p-3 space-y-1 ${
          gap === null ? 'border-slate-200 bg-slate-50'
          : gap >= 0 ? 'border-emerald-200 bg-emerald-50'
          : 'border-amber-200 bg-amber-50'
        }`}>
          {grandTotal != null && grandTotal > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-slate-500 font-bold">المطلوب</span>
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
              <span>{gap >= 0 ? 'يغطي ✓' : 'فرق'}</span>
              <span>{gap >= 0 ? `+${gap.toLocaleString('ar-SY')}` : Math.abs(gap).toLocaleString('ar-SY')} ل.س</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
