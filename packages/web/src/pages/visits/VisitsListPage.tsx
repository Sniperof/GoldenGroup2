import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Eye,
  Filter,
  Loader2,
  MapPinned,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import SmartTable, { type ColumnDef } from '../../components/SmartTable';
import ClientAvatar from '../../components/ClientAvatar';
import { api } from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuthStore';
import { useBranchContextStore } from '../../hooks/useBranchContextStore';
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
  const snap = row.teamSnapshot || {};
  const supervisor = compact(snap.supervisor?.name ?? snap.supervisorName);
  const technician = compact(snap.technician?.name ?? snap.technicianName);
  const trainee = compact(snap.trainee?.name ?? snap.traineeName);
  const labels = [
    supervisor ? `مشرف: ${supervisor}` : '',
    technician ? `فني: ${technician}` : '',
    trainee ? `متدرب: ${trainee}` : '',
  ].filter(Boolean);
  if (labels.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex min-w-[180px] flex-col gap-1">
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
  const { branchId: selectedBranchId } = useBranchContextStore();
  const [rows, setRows] = useState<VisitRow[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const [statusFilter, setStatusFilter] = useState('');
  const [visitTypeFilter, setVisitTypeFilter] = useState('');
  const [taskTypeFilter, setTaskTypeFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');

  const canGlobal = user?.isSuperAdmin === true
    || user?.role === 'ADMIN'
    || user?.role === 'HR_MANAGER'
    || grants.some((g) => g.permission === 'field_visits.view' && g.scope === 'GLOBAL');
  const canExecute = hasPermission('field_visits.execute');
  const canTasksView = hasPermission('tasks.view') || hasPermission('open_tasks.view');

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
    if (!canGlobal && !selectedBranchId) {
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
      });
      setRows(data as VisitRow[]);
    } catch (e: any) {
      setError(e?.message ?? 'تعذر تحميل الزيارات');
    } finally {
      setLoading(false);
    }
  }, [canGlobal, date, effectiveBranchId, selectedBranchId, statusFilter, taskTypeFilter, visitTypeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleRows = useMemo(() => {
    if (activeView === 'documentation') {
      return rows.filter((row) => {
        const taskDocsMissing = row.taskCount === 0 || row.documentedTaskCount < row.taskCount;
        const surveyMissing = !row.hasSurvey;
        const escalated = (row.escalationTiers?.length ?? 0) > 0;
        return taskDocsMissing || surveyMissing || escalated || row.status === 'ended' || row.status === 'in_progress';
      });
    }
    if (activeView === 'team') {
      return rows.filter((row) => ['scheduled', 'in_progress', 'ended'].includes(row.status));
    }
    return rows;
  }, [activeView, rows]);

  const stats = useMemo(() => {
    const total = rows.length;
    const inField = rows.filter((r) => r.status === 'in_progress' || r.status === 'ended').length;
    const completed = rows.filter((r) => r.status === 'completed').length;
    const missingDocs = rows.filter((r) => r.taskCount === 0 || r.documentedTaskCount < r.taskCount || !r.hasSurvey).length;
    const escalated = rows.filter((r) => (r.escalationTiers?.length ?? 0) > 0).length;
    return { total, inField, completed, missingDocs, escalated };
  }, [rows]);

  const taskOptions = useMemo(() => {
    const found = new Set<string>();
    rows.forEach((row) => row.tasksSummary?.forEach((task) => found.add(task.taskType)));
    Object.keys(OPEN_TASK_TYPE_LABELS as Record<string, string>).forEach((key) => found.add(key));
    return Array.from(found).sort();
  }, [rows]);

  const showOwnership = activeView === 'executive' || activeView === 'branch';

  const columns = useMemo<ColumnDef<VisitRow>[]>(() => {
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

    if (activeView === 'documentation') {
      base.push({
        key: 'alerts',
        label: 'التصعيد',
        width: '130px',
        render: (row) => {
          const tiers = row.escalationTiers || [];
          return tiers.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {tiers.map((tier) => (
                <span key={tier} className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-black text-orange-800">L{tier}</span>
              ))}
            </div>
          ) : <span className="text-slate-400">—</span>;
        },
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
  }, [activeView, showOwnership]);

  if (!canGlobal && !selectedBranchId) {
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
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { label: 'زيارات اليوم', value: stats.total, icon: CalendarDays, color: 'text-sky-700 bg-sky-50' },
          { label: 'بالميدان', value: stats.inField, icon: Activity, color: 'text-indigo-700 bg-indigo-50' },
          { label: 'مكتملة', value: stats.completed, icon: CheckCircle2, color: 'text-emerald-700 bg-emerald-50' },
          { label: 'ناقصة توثيق', value: stats.missingDocs, icon: ClipboardList, color: 'text-amber-700 bg-amber-50' },
          { label: 'تصعيد', value: stats.escalated, icon: AlertTriangle, color: 'text-orange-700 bg-orange-50' },
        ].map((item) => (
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

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-500">
          <Loader2 className="ml-2 h-8 w-8 animate-spin text-sky-500" />
          جار تحميل الزيارات...
        </div>
      ) : (
        <SmartTable
          title="جدول الزيارات اليومي"
          icon={MapPinned}
          data={visibleRows}
          columns={columns}
          searchKeys={['clientName', 'clientMobile', 'branchName', 'status']}
          searchPlaceholder="بحث باسم الزبون أو الموبايل أو الفرع..."
          emptyIcon={CalendarDays}
          emptyMessage="لا توجد زيارات ضمن الفلاتر الحالية"
          getId={(row) => row.id}
          onRowClick={(row) => navigate(`/field-visits/${row.id}`)}
          tableMinWidth={1200}
          defaultSortKey="scheduledTime"
          defaultSortDir="asc"
        />
      )}
    </div>
  );
}
