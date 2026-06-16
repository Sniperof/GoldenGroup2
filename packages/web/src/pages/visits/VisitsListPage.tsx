import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Eye,
  Filter,
  Flame,
  Loader2,
  MapPin,
  MapPinned,
  NotebookPen,
  Phone,
  ShieldCheck,
  ShoppingCart,
  Timer,
  UserCheck,
  UsersRound,
  XCircle,
} from 'lucide-react';
import SmartTable, { type ColumnDef } from '../../components/SmartTable';
import ClientAvatar from '../../components/ClientAvatar';
import { api } from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuthStore';
import { useBranchListScope } from '../../hooks/useBranchListScope';
import { usePermissions } from '../../hooks/usePermissions';
import { OPEN_TASK_TYPE_LABELS } from '@golden-crm/shared';

type VisitView = 'daily' | 'executive' | 'branch' | 'team' | 'documentation' | 'tasks';

interface VisitRow {
  id: number;
  visitType: string | null;
  visitFamily: string | null;
  status: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  clientId: number;
  branchId: number;
  branchName?: string | null;
  teamSnapshot?: any;
  /** Resolved team object built by the list endpoint (DEC-007 D47):
   *  { supervisor:{id,name}, technician:{id,name}, trainee:{id,name},
   *    teamName: "فريق <اسم المسؤول>", reassigned: boolean }. */
  team?: {
    supervisor?: { id: number; name: string } | null;
    technician?: { id: number; name: string } | null;
    trainee?: { id: number; name: string } | null;
    teamName?: string | null;
    reassigned?: boolean;
  } | null;
  customerSnapshot?: any;
  clientName?: string | null;
  clientMobile?: string | null;
  clientGender?: 'male' | 'female' | null;
  clientDataQuality?: 'correct' | 'incorrect' | 'needs_edit' | null;
  clientClassification?: string | null;
  addressShort?: string | null;
  ownership?: { ownerLabel?: string | null; ownerType?: string | null } | null;
  originType?: string | null;
  taskCount: number;
  documentedTaskCount: number;
  tasksSummary: Array<{ taskType: string; taskFamily: string; status: string }>;
  hasSurvey: boolean;
  surveySkipped: boolean;
  hasReferralSheet: boolean;
  actualStartTime?: string | null;
  actualEndTime?: string | null;
  locationMissing?: boolean | null;
  escalationTiers?: number[];
  updatedAt?: string | null;
}

const VISIT_STATUS_LABELS: Record<string, string> = {
  scheduled: 'مجدولة',
  in_progress: 'قيد التنفيذ',
  ended: 'منتهية ميدانياً',
  completed: 'مكتملة',
  not_completed: 'لم تكتمل',
  cancelled: 'ملغاة',
  closed: 'مغلقة',
};

const VISIT_STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-sky-50 text-sky-700 border-sky-200',
  in_progress: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  ended: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  not_completed: 'bg-rose-50 text-rose-700 border-rose-200',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
  closed: 'bg-slate-100 text-slate-700 border-slate-300',
};

const VISIT_TYPE_LABELS: Record<string, string> = {
  marketing: 'تسويق',
  service: 'خدمة',
  mixed: 'مختلطة',
};

const ORIGIN_LABELS: Record<string, string> = {
  telemarketing: 'تليماركتنغ',
  manual: 'يدوي',
  emergency_request: 'بلاغ طارئ',
  system: 'نظام',
  expected_followup: 'متابعة متوقعة',
};

const VIEW_META: Record<VisitView, { label: string; description: string; icon: any }> = {
  daily: {
    label: 'اليومي العام',
    description: 'كل زيارات اليوم كوعاء تشغيلي محايد لكل أنواع المهام.',
    icon: CalendarDays,
  },
  executive: {
    label: 'الإدارة العليا',
    description: 'نظرة متعددة الفروع مع مؤشرات صحة التنفيذ والتوثيق.',
    icon: ShieldCheck,
  },
  branch: {
    label: 'مدير الفرع',
    description: 'إدارة يوم العمل الحالي للفرع والفرق والمسارات.',
    icon: Building2,
  },
  team: {
    label: 'الفريق التشغيلي',
    description: 'قائمة تنفيذ مركزة للفريق والفنيين.',
    icon: UsersRound,
  },
  documentation: {
    label: 'التوثيق والتصعيد',
    description: 'زيارات ناقصة التوثيق أو دخلت مراحل التصعيد.',
    icon: AlertTriangle,
  },
  tasks: {
    label: 'تحليل المهام',
    description: 'فلترة الزيارات حسب أنواع المهام داخل الوعاء.',
    icon: ClipboardList,
  },
};

function todayIso() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('ar-SY', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return value;
  }
}

function formatTime(value?: string | null) {
  if (!value) return '—';
  if (/^\d{2}:\d{2}/.test(value)) return value;
  try {
    return new Date(value).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return value;
  }
}

function compact(value: unknown) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
}

function getClientName(row: VisitRow) {
  return compact(row.customerSnapshot?.name) || compact(row.clientName) || `زبون #${row.clientId}`;
}

function getClientMobile(row: VisitRow) {
  return compact(row.customerSnapshot?.mobile) || compact(row.clientMobile) || '—';
}

function getAddressShort(row: VisitRow) {
  if (row.addressShort) return row.addressShort;
  const address = row.customerSnapshot?.address;
  if (typeof address === 'string') return address;
  if (address && typeof address === 'object') {
    const neighborhood = compact(address.neighborhood?.name ?? address.neighborhood);
    const subArea = compact(address.subArea?.name ?? address.subArea);
    const district = compact(address.district?.name ?? address.district);
    if (subArea && neighborhood) return `${subArea} — ${neighborhood}`;
    if (district && subArea) return `${district} — ${subArea}`;
    return neighborhood || subArea || district || '—';
  }
  return '—';
}

function getClassification(row: VisitRow) {
  return compact(row.customerSnapshot?.classification) || compact(row.clientClassification);
}

// ── Documentation & Escalation helpers ──────────────────────────────────────
// DEC-006 D38: three-tier escalation (24h / 48h / 72h) for visits left in
// `in_progress` or `ended` without proper documentation.

/** Highest active escalation tier for a visit (1 / 2 / 3 / 0 if none). */
function maxTier(row: VisitRow): number {
  return (row.escalationTiers ?? []).reduce((m, t) => (t > m ? t : m), 0);
}

/** Hours since the visit was last touched — used to age non-escalated stuck rows. */
function hoursSinceUpdate(row: VisitRow): number {
  if (!row.updatedAt) return 0;
  const t = new Date(row.updatedAt).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 3_600_000));
}

/** "What is missing on this visit?" — used in the documentation view. */
function missingPieces(row: VisitRow): string[] {
  const out: string[] = [];
  const docs = row.documentedTaskCount ?? 0;
  const total = row.taskCount ?? 0;
  if (total === 0) out.push('لا توجد مهام');
  else if (docs < total) out.push(`نتائج المهام ${docs}/${total}`);
  if (!row.hasSurvey) out.push('الاستبيان غير مدخل');
  return out;
}

/** A visit is "stuck" if it is mid-flight and missing required documentation,
 *  or if it has any active escalation alert. */
function isVisitStuck(row: VisitRow): boolean {
  if (maxTier(row) > 0) return true;
  if (row.status === 'in_progress' || row.status === 'ended') {
    const docs = row.documentedTaskCount ?? 0;
    const total = row.taskCount ?? 0;
    if (total === 0 || docs < total) return true;
    if (!row.hasSurvey) return true;
  }
  return false;
}

