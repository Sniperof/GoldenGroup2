import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Activity, Clock3, RefreshCw } from '../../components/ui/icons';
import AttemptAlertsCard from '../../components/supervisor/AttemptAlertsCard';
import { api } from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuthStore';
import { useBranchContextStore } from '../../hooks/useBranchContextStore';
import Button from '../../components/ui/Button';
import PageHeader from '../../components/ui/PageHeader';

type AlertResponse = Awaited<ReturnType<typeof api.fieldVisits.escalationAlerts>>;
type VisitItem = AlertResponse['items'][number];
type ScheduledItem = AlertResponse['scheduledItems'][number];

const tierLabels: Record<number, string> = {
  1: 'مرحلة 1 · متابعة الفنيين',
  2: 'مرحلة 2 · متابعة المشرف',
  3: 'مرحلة 3 · تصعيد لمدير الفرع',
};

function VisitTitle({ item, canOpen }: { item: { visitId: number; clientId: number; clientName: string | null }; canOpen: boolean }) {
  const title = `${item.clientName || `زبون #${item.clientId}`} · زيارة #${item.visitId}`;
  return canOpen
    ? <Link to={`/field-visits/${item.visitId}`} className="font-semibold text-sky-800 hover:underline">{title}</Link>
    : <span className="font-semibold text-slate-900">{title}</span>;
}

