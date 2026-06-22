import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
    ArrowRight, Calendar, CheckSquare, ChevronRight,
    ExternalLink, Info, Loader2, PhoneCall, RotateCcw, Search, Square,
    Target, Users, X, Zap,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useBranchContextStore } from '../../hooks/useBranchContextStore';
import { getOutcomeMeta } from '@golden-crm/shared';
import Select from '../../components/ui/Select';
import IconButton from '../../components/ui/IconButton';

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
    generatedInTaskList: boolean;
    hasPendingSync: boolean;
    workspaceStatus: Phase;
    contactTargetId: number | null;
    contactTargetStatus: string | null;
    taskListItemStatus: string | null;
    taskListOpenTaskId: number | null;
    latestCallOutcome: string | null;
    appointmentDate: string | null;
    appointmentTime: string | null;
    attemptCount: number;
};

type Summary = {
    assigned: number;
    queued: number;
    contacted: number;
    closed: number;
};

type DashboardResponse = {
    teamKey: string;
    date: string;
    taskListGenerated: boolean;
    taskListGeneratedAt: string | null;
    newEligibleCount: number;
    generatedCount: number;
    pendingSyncCount: number;
    clients: ClientRow[];
    summary: Summary;
};

type SortKey = 'clientId' | 'clientName' | 'primaryPhone' | 'stationName' | 'taskCount' | 'attemptCount' | 'phase' | 'appointmentDate';
type SortDir = 'asc' | 'desc' | null;

// ─── Phase helpers ────────────────────────────────────────────────────────────

type Phase = 'assigned' | 'queued' | 'contacted' | 'closed';

function getPhase(c: ClientRow, today: string): Phase {
    return c.workspaceStatus;
}

type PhaseMeta = { label: string; icon: string; dot: string; badge: string; row: string };
const PHASE_META: Record<Phase, PhaseMeta> = {
    assigned:  { label: 'جاهزة الآن',   icon: '⏳', dot: 'bg-amber-400',   badge: 'border-amber-200 bg-amber-50 text-amber-700',       row: '' },
    queued:    { label: 'ضمن القائمة',  icon: '📋', dot: 'bg-sky-500',     badge: 'border-sky-200 bg-sky-50 text-sky-700',             row: 'bg-sky-50/30' },
    contacted: { label: 'تم التواصل',   icon: '📞', dot: 'bg-indigo-500',  badge: 'border-indigo-200 bg-indigo-50 text-indigo-700',    row: 'bg-indigo-50/20' },
    closed:    { label: 'مُغلقة',       icon: '🔒', dot: 'bg-slate-400',   badge: 'border-slate-200 bg-slate-100 text-slate-500',      row: 'opacity-60' },
};

const CT_LABELS: Record<string, string> = {
    new: 'جديدة', queued: 'ضمن القائمة', contacted: 'تم التواصل', booked: 'موعد محجوز', closed: 'مغلقة',
};

const TASK_STATUS_LABELS: Record<string, string> = {
    assigned: 'جاهزة للتوليد',
    in_scheduling: 'مرتبطة بالقائمة',
    scheduled: 'مجدولة',
    waiting_execution: 'بانتظار التنفيذ',
    in_execution: 'قيد التنفيذ',
    ended: 'منتهية',
    completed: 'مكتملة',
    closed: 'مغلقة',
    open: 'مفتوحة',
    needs_follow_up: 'تحتاج متابعة',
};

function getTaskLayerLabel(task: AssignedTask, client: ClientRow, today: string) {
    if (client.taskListOpenTaskId != null && task.taskId === client.taskListOpenTaskId) {
        return 'مرتبطة بالـ contact_target';
    }
    if (task.excludedForDate === today) return 'مستثناة من التوليد';
    if (task.status === 'assigned') return client.generatedInTaskList ? 'فرق حي للتوليد القادم' : 'جاهزة للتوليد';
    return 'مهمة مفتوحة مرتبطة بالزبون';
}

