import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import Modal from '../ui/Modal';
import Select from '../ui/Select';
import { api } from '../../lib/api';

// Payments against a service agreement's fee (migr 485). Each payment and each
// deletion is booked to the customer's unified ledger by the API.

const METHOD_OPTIONS = [
  { value: 'cash', label: 'نقدي' },
  { value: 'sham_cash', label: 'شام كاش' },
  { value: 'syriatel_cash', label: 'سيرياتيل كاش' },
  { value: 'mtn_cash', label: 'إم تي إن كاش' },
  { value: 'alharam', label: 'الهرم' },
  { value: 'bank_transfer', label: 'حوالة بنكية' },
];
const METHOD_LABEL: Record<string, string> = Object.fromEntries(METHOD_OPTIONS.map((o) => [o.value, o.label]));

const money = (v: number) => `${Math.round(v).toLocaleString('ar-SY', { numberingSystem: 'latn' })} ل.س`;

type Props = {
  agreement: { id: number; agreementNumber?: string | null; status: string };
  canEdit: boolean;
  onClose: () => void;
};

export default function ServiceAgreementPaymentsModal({ agreement, canEdit, onClose }: Props) {
  const [data, setData] = useState<{ payments: any[]; feeSyp: number; paidSyp: number; remainingSyp: number } | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editable = canEdit && !['cancelled', 'discarded'].includes(agreement.status);

  const load = useCallback(async () => {
    try { setData(await api.serviceAgreements.payments(agreement.id)); }
    catch (err: any) { setError(err?.message || 'تعذر تحميل الدفعات'); }
  }, [agreement.id]);

  useEffect(() => { load(); }, [load]);

  async function addPayment() {
    if (!(Number(amount) > 0)) { setError('أدخل مبلغاً صحيحاً'); return; }
    setBusy(true); setError('');
    try {
      await api.serviceAgreements.addPayment(agreement.id, { method, amountValue: Number(amount) });
      setAmount('');
      await load();
    } catch (err: any) { setError(err?.message || 'تعذر تسجيل الدفعة'); }
    finally { setBusy(false); }
  }

  async function removePayment(paymentId: number) {
    if (!confirm('حذف الدفعة؟ تُسجّل حركة عكسية في كشف حساب الزبون.')) return;
    setBusy(true); setError('');
    try { await api.serviceAgreements.deletePayment(paymentId); await load(); }
    catch (err: any) { setError(err?.message || 'تعذر حذف الدفعة'); }
    finally { setBusy(false); }
  }

  return (
    <Modal isOpen onClose={onClose} title="دفعات اتفاقية الخدمة" subtitle={agreement.agreementNumber || `#${agreement.id}`} size="lg">
      <div className="space-y-4 px-5 py-5" dir="rtl">
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        {!data ? (
          <div className="py-8 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-sky-500" /></div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-slate-50 px-2 py-2"><div className="text-[11px] text-slate-400">الرسوم</div><div className="font-black text-slate-800">{money(data.feeSyp)}</div></div>
              <div className="rounded-xl bg-emerald-50 px-2 py-2"><div className="text-[11px] text-emerald-600">المدفوع</div><div className="font-black text-emerald-700">{money(data.paidSyp)}</div></div>
              <div className="rounded-xl bg-rose-50 px-2 py-2"><div className="text-[11px] text-rose-500">المتبقي</div><div className="font-black text-rose-700">{money(data.remainingSyp)}</div></div>
            </div>

            {data.payments.length === 0 ? (
              <p className="text-center text-sm text-slate-400">لا توجد دفعات</p>
            ) : (
              <div className="space-y-1.5">
                {data.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-sm">
                    <span className="font-bold text-slate-700">
                      {money(p.amountSyp)} · {METHOD_LABEL[p.method] ?? p.method}{p.entryType === 'refund' ? ' (مرتجع)' : ''}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-slate-400">
                      {String(p.receivedAt).slice(0, 10)}
                      {editable && (
                        <button type="button" onClick={() => removePayment(p.id)} disabled={busy}
                          className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {editable && data.remainingSyp > 0 && (
              <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 p-3">
                <label className="flex-1 space-y-1">
                  <span className="text-xs font-bold text-slate-500">المبلغ</span>
                  <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} dir="ltr"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500" />
                </label>
                <label className="flex-1 space-y-1">
                  <span className="text-xs font-bold text-slate-500">طريقة الدفع</span>
                  <Select<string> value={method} onChange={setMethod} ariaLabel="طريقة الدفع" className="w-full" options={METHOD_OPTIONS} />
                </label>
                <button type="button" onClick={addPayment} disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-60">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} تسجيل دفعة
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
