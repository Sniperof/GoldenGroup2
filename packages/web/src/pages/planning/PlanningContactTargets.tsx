import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
    ArrowRight, Calendar, CheckSquare, ChevronRight,
    Info, Loader2, PhoneCall, RotateCcw, Square,
    Target, Users, X, Zap,
} from 'lucide-react';
import { api } from '../../lib/api';
import { getOutcomeMeta } from '@golden-crm/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

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
    completed: number;
    closed: number;
    excluded: number;
};

type DashboardResponse = {
    teamKey: string;
    date: string;
    taskListGenerated: boolean;
    taskListGeneratedAt: string | null;
    newEligibleCount: number;
    clients: ClientRow[];
    summary: Summary;
};

// ─── Phase helpers ────────────────────────────────────────────────────────────

type Phase = 'assigned' | 'in_list' | 'booked' | 'completed' | 'closed' | 'excluded';

function getPhase(c: ClientRow, today: string): Phase {
    if (
        c.assignedCount === 0 && c.excludedCount > 0 &&
        !['in_scheduling','scheduled','waiting_execution','in_execution','ended','completed','closed'].includes(c.taskPhase)
    ) return 'excluded';
    if (c.taskPhase === 'closed') return 'closed';
    if (c.taskPhase === 'completed') return 'completed';
    if (['scheduled','waiting_execution','in_execution','ended'].includes(c.taskPhase)) return 'booked';
    if (c.taskPhase === 'in_scheduling') return 'in_list';
    return 'assigned';
}

