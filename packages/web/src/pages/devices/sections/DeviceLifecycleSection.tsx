// «دورة الحياة»: the device's milestones on one timeline — creation, contract,
// task outcomes, status moves no task explains (suspension, manual edit),
// warranties and possession. Derived on the server (deviceLifecycleTimeline);
// a category the user cannot see in its own section is left out. Who changed
// which field is the «سجل التغييرات» section.
import { useEffect, useMemo, useState } from 'react';
import {
  Activity, Award, CalendarClock, FileSignature, Loader2, PackagePlus, Route, Siren, UserCheck, type LucideIcon,
} from '../../../components/ui/icons';
import LifecycleTimeline, {
  LifecycleStat, formatLifecycleDate, type LifecycleCategoryMeta, type TimelineEvent,
} from '../../../components/lifecycle/LifecycleTimeline';
import { api, type DeviceLifecycleCategory, type DeviceLifecycleEvent, type DeviceLifecycleResponse } from '../../../lib/api';
import { getOpenTaskDetailPath } from '../../../lib/taskRoutes';
import { taskDecisionLabel } from '../../../lib/taskDecisionLabels';

const CATEGORIES: Record<DeviceLifecycleCategory, LifecycleCategoryMeta> = {
  entry: { label: 'الإنشاء', icon: PackagePlus, tone: { icon: 'bg-emerald-100 text-emerald-700', chipOn: 'border-emerald-200 bg-emerald-50 text-emerald-800', pill: 'bg-emerald-50 text-emerald-700' } },
  status: { label: 'الحالة', icon: Activity, tone: { icon: 'bg-indigo-100 text-indigo-700', chipOn: 'border-indigo-200 bg-indigo-50 text-indigo-800', pill: 'bg-indigo-50 text-indigo-700' } },
  tasks: { label: 'المهام', icon: Route, tone: { icon: 'bg-sky-100 text-sky-700', chipOn: 'border-sky-200 bg-sky-50 text-sky-800', pill: 'bg-sky-50 text-sky-700' } },
  contract: { label: 'العقد', icon: FileSignature, tone: { icon: 'bg-violet-100 text-violet-700', chipOn: 'border-violet-200 bg-violet-50 text-violet-800', pill: 'bg-violet-50 text-violet-700' } },
  warranties: { label: 'الكفالات', icon: Award, tone: { icon: 'bg-amber-100 text-amber-700', chipOn: 'border-amber-200 bg-amber-50 text-amber-800', pill: 'bg-amber-50 text-amber-700' } },
  possession: { label: 'الحيازة', icon: UserCheck, tone: { icon: 'bg-teal-100 text-teal-700', chipOn: 'border-teal-200 bg-teal-50 text-teal-800', pill: 'bg-teal-50 text-teal-700' } },
};

// Emergencies stand out; a cancelled contract or warranty fades.
const KIND_OVERRIDES: Record<string, { icon: LucideIcon; tone: string }> = {
  emergency_done: { icon: Siren, tone: 'bg-rose-100 text-rose-700' },
  contract_cancelled: { icon: FileSignature, tone: 'bg-slate-100 text-slate-500' },
  warranty_cancelled: { icon: Award, tone: 'bg-slate-100 text-slate-500' },
  warranty_expired: { icon: Award, tone: 'bg-slate-100 text-slate-500' },
};

function linkTo(event: DeviceLifecycleEvent): string | null {
  const l = event.link;
  if (!l) return null;
  switch (l.type) {
    case 'task': return getOpenTaskDetailPath(l.taskType ?? null, l.id);
    case 'visit': return `/field-visits/${l.id}`;
    case 'contract': return `/contracts/${l.id}`;
    case 'client': return `/clients/${l.id}`;
    default: return null;
  }
}

function toTimelineEvent(event: DeviceLifecycleEvent): TimelineEvent {
  const title = event.decision
    ? `${event.title}: ${taskDecisionLabel(event.decision.code, event.decision.taskType)}`
    : event.title;
  return { ...event, title, href: linkTo(event) };
}

export function DeviceLifecycleSection({ deviceId }: { deviceId: number }) {
  const [data, setData] = useState<DeviceLifecycleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api.installedDevices.getLifecycle(deviceId)
      .then(res => { if (!cancelled) setData(res); })
      .catch((err: any) => { if (!cancelled) setError(err?.message || 'تعذّر تحميل دورة حياة الجهاز'); });
    return () => { cancelled = true; };
  }, [deviceId]);

  const events = useMemo(() => (data?.events ?? []).map(toTimelineEvent), [data]);

  const summary = useMemo(() => {
    const created = events.find(e => e.kind === 'device_created');
    return {
      since: created ? formatLifecycleDate(created.at) : '—',
      results: events.filter(e => e.kind === 'task_result' || e.kind === 'emergency_done').length,
      emergencies: events.filter(e => e.kind === 'emergency_done').length,
      last: events[0] ? formatLifecycleDate(events[0].at) : '—',
    };
  }, [events]);

  return (
    <section id="lifecycle" className="scroll-mt-16">
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>
      ) : !data ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-10 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> جارٍ تحميل دورة الحياة…
        </div>
      ) : (
        <LifecycleTimeline
          title="دورة حياة الجهاز"
          events={events}
          categories={CATEGORIES}
          hiddenCategories={data.hiddenCategories}
          kindOverrides={KIND_OVERRIDES}
          summary={(
            <>
              <LifecycleStat icon={PackagePlus} label="في النظام منذ" value={summary.since} tone="bg-emerald-100 text-emerald-700" />
              <LifecycleStat icon={Route} label="نتائج المهام" value={String(summary.results)} tone="bg-sky-100 text-sky-700" />
              <LifecycleStat icon={Siren} label="صيانات طارئة" value={String(summary.emergencies)} tone="bg-rose-100 text-rose-700" />
              <LifecycleStat icon={CalendarClock} label="آخر حدث" value={summary.last} tone="bg-indigo-100 text-indigo-700" />
            </>
          )}
        />
      )}
    </section>
  );
}