const TIER_META: Record<number, { label: string; bg: string; text: string; border: string; icon: any }> = {
  3: { label: 'L3 · ≥72س', bg: 'bg-rose-100',  text: 'text-rose-800',   border: 'border-rose-300',  icon: Flame },
  2: { label: 'L2 · ≥48س', bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-300', icon: AlertTriangle },
  1: { label: 'L1 · ≥24س', bg: 'bg-amber-100',  text: 'text-amber-800',  border: 'border-amber-300', icon: Timer },
};

function TierBadge({ row }: { row: VisitRow }) {
  const tier = maxTier(row);
  if (tier === 0) {
    return <span className="text-[11px] font-bold text-slate-400">—</span>;
  }
  const meta = TIER_META[tier];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-black ${meta.bg} ${meta.text} ${meta.border}`}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function HoursOverdueCell({ row }: { row: VisitRow }) {
  const tier = maxTier(row);
  const hrs = hoursSinceUpdate(row);
  // colour follows tier when present, otherwise scales with hours
  const cls = tier === 3 || hrs >= 72 ? 'text-rose-700'
            : tier === 2 || hrs >= 48 ? 'text-orange-700'
            : tier === 1 || hrs >= 24 ? 'text-amber-700'
            : 'text-slate-500';
  return (
    <div className={`flex flex-col min-w-[110px] ${cls}`}>
      <span className="font-black text-sm">{hrs}س</span>
      <span className="text-[10px] font-bold opacity-80">منذ آخر تحديث</span>
    </div>
  );
}

function MissingCell({ row }: { row: VisitRow }) {
  const docs = row.documentedTaskCount ?? 0;
  const total = row.taskCount ?? 0;
  const tasksOK = total > 0 && docs >= total;
  const surveyOK = row.hasSurvey;
  return (
    <div className="min-w-[190px] space-y-1 text-[11px]">
      <div className={`flex items-center gap-1.5 font-bold ${tasksOK ? 'text-emerald-700' : 'text-rose-700'}`}>
        {tasksOK ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
        نتائج المهام {docs}/{total || 0}
      </div>
      <div className={`flex items-center gap-1.5 font-bold ${surveyOK ? 'text-emerald-700' : 'text-rose-700'}`}>
        {surveyOK
          ? <ClipboardCheck className="h-3.5 w-3.5" />
          : <XCircle className="h-3.5 w-3.5" />}
        الاستبيان {surveyOK ? (row.surveySkipped ? 'متخطّى بسبب' : 'مُدخل') : 'غير مُدخل'}
      </div>
    </div>
  );
}

function ResponsibleCell({ row }: { row: VisitRow }) {
  const responsible = responsibleName(row);
  if (!responsible) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex items-center gap-1.5 min-w-[140px]">
      <UserCheck className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
      <span className="text-xs font-bold text-slate-700 truncate">{responsible}</span>
    </div>
  );
}

/** Returns the responsible person's name for a visit — supervisor first, technician fallback.
 *  DEC-007 D47: standard team → supervisor; emergency → technician. */
function responsibleName(row: VisitRow): string {
  const team = row.team || null;
  const snap = row.teamSnapshot || {};
  return compact(team?.supervisor?.name ?? snap.supervisor?.name ?? snap.supervisorName)
    || compact(team?.technician?.name ?? snap.technician?.name ?? snap.technicianName)
    || '';
}

/** Returns the "team name" — "فريق <اسم المسؤول>". */
function teamName(row: VisitRow): string {
  const fromTeam = compact(row.team?.teamName);
  if (fromTeam) return fromTeam;
  const r = responsibleName(row);
  return r ? `فريق ${r}` : '';
}

/** Status badge that, for branch view, surfaces an inline escalation marker so
 *  the branch manager spots stuck visits without leaving the page. */
function StatusWithTier({ row }: { row: VisitRow }) {
  const tier = maxTier(row);
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <StatusBadge status={row.status} />
      {tier > 0 && <TierBadge row={row} />}
    </div>
  );
}

function taskTypeLabel(taskType: string) {
  return (OPEN_TASK_TYPE_LABELS as Record<string, string>)[taskType] || taskType;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${VISIT_STATUS_COLORS[status] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
      {VISIT_STATUS_LABELS[status] || status}
    </span>
  );
}

function ClientMiniCell({ row, showOwnership = false }: { row: VisitRow; showOwnership?: boolean }) {
  const classification = getClassification(row);
  return (
    <div className="flex min-w-[260px] items-start gap-3">
      <ClientAvatar gender={row.clientGender ?? null} dataQuality={row.clientDataQuality ?? null} size="sm" />
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-black text-slate-800">{getClientName(row)}</span>
          {classification && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
              {classification}
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500" dir="ltr">{getClientMobile(row)}</div>
        <div className="max-w-[260px] truncate text-xs text-slate-500">{getAddressShort(row)}</div>
        {showOwnership && row.ownership?.ownerLabel && (
          <div className="text-[11px] font-bold text-slate-400">المسؤول: {row.ownership.ownerLabel}</div>
        )}
      </div>
    </div>
  );
}

function TeamCell({ row }: { row: VisitRow }) {
  // Prefer the resolved `team` object (with names) from the list endpoint.
  // Fall back to the raw `teamSnapshot` for older/legacy rows.
  const team = row.team || null;
  const supervisor = compact(team?.supervisor?.name ?? row.teamSnapshot?.supervisor?.name ?? row.teamSnapshot?.supervisorName);
  const technician = compact(team?.technician?.name ?? row.teamSnapshot?.technician?.name ?? row.teamSnapshot?.technicianName);
  const trainee    = compact(team?.trainee?.name    ?? row.teamSnapshot?.trainee?.name    ?? row.teamSnapshot?.traineeName);
  const teamName = compact(team?.teamName)
    || (supervisor ? `فريق ${supervisor}` : technician ? `فريق ${technician}` : '');

  if (!teamName && !supervisor && !technician && !trainee) {
    return <span className="text-slate-400">—</span>;
  }

  const labels = [
    supervisor ? `مشرف: ${supervisor}` : '',
    technician ? `فني: ${technician}` : '',
    trainee ? `متدرب: ${trainee}` : '',
  ].filter(Boolean);

  return (
    <div className="flex min-w-[180px] flex-col gap-1">
      {teamName && (
        <span className="inline-flex items-center gap-1 w-fit rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-black text-indigo-700">
          <UsersRound className="h-3 w-3" />
          {teamName}
          {team?.reassigned && <span className="text-amber-600">·معاد</span>}
        </span>
      )}
      {labels.map((label) => (
        <span key={label} className="w-fit rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
          {label}
        </span>
      ))}
    </div>
  );
}

function TasksCell({ row }: { row: VisitRow }) {
  const tasks = Array.isArray(row.tasksSummary) ? row.tasksSummary : [];
  if (tasks.length === 0) return <span className="text-slate-400">لا توجد مهام</span>;
  const unique = Array.from(new Set(tasks.map((t) => t.taskType))).slice(0, 4);
  const extra = Math.max(0, tasks.length - unique.length);
  return (
    <div className="flex min-w-[190px] flex-wrap gap-1">
      {unique.map((taskType) => (
        <span key={taskType} className="rounded-full border border-violet-100 bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700">
          {taskTypeLabel(taskType)}
        </span>
      ))}
      {extra > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">+{extra}</span>}
    </div>
  );
}

function DocumentationCell({ row }: { row: VisitRow }) {
  const allTasksDone = row.taskCount > 0 && row.documentedTaskCount >= row.taskCount;
  const complete = allTasksDone && row.hasSurvey;
  return (
    <div className="min-w-[150px] space-y-1">
      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${
        complete ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'
      }`}>
        {complete ? 'مكتمل التوثيق' : 'ناقص توثيق'}
      </span>
      <div className="text-[11px] text-slate-500">
        المهام {row.documentedTaskCount}/{row.taskCount || 0} · الاستبيان {row.hasSurvey ? (row.surveySkipped ? 'متخطى' : 'موجود') : 'ناقص'}
      </div>
    </div>
  );
}

function ExecutionCell({ row }: { row: VisitRow }) {
  const started = Boolean(row.actualStartTime) || row.status === 'in_progress' || row.status === 'ended' || row.status === 'completed';
  const ended = Boolean(row.actualEndTime) || row.status === 'ended' || row.status === 'completed';
  return (
    <div className="min-w-[135px] space-y-1 text-xs">
      <div className={started ? 'font-bold text-indigo-700' : 'text-slate-400'}>
        بدء: {started ? formatTime(row.actualStartTime) : 'لم تبدأ'}
      </div>
      <div className={ended ? 'font-bold text-cyan-700' : 'text-slate-400'}>
        إنهاء: {ended ? formatTime(row.actualEndTime) : '—'}
      </div>
      {row.locationMissing && <div className="font-bold text-amber-700">GPS مفقود</div>}
    </div>
  );
}