type PhaseMeta = { label: string; icon: string; dot: string; badge: string; row: string };
const PHASE_META: Record<Phase, PhaseMeta> = {
    assigned: { label: 'جاهزة',        icon: '⏳', dot: 'bg-amber-400',   badge: 'border-amber-200 bg-amber-50 text-amber-700',     row: '' },
    in_list:  { label: 'في القائمة',   icon: '📋', dot: 'bg-sky-500',     badge: 'border-sky-200 bg-sky-50 text-sky-700',           row: 'bg-sky-50/30' },
    booked:   { label: 'موعد محجوز',   icon: '📅', dot: 'bg-emerald-500', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700', row: 'bg-emerald-50/20' },
    completed:{ label: 'مكتملة',       icon: '✓',  dot: 'bg-lime-500',    badge: 'border-lime-200 bg-lime-50 text-lime-700',         row: 'bg-lime-50/20' },
    closed:   { label: 'مُقفلة',       icon: '🔒', dot: 'bg-slate-400',   badge: 'border-slate-200 bg-slate-100 text-slate-500',     row: 'opacity-60' },
    excluded: { label: 'مستثناة',      icon: '✗',  dot: 'bg-red-400',     badge: 'border-red-200 bg-red-50 text-red-600',           row: 'opacity-50 bg-red-50/20' },
};

const CT_LABELS: Record<string, string> = {
    new: 'جديدة', queued: 'ضمن القائمة', contacted: 'تم التواصل', closed: 'مغلقة',
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

function formatGeneratedAt(value: string | null) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('ar-SY', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

// ─── Task Modal ───────────────────────────────────────────────────────────────

function TaskModal({ client, today, onClose, onSave, saving }: {
    client: ClientRow; today: string; onClose: () => void;
    onSave: (excludeIds: number[], restoreIds: number[]) => Promise<void>;
    saving: boolean;
}) {
    const phase = getPhase(client, today);
    const pm = PHASE_META[phase];
    const canEdit = phase === 'assigned' || phase === 'excluded';

    const [keepSet, setKeepSet] = useState<Set<number>>(() => {
        const s = new Set<number>();
        client.tasks.forEach(t => { if (t.status === 'assigned') s.add(t.taskId); });
        return s;
    });

    const editableTasks = client.tasks.filter(t => t.status === 'assigned' || t.excludedForDate === today);
    const allIds = editableTasks.map(t => t.taskId);
    const allKept = allIds.length > 0 && allIds.every(id => keepSet.has(id));

    const handleSave = async () => {
        const excludeIds = editableTasks.filter(t => t.status === 'assigned' && !keepSet.has(t.taskId)).map(t => t.taskId);
        const restoreIds = editableTasks.filter(t => t.status !== 'assigned' && keepSet.has(t.taskId)).map(t => t.taskId);
        await onSave(excludeIds, restoreIds);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden" dir="rtl">

                {/* Header */}
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                    <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${pm.badge}`}>
                            <span className="text-sm">{pm.icon}</span>
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900">{client.clientName}</h3>
                            <div className="flex items-center gap-2 mt-0.5">
                                {client.primaryPhone && <span className="text-xs font-mono text-slate-500" dir="ltr">{client.primaryPhone}</span>}
                                <span className={`text-[10px] font-bold rounded-full border px-1.5 py-0.5 ${pm.badge}`}>{pm.label}</span>
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className="mt-0.5 rounded-lg p-1 text-slate-400 hover:bg-slate-100">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Appointment banner */}
                {client.appointmentDate && (
                    <div className="mx-5 mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-bold text-emerald-700">
                        <Calendar className="h-4 w-4 shrink-0" />
                        موعد: {client.appointmentDate}{client.appointmentTime && ` الساعة ${client.appointmentTime}`}
                    </div>
                )}

                {/* Editable hint */}
                {canEdit && editableTasks.length > 0 && (
                    <div className="mx-5 mt-3 flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>المهام المحددة ستُدرج في قائمة الاتصال عند التوليد — قم بإلغاء التحديد لاستثناء أي مهمة.</span>
                    </div>
                )}

                {/* Bulk toggle */}
                {canEdit && editableTasks.length > 1 && (
                    <div className="border-b border-slate-100 bg-slate-50 px-5 py-2.5 mt-2">
                        <button type="button"
                            onClick={() => setKeepSet(allKept ? new Set() : new Set(allIds))}
                            className="flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-900">
                            {allKept ? <CheckSquare className="h-4 w-4 text-emerald-600" /> : <Square className="h-4 w-4 text-slate-400" />}
                            {allKept ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
                        </button>
                    </div>
                )}

                {/* Tasks */}
                <div className="max-h-64 overflow-y-auto custom-scroll px-5 py-3 space-y-2">
                    {client.tasks.map(task => {
                        const isEditable = task.status === 'assigned' || task.excludedForDate === today;
                        const kept = keepSet.has(task.taskId);
                        const isExcluded = task.status !== 'assigned' && task.excludedForDate === today;
                        const isReturning = task.attemptCount > 0 && task.status === 'assigned';

                        return (
                            <button key={task.taskId} type="button"
                                disabled={!canEdit || !isEditable}
                                onClick={() => isEditable && setKeepSet(prev => {
                                    const s = new Set(prev);
                                    kept ? s.delete(task.taskId) : s.add(task.taskId);
                                    return s;
                                })}
                                className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-right transition-all
                                    ${!isEditable ? 'border-slate-100 bg-white cursor-default opacity-60'
                                    : isExcluded  ? 'border-slate-200 bg-slate-50 hover:border-amber-300'
                                    : kept        ? 'border-emerald-200 bg-emerald-50 hover:border-red-300 cursor-pointer'
                                    :               'border-red-200 bg-red-50 hover:border-emerald-300 cursor-pointer'}`}>
                                {isEditable
                                    ? (kept
                                        ? <CheckSquare className="h-4 w-4 shrink-0 text-emerald-600" />
                                        : <Square className="h-4 w-4 shrink-0 text-slate-400" />)
                                    : <span className={`h-2 w-2 rounded-full shrink-0 mt-1 ${PHASE_META[getPhase(client, today)].dot}`} />}
                                <div className="flex-1 min-w-0 text-right">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className="font-bold text-sm text-slate-800">{task.taskTypeLabel}</p>
                                        {isReturning && (
                                            <span className="text-[9px] font-bold bg-orange-100 text-orange-600 border border-orange-200 px-1.5 py-0.5 rounded-full">
                                                عودة · {task.attemptCount} محاولة
                                            </span>
                                        )}
                                    </div>
                                    {task.dueDate && <p className="text-xs text-slate-500 mt-0.5">استحقاق: {task.dueDate}</p>}
                                </div>
                                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold
                                    ${task.status === 'assigned'      ? 'border-amber-200 bg-amber-50 text-amber-700'
                                    : task.status === 'in_scheduling' ? 'border-sky-200 bg-sky-50 text-sky-700'
                                    : task.status === 'scheduled'     ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : isExcluded                      ? 'border-red-200 bg-red-50 text-red-600'
                                    :                                   'border-slate-200 bg-slate-50 text-slate-500'}`}>
                                    {task.status === 'assigned'      ? 'جاهزة'
                                    : task.status === 'in_scheduling' ? 'قيد الجدولة'
                                    : task.status === 'scheduled'     ? 'مجدولة'
                                    : isExcluded                      ? 'مستثناة'
                                    : task.status}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Footer */}
                <div className="flex gap-3 border-t border-slate-100 px-5 py-4">
                    <button type="button" onClick={onClose}
                        className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">
                        إغلاق
                    </button>
                    {canEdit && editableTasks.length > 0 && (
                        <button type="button" onClick={handleSave} disabled={saving}
                            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-60">
                            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                            حفظ
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ phase, count, active, onClick }: {
    phase: Phase | 'all'; count: number; active: boolean; onClick: () => void;
}) {
    if (phase === 'all') {
        return (
            <button type="button" onClick={onClick}
                className={`flex flex-col items-center gap-1 rounded-xl border px-4 py-3 min-w-[72px] transition-all ${
                    active ? 'border-slate-700 bg-slate-800 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}>
                <span className="text-xl font-black">{count}</span>
                <span className="text-[10px] font-bold">المعروض</span>
            </button>
        );
    }
    const pm = PHASE_META[phase as Phase];
    return (
        <button type="button" onClick={onClick}
            className={`flex flex-col items-center gap-1 rounded-xl border px-4 py-3 min-w-[72px] transition-all ${
                active ? `${pm.badge} shadow-sm ring-2 ring-offset-1 ring-current/20` : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}>
            <span className="text-xl font-black">{count}</span>
            <div className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${active ? pm.dot : 'bg-slate-300'}`} />
                <span className="text-[10px] font-bold">{pm.label}</span>
            </div>
        </button>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

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
            const added   = result?.counts?.added   ?? 0;
            const updated = result?.counts?.updated ?? 0;
            const skipped = result?.counts?.skipped ?? 0;
            setMessage({
                type: skipped > 0 ? 'warning' : 'success',
                text: `تم توليد قائمة الاتصال وتثبيتها — ${added} مضاف، ${updated} محدَّث${skipped > 0 ? `، ${skipped} مستبعد` : ''}.`,
            });
            setPhaseFilter('in_list');
            await loadData(); // reload to switch to post-generation mode
        } catch (err: any) {
            setMessage({ type: 'error', text: err?.message || 'تعذر توليد قائمة الاتصال' });
        } finally {
            setGenerating(false);
        }
    };

    const allClients       = data?.clients ?? [];
    const summary          = data?.summary;
    const assignedCount    = summary?.assigned ?? 0;
    const taskListGenerated = data?.taskListGenerated ?? false;
    const taskListGeneratedAt = formatGeneratedAt(data?.taskListGeneratedAt ?? null);
    const newEligibleCount = data?.newEligibleCount ?? 0;

    const filteredClients = phaseFilter === 'all'
        ? allClients
        : allClients.filter(c => getPhase(c, today) === phaseFilter);

    const tabs: { key: Phase | 'all'; count: number }[] = [
        { key: 'all',      count: allClients.length },
        { key: 'assigned', count: assignedCount },
        { key: 'in_list',  count: summary?.inList   ?? 0 },
        { key: 'booked',   count: summary?.booked   ?? 0 },
        { key: 'completed', count: summary?.completed ?? 0 },
        { key: 'closed',   count: summary?.closed   ?? 0 },
        { key: 'excluded', count: summary?.excluded ?? 0 },
    ];

    return (
        <div className="h-full overflow-y-auto bg-slate-50/60 custom-scroll" dir="rtl">
            <div className="mx-auto max-w-6xl px-4 py-6 space-y-4">

                {/* Back + Header */}
                <div>
                    <button type="button" onClick={() => navigate('/planning/overview')}
                        className="mb-3 inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-sky-600 transition-colors">
                        <ArrowRight className="h-4 w-4" />
                        العودة إلى ملخص الخطة
                    </button>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                                <Target className="h-5 w-5 text-sky-600" />
                                جهات الاتصال — {teamLabel}
                            </h1>
                            <p className="mt-0.5 text-sm text-slate-500 flex items-center gap-1.5">
                                <Calendar className="h-3.5 w-3.5" />
                                {date}
                                {date === today && <span className="text-[10px] font-bold bg-sky-100 text-sky-600 px-1.5 py-0.5 rounded-full border border-sky-200">اليوم</span>}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button type="button" onClick={loadData} disabled={loading}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-sm">
                                <RotateCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                                تحديث
                            </button>
                        </div>
                    </div>
                </div>

                {/* Message banner */}
                {message && (
                    <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-bold
                        ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : message.type === 'warning'  ? 'border-amber-200 bg-amber-50 text-amber-700'
                        :                               'border-red-200 bg-red-50 text-red-700'}`}>
                        <span>{message.text}</span>
                        <button onClick={() => setMessage(null)} className="opacity-60 hover:opacity-100">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                )}

                {/* Stat cards strip */}
                {!loading && allClients.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-1 custom-scroll">
                        {tabs.map(tab => (
                            <StatCard key={tab.key} phase={tab.key} count={tab.count}
                                active={phaseFilter === tab.key}
                                onClick={() => setPhaseFilter(tab.key)} />
                        ))}
                    </div>
                )}

                {/* ── State banner ──────────────────────────────────────────── */}
                {!loading && (
                    taskListGenerated ? (
                        /* POST-GENERATION: list is frozen — show regenerate option */
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                            <div className="flex items-start gap-3">
                                <PhoneCall className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                                <div>
                                    <p className="font-bold text-emerald-800 text-sm">
                                        قائمة الاتصال مُولَّدة وثابتة
                                    </p>
                                    <p className="text-xs text-emerald-600 mt-0.5">
                                        {taskListGeneratedAt ? `آخر توليد: ${taskListGeneratedAt} — ` : ''}
                                        الداشبورد يعرض القائمة المولَّدة فقط، وأي فرق لاحق لا يدخل إلا بعد إعادة التوليد.
                                    </p>
                                    {newEligibleCount > 0 && (
                                        <p className="mt-1 text-xs font-bold text-amber-700">
                                            يوجد {newEligibleCount} جهة جديدة مؤهلة منذ آخر توليد.
                                        </p>
                                    )}
                                </div>
                            </div>
                            <button type="button" onClick={handleGenerate} disabled={generating}
                                className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 shadow-sm whitespace-nowrap transition-colors shrink-0">
                                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                                {generating ? 'جاري التوليد...' : newEligibleCount > 0 ? 'إعادة التوليد لإدراج الجدد' : 'إعادة التوليد'}
                            </button>
                        </div>
                    ) : assignedCount > 0 ? (
                        /* PRE-GENERATION: contacts ready, prompt to generate */
                        <div className={`rounded-xl border px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                            phaseFilter === 'assigned'
                                ? 'border-amber-200 bg-amber-50'
                                : 'border-indigo-200 bg-indigo-50'
                        }`}>
                            <div className="flex items-start gap-3">
                                <Zap className={`h-5 w-5 shrink-0 mt-0.5 ${phaseFilter === 'assigned' ? 'text-amber-500' : 'text-indigo-500'}`} />
                                <div>
                                    <p className={`font-bold text-sm ${phaseFilter === 'assigned' ? 'text-amber-800' : 'text-indigo-800'}`}>
                                        {assignedCount} جهة اتصال جاهزة للإدراج
                                    </p>
                                    <p className={`text-xs mt-0.5 ${phaseFilter === 'assigned' ? 'text-amber-600' : 'text-indigo-600'}`}>
                                        راجع الجدول واستثنِ ما تريد، ثم اضغط "توليد قائمة الاتصال" لتثبيت اللقطة الأولى.
                                    </p>
                                </div>
                            </div>
                            <button type="button" onClick={handleGenerate} disabled={generating}
                                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60 shadow-sm whitespace-nowrap transition-colors shrink-0 ${
                                    phaseFilter === 'assigned'
                                        ? 'bg-amber-600 hover:bg-amber-500'
                                        : 'bg-indigo-600 hover:bg-indigo-500'
                                }`}>
                                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                                {generating ? 'جاري التوليد...' : 'توليد قائمة الاتصال'}
                            </button>
                        </div>
                    ) : null
                )}

                {/* Checkbox legend — only on assigned tab */}
                {!loading && phaseFilter === 'assigned' && filteredClients.length > 0 && (
                    <div className="flex items-center gap-4 text-xs text-slate-500 bg-white border border-slate-200 rounded-xl px-4 py-2.5">
                        <Info className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="flex items-center gap-1.5">
                            <CheckSquare className="h-3.5 w-3.5 text-emerald-600" />
                            <strong className="text-slate-700">مُحدَّد</strong> = ستُدرج في القائمة
                        </span>
                        <span className="flex items-center gap-1.5">
                            <Square className="h-3.5 w-3.5 text-red-400" />
                            <strong className="text-slate-700">غير مُحدَّد</strong> = مستثناة من التوليد
                        </span>
                        <span className="text-slate-400">· اضغط على السطر لتفاصيل المهام</span>
                    </div>
                )}

                {/* Content */}
                {loading ? (
                    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white py-24 text-slate-400">
                        <Loader2 className="h-7 w-7 animate-spin text-sky-500" />
                        <span className="text-sm font-medium">جاري التحميل...</span>
                    </div>
                ) : loadError ? (
                    <div className="rounded-2xl border border-red-100 bg-red-50 py-16 text-center">
                        <p className="text-sm font-bold text-red-600">تعذر تحميل البيانات</p>
                        <button onClick={loadData} className="mt-3 text-xs font-bold text-red-500 hover:underline">إعادة المحاولة</button>
                    </div>
                ) : allClients.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center space-y-2">
                        <Users className="mx-auto h-10 w-10 text-slate-200" />
                        <p className="text-sm font-bold text-slate-500">لا توجد جهات اتصال لهذا الفريق</p>
                        <p className="text-xs text-slate-400">احفظ نطاق العمل أولاً من صفحة الخطة</p>
                    </div>
                ) : filteredClients.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center">
                        <p className="text-sm text-slate-500">لا يوجد عملاء في هذه المرحلة</p>
                    </div>
                ) : (
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <div className="overflow-x-auto custom-scroll">
                            <table className="w-full min-w-[860px] border-collapse text-sm">
                                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-500">
                                    <tr>
                                        {/* Checkbox col — only interactive on assigned/excluded */}
                                        <th className="w-12 px-3 py-3 text-center">
                                            {phaseFilter === 'assigned'
                                                ? <span className="text-[10px] text-slate-400 font-normal">إدراج</span>
                                                : null}
                                        </th>
                                        <th className="px-4 py-3 text-right w-16">#</th>
                                        <th className="px-4 py-3 text-right">الزبون</th>
                                        <th className="px-4 py-3 text-right w-36">الهاتف</th>
                                        <th className="px-4 py-3 text-right w-20">التصنيف</th>
                                        <th className="px-4 py-3 text-right w-28">المحطة</th>
                                        <th className="px-4 py-3 text-center w-16">مهام</th>
                                        <th className="px-4 py-3 text-right w-28">المرحلة</th>
                                        <th className="px-4 py-3 text-right w-36">آخر نتيجة</th>
                                        <th className="px-4 py-3 text-right w-32">الموعد</th>
                                        <th className="w-8 px-2" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredClients.map(client => {
                                        const phase   = getPhase(client, today);
                                        const pm      = PHASE_META[phase];
                                        const isSaving  = savingId === client.clientId;
                                        const canToggle = phase === 'assigned' || phase === 'excluded';
                                        const outcomeMeta = client.latestCallOutcome ? getOutcomeMeta(client.latestCallOutcome) : null;
                                        const hasRetry = client.tasks.some(t => t.attemptCount > 0 && t.status === 'assigned');

                                        return (
                                            <tr key={client.clientId}
                                                onClick={() => setModalClient(client)}
                                                className={`cursor-pointer transition-colors hover:bg-indigo-50/40 ${pm.row}`}>

                                                {/* Checkbox */}
                                                <td className="px-3 py-3 text-center"
                                                    onClick={e => { e.stopPropagation(); if (canToggle && !isSaving) handleRowToggle(client); }}>
                                                    {isSaving
                                                        ? <Loader2 className="h-4 w-4 animate-spin text-indigo-500 mx-auto" />
                                                        : phase === 'excluded'
                                                            ? <Square className="h-4 w-4 text-red-400 mx-auto hover:text-amber-500 cursor-pointer transition-colors"  />
                                                            : phase === 'assigned'
                                                                ? <CheckSquare className="h-4 w-4 text-emerald-600 mx-auto hover:text-red-400 cursor-pointer transition-colors"  />
                                                                : <span className={`inline-block h-2 w-2 rounded-full ${pm.dot}`} />}
                                                </td>

                                                <td className="px-4 py-3 font-mono text-xs text-slate-400">#{client.clientId}</td>

                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-slate-800">{client.clientName}</span>
                                                        {hasRetry && (
                                                            <span className="text-[9px] font-bold bg-orange-100 text-orange-600 border border-orange-200 px-1.5 py-0.5 rounded-full shrink-0">
                                                                عودة
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>

                                                <td className="px-4 py-3 font-mono text-xs text-slate-600" dir="ltr">
                                                    {client.primaryPhone || <span className="text-slate-300">—</span>}
                                                </td>

                                                <td className="px-4 py-3">
                                                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${classificationColor(client.candidateStatus)}`}>
                                                        {classificationLabel(client.candidateStatus)}
                                                    </span>
                                                </td>

                                                <td className="px-4 py-3 text-xs text-slate-600">
                                                    {client.stationName || <span className="text-slate-300">—</span>}
                                                </td>

                                                <td className="px-4 py-3 text-center">
                                                    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${pm.badge}`}>
                                                        {client.tasks.length}
                                                        {client.excludedCount > 0 && (
                                                            <span className="text-red-400 text-[9px]">/{client.excludedCount}✗</span>
                                                        )}
                                                    </span>
                                                </td>

                                                <td className="px-4 py-3">
                                                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${pm.badge}`}>
                                                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${pm.dot}`} />
                                                        {pm.label}
                                                    </span>
                                                </td>

                                                <td className="px-4 py-3 text-xs">
                                                    {outcomeMeta
                                                        ? <span className={outcomeMeta.closesContactTarget ? 'font-bold text-emerald-700' : 'text-slate-600'}>
                                                            {outcomeMeta.label}
                                                          </span>
                                                        : client.contactTargetStatus
                                                            ? <span className="text-slate-500">{CT_LABELS[client.contactTargetStatus] || client.contactTargetStatus}</span>
                                                            : <span className="text-slate-300">—</span>}
                                                </td>

                                                <td className="px-4 py-3 text-xs">
                                                    {client.appointmentDate
                                                        ? <span className="font-bold text-emerald-700">
                                                            {client.appointmentDate}
                                                            {client.appointmentTime && <span className="font-normal text-emerald-600"> · {client.appointmentTime}</span>}
                                                          </span>
                                                        : <span className="text-slate-300">—</span>}
                                                </td>

                                                <td className="px-2 py-3">
                                                    <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Footer hint */}
                        <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-2.5 flex items-center justify-between text-xs text-slate-400">
                            <span>{filteredClients.length} جهة اتصال · اضغط على السطر للتفاصيل</span>
                            {phaseFilter === 'assigned' && (
                                <span className="flex items-center gap-1">
                                    <CheckSquare className="h-3 w-3 text-emerald-500" /> مُدرجة
                                    <span className="mx-1">·</span>
                                    <Square className="h-3 w-3 text-red-400" /> مستثناة
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>

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
