// حساب فروقات سعر الصرف (migr 493) — قراءة فقط. كل تحصيل لقسط مربوط
// بالدولار يُسدِّد القسط بقيمته الأصلية بالليرة، والفرق بين النقد المحصَّل
// والمسدَّد يُسجَّل هنا على فرع العقد. نطاق الفروع من الخادم + المرشّح الخارجي.
import { useEffect, useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { AlertTriangle, Loader2, Scale } from '../../components/ui/icons';
import PageHeader from '../../components/ui/PageHeader';
import DateField from '../../components/ui/DateField';
import { useAuthStore } from '../../hooks/useAuthStore';
import { useBranchListScope } from '../../hooks/useBranchListScope';
import { api } from '../../lib/api';

type Data = Awaited<ReturnType<typeof api.fxDifferences.list>>;

function money(n: number) {
  return Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 2 });
}

function signed(n: number) {
  const v = Number(n || 0);
  return `${v > 0 ? '+' : ''}${money(v)}`;
}

export default function FxDifferences() {
  const { user, hasPermission } = useAuthStore();
  const canView = user?.isSuperAdmin === true || hasPermission('fx_differences.view');
  const branchScope = useBranchListScope();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canView) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError('');
    api.fxDifferences.list({ branchId: branchScope.effectiveBranchId ?? null, from, to })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: any) => { if (!cancelled) setError(e?.message ?? 'فشل التحميل'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [canView, branchScope.effectiveBranchId, from, to]);

  if (!canView) return <Navigate to="/" replace />;

  return (
    <div className="p-4 sm:p-6 lg:p-8" dir="rtl">
      <PageHeader
        className="mb-6"
        title="حساب فروقات سعر الصرف"
        subtitle="الفرق بين النقد المحصَّل بسعر يوم الدفع والقيمة الأصلية بالليرة المسدَّدة على القسط، لكل فرع (فرع العقد). موجب = ربح للفرع، سالب = خسارة."
        icon={<div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center"><Scale className="w-5 h-5 text-amber-600" /></div>}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-xs font-bold text-slate-500">من تاريخ</span>
          <DateField value={from} onChange={setFrom} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-bold text-slate-500">إلى تاريخ</span>
          <DateField value={to} onChange={setTo} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        {(from || to) && (
          <button type="button" onClick={() => { setFrom(''); setTo(''); }}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50">مسح التاريخ</button>
        )}
        <span className="text-xs text-slate-400">الفرع يُحدَّد من مرشّح الفروع العام.</span>
      </div>

      {error && <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700"><AlertTriangle className="w-4 h-4" />{error}</div>}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-amber-500" /></div>
      ) : data && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className={`rounded-2xl border p-4 ${data.balanceSyp >= 0 ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
              <div className="text-xs font-bold text-slate-600">الرصيد (ضمن المرشّح)</div>
              <div className="mt-1 text-2xl font-black" dir="ltr">{signed(data.balanceSyp)} ل.س</div>
            </div>
            {data.branches.map((b) => (
              <div key={b.branchId} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-bold text-slate-600">{b.branchName ?? `فرع #${b.branchId}`}</div>
                <div className="mt-1 text-lg font-black" dir="ltr">{signed(b.balanceSyp)} ل.س</div>
                <div className="text-xs text-slate-400">{b.count} حركة · محصَّل {money(b.collectedSyp)} · مسدَّد {money(b.settledSyp)}</div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-start">التاريخ</th>
                    <th className="px-3 py-2 text-start">الفرع</th>
                    <th className="px-3 py-2 text-start">المصدر</th>
                    <th className="px-3 py-2 text-start">القسط</th>
                    <th className="px-3 py-2 text-start">سعر العقد</th>
                    <th className="px-3 py-2 text-start">سعر يوم الدفع</th>
                    <th className="px-3 py-2 text-start">دولار مسدَّد</th>
                    <th className="px-3 py-2 text-start">المحصَّل (ل.س)</th>
                    <th className="px-3 py-2 text-start">المسدَّد الأصلي (ل.س)</th>
                    <th className="px-3 py-2 text-start">الفرق</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 text-slate-600">{new Date(r.occurredAt).toLocaleDateString('ar-SY')}</td>
                      <td className="px-3 py-2">{r.branchName ?? '—'}</td>
                      <td className="px-3 py-2">
                        {r.sourceKind === 'maintenance_installment'
                          ? <span className="text-amber-700">صيانة — مهمة #{r.openTaskId ?? '—'}</span>
                          : r.contractId ? <Link className="text-blue-700 hover:underline" to={`/contracts/${r.contractId}`}>{r.contractNumber ?? `#${r.contractId}`}</Link> : '—'}
                        {r.customerName && <div className="text-xs text-slate-400">{r.customerName}</div>}
                      </td>
                      <td className="px-3 py-2">{r.installmentNumber ?? '—'}</td>
                      <td className="px-3 py-2">{money(r.contractRate)}</td>
                      <td className="px-3 py-2">{money(r.dayRate)}</td>
                      <td className="px-3 py-2" dir="ltr">${Number(r.usdSettled).toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2">{money(r.collectedSyp)}</td>
                      <td className="px-3 py-2">{money(r.settledSyp)}</td>
                      <td className={`px-3 py-2 font-bold ${r.differenceSyp >= 0 ? 'text-emerald-700' : 'text-rose-700'}`} dir="ltr">{signed(r.differenceSyp)}</td>
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-400">لا توجد فروقات مسجلة</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {data.truncated && <div className="px-4 py-2 text-xs text-amber-700 bg-amber-50">يُعرض أحدث 1000 حركة فقط — ضيّق نطاق التاريخ. الأرصدة تشمل كل الحركات ضمن المرشّح.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
