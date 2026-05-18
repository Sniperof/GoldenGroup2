import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
    ArrowRight, Calendar, CheckSquare, Loader2,
    PhoneCall, Square, Target, X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { getOutcomeMeta } from '@golden-crm/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

type AssignedTask = {
    taskId: number;
    taskType: string;
    taskTypeLabel: string;
    status: string;
    dueDate: string | null;
    expectedDate: string | null;
    excludedForDate: string | null;
    excludedReason: string | null;
    attemptCount: number;
};

type ClientRow = {
    clientId: number;
    clientName: string;
    primaryPhone: string | null;
    candidateStatus: string | null;
    stationName: string | null;
    tasks: AssignedTask[];
    assignedCount: number;
    excludedCount: number;
    // dashboard
    taskPhase: string;
    contactTargetStatus: string | null;
    taskListItemStatus: string | null;
    latestCallOutcome: string | null;
    appointmentDate: string | null;
    appointmentTime: string | null;
    attemptCount: number;
};

type Summary = {
    assigned: number;
    inList: number;
    booked: number;
    closed: number;
    excluded: number;
};

type DashboardResponse = {
    teamKey: string;
    date: string;
    clients: ClientRow[];
    summary: Summary;
};

// ─── Phase metadata ───────────────────────────────────────────────────────────

type Phase = 'assigned' | 'in_list' | 'booked' | 'closed' | 'excluded';

function getPhase(c: ClientRow, today: string): Phase {
    if (c.assignedCount === 0 && c.excludedCount > 0 && !['in_scheduling','scheduled','waiting_execution','in_execution','ended','completed','closed'].includes(c.taskPhase))
        return 'excluded';
    if (['completed','closed'].includes(c.taskPhase)) return 'closed';
    if (['scheduled','waiting_execution','in_execution','ended'].includes(c.taskPhase)) return 'booked';
    if (c.taskPhase === 'in_scheduling') return 'in_list';
    return 'assigned';
}

