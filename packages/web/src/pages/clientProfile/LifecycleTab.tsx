// «دورة الحياة»: the client's milestones on one vertical timeline, newest
// first, grouped by year and month — from the suggested name to the latest
// emergency. Derived on the server from the table that holds each milestone;
// a category the user cannot see in its own tab is left out. Who changed the
// client's DATA is the separate «سجل التغييرات» tab. The layout is the shared
// LifecycleTimeline (also used by the device profile).
import { useEffect, useMemo, useState } from 'react';
import {
    Banknote, CalendarClock, Cpu, FileSignature, FileText, Gift, Loader2,
    MessageSquareWarning, Route, Siren, UserPlus, type LucideIcon,
} from '../../components/ui/icons';
import LifecycleTimeline, {
    LifecycleStat, formatLifecycleDate, type LifecycleCategoryMeta, type TimelineEvent,
} from '../../components/lifecycle/LifecycleTimeline';
import { api, type ClientLifecycleCategory, type ClientLifecycleEvent, type ClientLifecycleResponse } from '../../lib/api';
import { getOpenTaskDetailPath } from '../../lib/taskRoutes';
import { taskDecisionLabel } from '../../lib/taskDecisionLabels';

const CATEGORIES: Record<ClientLifecycleCategory, LifecycleCategoryMeta> = {
    entry: { label: 'الدخول', icon: UserPlus, tone: { icon: 'bg-emerald-100 text-emerald-700', chipOn: 'border-emerald-200 bg-emerald-50 text-emerald-800', pill: 'bg-emerald-50 text-emerald-700' } },
    tasks: { label: 'المهام', icon: Route, tone: { icon: 'bg-sky-100 text-sky-700', chipOn: 'border-sky-200 bg-sky-50 text-sky-800', pill: 'bg-sky-50 text-sky-700' } },
    contracts: { label: 'العقود', icon: FileSignature, tone: { icon: 'bg-violet-100 text-violet-700', chipOn: 'border-violet-200 bg-violet-50 text-violet-800', pill: 'bg-violet-50 text-violet-700' } },
    devices: { label: 'الأجهزة', icon: Cpu, tone: { icon: 'bg-indigo-100 text-indigo-700', chipOn: 'border-indigo-200 bg-indigo-50 text-indigo-800', pill: 'bg-indigo-50 text-indigo-700' } },
    money: { label: 'الدفعات', icon: Banknote, tone: { icon: 'bg-amber-100 text-amber-700', chipOn: 'border-amber-200 bg-amber-50 text-amber-800', pill: 'bg-amber-50 text-amber-700' } },
    gifts: { label: 'الهدايا', icon: Gift, tone: { icon: 'bg-pink-100 text-pink-700', chipOn: 'border-pink-200 bg-pink-50 text-pink-800', pill: 'bg-pink-50 text-pink-700' } },
    requests: { label: 'الطلبات', icon: FileText, tone: { icon: 'bg-teal-100 text-teal-700', chipOn: 'border-teal-200 bg-teal-50 text-teal-800', pill: 'bg-teal-50 text-teal-700' } },
    complaints: { label: 'الشكاوى', icon: MessageSquareWarning, tone: { icon: 'bg-rose-100 text-rose-700', chipOn: 'border-rose-200 bg-rose-50 text-rose-800', pill: 'bg-rose-50 text-rose-700' } },
};

// Emergencies stand out among the task results; a cancelled contract fades.
const KIND_OVERRIDES: Record<string, { icon: LucideIcon; tone: string }> = {
    emergency_done: { icon: Siren, tone: 'bg-rose-100 text-rose-700' },
    contract_cancelled: { icon: FileSignature, tone: 'bg-slate-100 text-slate-500' },
};

function linkTo(event: ClientLifecycleEvent): string | null {
    const l = event.link;
    if (!l) return null;
    switch (l.type) {
        case 'task': return getOpenTaskDetailPath(l.taskType ?? null, l.id);
        case 'visit': return `/field-visits/${l.id}`;
        case 'contract': return `/contracts/${l.id}`;
        case 'device': return `/installed-devices/${l.id}`;
        case 'request': return `/service-requests/${l.id}`;
        case 'complaint': return `/complaints/${l.id}`;
        default: return null;
    }
}

// A task outcome reads with the app's one decision-label table, like the task
// screens: «تسديد ذمة: رفض الزبون الدفع», never the stored code.
function toTimelineEvent(event: ClientLifecycleEvent): TimelineEvent & { link: ClientLifecycleEvent['link'] } {
    const title = event.decision
        ? `${event.title}: ${taskDecisionLabel(event.decision.code, event.decision.taskType)}`
        : event.title;
    return { ...event, title, href: linkTo(event) };
}

export default function LifecycleTab({ clientId }: { clientId: number }) {
    const [data, setData] = useState<ClientLifecycleResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setData(null);
        setError(null);
        api.clients.getLifecycle(clientId)
            .then(res => { if (!cancelled) setData(res); })
            .catch((err: any) => { if (!cancelled) setError(err?.message || 'تعذّر تحميل دورة حياة الزبون'); });
        return () => { cancelled = true; };
    }, [clientId]);

    const events = useMemo(() => (data?.events ?? []).map(toTimelineEvent), [data]);

    const summary = useMemo(() => {
        const entry = [...events].reverse().find(e => e.category === 'entry' && e.reliable) ?? events[events.length - 1];
        const devices = new Set(events.filter(e => e.category === 'devices' && e.link?.type === 'device').map(e => e.link!.id));
        return {
            since: entry ? formatLifecycleDate(entry.at) : '—',
            contracts: events.filter(e => e.kind === 'contract_signed').length,
            devices: devices.size,
            emergencies: events.filter(e => e.kind === 'emergency_done').length,
            last: events[0] ? formatLifecycleDate(events[0].at) : '—',
        };
    }, [events]);

    if (error) {
        return <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>;
    }
    if (!data) {
        return (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-10 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> جارٍ تحميل دورة الحياة…
            </div>
        );
    }

    return (
        <LifecycleTimeline
            title="دورة حياة الزبون"
            events={events}
            categories={CATEGORIES}
            hiddenCategories={data.hiddenCategories}
            kindOverrides={KIND_OVERRIDES}
            summary={(
                <>
                    <LifecycleStat icon={UserPlus} label="زبون منذ" value={summary.since} tone="bg-emerald-100 text-emerald-700" />
                    <LifecycleStat icon={FileSignature} label="العقود" value={String(summary.contracts)} tone="bg-violet-100 text-violet-700" />
                    <LifecycleStat icon={Cpu} label="الأجهزة" value={String(summary.devices)} tone="bg-indigo-100 text-indigo-700" />
                    <LifecycleStat icon={Siren} label="صيانات طارئة" value={String(summary.emergencies)} tone="bg-rose-100 text-rose-700" />
                    <LifecycleStat icon={CalendarClock} label="آخر حدث" value={summary.last} tone="bg-sky-100 text-sky-700" />
                </>
            )}
        />
    );
}