export default function VisitsListPage() {
  const navigate = useNavigate();
  const { user, grants } = useAuthStore();
  const { hasPermission } = usePermissions();
  const { selectedBranchId, hasBranchScope } = useBranchListScope();
  const [rows, setRows] = useState<VisitRow[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const [statusFilter, setStatusFilter] = useState('');
  const [visitTypeFilter, setVisitTypeFilter] = useState('');
  const [taskTypeFilter, setTaskTypeFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  // documentation view: tier filter (0 = any).
  const [tierFilter, setTierFilter] = useState<0 | 1 | 2 | 3>(0);
  // branch manager view: quick "stuck only" toggle to focus attention.
  const [branchStuckOnly, setBranchStuckOnly] = useState(false);
  // team view: "my visits only" vs "whole team day" (defaults to mine).
  const [teamMineOnly, setTeamMineOnly] = useState(true);
  // executive view: per-branch aggregation over a date range (defaults to last 7 days).
  const [execFrom, setExecFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  });
  const [execTo, setExecTo] = useState(todayIso);
  const [branchSummary, setBranchSummary] = useState<Array<{
    branchId: number; branchName: string | null;
    total: number; scheduled: number; inProgress: number; ended: number;
    completed: number; notCompleted: number; cancelled: number;
    stuckEscalated: number; locationMissing: number;
    avgDurationMinutes: number;
    demoOffersPresented: number; demoOffersAccepted: number;
    demoOffersRejected: number; demoOffersExtension: number;
    demoOffersPending: number;
  }>>([]);
  const [execLoading, setExecLoading] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  // tasks view: per-task-type aggregation - reuses the same date range as
  // executive view since both share the "comparison over a period" lens.
  const [taskSummary, setTaskSummary] = useState<Array<{
    taskType: string; taskFamily: string; arabicLabel: string; displayOrder: number;
    totalAttempts: number; completed: number; notCompleted: number; cancelled: number;
    inProgress: number; pending: number; documented: number;
    demoOffersPresented: number | null; demoOffersAccepted: number | null;
    demoOffersRejected: number | null; demoOffersExtension: number | null;
    demoOffersPending: number | null;
  }>>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);

  // Grant-driven only (engineering standard §3-1/§3-2): the cross-branch
  // executive view is gated by a GLOBAL grant or super-admin — never by a
  // textual role name.
  const canGlobal = user?.isSuperAdmin === true
    || grants.some((g) => g.permission === 'field_visits.view' && g.scope === 'GLOBAL');
  const canExecute = hasPermission('field_visits.edit');
  const canTasksView = hasPermission('open_tasks.view');

  const availableViews = useMemo(() => {
    const items: VisitView[] = ['daily'];
    if (canGlobal) items.push('executive');
    items.push('branch');
    if (canExecute) items.push('team');
    items.push('documentation');
    if (canTasksView) items.push('tasks');
    return items;
  }, [canExecute, canGlobal, canTasksView]);

  const [activeView, setActiveView] = useState<VisitView>('daily');

  useEffect(() => {
    if (!availableViews.includes(activeView)) setActiveView(availableViews[0] ?? 'daily');
  }, [activeView, availableViews]);

  useEffect(() => {
    if (!canGlobal) return;
    api.branches.list().then(setBranches).catch(() => setBranches([]));
  }, [canGlobal]);

  const effectiveBranchId = canGlobal
    ? (branchFilter ? Number(branchFilter) : selectedBranchId ?? undefined)
    : selectedBranchId ?? undefined;

  const load = useCallback(async () => {
    if (!date) return;
    if (!canGlobal && !selectedBranchId && !hasBranchScope) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.fieldVisits.list({
        date,
        ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(visitTypeFilter ? { visitType: visitTypeFilter } : {}),
        ...(taskTypeFilter ? { taskType: taskTypeFilter } : {}),
        ...(activeView === 'team' && teamMineOnly ? { mineOnly: true } : {}),
      });
      setRows(data as VisitRow[]);
    } catch (e: any) {
      setError(e?.message ?? 'تعذر تحميل الزيارات');
    } finally {
      setLoading(false);
    }
  }, [activeView, canGlobal, hasBranchScope, date, effectiveBranchId, selectedBranchId, statusFilter, taskTypeFilter, teamMineOnly, visitTypeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Executive view loads a separate aggregated dataset (per-branch KPIs).
  useEffect(() => {
    if (activeView !== 'executive') return;
    setExecLoading(true);
    setExecError(null);
    api.fieldVisits.branchSummary({ from: execFrom, to: execTo })
      .then((res) => setBranchSummary(res.branches ?? []))
      .catch((e: any) => setExecError(e?.message ?? 'تعذر تحميل ملخص الفروع'))
      .finally(() => setExecLoading(false));
  }, [activeView, execFrom, execTo]);

  // Tasks analytics view: per-task-type aggregation (shares the date range).
  useEffect(() => {
    if (activeView !== 'tasks') return;
    setTasksLoading(true);
    setTasksError(null);
    api.fieldVisits.taskTypeSummary({ from: execFrom, to: execTo })
      .then((res) => setTaskSummary(res.taskTypes ?? []))
      .catch((e: any) => setTasksError(e?.message ?? 'تعذر تحميل ملخص المهام'))
      .finally(() => setTasksLoading(false));
  }, [activeView, execFrom, execTo]);

  const visibleRows = useMemo(() => {
    if (activeView === 'documentation') {
      // Strict definition: only visits that genuinely need a documentation
      // action (escalated, or in_progress/ended with missing tasks/survey).
      // Completed / cancelled / closed visits are NOT documentation issues.
      return rows
        .filter(isVisitStuck)
        .filter((row) => (tierFilter === 0 ? true : maxTier(row) === tierFilter));
    }
    if (activeView === 'branch') {
      // Branch manager sees all visits for the day; toggling "stuck only"
      // narrows the table to the same definition the documentation view uses.
      return branchStuckOnly ? rows.filter(isVisitStuck) : rows;
    }
    if (activeView === 'team') {
      // Field team view: actionable visits (not cancelled/closed).
      // The mineOnly filtering is now server-side; we only filter by status here.
      return rows
        .filter((row) => !['cancelled', 'closed'].includes(row.status));
    }
    return rows;
  }, [activeView, rows, tierFilter, branchStuckOnly]);

  // Branch manager: load distribution per responsible person for the day.
  const teamLoad = useMemo(() => {
    if (activeView !== 'branch') return [] as Array<{ name: string; total: number; done: number; stuck: number }>;
    const map = new Map<string, { name: string; total: number; done: number; stuck: number }>();
    rows.forEach((r) => {
      const name = responsibleName(r) || '— غير معيّن —';
      const cur = map.get(name) ?? { name, total: 0, done: 0, stuck: 0 };
      cur.total += 1;
      if (r.status === 'completed') cur.done += 1;
      if (isVisitStuck(r)) cur.stuck += 1;
      map.set(name, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [activeView, rows]);

  const stats = useMemo(() => {
    const total = rows.length;
    const inField = rows.filter((r) => r.status === 'in_progress' || r.status === 'ended').length;
    const completed = rows.filter((r) => r.status === 'completed').length;
    const missingDocs = rows.filter((r) => r.taskCount === 0 || r.documentedTaskCount < r.taskCount || !r.hasSurvey).length;
    const escalated = rows.filter((r) => (r.escalationTiers?.length ?? 0) > 0).length;
    return { total, inField, completed, missingDocs, escalated };
  }, [rows]);

  // Documentation view has its own KPI shape: tier breakdown + avg overdue.
  const docStats = useMemo(() => {
    const stuck = rows.filter(isVisitStuck);
    const l3 = stuck.filter((r) => maxTier(r) === 3).length;
    const l2 = stuck.filter((r) => maxTier(r) === 2).length;
    const l1 = stuck.filter((r) => maxTier(r) === 1).length;
    const totalStuck = stuck.length;
    const sumHours = stuck.reduce((s, r) => s + hoursSinceUpdate(r), 0);
    const avgHours = totalStuck > 0 ? Math.round(sumHours / totalStuck) : 0;
    return { l3, l2, l1, totalStuck, avgHours };
  }, [rows]);

  const headerKpis = useMemo(() => {
    if (activeView === 'documentation') {
      return [
        { label: 'L3 · ≥72س',   value: docStats.l3,         icon: Flame,          color: 'text-rose-700 bg-rose-50' },
        { label: 'L2 · ≥48س',   value: docStats.l2,         icon: AlertTriangle,  color: 'text-orange-700 bg-orange-50' },
        { label: 'L1 · ≥24س',   value: docStats.l1,         icon: Timer,          color: 'text-amber-700 bg-amber-50' },
        { label: 'إجمالي العالق', value: docStats.totalStuck, icon: ClipboardList,  color: 'text-slate-700 bg-slate-100' },
        { label: 'متوسط الساعات', value: `${docStats.avgHours}س`, icon: Activity,    color: 'text-indigo-700 bg-indigo-50' },
      ];
    }
    if (activeView === 'tasks') {
      // Tasks view: KPIs are sums across all task types over the same period.
      const sumT = (k: keyof typeof taskSummary[number]) => taskSummary.reduce((s, t) => s + Number(t[k] || 0), 0);
      const totalAttempts = sumT('totalAttempts');
      const documented = sumT('documented');
      const docPct = totalAttempts > 0 ? Math.round((documented / totalAttempts) * 100) : 0;
      const activeTypes = taskSummary.filter((t) => t.totalAttempts > 0).length;
      return [
        { label: 'أنواع نشطة',         value: `${activeTypes}/${taskSummary.length}`, icon: ClipboardList,  color: 'text-indigo-700 bg-indigo-50' },
        { label: 'إجمالي المحاولات',  value: totalAttempts,                          icon: Activity,       color: 'text-sky-700 bg-sky-50' },
        { label: 'موثّقة بنتيجة',       value: documented,                              icon: CheckCircle2,   color: 'text-emerald-700 bg-emerald-50' },
        { label: 'معدل التوثيق',        value: `${docPct}%`,                            icon: ShieldCheck,    color: 'text-indigo-700 bg-indigo-50' },
        { label: 'لم تكتمل',            value: sumT('notCompleted') + sumT('cancelled'), icon: AlertTriangle, color: 'text-rose-700 bg-rose-50' },
      ];
    }
    if (activeView === 'executive') {
      // Executive KPIs sum across all branches over the selected date range.
      const sum = (k: keyof typeof branchSummary[number]) => branchSummary.reduce((s, b) => s + Number(b[k] || 0), 0);
      const total = sum('total');
      const completed = sum('completed');
      const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0;
      const offersPresented = sum('demoOffersPresented');
      const offersAccepted = sum('demoOffersAccepted');
      const acceptancePct = offersPresented > 0 ? Math.round((offersAccepted / offersPresented) * 100) : 0;
      return [
        { label: 'إجمالي الزيارات',   value: total,                  icon: CalendarDays,  color: 'text-sky-700 bg-sky-50' },
        { label: 'معدل الإنجاز',       value: `${completionPct}%`,    icon: Activity,      color: 'text-indigo-700 bg-indigo-50' },
        { label: 'عروض مُقدَّمة',       value: offersPresented,        icon: ShoppingCart,  color: 'text-sky-700 bg-sky-50' },
        { label: 'عروض مقبولة',        value: `${offersAccepted}${offersPresented > 0 ? ` (${acceptancePct}%)` : ''}`, icon: CheckCircle2, color: 'text-emerald-700 bg-emerald-50' },
        { label: 'مُصعَّدة',            value: sum('stuckEscalated'),  icon: AlertTriangle, color: 'text-rose-700 bg-rose-50' },
      ];
    }
    if (activeView === 'branch') {
      // Branch manager focuses on: what's the day's load, what's in flight,
      // what's already done, what needs documentation, what's escalated now.
      return [
        { label: 'زيارات اليوم',     value: stats.total,         icon: CalendarDays,  color: 'text-sky-700 bg-sky-50' },
        { label: 'بالميدان الآن',    value: stats.inField,       icon: Activity,      color: 'text-indigo-700 bg-indigo-50' },
        { label: 'مكتملة',            value: stats.completed,     icon: CheckCircle2,  color: 'text-emerald-700 bg-emerald-50' },
        { label: 'تحتاج توثيق',       value: docStats.totalStuck, icon: ClipboardList, color: 'text-amber-700 bg-amber-50' },
        { label: 'مُصعَّدة الآن',      value: stats.escalated,     icon: AlertTriangle, color: 'text-rose-700 bg-rose-50' },
      ];
    }
    if (activeView === 'team') {
      // Field team: lens shifts from "the branch" to "my visits today" — what's
      // next, what's running, what's done, what's left, what's urgent.
      const mine = rows;
      const myTotal = mine.length;
      const myInField = mine.filter((r) => r.status === 'in_progress' || r.status === 'ended').length;
      const myDone = mine.filter((r) => r.status === 'completed').length;
      const myRemaining = mine.filter((r) => ['scheduled', 'in_progress', 'ended'].includes(r.status)).length
        - mine.filter((r) => r.status === 'completed').length;
      const myUrgent = mine.filter(isVisitStuck).length;
      return [
        { label: 'زياراتي اليوم', value: myTotal,                  icon: CalendarDays,  color: 'text-sky-700 bg-sky-50' },
        { label: 'بدأت',          value: myInField,                icon: Activity,      color: 'text-indigo-700 bg-indigo-50' },
        { label: 'مكتملة',         value: myDone,                   icon: CheckCircle2,  color: 'text-emerald-700 bg-emerald-50' },
        { label: 'المتبقّي',       value: Math.max(0, myRemaining), icon: ClipboardList, color: 'text-slate-700 bg-slate-100' },
        { label: 'يحتاج إجراء',    value: myUrgent,                 icon: AlertTriangle, color: 'text-rose-700 bg-rose-50' },
      ];
    }
    return [
      { label: 'زيارات اليوم',  value: stats.total,       icon: CalendarDays,   color: 'text-sky-700 bg-sky-50' },
      { label: 'بالميدان',       value: stats.inField,     icon: Activity,       color: 'text-indigo-700 bg-indigo-50' },
      { label: 'مكتملة',         value: stats.completed,   icon: CheckCircle2,   color: 'text-emerald-700 bg-emerald-50' },
      { label: 'ناقصة توثيق',    value: stats.missingDocs, icon: ClipboardList,  color: 'text-amber-700 bg-amber-50' },
      { label: 'تصعيد',           value: stats.escalated,   icon: AlertTriangle,  color: 'text-orange-700 bg-orange-50' },
    ];
  }, [activeView, stats, docStats, rows, branchSummary, taskSummary]);

  // ── Executive view: per-branch comparison columns ──────────────────────────
  // Each numeric KPI is rendered as a value + a tiny horizontal bar, scaled
  // against the max value across all branches, so the visual signal is "who is
  // ahead of whom" without forcing the eye to read every number.
  const execMaxes = useMemo(() => {
    const max = (k: keyof typeof branchSummary[number]) =>
      branchSummary.reduce((m, b) => Math.max(m, Number(b[k] || 0)), 0);
    return {
      total: max('total'),
      completed: max('completed'),
      demoOffersPresented: max('demoOffersPresented'),
      demoOffersAccepted: max('demoOffersAccepted'),
      stuckEscalated: max('stuckEscalated'),
      avgDurationMinutes: max('avgDurationMinutes'),
    };
  }, [branchSummary]);

  const execColumns = useMemo<ColumnDef<any>[]>(() => {
    const Bar = ({ value, max, color }: { value: number; max: number; color: string }) => {
      const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
      return (
        <div className="h-1.5 w-full rounded-full bg-slate-100 mt-1 overflow-hidden">
          <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
        </div>
      );
    };
    const NumericCell = ({ value, max, color, accent }: { value: number; max: number; color: string; accent: string }) => (
      <div className="min-w-[110px]">
        <span className={`font-black text-sm ${accent}`}>{value}</span>
        <Bar value={value} max={max} color={color} />
      </div>
    );
    return [
      {
        key: 'branchName',
        label: 'الفرع',
        sortable: true,
        minWidth: '170px',
        getValue: (row) => row.branchName || '',
        render: (row) => (
          <div className="flex items-center gap-2 min-w-[150px]">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <Building2 className="h-4 w-4" />
            </div>
            <span className="font-black text-slate-800">{row.branchName || `#${row.branchId}`}</span>
          </div>
        ),
      },
      {
        key: 'total',
        label: 'الزيارات',
        sortable: true,
        width: '130px',
        getValue: (row) => row.total,
        render: (row) => <NumericCell value={row.total} max={execMaxes.total} color="bg-sky-400" accent="text-sky-700" />,
      },
      {
        key: 'completed',
        label: 'مكتملة',
        sortable: true,
        width: '140px',
        getValue: (row) => row.completed,
        render: (row) => {
          const pct = row.total > 0 ? Math.round((row.completed / row.total) * 100) : 0;
          return (
            <div className="min-w-[120px]">
              <div className="flex items-baseline gap-1.5">
                <span className="font-black text-sm text-emerald-700">{row.completed}</span>
                <span className="text-[10px] font-bold text-emerald-600">({pct}%)</span>
              </div>
              <Bar value={row.completed} max={execMaxes.completed} color="bg-emerald-400" />
            </div>
          );
        },
      },
      {
        key: 'inProgress',
        label: 'بالميدان',
        sortable: true,
        width: '100px',
        getValue: (row) => row.inProgress,
        render: (row) => (
          <span className={`inline-flex items-center gap-1 font-black text-sm ${row.inProgress > 0 ? 'text-indigo-700' : 'text-slate-400'}`}>
            <Activity className="h-3.5 w-3.5" />
            {row.inProgress}
          </span>
        ),
      },
      {
        key: 'demoOffersPresented',
        label: 'عروض مُقدَّمة',
        sortable: true,
        width: '120px',
        getValue: (row) => row.demoOffersPresented,
        render: (row) => (
          <div className="min-w-[100px]">
            <span className="inline-flex items-center gap-1 font-black text-sm text-sky-700">
              <ShoppingCart className="h-3.5 w-3.5" />
              {row.demoOffersPresented}
            </span>
            <Bar value={row.demoOffersPresented} max={execMaxes.demoOffersPresented} color="bg-sky-400" />
          </div>
        ),
      },
      {
        key: 'demoOffersAccepted',
        label: 'عروض مقبولة',
        sortable: true,
        width: '160px',
        getValue: (row) => row.demoOffersAccepted,
        render: (row) => {
          const pct = row.demoOffersPresented > 0
            ? Math.round((row.demoOffersAccepted / row.demoOffersPresented) * 100)
            : 0;
          // Compact breakdown: accepted count + rate, with rejected/extension/pending as small chips below
          return (
            <div className="min-w-[140px]">
              <div className="flex items-baseline gap-1.5">
                <span className="font-black text-sm text-emerald-700">{row.demoOffersAccepted}</span>
                {row.demoOffersPresented > 0 && (
                  <span className="text-[10px] font-bold text-emerald-600">من {row.demoOffersPresented} ({pct}%)</span>
                )}
              </div>
              <Bar value={row.demoOffersAccepted} max={execMaxes.demoOffersAccepted} color="bg-emerald-400" />
              {(row.demoOffersRejected > 0 || row.demoOffersExtension > 0 || row.demoOffersPending > 0) && (
                <div className="flex items-center gap-1 mt-1 text-[10px]">
                  {row.demoOffersRejected > 0  && <span className="text-rose-600 font-bold" title="مرفوضة">✗{row.demoOffersRejected}</span>}
                  {row.demoOffersExtension > 0 && <span className="text-amber-600 font-bold" title="بمهلة">⏳{row.demoOffersExtension}</span>}
                  {row.demoOffersPending > 0   && <span className="text-slate-500 font-bold" title="بانتظار الرد">●{row.demoOffersPending}</span>}
                </div>
              )}
            </div>
          );
        },
      },
      {
        key: 'stuckEscalated',
        label: 'مُصعَّدة',
        sortable: true,
        width: '120px',
        getValue: (row) => row.stuckEscalated,
        render: (row) => (
          <span className={`inline-flex items-center gap-1 font-black text-sm ${row.stuckEscalated > 0 ? 'text-rose-700' : 'text-slate-400'}`}>
            <AlertTriangle className="h-3.5 w-3.5" />
            {row.stuckEscalated}
          </span>
        ),
      },
      {
        key: 'avgDurationMinutes',
        label: 'متوسط المدة',
        sortable: true,
        width: '130px',
        getValue: (row) => row.avgDurationMinutes,
        render: (row) => (
          <div className="min-w-[110px]">
            <span className="font-black text-sm text-slate-700">{row.avgDurationMinutes} د</span>
            <Bar value={row.avgDurationMinutes} max={execMaxes.avgDurationMinutes} color="bg-slate-400" />
          </div>
        ),
      },
      {
        key: 'cancelled',
        label: 'ملغاة',
        sortable: true,
        width: '90px',
        getValue: (row) => row.cancelled,
        render: (row) => (
          <span className={`font-bold text-sm ${row.cancelled > 0 ? 'text-slate-600' : 'text-slate-300'}`}>{row.cancelled}</span>
        ),
      },
      {
        key: 'locationMissing',
        label: 'GPS مفقود',
        sortable: true,
        width: '100px',
        getValue: (row) => row.locationMissing,
        render: (row) => (
          <span className={`font-bold text-sm ${row.locationMissing > 0 ? 'text-amber-700' : 'text-slate-300'}`}>{row.locationMissing}</span>
        ),
      },
    ];
  }, [execMaxes]);

  // ── Tasks analytics: per-task-type column set ──────────────────────────────
  const tasksMaxes = useMemo(() => {
    const max = (k: keyof typeof taskSummary[number]) =>
      taskSummary.reduce((m, t) => Math.max(m, Number(t[k] || 0)), 0);
    return {
      totalAttempts: max('totalAttempts'),
      documented: max('documented'),
      demoOffersPresented: max('demoOffersPresented'),
      demoOffersAccepted: max('demoOffersAccepted'),
    };
  }, [taskSummary]);

  const tasksColumns = useMemo<ColumnDef<any>[]>(() => {
    const Bar = ({ value, max, color }: { value: number; max: number; color: string }) => {
      const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
      return (
        <div className="h-1.5 w-full rounded-full bg-slate-100 mt-1 overflow-hidden">
          <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
        </div>
      );
    };
    const familyMeta: Record<string, { label: string; cls: string }> = {
      marketing:   { label: 'تسويق',  cls: 'bg-violet-100 text-violet-700 border-violet-200' },
      service:     { label: 'خدمة',   cls: 'bg-sky-100 text-sky-700 border-sky-200' },
      maintenance: { label: 'صيانة',  cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
      emergency:   { label: 'طوارئ',  cls: 'bg-rose-100 text-rose-700 border-rose-200' },
      sales:       { label: 'مبيعات', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    };
    return [
      {
        key: 'arabicLabel',
        label: 'نوع المهمة',
        sortable: true,
        minWidth: '230px',
        getValue: (row) => row.displayOrder,
        render: (row) => {
          const fam = familyMeta[row.taskFamily] ?? { label: row.taskFamily, cls: 'bg-slate-100 text-slate-600 border-slate-200' };
          return (
            <div className="flex flex-col gap-1 min-w-[210px]">
              <span className="font-black text-slate-800">{row.arabicLabel}</span>
              <div className="flex items-center gap-1.5">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${fam.cls}`}>{fam.label}</span>
                <span className="font-mono text-[10px] text-slate-400">{row.taskType}</span>
              </div>
            </div>
          );
        },
      },
      {
        key: 'totalAttempts',
        label: 'المحاولات',
        sortable: true,
        width: '130px',
        getValue: (row) => row.totalAttempts,
        render: (row) => (
          <div className="min-w-[110px]">
            <span className={`font-black text-sm ${row.totalAttempts > 0 ? 'text-sky-700' : 'text-slate-300'}`}>{row.totalAttempts}</span>
            <Bar value={row.totalAttempts} max={tasksMaxes.totalAttempts} color="bg-sky-400" />
          </div>
        ),
      },
      {
        key: 'documented',
        label: 'موثّقة بنتيجة',
        sortable: true,
        width: '160px',
        getValue: (row) => row.documented,
        render: (row) => {
          const pct = row.totalAttempts > 0 ? Math.round((row.documented / row.totalAttempts) * 100) : 0;
          return (
            <div className="min-w-[140px]">
              <div className="flex items-baseline gap-1.5">
                <span className={`font-black text-sm ${row.documented > 0 ? 'text-emerald-700' : 'text-slate-300'}`}>{row.documented}</span>
                {row.totalAttempts > 0 && (
                  <span className="text-[10px] font-bold text-emerald-600">({pct}%)</span>
                )}
              </div>
              <Bar value={row.documented} max={tasksMaxes.documented} color="bg-emerald-400" />
            </div>
          );
        },
      },
      {
        key: 'notCompleted',
        label: 'لم تكتمل',
        sortable: true,
        width: '110px',
        getValue: (row) => row.notCompleted + row.cancelled,
        render: (row) => {
          const v = row.notCompleted + row.cancelled;
          return (
            <span className={`font-bold text-sm ${v > 0 ? 'text-rose-700' : 'text-slate-300'}`}>
              {v}{row.cancelled > 0 && <span className="text-[10px] text-slate-400"> · ملغاة {row.cancelled}</span>}
            </span>
          );
        },
      },
      {
        key: 'demoSpecific',
        label: 'مؤشّر النوع',
        minWidth: '220px',
        render: (row) => {
          // Currently only device_demo has a wired success signal.
          if (row.taskType === 'device_demo') {
            const presented = row.demoOffersPresented ?? 0;
            const accepted  = row.demoOffersAccepted  ?? 0;
            const pct = presented > 0 ? Math.round((accepted / presented) * 100) : 0;
            return (
              <div className="min-w-[200px]">
                <div className="flex items-baseline gap-1.5">
                  <span className="inline-flex items-center gap-1 font-black text-sm text-emerald-700">
                    <ShoppingCart className="h-3.5 w-3.5" />
                    {accepted}
                  </span>
                  <span className="text-[11px] font-bold text-emerald-600">
                    عرض مقبول{presented > 0 ? ` من ${presented} (${pct}%)` : ''}
                  </span>
                </div>
                <Bar value={accepted} max={tasksMaxes.demoOffersAccepted} color="bg-emerald-400" />
                {(row.demoOffersRejected > 0 || row.demoOffersExtension > 0 || row.demoOffersPending > 0) && (
                  <div className="flex items-center gap-1.5 mt-1 text-[10px]">
                    {row.demoOffersRejected > 0  && <span className="text-rose-600 font-bold" title="مرفوضة">✗{row.demoOffersRejected}</span>}
                    {row.demoOffersExtension > 0 && <span className="text-amber-600 font-bold" title="بمهلة">⏳{row.demoOffersExtension}</span>}
                    {row.demoOffersPending > 0   && <span className="text-slate-500 font-bold" title="بانتظار الرد">●{row.demoOffersPending}</span>}
                  </div>
                )}
              </div>
            );
          }
          return (
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 italic">
              <Eye className="h-3 w-3" /> قيد التطوير
            </span>
          );
        },
      },
    ];
  }, [tasksMaxes]);

  const taskOptions = useMemo(() => {
    const found = new Set<string>();
    rows.forEach((row) => row.tasksSummary?.forEach((task) => found.add(task.taskType)));
    Object.keys(OPEN_TASK_TYPE_LABELS as Record<string, string>).forEach((key) => found.add(key));
    return Array.from(found).sort();
  }, [rows]);

  const showOwnership = activeView === 'executive' || activeView === 'branch';

  const columns = useMemo<ColumnDef<VisitRow>[]>(() => {
    // ── Documentation & Escalation: dedicated column set ─────────────────────
    // The columns are designed to answer one question only: *why is this visit
    // still open, and who must act on it?* No execution clock, no task chips —
    // just escalation tier, what's missing, and who is accountable.
    if (activeView === 'documentation') {
      const docCols: ColumnDef<VisitRow>[] = [
        {
          key: 'tier',
          label: 'التصعيد',
          sortable: true,
          width: '120px',
          getValue: (row) => -maxTier(row), // sort by tier desc
          render: (row) => <TierBadge row={row} />,
        },
        {
          key: 'hours',
          label: 'العمر',
          sortable: true,
          width: '110px',
          getValue: (row) => -hoursSinceUpdate(row), // most overdue first
          render: (row) => <HoursOverdueCell row={row} />,
        },
        {
          key: 'clientName',
          label: 'الزبون',
          sortable: true,
          minWidth: '260px',
          getValue: getClientName,
          render: (row) => <ClientMiniCell row={row} />,
        },
        {
          key: 'status',
          label: 'الحالة',
          sortable: true,
          width: '130px',
          render: (row) => <StatusBadge status={row.status} />,
        },
        {
          key: 'responsible',
          label: 'المسؤول',
          minWidth: '150px',
          render: (row) => <ResponsibleCell row={row} />,
        },
        {
          key: 'missing',
          label: 'ما الناقص؟',
          minWidth: '200px',
          render: (row) => <MissingCell row={row} />,
        },
        {
          key: 'scheduledDate',
          label: 'تاريخ الزيارة',
          sortable: true,
          width: '120px',
          getValue: (row) => row.scheduledDate || '',
          render: (row) => <span className="text-xs font-bold text-slate-600">{formatDate(row.scheduledDate)}</span>,
        },
      ];
      if (canGlobal) {
        docCols.splice(3, 0, {
          key: 'branchName',
          label: 'الفرع',
          sortable: true,
          width: '120px',
          getValue: (row) => row.branchName || '',
          render: (row) => <span className="text-xs font-bold text-slate-700">{row.branchName || `#${row.branchId}`}</span>,
        });
      }
      return docCols;
    }

    // ── Branch Manager: dedicated column set ─────────────────────────────────
    // Promotes the responsible supervisor column and folds the escalation
    // signal into the status badge so stuck visits surface inline without a
    // dedicated tab switch.
    if (activeView === 'branch') {
      return [
        {
          key: 'scheduledTime',
          label: 'الوقت',
          sortable: true,
          width: '100px',
          getValue: (row) => row.scheduledTime || '',
          render: (row) => <span className="font-mono text-xs font-bold text-slate-700">{row.scheduledTime || '—'}</span>,
        },
        {
          key: 'status',
          label: 'الحالة',
          sortable: true,
          minWidth: '170px',
          render: (row) => <StatusWithTier row={row} />,
        },
        {
          key: 'responsible',
          label: 'المسؤول',
          sortable: true,
          minWidth: '170px',
          getValue: responsibleName,
          render: (row) => <ResponsibleCell row={row} />,
        },
        {
          key: 'clientName',
          label: 'الزبون',
          sortable: true,
          minWidth: '280px',
          getValue: getClientName,
          render: (row) => <ClientMiniCell row={row} />,
        },
        {
          key: 'tasks',
          label: 'المهام',
          minWidth: '200px',
          render: (row) => <TasksCell row={row} />,
        },
        {
          key: 'execution',
          label: 'التنفيذ',
          minWidth: '140px',
          render: (row) => <ExecutionCell row={row} />,
        },
        {
          key: 'documentation',
          label: 'التوثيق',
          minWidth: '170px',
          render: (row) => <DocumentationCell row={row} />,
        },
        {
          key: 'originType',
          label: 'المصدر',
          width: '120px',
          render: (row) => <span className="text-xs font-bold text-slate-500">{ORIGIN_LABELS[row.originType || ''] || row.originType || '—'}</span>,
        },
      ];
    }

    // ── Field Team: dedicated column set ─────────────────────────────────────
    // The field team is in motion — they need: when is the next visit, who
    // exactly are they visiting, can I call them, where is it, what tasks must
    // I cover, and was there anything the telemarketer flagged?
    if (activeView === 'team') {
      return [
        {
          key: 'scheduledTime',
          label: 'الوقت',
          sortable: true,
          width: '90px',
          getValue: (row) => row.scheduledTime || '',
          render: (row) => <span className="font-mono text-xs font-black text-slate-800">{row.scheduledTime || '—'}</span>,
        },
        {
          key: 'status',
          label: 'الحالة',
          sortable: true,
          minWidth: '160px',
          render: (row) => <StatusWithTier row={row} />,
        },
        {
          key: 'clientName',
          label: 'الزبون',
          sortable: true,
          minWidth: '260px',
          getValue: getClientName,
          render: (row) => {
            const mobile = getClientMobile(row);
            const classification = getClassification(row);
            return (
              <div className="flex min-w-[240px] items-start gap-2">
                <ClientAvatar gender={row.clientGender ?? null} dataQuality={row.clientDataQuality ?? null} size="sm" />
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-black text-slate-800">{getClientName(row)}</span>
                    {classification && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{classification}</span>
                    )}
                  </div>
                  {mobile && mobile !== '—' && (
                    <a
                      href={`tel:${mobile}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-xs font-bold text-sky-600 hover:underline"
                      dir="ltr"
                    >
                      <Phone className="h-3 w-3" />
                      {mobile}
                    </a>
                  )}
                </div>
              </div>
            );
          },
        },
        {
          key: 'address',
          label: 'العنوان',
          minWidth: '220px',
          render: (row) => {
            const addr = getAddressShort(row);
            const gps = row.customerSnapshot?.gps || row.customerSnapshot?.gps_coordinates;
            const lat = gps?.lat, lng = gps?.lng;
            const mapHref = lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : null;
            return (
              <div className="flex min-w-[200px] flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">{addr}</span>
                {mapHref && (
                  <a
                    href={mapHref}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-600 hover:underline w-fit"
                  >
                    <MapPin className="h-3 w-3" />
                    افتح على الخريطة
                  </a>
                )}
              </div>
            );
          },
        },
        {
          key: 'tasks',
          label: 'المهام',
          minWidth: '200px',
          render: (row) => <TasksCell row={row} />,
        },
        {
          key: 'telemarketerNotes',
          label: 'ملاحظات التيلماركتر',
          minWidth: '200px',
          render: (row) => {
            const notes = compact(row.customerSnapshot?.telemarketerNotes || row.customerSnapshot?.notes);
            if (!notes) return <span className="text-slate-300 text-xs">—</span>;
            return (
              <div className="flex items-start gap-1.5 max-w-[240px]">
                <NotebookPen className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                <span className="text-[11px] text-slate-600 line-clamp-2">{notes}</span>
              </div>
            );
          },
        },
        {
          key: 'execution',
          label: 'التنفيذ',
          minWidth: '130px',
          render: (row) => <ExecutionCell row={row} />,
        },
      ];
    }

    // ── Default column set used by daily / executive / tasks ─
    const base: ColumnDef<VisitRow>[] = [
      {
        key: 'scheduledTime',
        label: 'الوقت',
        sortable: true,
        width: '110px',
        getValue: (row) => row.scheduledTime || '',
        render: (row) => <span className="font-mono text-xs font-bold text-slate-700">{row.scheduledTime || '—'}</span>,
      },
      {
        key: 'status',
        label: 'الحالة',
        sortable: true,
        width: '150px',
        render: (row) => <StatusBadge status={row.status} />,
      },
      {
        key: 'clientName',
        label: 'الزبون',
        sortable: true,
        minWidth: '300px',
        getValue: getClientName,
        render: (row) => <ClientMiniCell row={row} showOwnership={showOwnership} />,
      },
      {
        key: 'team',
        label: 'الفريق',
        minWidth: '190px',
        render: (row) => <TeamCell row={row} />,
      },
      {
        key: 'visitType',
        label: 'نوع الزيارة',
        sortable: true,
        width: '130px',
        render: (row) => (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-bold text-slate-600">
            {VISIT_TYPE_LABELS[row.visitType || ''] || row.visitType || '—'}
          </span>
        ),
      },
      {
        key: 'tasks',
        label: 'المهام داخل الزيارة',
        minWidth: '220px',
        render: (row) => <TasksCell row={row} />,
      },
      {
        key: 'execution',
        label: 'التنفيذ',
        minWidth: '150px',
        render: (row) => <ExecutionCell row={row} />,
      },
      {
        key: 'documentation',
        label: 'التوثيق',
        minWidth: '170px',
        render: (row) => <DocumentationCell row={row} />,
      },
    ];

    if (activeView === 'executive') {
      base.splice(1, 0, {
        key: 'branchName',
        label: 'الفرع',
        sortable: true,
        width: '130px',
        getValue: (row) => row.branchName || '',
        render: (row) => <span className="font-bold text-slate-700">{row.branchName || `#${row.branchId}`}</span>,
      });
    }

    if (activeView === 'tasks') {
      base.push({
        key: 'taskCount',
        label: 'عدد المهام',
        sortable: true,
        width: '110px',
        getValue: (row) => row.taskCount,
        render: (row) => <span className="font-black text-slate-700">{row.taskCount}</span>,
      });
    }

    base.push({
      key: 'originType',
      label: 'المصدر',
      width: '130px',
      render: (row) => <span className="text-xs font-bold text-slate-500">{ORIGIN_LABELS[row.originType || ''] || row.originType || '—'}</span>,
    });

    return base;
  }, [activeView, canGlobal, showOwnership]);

  if (!canGlobal && !selectedBranchId && !hasBranchScope) {
    return (
      <div className="p-8 text-center text-slate-500" dir="rtl">
        <CalendarDays className="mx-auto mb-4 h-12 w-12 text-slate-300" />
        <p className="text-lg font-bold">يرجى اختيار فرع لعرض جدول الزيارات اليومي.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6" dir="rtl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500 text-white shadow-lg shadow-sky-500/20">
            <CalendarDays className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-800">الزيارات</h1>
            <p className="text-sm text-slate-500">جدول يومي مركزي للزيارات كوعاء لكل المهام التشغيلية.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          {/* Visit-level filters - hidden for the aggregated executive/tasks
              views, which have their own date-range picker rendered below. */}
          {activeView !== 'executive' && activeView !== 'tasks' && (
            <>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
              {canGlobal && (
                <select
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                >
                  <option value="">كل الفروع / الفرع المحدد</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
              )}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
              >
                <option value="">كل الحالات</option>
                {Object.entries(VISIT_STATUS_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <select
                value={visitTypeFilter}
                onChange={(e) => setVisitTypeFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
              >
                <option value="">كل أنواع الزيارة</option>
                {Object.entries(VISIT_TYPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <select
                value={taskTypeFilter}
                onChange={(e) => setTaskTypeFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
              >
                <option value="">كل أنواع المهام</option>
                {taskOptions.map((taskType) => (
                  <option key={taskType} value={taskType}>{taskTypeLabel(taskType)}</option>
                ))}
              </select>
            </>
          )}
          {activeView === 'documentation' && (
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(Number(e.target.value) as 0 | 1 | 2 | 3)}
              className="rounded-lg border border-rose-200 bg-rose-50/40 px-3 py-2 text-sm font-bold text-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-300"
              title="مستوى التصعيد"
            >
              <option value={0}>كل مستويات التصعيد</option>
              <option value={3}>L3 فقط (≥72 ساعة)</option>
              <option value={2}>L2 فقط (≥48 ساعة)</option>
              <option value={1}>L1 فقط (≥24 ساعة)</option>
            </select>
          )}
          {activeView === 'branch' && (
            <button
              type="button"
              onClick={() => setBranchStuckOnly((v) => !v)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-bold transition ${
                branchStuckOnly
                  ? 'border-rose-300 bg-rose-50 text-rose-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              title="إظهار الزيارات التي تحتاج توثيقاً فقط"
            >
              <AlertTriangle className="h-4 w-4" />
              {branchStuckOnly ? 'العالقة فقط (نشط)' : 'إظهار العالقة فقط'}
            </button>
          )}
          {activeView === 'team' && user?.employeeId != null && (
            <button
              type="button"
              onClick={() => setTeamMineOnly((v) => !v)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-bold transition ${
                teamMineOnly
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              title="فلتر الزيارات بناء على وجودي في الفريق"
            >
              <UserCheck className="h-4 w-4" />
              {teamMineOnly ? 'زياراتي فقط (نشط)' : 'كل زيارات الفرق'}
            </button>
          )}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {headerKpis.map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${item.color}`}>
                <item.icon className="h-4 w-4" />
              </span>
              <div>
                <div className="text-lg font-black text-slate-800">{item.value}</div>
                <div className="text-[11px] font-bold text-slate-500">{item.label}</div>
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="flex flex-wrap gap-2">
        {availableViews.map((view) => {
          const meta = VIEW_META[view];
          const Icon = meta.icon;
          const active = view === activeView;
          return (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold transition ${
                active
                  ? 'border-sky-200 bg-sky-50 text-sky-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              title={meta.description}
            >
              <Icon className="h-4 w-4" />
              {meta.label}
            </button>
          );
        })}
      </section>

      <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500">
        <div className="flex items-center gap-2 font-bold text-slate-700">
          <Eye className="h-4 w-4 text-sky-600" />
          {VIEW_META[activeView].label}
        </div>
        <p className="mt-1">{VIEW_META[activeView].description}</p>
      </div>

      {activeView === 'branch' && teamLoad.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2 mb-2 text-xs font-bold text-slate-600">
            <UsersRound className="h-4 w-4 text-indigo-500" />
            توزيع زيارات اليوم على المسؤولين ({teamLoad.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {teamLoad.map((t) => {
              const isUnassigned = t.name.startsWith('—');
              return (
                <div
                  key={t.name}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                    isUnassigned
                      ? 'border-rose-200 bg-rose-50 text-rose-700'
                      : 'border-slate-200 bg-slate-50 text-slate-700'
                  }`}
                  title={`إجمالي ${t.total} · مكتملة ${t.done} · عالقة ${t.stuck}`}
                >
                  <UserCheck className={`h-3.5 w-3.5 ${isUnassigned ? 'text-rose-500' : 'text-indigo-500'}`} />
                  <span className="font-bold">{t.name}</span>
                  <span className="rounded bg-white px-1.5 py-0.5 font-black">{t.total}</span>
                  {t.done > 0 && (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" />{t.done}
                    </span>
                  )}
                  {t.stuck > 0 && (
                    <span className="inline-flex items-center gap-1 text-rose-700">
                      <AlertTriangle className="h-3 w-3" />{t.stuck}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {(activeView === 'executive' || activeView === 'tasks') && (() => {
        // ── Date-range presets ────────────────────────────────────────────
        // Quick shortcuts cover the three most common executive lenses. The
        // custom from/to inputs stay live so the manager can refine after.
        const today = todayIso();
        const daysAgo = (n: number) => {
          const d = new Date();
          d.setDate(d.getDate() - n);
          d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
          return d.toISOString().slice(0, 10);
        };
        const startOfMonth = (() => {
          const d = new Date();
          d.setDate(1);
          d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
          return d.toISOString().slice(0, 10);
        })();
        const presets: Array<{ key: string; label: string; from: string; to: string }> = [
          { key: 'today',  label: 'اليوم',         from: today,        to: today },
          { key: 'week',   label: 'آخر ٧ أيام',     from: daysAgo(6),   to: today },
          { key: 'month',  label: 'الشهر الحالي',   from: startOfMonth, to: today },
        ];
        const activePreset = presets.find((p) => p.from === execFrom && p.to === execTo)?.key ?? 'custom';
        return (
          <section className="rounded-lg border border-slate-200 bg-white p-3 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs font-bold text-indigo-700">
              <CalendarDays className="h-4 w-4" />
              الفترة:
            </span>
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => { setExecFrom(p.from); setExecTo(p.to); }}
                className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                  activePreset === p.key
                    ? 'border-indigo-400 bg-indigo-50 text-indigo-700 shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {p.label}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <label className="text-xs text-slate-500">من</label>
            <input
              type="date"
              value={execFrom}
              max={execTo}
              onChange={(e) => setExecFrom(e.target.value)}
              className={`rounded-lg border px-2 py-1.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-300 ${
                activePreset === 'custom'
                  ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            />
            <label className="text-xs text-slate-500">إلى</label>
            <input
              type="date"
              value={execTo}
              min={execFrom}
              onChange={(e) => setExecTo(e.target.value)}
              className={`rounded-lg border px-2 py-1.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-300 ${
                activePreset === 'custom'
                  ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            />
            <span className="text-[11px] text-slate-400 mr-auto">
              {activePreset === 'custom'
                ? 'فترة مخصّصة'
                : activeView === 'tasks'
                  ? 'تحليل أداء أنواع المهام'
                  : 'مقارنة الأداء عبر الفروع'}
            </span>
          </section>
        );
      })()}

      {(activeView === 'executive' ? execError : activeView === 'tasks' ? tasksError : error) && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {activeView === 'executive' ? execError : activeView === 'tasks' ? tasksError : error}
        </div>
      )}

      {activeView === 'executive' ? (
        execLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-500">
            <Loader2 className="ml-2 h-8 w-8 animate-spin text-indigo-500" />
            جار تحميل ملخص الفروع...
          </div>
        ) : (
          <SmartTable
            title="مقارنة أداء الفروع"
            icon={ShieldCheck}
            data={branchSummary as any}
            columns={execColumns as any}
            searchKeys={['branchName']}
            searchPlaceholder="بحث باسم الفرع..."
            emptyIcon={ShieldCheck}
            emptyMessage="لا توجد بيانات للفترة المختارة"
            getId={(row: any) => row.branchId}
            tableMinWidth={1100}
            defaultSortKey="total"
            defaultSortDir="desc"
          />
        )
      ) : activeView === 'tasks' ? (
        tasksLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-500">
            <Loader2 className="ml-2 h-8 w-8 animate-spin text-indigo-500" />
            جار تحميل ملخص المهام...
          </div>
        ) : (
          <SmartTable
            title="تحليل أداء أنواع المهام"
            icon={ClipboardList}
            data={taskSummary as any}
            columns={tasksColumns as any}
            searchKeys={['arabicLabel', 'taskType']}
            searchPlaceholder="بحث باسم نوع المهمة..."
            emptyIcon={ClipboardList}
            emptyMessage="لا توجد مهام للفترة المختارة"
            getId={(row: any) => row.taskType}
            tableMinWidth={900}
            defaultSortKey="totalAttempts"
            defaultSortDir="desc"
          />
        )
      ) : loading ? (
        <div className="flex items-center justify-center py-16 text-slate-500">
          <Loader2 className="ml-2 h-8 w-8 animate-spin text-sky-500" />
          جار تحميل الزيارات...
        </div>
      ) : (
        <SmartTable
          title={activeView === 'documentation'
            ? 'الزيارات العالقة بانتظار التوثيق'
            : activeView === 'branch'
              ? (branchStuckOnly ? 'زيارات الفرع — العالقة فقط' : 'زيارات الفرع لليوم')
              : activeView === 'team'
                ? (teamMineOnly && user?.employeeId != null ? 'زياراتي اليوم' : 'زيارات الفريق التشغيلي')
                : 'جدول الزيارات اليومي'}
          icon={activeView === 'documentation'
            ? AlertTriangle
            : activeView === 'branch' ? Building2
            : activeView === 'team'   ? UsersRound
            : MapPinned}
          data={visibleRows}
          columns={columns}
          searchKeys={['clientName', 'clientMobile', 'branchName', 'status']}
          searchPlaceholder={activeView === 'documentation' || activeView === 'branch'
            ? 'بحث باسم الزبون / المسؤول / الحالة...'
            : activeView === 'team'
              ? 'بحث باسم الزبون / الجوال / المنطقة...'
              : 'بحث باسم الزبون أو الموبايل أو الفرع...'}
          emptyIcon={activeView === 'documentation' ? CheckCircle2 : CalendarDays}
          emptyMessage={activeView === 'documentation'
            ? 'لا توجد زيارات عالقة — كل التوثيق مكتمل ✅'
            : activeView === 'branch' && branchStuckOnly
              ? 'لا توجد زيارات عالقة في فرعك اليوم ✅'
              : activeView === 'team' && teamMineOnly
                ? 'ما عندك زيارات اليوم — استرح 👋'
                : 'لا توجد زيارات ضمن الفلاتر الحالية'}
          getId={(row) => row.id}
          onRowClick={(row) => navigate(`/field-visits/${row.id}`)}
          tableMinWidth={1200}
          defaultSortKey={activeView === 'documentation' ? 'tier' : 'scheduledTime'}
          defaultSortDir="asc"
        />
      )}
    </div>
  );
}