const PHASE_META: Record<Phase, { label: string; dot: string; badge: string }> = {
    assigned:  { label: 'مسندة',          dot: 'bg-amber-400',   badge: 'border-amber-200 bg-amber-50 text-amber-700' },
    in_list:   { label: 'في القائمة',      dot: 'bg-sky-500',     badge: 'border-sky-200 bg-sky-50 text-sky-700' },
    booked:    { label: 'محجوز',           dot: 'bg-emerald-500', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    closed:    { label: 'مغلق',            dot: 'bg-slate-400',   badge: 'border-slate-200 bg-slate-100 text-slate-600' },
    excluded:  { label: 'مستثناة',         dot: 'bg-red-400',     badge: 'border-red-200 bg-red-50 text-red-600' },
};

const CT_LABELS: Record<string, string> = {
    new: 'جديدة', queued: 'في القائمة', contacted: 'تم التواصل', closed: 'مغلقة',
};
const TLI_LABELS: Record<string, string> = {
    pending: 'بانتظار الاتصال', called: 'تم الاتصال', booked: 'محجوز',
};

function classificationLabel(s: string | null) {
    if (s === 'OP') return 'OP';
    if (s === 'FOP') return 'FOP';
    return 'Lead';
}
function classificationColor(s: string | null) {
    if (s === 'FOP') return 'border-violet-200 bg-violet-50 text-violet-700';
    if (s === 'OP')  return 'border-indigo-200 bg-indigo-50 text-indigo-700';
    return 'border-sky-200 bg-sky-50 text-sky-700';
}

const getToday = () => new Date().toISOString().split('T')[0];

// ─── Task Modal ───────────────────────────────────────────────────────────────

function TaskModal({ client, today, onClose, onSave, saving }: {
    client: ClientRow;
    today: string;
    onClose: () => void;
    onSave: (excludeIds: number[], restoreIds: number[]) => Promise<void>;
    saving: boolean;
}) {
    const phase = getPhase(client, today);
    const canEdit = phase === 'assigned' || phase === 'excluded';

    const [keepSet, setKeepSet] = useState<Set<number>>(() => {
        const s = new Set<number>();
        client.tasks.forEach(t => { if (t.status === 'assigned') s.add(t.taskId); });
        return s;
    });

    const editableTasks = client.tasks.filter(t =>
        t.status === 'assigned' || t.excludedForDate === today
    );
    const allIds = editableTasks.map(t => t.taskId);
    const allKept = allIds.length > 0 && allIds.every(id => keepSet.has(id));

    const handleSave = async () => {
        const excludeIds = editableTasks
            .filter(t => t.status === 'assigned' && !keepSet.has(t.taskId))
            .map(t => t.taskId);
        const restoreIds = editableTasks
            .filter(t => t.status !== 'assigned' && keepSet.has(t.taskId))
            .map(t => t.taskId);
        await onSave(excludeIds, restoreIds);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">

                <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                    <div>
                        <p className="text-xs text-slate-500 mb-0.5">مهام جهة الاتصال</p>
                        <h3 className="font-bold text-slate-900">{client.clientName}</h3>
                        {client.primaryPhone && <p className="text-xs font-mono text-slate-500 mt-0.5">{client.primaryPhone}</p>}
                    </div>
                    <button onClick={onClose} className="mt-0.5 rounded-lg p-1 text-slate-400 hover:bg-slate-100">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Appointment info if exists */}
                {client.appointmentDate && (
                    <div className="mx-5 mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
                        <Calendar className="h-4 w-4" />
                        موعد محجوز: {client.appointmentDate} {client.appointmentTime && `— ${client.appointmentTime}`}
                    </div>
                )}

                {/* Bulk toggle — only shown when editable */}
                {canEdit && editableTasks.length > 0 && (
                    <div className="border-b border-slate-100 bg-slate-50 px-5 py-2.5">
                        <button type="button"
                            onClick={() => setKeepSet(allKept ? new Set() : new Set(allIds))}
                            className="flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-slate-900">
                            {allKept
                                ? <CheckSquare className="h-4 w-4 text-emerald-600" />
                                : <Square className="h-4 w-4 text-slate-400" />}
                            {allKept ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
                        </button>
                    </div>
                )}

                <div className="max-h-72 overflow-y-auto custom-scroll px-5 py-3 space-y-2">
                    {client.tasks.map(task => {
                        const isEditable = task.status === 'assigned' || task.excludedForDate === today;
                        const kept = keepSet.has(task.taskId);
                        const isExcluded = task.status !== 'assigned' && task.excludedForDate === today;

                        return (
                            <button key={task.taskId} type="button"
                                disabled={!canEdit || !isEditable}
                                onClick={() => isEditable && setKeepSet(prev => {
                                    const s = new Set(prev);
                                    kept ? s.delete(task.taskId) : s.add(task.taskId);
                                    return s;
                                })}
                                className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-right transition-colors
                                    ${!isEditable ? 'border-slate-100 bg-white cursor-default'
                                    : isExcluded ? 'border-slate-200 bg-slate-50 opacity-70'
                                    : kept ? 'border-emerald-200 bg-emerald-50 cursor-pointer'
                                    : 'border-red-200 bg-red-50 cursor-pointer'}`}>
                                {isEditable
                                    ? kept ? <CheckSquare className="h-4 w-4 flex-shrink-0 text-emerald-600" />
                                           : <Square className="h-4 w-4 flex-shrink-0 text-slate-400" />
                                    : <span className={`h-2 w-2 rounded-full flex-shrink-0 mt-1 ${PHASE_META[getPhase(client, today)].dot}`} />}
                                <div className="flex-1 min-w-0 text-right">
                                    <p className="font-bold text-sm text-slate-800">{task.taskTypeLabel}</p>
                                    {task.dueDate && <p className="text-xs text-slate-500 mt-0.5">استحقاق: {task.dueDate}</p>}
                                    {task.expectedDate && <p className="text-xs text-slate-500 mt-0.5">متوقع: {task.expectedDate}</p>}
                                </div>
                                <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold
                                    ${task.status === 'assigned' ? 'border-amber-200 bg-amber-50 text-amber-700'
                                    : task.status === 'in_scheduling' ? 'border-sky-200 bg-sky-50 text-sky-700'
                                    : task.status === 'scheduled' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : isExcluded ? 'border-red-200 bg-red-50 text-red-600'
                                    : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                                    {task.status === 'assigned' ? 'مسندة'
                                    : task.status === 'in_scheduling' ? 'قيد الجدولة'
                                    : task.status === 'scheduled' ? 'مجدولة'
                                    : isExcluded ? 'مستثناة'
                                    : task.status}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className="flex gap-3 border-t border-slate-100 px-5 py-4">
                    <button type="button" onClick={onClose}
                        className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">
                        إغلاق
                    </button>
                    {canEdit && editableTasks.length > 0 && (
                        <button type="button" onClick={handleSave} disabled={saving}
                            className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-60">
                            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                            حفظ
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function PlanningContactTargets() {
    const navigate = useNavigate();
    const { teamKey = '' } = useParams();
    const [searchParams] = useSearchParams();
    const date = searchParams.get('date') || getToday();
    const teamLabel = searchParams.get('label') || teamKey;
    const today = getToday();

    const [data, setData] = useState<DashboardResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [savingId, setSavingId] = useState<number | null>(null);
    const [modalClient, setModalClient] = useState<ClientRow | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);
    const [phaseFilter, setPhaseFilter] = useState<Phase | 'all'>('all');

    const loadData = useCallback(async () => {
        setLoading(true);
        setLoadError(false);
        try {
            setData(await api.planning.assignedTasks(date, teamKey));
        } catch {
            setLoadError(true);
        } finally {
            setLoading(false);
        }
    }, [date, teamKey]);

    useEffect(() => { loadData(); }, [loadData]);

    const handleRowToggle = async (client: ClientRow) => {
        setSavingId(client.clientId);
        try {
            if (client.assignedCount > 0) {
                const ids = client.tasks.filter(t => t.status === 'assigned').map(t => t.taskId);
                if (ids.length) await api.openTasks.bulkExclude(ids);
            } else {
                const ids = client.tasks.filter(t => t.excludedForDate === date).map(t => t.taskId);
                if (ids.length) await api.openTasks.bulkRestore(ids);
            }
            await loadData();
        } finally {
            setSavingId(null);
        }
    };

    const handleModalSave = async (excludeIds: number[], restoreIds: number[]) => {
        if (!modalClient) return;
        setSavingId(modalClient.clientId);
        try {
            if (excludeIds.length) await api.openTasks.bulkExclude(excludeIds);
            if (restoreIds.length) await api.openTasks.bulkRestore(restoreIds);
            setModalClient(null);
            await loadData();
        } finally {
            setSavingId(null);
        }
    };

    const handleGenerate = async () => {
        setGenerating(true);
        setMessage(null);
        try {
            const result = await api.telemarketing.generateTaskListFromPlan({ date, teamKey });
            const added = result?.counts?.added ?? 0;
            const updated = result?.counts?.updated ?? 0;
            const skipped = result?.counts?.skipped ?? 0;
            setMessage({
                type: skipped > 0 ? 'warning' : 'success',
                text: `تم توليد قائمة الاتصال — ${added} مضاف، ${updated} محدَّث${skipped > 0 ? `، ${skipped} مستبعد` : ''}.`,
            });
            await loadData();
        } catch (err: any) {
            setMessage({ type: 'error', text: err?.message || 'تعذر توليد قائمة الاتصال' });
        } finally {
            setGenerating(false);
        }
    };

    const allClients = data?.clients ?? [];
    const summary = data?.summary;
    const hasAssigned = (summary?.assigned ?? 0) > 0;

    const filteredClients = phaseFilter === 'all'
        ? allClients
        : allClients.filter(c => getPhase(c, today) === phaseFilter);

    const tabs: { key: Phase | 'all'; label: string; count: number }[] = [
        { key: 'all',      label: 'الكل',           count: allClients.length },
        { key: 'assigned', label: 'مسندة',           count: summary?.assigned ?? 0 },
        { key: 'in_list',  label: 'في القائمة',      count: summary?.inList ?? 0 },
        { key: 'booked',   label: 'محجوز',           count: summary?.booked ?? 0 },
        { key: 'closed',   label: 'مغلق',            count: summary?.closed ?? 0 },
        { key: 'excluded', label: 'مستثناة',         count: summary?.excluded ?? 0 },
    ];

    return (
        <div className="h-full overflow-y-auto p-6 custom-scroll">

            {/* Back */}
            <button type="button" onClick={() => navigate('/planning/overview')}
                className="mb-4 inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-sky-600">
                <ArrowRight className="h-4 w-4" />العودة إلى ملخص الخطة
            </button>

            {/* Header */}
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                        <Target className="h-5 w-5 text-sky-600" />
                        داشبورد جهات الاتصال — {teamLabel}
                    </h1>
                    <p className="mt-1 text-sm text-slate-500">{date} · تتبع كامل من الإسناد حتى الإغلاق</p>
                </div>
                <button type="button"
                    disabled={generating || loading || !hasAssigned}
                    onClick={handleGenerate}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-500 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none">
                    {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                    {generating ? 'جاري التوليد...' : 'توليد قائمة الاتصال'}
                </button>
            </div>

            {/* Message */}
            {message && (
                <div className={`mb-4 rounded-xl border px-4 py-3 text-sm font-bold
                    ${message.type === 'success' ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                    : message.type === 'warning' ? 'border-amber-100 bg-amber-50 text-amber-700'
                    : 'border-red-100 bg-red-50 text-red-700'}`}>
                    {message.text}
                </div>
            )}

            {/* Phase filter tabs */}
            {!loading && allClients.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-1.5">
                    {tabs.map(tab => (
                        <button key={tab.key} type="button"
                            onClick={() => setPhaseFilter(tab.key)}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors
                                ${phaseFilter === tab.key
                                    ? 'border-indigo-500 bg-indigo-600 text-white shadow-sm'
                                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                            {tab.label}
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold
                                ${phaseFilter === tab.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                {tab.count}
                            </span>
                        </button>
                    ))}
                </div>
            )}

            {/* Table */}
            {loading ? (
                <div className="flex items-center justify-center gap-2 rounded-xl border bg-white py-16 text-sm font-bold text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> جاري التحميل...
                </div>
            ) : loadError ? (
                <div className="rounded-xl border border-red-100 bg-red-50 py-12 text-center text-sm font-bold text-red-700">
                    تعذر تحميل البيانات
                </div>
            ) : allClients.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-sm font-bold text-slate-500">
                    لا توجد جهات اتصال لهذا الفريق اليوم — احفظ نطاق العمل أولاً
                </div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="overflow-x-auto custom-scroll">
                        <table className="w-full min-w-[1080px] border-collapse text-sm">
                            <thead className="bg-slate-50 text-xs font-bold text-slate-500 border-b border-slate-200">
                                <tr>
                                    <th className="w-10 px-3 py-3 text-center" />
                                    <th className="px-4 py-3 text-right">المعرف</th>
                                    <th className="px-4 py-3 text-right">الزبون</th>
                                    <th className="px-4 py-3 text-right">الهاتف</th>
                                    <th className="px-4 py-3 text-right">التصنيف</th>
                                    <th className="px-4 py-3 text-right">المحطة</th>
                                    <th className="px-4 py-3 text-center">المهام</th>
                                    <th className="px-4 py-3 text-right">مرحلة المهمة</th>
                                    <th className="px-4 py-3 text-right">حالة جهة الاتصال</th>
                                    <th className="px-4 py-3 text-right">آخر نتيجة اتصال</th>
                                    <th className="px-4 py-3 text-right">الموعد</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredClients.map(client => {
                                    const phase = getPhase(client, today);
                                    const pm = PHASE_META[phase];
                                    const isSaving = savingId === client.clientId;
                                    const canToggle = phase === 'assigned' || phase === 'excluded';
                                    const outcomeMeta = client.latestCallOutcome ? getOutcomeMeta(client.latestCallOutcome) : null;

                                    return (
                                        <tr key={client.clientId}
                                            onClick={() => setModalClient(client)}
                                            className={`cursor-pointer transition-colors hover:bg-sky-50/60
                                                ${phase === 'closed' ? 'opacity-60 bg-slate-50/50' : ''}
                                                ${phase === 'excluded' ? 'opacity-55 bg-red-50/30' : ''}`}>

                                            {/* Checkbox — only actionable when assigned/excluded */}
                                            <td className="px-3 py-3 text-center"
                                                onClick={e => { e.stopPropagation(); if (canToggle && !isSaving) handleRowToggle(client); }}>
                                                {isSaving
                                                    ? <Loader2 className="h-4 w-4 animate-spin text-indigo-500 mx-auto" />
                                                    : !canToggle
                                                        ? <span className={`inline-block h-2.5 w-2.5 rounded-full ${pm.dot}`} />
                                                        : phase === 'excluded'
                                                            ? <Square className="h-4 w-4 text-red-400 mx-auto hover:text-red-600" />
                                                            : <CheckSquare className="h-4 w-4 text-emerald-600 mx-auto hover:text-red-400" />}
                                            </td>

                                            <td className="px-4 py-3 font-mono text-xs text-slate-400">#{client.clientId}</td>

                                            <td className="px-4 py-3 font-bold text-slate-800">{client.clientName}</td>

                                            <td className="px-4 py-3 font-mono text-sm text-slate-600" dir="ltr">
                                                {client.primaryPhone || <span className="text-slate-300">—</span>}
                                            </td>

                                            <td className="px-4 py-3">
                                                <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-bold ${classificationColor(client.candidateStatus)}`}>
                                                    {classificationLabel(client.candidateStatus)}
                                                </span>
                                            </td>

                                            <td className="px-4 py-3 text-sm text-slate-600">
                                                {client.stationName || <span className="text-slate-300">—</span>}
                                            </td>

                                            {/* Task count badge */}
                                            <td className="px-4 py-3 text-center">
                                                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${pm.badge}`}>
                                                    {client.tasks.length}
                                                    {client.excludedCount > 0 && (
                                                        <span className="text-red-400 text-[10px]">/{client.excludedCount}✗</span>
                                                    )}
                                                </span>
                                            </td>

                                            {/* Task phase */}
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${pm.badge}`}>
                                                    <span className={`h-1.5 w-1.5 rounded-full ${pm.dot}`} />
                                                    {pm.label}
                                                </span>
                                            </td>

                                            {/* Contact target status */}
                                            <td className="px-4 py-3 text-xs text-slate-600">
                                                {client.contactTargetStatus
                                                    ? <span>{CT_LABELS[client.contactTargetStatus] || client.contactTargetStatus}</span>
                                                    : client.taskListItemStatus
                                                        ? <span className="text-slate-500">{TLI_LABELS[client.taskListItemStatus] || client.taskListItemStatus}</span>
                                                        : <span className="text-slate-300">—</span>}
                                            </td>

                                            {/* Latest call outcome */}
                                            <td className="px-4 py-3 text-xs">
                                                {outcomeMeta
                                                    ? <span className={outcomeMeta.closesContactTarget ? 'font-bold text-emerald-700' : 'text-slate-600'}>
                                                        {outcomeMeta.label}
                                                      </span>
                                                    : <span className="text-slate-300">—</span>}
                                            </td>

                                            {/* Appointment */}
                                            <td className="px-4 py-3 text-xs text-slate-600">
                                                {client.appointmentDate
                                                    ? <span className="font-bold text-emerald-700">
                                                        {client.appointmentDate} {client.appointmentTime && `· ${client.appointmentTime}`}
                                                      </span>
                                                    : <span className="text-slate-300">—</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-400">
                        اضغط على أي سطر للتفاصيل · الـ checkbox يعمل على المسندة والمستثناة فقط
                    </div>
                </div>
            )}

            {/* Modal */}
            {modalClient && (
                <TaskModal client={modalClient} today={today}
                    onClose={() => setModalClient(null)}
                    onSave={handleModalSave}
                    saving={savingId === modalClient.clientId} />
            )}
        </div>
    );
}