function getTaskLayerClass(task: AssignedTask, client: ClientRow, today: string) {
    if (client.taskListOpenTaskId != null && task.taskId === client.taskListOpenTaskId) {
        return 'border-sky-200 bg-sky-50 text-sky-700';
    }
    if (task.excludedForDate === today) return 'border-red-200 bg-red-50 text-red-600';
    if (task.status === 'assigned') return 'border-amber-200 bg-amber-50 text-amber-700';
    return 'border-slate-200 bg-slate-50 text-slate-500';
}

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

function compareValues(a: string | number | null, b: string | number | null, dir: Exclude<SortDir, null>) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (typeof a === 'number' && typeof b === 'number') {
        return dir === 'asc' ? a - b : b - a;
    }
    return dir === 'asc'
        ? String(a).localeCompare(String(b), 'ar')
        : String(b).localeCompare(String(a), 'ar');
}

// Local calendar date (NOT UTC) — toISOString() is a day behind before the UTC offset.
const getPlanningDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function parseSortKey(value: string | null): SortKey | null {
    if (
        value === 'clientId' ||
        value === 'clientName' ||
        value === 'primaryPhone' ||
        value === 'stationName' ||
        value === 'taskCount' ||
        value === 'attemptCount' ||
        value === 'phase' ||
        value === 'appointmentDate'
    ) {
        return value;
    }
    return null;
}

function parseSortDir(value: string | null): SortDir {
    if (value === 'asc' || value === 'desc') return value;
    return null;
}