export default function SupervisorAlertsPage() {
  const userId = useAuthStore(s => s.user?.id);
  const branchId = useBranchContextStore(s => s.branchId);
  const canOpenVisits = useAuthStore(s => s.hasPermission('field_visits.view'));
  const canOpenOwnVisits = useAuthStore(s => s.hasPermission('field_visits.my_visits.view'));
  const [escalations, setEscalations] = useState<VisitItem[]>([]);
  const [scheduledAlerts, setScheduledAlerts] = useState<ScheduledItem[]>([]);
  const [visibilityScope, setVisibilityScope] = useState<AlertResponse['visibilityScope'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoaded(false);
    setVisibilityScope(null);
    setError(null);
    void api.fieldVisits.escalationAlerts().then(result => {
      if (!active) return;
      setEscalations(result.items);
      setScheduledAlerts(result.scheduledItems);
      setVisibilityScope(result.visibilityScope);
      setLoaded(true);
    }).catch((cause: Error) => {
      if (!active) return;
      setLoaded(false);
      setVisibilityScope(null);
      setError(cause.message || 'تعذر تحميل تنبيهات الزيارات');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey, branchId]);

  const myScheduled = scheduledAlerts.filter(item => item.responsibleUserId === userId);
  const branchScheduled = scheduledAlerts.filter(item => item.responsibleUserId !== userId);
  const urgentCount = escalations.filter(item => item.tiersAlerted.includes(3)).length;

  return <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
    <PageHeader
      title="تنبيهات المتابعة"
      subtitle="متابعة الزيارات والمهام ضمن نطاق صلاحيتك. ظهور التنبيه لا يعني إرسال إشعار شخصي أو إغلاق المهمة تلقائياً."
      icon={<div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-700"><AlertTriangle className="h-5 w-5" /></div>}
      actions={<Button variant="secondary" size="sm" icon={RefreshCw} loading={loading} onClick={() => setRefreshKey(key => key + 1)}>تحديث الكل</Button>}
    />
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
      <p className="font-bold">كيف تقرأ هذه اللوحة؟</p>
      <p className="mt-1">{visibilityScope === 'ASSIGNED'
        ? 'نطاقك «السجلات المسندة»: تظهر هنا تنبيهات زياراتك ومهامك فقط، ولا تظهر سجلات المشرفات الأخريات في الفرع.'
        : '«عليّ المتابعة» يعني أنك مسجّل مسؤولاً عن زيارة تجاوزت موعدها. «مراقبة الفرع» تعرض حالات بقية المسؤولين في الفرع، ولا تعني أنك المكلّف بتنفيذها.'}</p>
    </div>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">تعذر تحميل تنبيهات الزيارات: {error}. الأعداد أدناه غير متاحة الآن.</div>}
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-sky-200 bg-white p-4"><div className="text-sm text-slate-600">زيارات تجاوزت الموعد {visibilityScope === 'ASSIGNED' ? 'ضمن سجلاتي' : 'في الفرع'}</div><div className="mt-1 text-2xl font-bold text-sky-900">{loaded ? scheduledAlerts.length : '—'}</div></div>
      <div className="rounded-xl border border-orange-200 bg-white p-4"><div className="text-sm text-slate-600">زيارات بانتظار التوثيق</div><div className="mt-1 text-2xl font-bold text-orange-900">{loaded ? escalations.length : '—'}</div></div>
      <div className="rounded-xl border border-red-200 bg-white p-4"><div className="text-sm text-slate-600">وصلت إلى المرحلة الثالثة</div><div className="mt-1 text-2xl font-bold text-red-900">{loaded ? urgentCount : '—'}</div></div>
    </div>
    <section className="rounded-2xl border border-sky-200 bg-white p-4 sm:p-5" aria-labelledby="scheduled-heading">
      <div className="flex items-center gap-2 text-sky-900"><Clock3 className="h-5 w-5" /><h2 id="scheduled-heading" className="text-lg font-bold">زيارات مجدولة لم تبدأ في موعدها</h2></div>
      <p className="mt-1 text-sm text-slate-600">المسؤول المسجّل يتابع سبب التأخر وتحديث الزيارة. {visibilityScope === 'ASSIGNED' ? 'تُعرض سجلاتك فقط.' : 'بقية الحالات معروضة لمراقبة الفرع.'}</p>
      {loading && !loaded && <p className="mt-4 text-sm text-slate-500">جارٍ تحميل الزيارات…</p>}
      {loaded && scheduledAlerts.length === 0 && <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">لا توجد زيارات متأخرة عن موعد البدء ضمن نطاقك.</p>}
      {loaded && [
        { label: 'عليّ المتابعة', items: myScheduled, tone: 'bg-sky-100 text-sky-900' },
        { label: 'مراقبة الفرع', items: visibilityScope === 'ASSIGNED' ? [] : branchScheduled, tone: 'bg-slate-100 text-slate-700' },
      ].map(group => group.items.length > 0 && <div key={group.label} className="mt-4 space-y-2">
        <h3 className="text-sm font-bold text-slate-800">{group.label} ({group.items.length})</h3>
        {group.items.map(item => <div key={item.visitId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 text-sm">
          <div><VisitTitle item={item} canOpen={canOpenVisits || (canOpenOwnVisits && item.responsibleUserId === userId)} /><p className="mt-1 text-slate-600">الموعد: {item.scheduledDate} {item.scheduledTime || 'دون ساعة محددة'} · المسؤول: {item.teamResponsibleName || 'غير معيّن'}</p></div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${group.tone}`}>{group.label}</span>
        </div>)}
      </div>)}
    </section>
    <section className="rounded-2xl border border-orange-200 bg-white p-4 sm:p-5" aria-labelledby="documentation-heading">
      <div className="flex items-center gap-2 text-orange-900"><Activity className="h-5 w-5" /><h2 id="documentation-heading" className="text-lg font-bold">زيارات بدأت وتنتظر التوثيق</h2></div>
      <p className="mt-1 text-sm text-slate-600">المراحل تمثل سجل التصعيد داخل النظام: الفنيون، ثم المشرف، ثم مدير الفرع. لا يُغلق النظام الزيارة آلياً.</p>
      {loading && !loaded && <p className="mt-4 text-sm text-slate-500">جارٍ تحميل الزيارات…</p>}
      {loaded && escalations.length === 0 && <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">لا توجد زيارات في مراحل التصعيد حالياً.</p>}
      {loaded && escalations.length > 0 && <div className="mt-4 space-y-2">{escalations.map(item => {
        const highestTier = Math.max(...item.tiersAlerted);
        return <div key={item.visitId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 text-sm">
          <div><VisitTitle item={item} canOpen={canOpenVisits || (canOpenOwnVisits && item.teamResponsibleUserId === userId)} /><p className="mt-1 text-slate-600">{item.hoursSinceStart == null ? 'وقت البدء غير مسجل' : `بدأت منذ ${Math.max(0, Math.round(item.hoursSinceStart))} ساعة`} · الحالة: {item.status === 'ended' ? 'انتهت وتنتظر التوثيق' : 'قيد التنفيذ'}</p></div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${highestTier === 3 ? 'bg-red-100 text-red-900' : 'bg-orange-100 text-orange-900'}`}>{tierLabels[highestTier] ?? `مرحلة ${highestTier}`}</span>
        </div>;
      })}</div>}
    </section>
    <AttemptAlertsCard refreshKey={refreshKey} />
  </div>;
}
