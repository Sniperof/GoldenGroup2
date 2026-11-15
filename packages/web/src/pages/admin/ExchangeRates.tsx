// سعر الصرف المركزي (migr 493) — ليرة لكل دولار، سعر واحد لكل الفروع،
// بتاريخ سريان وسجل كامل غير قابل للتعديل (التصحيح = سعر جديد).
import { confirmDialog } from '../../lib/dialogs';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, DollarSign, Loader2, Plus } from '../../components/ui/icons';
import Button from '../../components/ui/Button';
import PageHeader from '../../components/ui/PageHeader';
import DateField from '../../components/ui/DateField';
import { useAuthStore } from '../../hooks/useAuthStore';
import { api } from '../../lib/api';

type Data = Awaited<ReturnType<typeof api.exchangeRates.list>>;

function money(n: number) {
  return Number(n).toLocaleString('ar-SY', { maximumFractionDigits: 4 });
}

export default function ExchangeRates() {
  const { user, hasPermission } = useAuthStore();
  const canView = user?.isSuperAdmin === true || hasPermission('exchange_rates.view');
  const canManage = user?.isSuperAdmin === true || hasPermission('exchange_rates.manage');

  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [rate, setRate] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const d = await api.exchangeRates.list();
      setData(d);
      setEffectiveFrom((prev) => prev || d.today);
    } catch (e: any) {
      setError(e?.message ?? 'فشل التحميل');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (canView) load(); else setLoading(false); }, [canView]);

  const save = async () => {
    setError('');
    setSuccess('');
    const r = Number(rate);
    if (!(r > 0)) { setError('أدخل سعر صرف صحيحاً (ليرة لكل دولار).'); return; }
    if (!effectiveFrom) { setError('تاريخ السريان مطلوب.'); return; }
    if (!await confirmDialog(`تأكيد إدخال سعر ${money(r)} ل.س للدولار ساري من ${effectiveFrom}؟ لا يمكن تعديله بعد الحفظ.`)) return;
    setSaving(true);
    try {
      await api.exchangeRates.create({ rate: r, effectiveFrom, note: note.trim() || null });
      setRate('');
      setNote('');
      setSuccess('تم حفظ سعر الصرف');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  if (!canView) return <Navigate to="/" replace />;

  return (
    <div className="p-4 sm:p-6 lg:p-8" dir="rtl">
      <PageHeader
        className="mb-6"
        title="سعر الصرف"
        subtitle="سعر الدولار المركزي (ليرة سورية لكل 1 دولار) — سعر واحد لكل الفروع. يُثبَّت على العقد عند تأكيد جدول الأقساط ويُستخدم سعر يوم الدفع عند التحصيل."
        icon={<div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center"><DollarSign className="w-5 h-5 text-blue-600" /></div>}
      />

      {error && <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700"><AlertTriangle className="w-4 h-4" />{error}</div>}
      {success && <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700"><CheckCircle2 className="w-4 h-4" />{success}</div>}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-blue-500" /></div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
              <div className="text-sm font-bold text-blue-700">السعر الساري اليوم</div>
              {data?.current ? (
                <>
                  <div className="mt-2 text-3xl font-black text-blue-900">{money(data.current.rate)} <span className="text-base">ل.س / $</span></div>
                  <div className="mt-1 text-xs text-blue-600">ساري منذ {data.current.effectiveFrom}</div>
                </>
              ) : (
                <div className="mt-2 text-sm font-bold text-rose-700">لا يوجد سعر ساري — تأكيد جداول الأقساط وتحصيل الأقساط المربوطة بالدولار متوقف حتى يُدخل سعر.</div>
              )}
              <div className="mt-3 text-xs text-blue-700">تقريب المستحق عند التحصيل: لأقرب {money(data?.roundingUnit ?? 0)} ل.س (من إعدادات النظام)</div>
            </div>

            {canManage && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                <div className="text-sm font-black text-slate-700">إدخال سعر جديد</div>
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-slate-500">السعر (ل.س لكل 1 دولار)</span>
                  <input type="number" min={0} step="any" value={rate} onChange={(e) => setRate(e.target.value)} dir="ltr"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-slate-500">ساري من تاريخ</span>
                  <DateField value={effectiveFrom} onChange={setEffectiveFrom} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-slate-500">ملاحظة</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <Button variant="primary" icon={Plus} loading={saving} onClick={save}>حفظ السعر</Button>
                <p className="text-xs text-slate-400">السجل لا يُعدَّل ولا يُحذف. لتصحيح خطأ أدخل سعراً جديداً بنفس التاريخ — يُعتمد آخر سعر مُدخل.</p>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 text-sm font-black text-slate-700 border-b border-slate-100">سجل أسعار الصرف</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-start">ساري من</th>
                    <th className="px-4 py-2 text-start">السعر</th>
                    <th className="px-4 py-2 text-start">ملاحظة</th>
                    <th className="px-4 py-2 text-start">أدخله</th>
                    <th className="px-4 py-2 text-start">وقت الإدخال</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(data?.history ?? []).map((h) => (
                    <tr key={h.id} className={data?.current?.id === h.id ? 'bg-blue-50/50' : ''}>
                      <td className="px-4 py-2 font-mono">{h.effectiveFrom}</td>
                      <td className="px-4 py-2 font-bold">{money(h.rate)} ل.س</td>
                      <td className="px-4 py-2 text-slate-600">{h.note ?? '—'}</td>
                      <td className="px-4 py-2 text-slate-600">{h.createdByName ?? '—'}</td>
                      <td className="px-4 py-2 text-slate-500">{new Date(h.createdAt).toLocaleString('ar-SY')}</td>
                    </tr>
                  ))}
                  {(data?.history ?? []).length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">لا توجد أسعار مسجلة بعد</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