function renderSortIndicator(active: boolean, dir: SortDir) {
    if (!active || !dir) return <span className="text-slate-300">↕</span>;
    return <span className="text-sky-600">{dir === 'asc' ? '↑' : '↓'}</span>;
}

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

    const [keepSet, setKeepSet] = useState<Set<number>>(() => {
        const s = new Set<number>();
        client.tasks.forEach(t => { if (t.status === 'assigned') s.add(t.taskId); });
        return s;
    });

    const editableTasks = client.tasks.filter(t => t.status === 'assigned' || t.excludedForDate === today);
    const canEdit = editableTasks.length > 0;
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
                            <h3 className="font-bold text-slate-800">{client.clientName}</h3>
                            <div className="flex items-center gap-2 mt-0.5">
                                {client.primaryPhone && <span className="text-xs font-mono text-slate-500" dir="ltr">{client.primaryPhone}</span>}
                                <span className={`text-xs font-bold rounded-full border px-1.5 py-0.5 ${pm.badge}`}>{pm.label}</span>
                            </div>
                        </div>
                    </div>
                    <IconButton icon={X} label="إغلاق" size="sm" className="mt-0.5" onClick={onClose} />
                </div>

                {/* Appointment banner */}
                {client.appointmentDate && (
                    <div className="mx-5 mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-bold text-emerald-700">
                        <Calendar className="h-4 w-4 shrink-0" />
                        موعد: {client.appointmentDate}{client.appointmentTime && ` الساعة ${client.appointmentTime}`}
                    </div>
                )}

                <div className={`mx-5 mt-3 rounded-xl border px-3 py-2.5 text-xs ${
                    client.contactTargetId
                        ? 'border-sky-200 bg-sky-50 text-sky-700'
                        : 'border-slate-200 bg-slate-50 text-slate-500'
                }`}>
                    <div className="font-bold">
                        {client.contactTargetId
                            ? `Contact Target #${client.contactTargetId}`
                            : 'لا يوجد contact_target مولَّد لهذه الجهة'}
                    </div>
                    <div className="mt-0.5">
                        {client.contactTargetId
                            ? `حالته: ${CT_LABELS[client.contactTargetStatus ?? ''] || client.contactTargetStatus || 'غير محددة'}`
                            : 'المعروض هنا يأتي من open_tasks فقط، وليس من قائمة اتصال مولَّدة.'}
                    </div>
                </div>

                {/* Editable hint */}
                {canEdit && editableTasks.length > 0 && (
                    <div className="mx-5 mt-3 flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>
                            {client.generatedInTaskList
                                ? 'هذه مهام حية ظهرت بعد توليد القائمة الحالية، وأي تعديل هنا سيؤثر على التوليد القادم فقط.'
                                : 'المهام المحددة ستُدرج في قائمة الاتصال عند التوليد — قم بإلغاء التحديد لاستثناء أي مهمة.'}
                        </span>
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
                                        <span className={`text-[9px] font-bold border px-1.5 py-0.5 rounded-full ${getTaskLayerClass(task, client, today)}`}>
                                            {getTaskLayerLabel(task, client, today)}
                                        </span>
                                    </div>
                                    {task.dueDate && <p className="text-xs text-slate-500 mt-0.5">استحقاق: {task.dueDate}</p>}
                                </div>
                                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-bold
                                    ${task.status === 'assigned'      ? 'border-amber-200 bg-amber-50 text-amber-700'
                                    : task.status === 'in_scheduling' ? 'border-sky-200 bg-sky-50 text-sky-700'
                                    : task.status === 'scheduled'     ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : isExcluded                      ? 'border-red-200 bg-red-50 text-red-600'
                                    :                                   'border-slate-200 bg-slate-50 text-slate-500'}`}>
                                    {isExcluded ? 'مستثناة' : TASK_STATUS_LABELS[task.status] || task.status}
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
                <span className="text-lg font-black">{count}</span>
                <span className="text-xs font-bold">المعروض</span>
            </button>
        );
    }
    const pm = PHASE_META[phase as Phase];
    return (
        <button type="button" onClick={onClick}
            className={`flex flex-col items-center gap-1 rounded-xl border px-4 py-3 min-w-[72px] transition-all ${
                active ? `${pm.badge} shadow-sm ring-2 ring-offset-1 ring-current/20` : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}>
            <span className="text-lg font-black">{count}</span>
            <div className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${active ? pm.dot : 'bg-slate-300'}`} />
                <span className="text-xs font-bold">{pm.label}</span>
            </div>
        </button>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PlanningContactTargets() {
    const navigate = useNavigate();
    const { teamKey = '' } = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    const defaultPlanningDate = getPlanningDate();
    const date = searchParams.get('date') || defaultPlanningDate;
    const teamLabel = searchParams.get('label') || teamKey;
    const today = date;

    const [data, setData] = useState<DashboardResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [savingId, setSavingId] = useState<number | null>(null);
    const [modalClient, setModalClient] = useState<ClientRow | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);
    const [phaseFilter, setPhaseFilter] = useState<Phase | 'all'>('all');
    const [searchTerm, setSearchTerm] = useState(searchParams.get('q') || '');
    const [stationFilter, setStationFilter] = useState(searchParams.get('station') || 'all');
    const [attemptFilter, setAttemptFilter] = useState<'all' | '1' | '3' | '5'>(() => {
        const value = searchParams.get('attempts');
        return value === '1' || value === '3' || value === '5' ? value : 'all';
    });
    const [sortKey, setSortKey] = useState<SortKey | null>(parseSortKey(searchParams.get('sort')) || 'clientName');
    const [sortDir, setSortDir] = useState<SortDir>(parseSortDir(searchParams.get('dir')) || 'asc');
    const [syncingContacts, setSyncingContacts] = useState(false);
    // React to the external branch switcher (no full reload — §4): refetch on change.
    const branchId = useBranchContextStore(s => s.branchId);

    const loadData = useCallback(async () => {
        setLoading(true);
        setLoadError(false);
        try {
            setData(await api.planning.contactTargetsDashboard(date, teamKey));
        } catch {
            setLoadError(true);
        } finally {
            setLoading(false);
        }
    }, [date, teamKey, branchId]);

    useEffect(() => { loadData(); }, [loadData]);
    useEffect(() => {
        const next = new URLSearchParams(searchParams);
        next.set('date', date);
        next.set('label', teamLabel);

        if (searchTerm.trim()) next.set('q', searchTerm.trim());
        else next.delete('q');

        if (stationFilter !== 'all') next.set('station', stationFilter);
        else next.delete('station');

        if (attemptFilter !== 'all') next.set('attempts', attemptFilter);
        else next.delete('attempts');

        next.delete('taskTypes');

        if (sortKey && sortDir) {
            next.set('sort', sortKey);
            next.set('dir', sortDir);
        } else {
            next.delete('sort');
            next.delete('dir');
        }

        const current = searchParams.toString();
        const updated = next.toString();
        if (current !== updated) {
            setSearchParams(next, { replace: true });
        }
    }, [
        attemptFilter,
        date,
        searchParams,
        searchTerm,
        setSearchParams,
        sortDir,
        sortKey,
        stationFilter,
        teamLabel,
    ]);

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
            setPhaseFilter('queued');
            await loadData(); // reload to switch to post-generation mode
        } catch (err: any) {
            setMessage({ type: 'error', text: err?.message || 'تعذر توليد قائمة الاتصال' });
        } finally {
            setGenerating(false);
        }
    };

    const handleSyncContacts = async () => {
        setSyncingContacts(true);
        setMessage(null);
        try {
            const result = await api.planning.syncContactTargetsDashboard(date, teamKey);
            const newlyAssigned = result?.counts?.newlyAssigned ?? 0;
            const released = result?.counts?.released ?? 0;
            setMessage({
                type: 'success',
                text: `تم تحديث جهات الاتصال — ${newlyAssigned} مهمة جديدة أُدخلت للخطة${released > 0 ? `، و${released} مهمة خرجت من النطاق` : ''}.`,
            });
            await loadData();
        } catch (err: any) {
            setMessage({ type: 'error', text: err?.message || 'تعذر تحديث جهات الاتصال' });
        } finally {
            setSyncingContacts(false);
        }
    };

    const handleSort = (key: SortKey) => {
        if (sortKey !== key) {
            setSortKey(key);
            setSortDir('asc');
            return;
        }
        if (sortDir === 'asc') {
            setSortDir('desc');
            return;
        }
        if (sortDir === 'desc') {
            setSortKey(null);
            setSortDir(null);
            return;
        }
        setSortDir('asc');
    };

    const allClients       = data?.clients ?? [];
    const summary          = data?.summary;
    const assignedCount    = summary?.assigned ?? 0;
    const taskListGenerated = data?.taskListGenerated ?? false;
    const taskListGeneratedAt = formatGeneratedAt(data?.taskListGeneratedAt ?? null);
    const newEligibleCount = data?.newEligibleCount ?? 0;
    const generatedCount = data?.generatedCount ?? 0;
    const pendingSyncCount = data?.pendingSyncCount ?? 0;
    const stationOptions = Array.from(new Set(allClients.map(c => c.stationName).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, 'ar'));
    let filteredClients = allClients.filter(client => {
        if (phaseFilter !== 'all' && getPhase(client, today) !== phaseFilter) return false;
        if (stationFilter !== 'all' && (client.stationName ?? '') !== stationFilter) return false;
        if (attemptFilter !== 'all' && client.attemptCount < Number(attemptFilter)) return false;
        if (searchTerm.trim()) {
            const q = searchTerm.trim().toLowerCase();
            const haystacks = [
                String(client.clientId),
                client.clientName,
                client.primaryPhone ?? '',
            ];
            if (!haystacks.some(value => value.toLowerCase().includes(q))) return false;
        }
        return true;
    });

    if (sortKey && sortDir) {
        filteredClients = [...filteredClients].sort((a, b) => {
            const phaseA = PHASE_META[getPhase(a, today)].label;
            const phaseB = PHASE_META[getPhase(b, today)].label;
            const valueA: string | number | null =
                sortKey === 'clientId' ? a.clientId :
                sortKey === 'clientName' ? a.clientName :
                sortKey === 'primaryPhone' ? a.primaryPhone :
                sortKey === 'stationName' ? a.stationName :
                sortKey === 'taskCount' ? a.tasks.length :
                sortKey === 'attemptCount' ? a.attemptCount :
                sortKey === 'phase' ? phaseA :
                a.appointmentDate;
            const valueB: string | number | null =
                sortKey === 'clientId' ? b.clientId :
                sortKey === 'clientName' ? b.clientName :
                sortKey === 'primaryPhone' ? b.primaryPhone :
                sortKey === 'stationName' ? b.stationName :
                sortKey === 'taskCount' ? b.tasks.length :
                sortKey === 'attemptCount' ? b.attemptCount :
                sortKey === 'phase' ? phaseB :
                b.appointmentDate;
            return compareValues(valueA, valueB, sortDir);
        });
    }

    const hasActiveFilters =
        searchTerm.trim() !== '' ||
        stationFilter !== 'all' ||
        attemptFilter !== 'all';

    const clearFilters = () => {
        setSearchTerm('');
        setStationFilter('all');
        setAttemptFilter('all');
    };

    const tabs: { key: Phase | 'all'; count: number }[] = [
        { key: 'all',      count: allClients.length },
        { key: 'assigned', count: assignedCount },
        { key: 'queued',   count: summary?.queued   ?? 0 },
        { key: 'contacted', count: summary?.contacted ?? 0 },
        { key: 'closed',   count: summary?.closed   ?? 0 },
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
                            <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800">
                                <Target className="h-5 w-5 text-sky-600" />
                                جهات الاتصال — {teamLabel}
                            </h1>
                            <p className="mt-0.5 text-sm text-slate-500 flex items-center gap-1.5">
                                <Calendar className="h-3.5 w-3.5" />
                                {date}
                                {date === defaultPlanningDate && <span className="text-xs font-bold bg-sky-100 text-sky-600 px-1.5 py-0.5 rounded-full border border-sky-200">خطة الغد</span>}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button type="button" onClick={handleSyncContacts} disabled={syncingContacts || loading}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors shadow-sm">
                                {syncingContacts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                                {syncingContacts ? 'جاري التحديث...' : 'تحديث جهات الاتصال'}
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
                        <IconButton icon={X} label="إغلاق" size="sm" className="opacity-60 hover:opacity-100" onClick={() => setMessage(null)} />
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
                        /* POST-GENERATION: generated snapshot + live delta */
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                            <div className="flex items-start gap-3">
                                <PhoneCall className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                                <div>
                                    <p className="font-bold text-emerald-800 text-sm">
                                        أنت الآن على قائمة الاتصال الحالية مع تنبيه للمهام الجديدة
                                    </p>
                                    <p className="text-xs text-emerald-600 mt-0.5">
                                        {taskListGeneratedAt ? `آخر توليد: ${taskListGeneratedAt} — ` : ''}
                                        المعروض الأساسي هو جهات الاتصال ضمن القائمة. أي مهام مناسبة تظهر بعد آخر توليد ستظهر كبادجات فرق، ولا تدخل القائمة إلا بعد إعادة التوليد.
                                    </p>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold">
                                        <span className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-emerald-700">
                                            {generatedCount} ضمن القائمة
                                        </span>
                                        {newEligibleCount > 0 && (
                                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">
                                                {newEligibleCount} جهات جديدة منذ آخر توليد
                                            </span>
                                        )}
                                        {pendingSyncCount > 0 && (
                                            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-indigo-700">
                                                {pendingSyncCount} جهات لها فرق حي
                                            </span>
                                        )}
                                    </div>
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
                                        راجع الجدول واستثنِ ما تريد، ثم اضغط "توليد قائمة الاتصال" لإنشاء القائمة الأولى.
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

                {!loading && allClients.length > 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative min-w-[220px] flex-1">
                                <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <input
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    placeholder="بحث بالاسم أو الهاتف أو رقم الزبون"
                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pr-10 pl-3 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:bg-white"
                                />
                            </div>

                            <Select
                                value={stationFilter}
                                onChange={setStationFilter}
                                ariaLabel="المحطة"
                                variant="filled"
                                options={[{ value: 'all', label: 'كل المحطات' }, ...stationOptions.map(station => ({ value: station, label: station }))]}
                            />

                            <Select<'all' | '1' | '3' | '5'>
                                value={attemptFilter}
                                onChange={setAttemptFilter}
                                ariaLabel="المحاولات"
                                variant="filled"
                                options={[
                                    { value: 'all', label: 'كل المحاولات' },
                                    { value: '1', label: '1+ محاولة' },
                                    { value: '3', label: '3+ محاولات' },
                                    { value: '5', label: '5+ محاولات' },
                                ]}
                            />
                        </div>

                        {hasActiveFilters && (
                            <div className="flex items-center justify-between gap-3 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-700">
                                <span>النتائج المعروضة: {filteredClients.length} من أصل {allClients.length}</span>
                                <button
                                    type="button"
                                    onClick={clearFilters}
                                    className="font-bold hover:underline"
                                >
                                    مسح الفلاتر
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Checkbox legend — only on assigned tab */}
                {!loading && phaseFilter === 'assigned' && filteredClients.length > 0 && (
                    <div className="flex items-center gap-4 text-xs text-slate-500 bg-white border border-slate-200 rounded-xl px-4 py-2.5">
                        <Info className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="flex items-center gap-1.5">
                            <CheckSquare className="h-3.5 w-3.5 text-emerald-600" />
                            <strong className="text-slate-700">مُحدَّد</strong> = {taskListGenerated ? 'سيدخل في التوليد القادم' : 'ستُدرج في القائمة'}
                        </span>
                        <span className="flex items-center gap-1.5">
                            <Square className="h-3.5 w-3.5 text-red-400" />
                            <strong className="text-slate-700">غير مُحدَّد</strong> = {taskListGenerated ? 'سيبقى خارج التوليد القادم' : 'مستثناة من التوليد'}
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
                        <button
                            type="button"
                            onClick={() => navigate('/planning/overview')}
                            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500"
                        >
                            <ArrowRight className="h-4 w-4" />
                            الذهاب إلى صفحة الخطة
                        </button>
                    </div>
                ) : filteredClients.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center space-y-3">
                        <p className="text-sm font-bold text-slate-500">لا توجد نتائج مطابقة في العرض الحالي</p>
                        <p className="text-xs text-slate-400">
                            {hasActiveFilters ? 'جرّب تعديل الفلاتر أو مسحها لعرض بقية الجهات.' : 'غيّر المرحلة المختارة أو راجع التوليد الحالي.'}
                        </p>
                        {hasActiveFilters && (
                            <button
                                type="button"
                                onClick={clearFilters}
                                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                            >
                                <RotateCcw className="h-4 w-4" />
                                مسح الفلاتر
                            </button>
                        )}
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
                                                ? <span className="text-xs text-slate-400 font-normal">توليد</span>
                                                : null}
                                        </th>
                                        <th className="px-4 py-3 text-right w-16">
                                            <button type="button" onClick={() => handleSort('clientId')} className="inline-flex items-center gap-1 hover:text-slate-700">
                                                #
                                                {renderSortIndicator(sortKey === 'clientId', sortDir)}
                                            </button>
                                        </th>
                                        <th className="px-4 py-3 text-right">
                                            <button type="button" onClick={() => handleSort('clientName')} className="inline-flex items-center gap-1 hover:text-slate-700">
                                                الزبون
                                                {renderSortIndicator(sortKey === 'clientName', sortDir)}
                                            </button>
                                        </th>
                                        <th className="px-4 py-3 text-right w-36">
                                            <button type="button" onClick={() => handleSort('primaryPhone')} className="inline-flex items-center gap-1 hover:text-slate-700">
                                                الهاتف
                                                {renderSortIndicator(sortKey === 'primaryPhone', sortDir)}
                                            </button>
                                        </th>
                                        <th className="px-4 py-3 text-right w-20">التصنيف</th>
                                        <th className="px-4 py-3 text-right w-28">
                                            <button type="button" onClick={() => handleSort('stationName')} className="inline-flex items-center gap-1 hover:text-slate-700">
                                                المحطة
                                                {renderSortIndicator(sortKey === 'stationName', sortDir)}
                                            </button>
                                        </th>
                                        <th className="px-4 py-3 text-center w-16">
                                            <button type="button" onClick={() => handleSort('taskCount')} className="inline-flex items-center gap-1 hover:text-slate-700">
                                                مهام
                                                {renderSortIndicator(sortKey === 'taskCount', sortDir)}
                                            </button>
                                        </th>
                                        <th className="px-4 py-3 text-center w-20">
                                            <button type="button" onClick={() => handleSort('attemptCount')} className="inline-flex items-center gap-1 hover:text-slate-700">
                                                محاولات
                                                {renderSortIndicator(sortKey === 'attemptCount', sortDir)}
                                            </button>
                                        </th>
                                        <th className="px-4 py-3 text-right w-28">
                                            <button type="button" onClick={() => handleSort('phase')} className="inline-flex items-center gap-1 hover:text-slate-700">
                                                المرحلة
                                                {renderSortIndicator(sortKey === 'phase', sortDir)}
                                            </button>
                                        </th>
                                        <th className="px-4 py-3 text-right w-36">آخر نتيجة</th>
                                        <th className="px-4 py-3 text-right w-32">
                                            <button type="button" onClick={() => handleSort('appointmentDate')} className="inline-flex items-center gap-1 hover:text-slate-700">
                                                الموعد
                                                {renderSortIndicator(sortKey === 'appointmentDate', sortDir)}
                                            </button>
                                        </th>
                                        <th className="w-8 px-2" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredClients.map(client => {
                                        const phase   = getPhase(client, today);
                                        const pm      = PHASE_META[phase];
                                        const isSaving  = savingId === client.clientId;
                                        const canToggle = client.tasks.some(task => task.status === 'assigned' || task.excludedForDate === today);
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
                                                        : phase === 'assigned'
                                                            ? <CheckSquare className="h-4 w-4 text-emerald-600 mx-auto hover:text-red-400 cursor-pointer transition-colors"  />
                                                            : <span className={`inline-block h-2 w-2 rounded-full ${pm.dot}`} />}
                                                </td>

                                                <td className="px-4 py-3 font-mono text-xs text-slate-400">#{client.clientId}</td>

                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-bold text-slate-800">{client.clientName}</span>
                                                        {hasRetry && (
                                                            <span className="text-[9px] font-bold bg-orange-100 text-orange-600 border border-orange-200 px-1.5 py-0.5 rounded-full shrink-0">
                                                                عودة
                                                            </span>
                                                        )}
                                                        {client.generatedInTaskList && (
                                                            <span className="text-[9px] font-bold bg-sky-100 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded-full shrink-0">
                                                                ضمن القائمة
                                                            </span>
                                                        )}
                                                        {client.contactTargetId ? (
                                                            <span className="text-[9px] font-bold bg-white text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded-full shrink-0">
                                                                CT #{client.contactTargetId}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded-full shrink-0">
                                                                open_tasks فقط
                                                            </span>
                                                        )}
                                                        {client.generatedInTaskList && client.hasPendingSync && (
                                                            <span className="text-[9px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded-full shrink-0">
                                                                فرق حي
                                                            </span>
                                                        )}
                                                        {!client.generatedInTaskList && taskListGenerated && client.assignedCount > 0 && (
                                                            <span className="text-[9px] font-bold bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full shrink-0">
                                                                جديد منذ آخر توليد
                                                            </span>
                                                        )}
                                                        {client.excludedCount > 0 && (
                                                            <span className="text-[9px] font-bold bg-red-100 text-red-700 border border-red-200 px-1.5 py-0.5 rounded-full shrink-0">
                                                                مستثناة {client.excludedCount}
                                                            </span>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={e => {
                                                                e.stopPropagation();
                                                                navigate(`/clients/${client.clientId}`);
                                                            }}
                                                            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-sky-600"
                                                            title="فتح ملف الزبون"
                                                        >
                                                            <ExternalLink className="h-3.5 w-3.5" />
                                                        </button>
                                                    </div>
                                                </td>

                                                <td className="px-4 py-3 font-mono text-xs text-slate-600" dir="ltr">
                                                    {client.primaryPhone || <span className="text-slate-300">—</span>}
                                                </td>

                                                <td className="px-4 py-3">
                                                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${classificationColor(client.candidateStatus)}`}>
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

                                                <td className="px-4 py-3 text-center">
                                                    <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-bold text-slate-600">
                                                        {client.attemptCount}
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
