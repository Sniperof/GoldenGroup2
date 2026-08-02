import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { OPEN_TASK_FAMILY_LABELS } from '@golden-crm/shared';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ExternalLink,
  Filter,
  Info,
  ListChecks,
  Loader2,
  Lock,
  MapPin,
  Phone,
  PhoneCall,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Target,
  Undo2,
  Users,
  X,
} from '../../components/ui/icons';
import Checkbox from '../../components/ui/Checkbox';
import DataTable from '../../components/ui/DataTable';
import Modal from '../../components/ui/Modal';
import Select from '../../components/ui/Select';
import { useAuthStore } from '../../hooks/useAuthStore';
import { useBranchContextStore } from '../../hooks/useBranchContextStore';
import {
  api,
  type PlanningCurationAction,
  type PlanningCurationDashboardResponse,
  type PlanningCurationRow,
  type PlanningCurationSelector,
  type PlanningCurationTask,
  type PlanningDashboardFilters,
  type PlanningDayCycleSummary,
  type PlanningExclusionLayer,
  type PlanningTargetMode,
} from '../../lib/api';

type LifecycleStatus = 'ready' | 'queued' | 'in_call_list' | 'contacted' | 'closed';
type SelectionScope = 'TASKS' | 'CONTACTS';
type SortDir = 'asc' | 'desc';
type SortKey = 'clientName' | 'clientId' | 'station' | 'status';

type SelectionState = {
  scope: SelectionScope;
  allMatching: boolean;
  taskIds: Set<number>;
  contactKeys: Set<string>;
  exceptTaskIds: Set<number>;
  exceptContactKeys: Set<string>;
};

type CurationOperation = {
  action: PlanningCurationAction;
  layer: PlanningExclusionLayer;
  label: string;
  description: string;
  tone: 'amber' | 'red' | 'slate' | 'emerald';
};

type PendingCuration = {
  operation: CurationOperation;
  selector: PlanningCurationSelector;
  selectionLabel: string;
};

type CurationPreview = Awaited<ReturnType<typeof api.planning.previewCuration>>;

const EMPTY_SELECTION = (scope: SelectionScope = 'TASKS'): SelectionState => ({
  scope,
  allMatching: false,
  taskIds: new Set(),
  contactKeys: new Set(),
  exceptTaskIds: new Set(),
  exceptContactKeys: new Set(),
});

const LIFECYCLE_META: Record<
  LifecycleStatus,
  { label: string; badge: string; dot: string; card: string }
> = {
  ready: {
    label: 'جاهزة',
    badge: 'border-amber-200 bg-amber-50 text-amber-700',
    dot: 'bg-amber-500',
    card: 'border-amber-200 bg-amber-50/70',
  },
  queued: {
    label: 'ضمن القائمة',
    badge: 'border-sky-200 bg-sky-50 text-sky-700',
    dot: 'bg-sky-500',
    card: 'border-sky-200 bg-sky-50/70',
  },
  in_call_list: {
    label: 'قيد المعالجة',
    badge: 'border-cyan-200 bg-cyan-50 text-cyan-700',
    dot: 'bg-cyan-500',
    card: 'border-cyan-200 bg-cyan-50/70',
  },
  contacted: {
    label: 'تم التواصل',
    badge: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    dot: 'bg-indigo-500',
    card: 'border-indigo-200 bg-indigo-50/70',
  },
  closed: {
    label: 'مغلقة',
    badge: 'border-slate-200 bg-slate-100 text-slate-600',
    dot: 'bg-slate-500',
    card: 'border-slate-200 bg-slate-50',
  },
};

const TASK_STATUS_LABELS: Record<string, string> = {
  open: 'قيد الانتظار',
  needs_follow_up: 'تحتاج متابعة',
  assigned: 'مسندة للتخطيط',
  in_scheduling: 'قيد الجدولة',
  scheduled: 'مجدولة',
  waiting_execution: 'بانتظار التنفيذ',
  in_execution: 'قيد التنفيذ',
  ended: 'منتهية',
  completed: 'مكتملة',
  closed: 'مغلقة',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'منخفضة',
  normal: 'عادية',
  medium: 'متوسطة',
  high: 'عالية',
  urgent: 'عاجلة',
  critical: 'حرجة',
};

const TARGET_MODE_OPTIONS: Array<{ value: PlanningTargetMode; label: string }> = [
  { value: 'MATCHING_TASKS', label: 'المهام المطابقة فقط' },
  { value: 'ALL_TASKS_OF_MATCHED_CONTACTS', label: 'كل مهام الجهات المطابقة' },
  { value: 'NON_MATCHING_TASKS_OF_MATCHED_CONTACTS', label: 'المهام غير المطابقة داخل الجهات' },
];

const TASK_OPERATIONS: CurationOperation[] = [
  {
    action: 'EXCLUDE',
    layer: 'TEAM_DAY',
    label: 'غير مناسبة لهذا الفريق اليوم',
    description: 'تحرير المهام من هذا الفريق فقط مع بقائها متاحة لفريق آخر مؤهل في اليوم نفسه.',
    tone: 'amber',
  },
  {
    action: 'EXCLUDE',
    layer: 'ALL_TEAMS_DAY',
    label: 'استبعاد من جميع الفرق اليوم',
    description: 'إخراج المهام من خطة هذا اليوم لجميع الفرق دون تغيير حالتها التاريخية.',
    tone: 'red',
  },
  {
    action: 'RESTORE',
    layer: 'TEAM_DAY',
    label: 'استعادة إتاحة هذا الفريق',
    description: 'إلغاء قرار عدم ملاءمة الفريق فقط دون انتزاع المهمة من فريق آخر.',
    tone: 'emerald',
  },
  {
    action: 'RESTORE',
    layer: 'ALL_TEAMS_DAY',
    label: 'استعادة الإتاحة العامة',
    description: 'إلغاء استبعاد اليوم عن جميع الفرق، مع إعادة تقييم الإسناد من الخادم.',
    tone: 'emerald',
  },
];

const CONTACT_OPERATIONS: CurationOperation[] = [
  {
    action: 'SET_DO_NOT_CONTACT',
    layer: 'CLIENT_DO_NOT_CONTACT',
    label: 'تفعيل عدم التواصل',
    description: 'قرار دائم على الزبون يؤثر في جميع مهامه وفرق العمل حتى إلغائه.',
    tone: 'red',
  },
  {
    action: 'CLEAR_DO_NOT_CONTACT',
    layer: 'CLIENT_DO_NOT_CONTACT',
    label: 'إلغاء عدم التواصل',
    description: 'إزالة الحظر الدائم؛ تبقى بقية شروط الأهلية وقرارات اليوم فعالة.',
    tone: 'emerald',
  },
];

const getPlanningDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const toCsv = (values: Array<string | number> | undefined) => values?.join(',') ?? '';
const fromCsv = (value: string | null) => value?.split(',').map(item => item.trim()).filter(Boolean) ?? [];
const fromNumberCsv = (value: string | null) => fromCsv(value)
  .map(Number)
  .filter(item => Number.isInteger(item) && item > 0);

function initialFilters(searchParams: URLSearchParams): PlanningDashboardFilters {
  const lifecycleStatuses = fromCsv(searchParams.get('status'))
    .filter(value => ['ready', 'queued', 'in_call_list', 'contacted', 'closed'].includes(value)) as LifecycleStatus[];
  const due = searchParams.get('due');
  const optionalNonNegativeInteger = (key: string) => {
    const raw = searchParams.get(key);
    if (raw == null || raw.trim() === '') return undefined;
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  };
  const minTasks = optionalNonNegativeInteger('minTasks');
  const maxTasks = optionalNonNegativeInteger('maxTasks');
  return {
    ...(searchParams.get('q') ? { q: searchParams.get('q')! } : {}),
    ...(lifecycleStatuses.length ? { lifecycleStatuses } : {}),
    ...(fromNumberCsv(searchParams.get('stations')).length
      ? { stationIds: fromNumberCsv(searchParams.get('stations')) }
      : {}),
    ...(fromCsv(searchParams.get('classes')).length
      ? { classifications: fromCsv(searchParams.get('classes')) }
      : {}),
    ...(fromCsv(searchParams.get('ownership')).length
      ? { ownershipTypes: fromCsv(searchParams.get('ownership')) }
      : {}),
    ...(minTasks != null ? { minTaskCount: minTasks } : {}),
    ...(maxTasks != null ? { maxTaskCount: maxTasks } : {}),
    ...(fromNumberCsv(searchParams.get('taskIds')).length
      ? { taskIds: fromNumberCsv(searchParams.get('taskIds')) }
      : {}),
    ...(fromCsv(searchParams.get('taskTypes')).length
      ? { taskTypes: fromCsv(searchParams.get('taskTypes')) }
      : {}),
    ...(fromCsv(searchParams.get('families')).length
      ? { taskFamilies: fromCsv(searchParams.get('families')) }
      : {}),
    ...(fromCsv(searchParams.get('priorities')).length
      ? { priorities: fromCsv(searchParams.get('priorities')) }
      : {}),
    ...(['OVERDUE', 'ON_DATE', 'FUTURE', 'NO_DATE'].includes(due ?? '')
      ? { dueState: due as PlanningDashboardFilters['dueState'] }
      : {}),
    ...(fromCsv(searchParams.get('exclusions')).length
      ? {
          exclusionLayers: fromCsv(searchParams.get('exclusions')) as PlanningDashboardFilters['exclusionLayers'],
        }
      : {}),
  };
}

function cleanFilters(filters: PlanningDashboardFilters): PlanningDashboardFilters {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => (
      value !== undefined
      && value !== ''
      && (!Array.isArray(value) || value.length > 0)
    )),
  ) as PlanningDashboardFilters;
}

function formatDateTime(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat('ar-SY', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

function classificationLabel(value: string | null) {
  if (value === 'OP') return 'OP';
  if (value === 'FOP') return 'FOP';
  return 'Lead';
}

function taskFamilyLabel(value: string): string {
  return (OPEN_TASK_FAMILY_LABELS as Record<string, string>)[value] ?? value;
}

function taskCountLabel(count: number): string {
  if (count === 1) return 'مهمة واحدة';
  if (count === 2) return 'مهمتان';
  if (count >= 3 && count <= 10) return `${count} مهام`;
  return `${count} مهمة`;
}

function contactAttemptLabel(count: number): string {
  if (count === 0) return 'لم تبدأ محاولة اتصال';
  if (count === 1) return 'محاولة اتصال واحدة';
  if (count === 2) return 'محاولتا اتصال';
  if (count >= 3 && count <= 10) return `${count} محاولات اتصال`;
  return `${count} محاولة اتصال`;
}

function fallbackTeamLabel(teamKey: string): string {
  const [kind, rawIndex] = teamKey.split('_');
  const index = Number(rawIndex);
  const number = Number.isInteger(index) ? index + 1 : null;
  return kind === 'solo'
    ? `فريق طوارئ${number == null ? '' : ` رقم ${number}`}`
    : `الفريق${number == null ? '' : ` رقم ${number}`}`;
}

function ownershipLabel(value: string, ownerLabel: string) {
  return value === 'personal' ? `ملكية شخصية · ${ownerLabel}` : `ملكية الشركة · ${ownerLabel}`;
}

function taskMatchesMode(task: PlanningCurationTask, mode: PlanningTargetMode) {
  if (mode === 'MATCHING_TASKS') return task.matchesTaskFilters;
  if (mode === 'NON_MATCHING_TASKS_OF_MATCHED_CONTACTS') return !task.matchesTaskFilters;
  return true;
}

function tasksForMode(row: PlanningCurationRow, mode: PlanningTargetMode) {
  return row.tasks.filter(task => taskMatchesMode(task, mode));
}

function taskCanBeCurated(task: PlanningCurationTask) {
  return !task.assignment.committed && task.availableActions.length > 0;
}

function selectableTasksForMode(row: PlanningCurationRow, mode: PlanningTargetMode) {
  return tasksForMode(row, mode).filter(taskCanBeCurated);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function operationReasonCode(operation: CurationOperation) {
  if (operation.action === 'SET_DO_NOT_CONTACT') return 'do_not_contact';
  if (operation.action === 'CLEAR_DO_NOT_CONTACT') return 'contact_restored';
  if (operation.action === 'RESTORE') return 'manual_restore';
  return operation.layer === 'TEAM_DAY' ? 'team_unsuitable' : 'defer_day';
}

function MultiChoiceFilter({
  label,
  values,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  values: string[];
  options: Array<{ value: string; label: string; count?: number }>;
  onChange: (values: string[]) => void;
  disabled?: boolean;
}) {
  const selected = new Set(values);
  return (
    <details className="group relative">
      <summary
        className={[
          'flex h-10 min-w-[145px] cursor-pointer list-none items-center justify-between gap-2 rounded-xl border px-3 text-sm font-bold',
          values.length
            ? 'border-sky-300 bg-sky-50 text-sky-700'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
          disabled ? 'pointer-events-none opacity-50' : '',
        ].join(' ')}
      >
        <span className="truncate">{label}{values.length ? ` (${values.length})` : ''}</span>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
          <span className="text-xs font-bold text-slate-500">{label}</span>
          {values.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-xs font-bold text-sky-600 hover:underline"
            >
              مسح
            </button>
          )}
        </div>
        <div className="max-h-64 space-y-0.5 overflow-y-auto p-2 custom-scroll">
          {options.length === 0 ? (
            <p className="px-2 py-5 text-center text-xs text-slate-400">لا توجد خيارات</p>
          ) : options.map(option => (
            <Checkbox
              key={option.value}
              checked={selected.has(option.value)}
              onCheckedChange={checked => {
                const next = new Set(selected);
                if (checked) next.add(option.value);
                else next.delete(option.value);
                onChange([...next]);
              }}
              className="w-full rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="truncate">{option.label}</span>
                {option.count != null && (
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                    {option.count}
                  </span>
                )}
              </span>
            </Checkbox>
          ))}
        </div>
      </div>
    </details>
  );
}

function MetricCard({
  label,
  count,
  active,
  status,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  status?: LifecycleStatus;
  onClick: () => void;
}) {
  const meta = status ? LIFECYCLE_META[status] : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'min-w-[108px] rounded-2xl border px-4 py-3 text-right transition',
        active
          ? meta?.card ?? 'border-slate-700 bg-slate-800 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:shadow-sm',
      ].join(' ')}
    >
      <span className="block text-2xl font-black">{count}</span>
      <span className="mt-1 flex items-center gap-1.5 text-xs font-bold">
        {meta && <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />}
        {label}
      </span>
    </button>
  );
}

function StatusBadge({ status }: { status: LifecycleStatus }) {
  const meta = LIFECYCLE_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${meta.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function SortButton({
  label,
  sortKey,
  currentKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  direction: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = currentKey === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className="inline-flex items-center gap-1 hover:text-slate-800"
    >
      {label}
      {active
        ? direction === 'asc'
          ? <ChevronDown className="h-3.5 w-3.5 rotate-180 text-sky-600" />
          : <ChevronDown className="h-3.5 w-3.5 text-sky-600" />
        : <ChevronsUpDown className="h-3.5 w-3.5 text-slate-300" />}
    </button>
  );
}

function CurationPreviewModal({
  request,
  date,
  teamKey,
  teamLabel,
  onClose,
  onApplied,
}: {
  request: PendingCuration | null;
  date: string;
  teamKey: string;
  teamLabel: string;
  onClose: () => void;
  onApplied: (result: Awaited<ReturnType<typeof api.planning.applyCuration>>) => Promise<void>;
}) {
  const [reasonText, setReasonText] = useState('');
  const [preview, setPreview] = useState<CurationPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReasonText('');
    setPreview(null);
    setError(null);
  }, [request]);

  if (!request) return null;
  const { operation, selector, selectionLabel } = request;
  const reasonRequired = operation.action !== 'RESTORE';

  const runPreview = async () => {
    if (reasonRequired && !reasonText.trim()) {
      setError('اكتب سبب القرار قبل المعاينة.');
      return;
    }
    setPreviewing(true);
    setError(null);
    try {
      const next = await api.planning.previewCuration({
        date,
        teamKey,
        action: operation.action,
        layer: operation.layer,
        selector,
        reasonCode: operationReasonCode(operation),
        reasonText: reasonText.trim() || undefined,
      });
      setPreview(next);
    } catch (err) {
      setPreview(null);
      setError(errorMessage(err, 'تعذر إعداد معاينة القرار'));
    } finally {
      setPreviewing(false);
    }
  };

  const apply = async () => {
    if (!preview?.canApply) return;
    setApplying(true);
    setError(null);
    try {
      const result = await api.planning.applyCuration(preview.previewToken);
      await onApplied(result);
    } catch (err) {
      setError(errorMessage(err, 'تعذر تطبيق القرار. أعد المعاينة وحاول مجددًا.'));
      setPreview(null);
    } finally {
      setApplying(false);
    }
  };

  const toneClass = operation.tone === 'red'
    ? 'border-red-200 bg-red-50 text-red-700'
    : operation.tone === 'amber'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : operation.tone === 'emerald'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-slate-200 bg-slate-50 text-slate-700';

  return (
    <Modal
      isOpen
      onClose={() => !applying && onClose()}
      closeOnBackdrop={!applying}
      closeOnEsc={!applying}
      size="2xl"
      title={operation.label}
      subtitle={selectionLabel}
      bodyClassName="p-5"
      footer={(
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="rounded-full border border-slate-200 px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            إلغاء
          </button>
          {!preview ? (
            <button
              type="button"
              onClick={runPreview}
              disabled={previewing}
              className="inline-flex items-center gap-2 rounded-full bg-sky-600 px-5 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
              معاينة الأثر
            </button>
          ) : (
            <button
              type="button"
              onClick={apply}
              disabled={applying || !preview.canApply}
              className={[
                'inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold text-white disabled:opacity-50',
                operation.tone === 'red' ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500',
              ].join(' ')}
            >
              {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              تطبيق القرار
            </button>
          )}
        </>
      )}
    >
      <div className={`rounded-xl border px-4 py-3 text-sm ${toneClass}`}>
        <p className="font-bold">{operation.description}</p>
        <p className="mt-1 text-xs opacity-80">يوم التخطيط: {date} · {teamLabel}</p>
      </div>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-xs font-bold text-slate-600">
          سبب القرار {reasonRequired ? <span className="text-red-500">*</span> : '(اختياري)'}
        </span>
        <textarea
          value={reasonText}
          onChange={event => {
            setReasonText(event.target.value);
            setPreview(null);
          }}
          rows={3}
          maxLength={500}
          placeholder={
            operation.layer === 'TEAM_DAY'
              ? 'مثال: نوع المهمة لا يناسب تجهيز هذا الفريق اليوم'
              : operation.layer === 'ALL_TEAMS_DAY'
                ? 'مثال: طلب الزبون تأجيل التواصل عن خطة اليوم'
                : 'دوّن سبب تفعيل أو إلغاء عدم التواصل'
          }
          className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-sky-400 focus:bg-white"
        />
      </label>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-bold text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {preview && (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['جهات الاتصال', preview.counts.contacts],
              ['المهام المحددة', preview.counts.selectedTasks],
              ['سيتغير فعليًا', preview.counts.affectedTasks],
              ['إسنادات ستتحرر', preview.counts.releasedAssignments],
              ['جهات اتصال ستغلق', preview.counts.closedTargets],
              ['جهات ستفرغ', preview.counts.contactsFullyExcluded],
              ['مطبق مسبقًا', preview.counts.alreadyApplied],
              ['تعارضات اعتماد', preview.counts.committedConflicts],
              ['مهام متجاوزة', preview.counts.skippedUnavailableTasks],
            ].map(([label, count]) => (
              <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <div className="text-lg font-black text-slate-800">{count}</div>
                <div className="text-[11px] font-bold text-slate-500">{label}</div>
              </div>
            ))}
          </div>

          {preview.warnings.length > 0 && (
            <div className="space-y-2">
              {preview.warnings.map(warning => (
                <div key={warning} className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {warning}
                </div>
              ))}
            </div>
          )}

          {preview.sample.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold text-slate-500">عينة من الجهات المتأثرة</p>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                {preview.sample.map(item => (
                  <div key={item.rowKey} className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5 last:border-b-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-700">{item.clientName}</p>
                      <p className="text-xs text-slate-400">#{item.clientId}</p>
                    </div>
                    <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700">
                      {item.selectedTaskCount} من {item.taskCount} مهمة
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!preview.canApply && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-bold text-red-700">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              لا يمكن تطبيق هذه الدفعة لأن فيها مهام دخلت مرحلة الاعتماد. عدّل الاختيار ثم أعد المعاينة.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function PlanningContactTargets() {
  const navigate = useNavigate();
  const { teamKey = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultPlanningDate = getPlanningDate();
  const date = searchParams.get('date') || defaultPlanningDate;
  const teamLabelFromUrl = searchParams.get('label') || fallbackTeamLabel(teamKey);
  const branchId = useBranchContextStore(state => state.branchId);
  const hasPermission = useAuthStore(state => state.hasPermission);
  const canEditContactControl = hasPermission('clients.contact_control.edit');

  const [filters, setFilters] = useState<PlanningDashboardFilters>(() => initialFilters(searchParams));
  const [searchDraft, setSearchDraft] = useState(filters.q ?? '');
  const [taskIdsDraft, setTaskIdsDraft] = useState(toCsv(filters.taskIds));
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [limit, setLimit] = useState(() => {
    const parsed = Number(searchParams.get('limit'));
    return [10, 25, 50, 100].includes(parsed) ? parsed : 50;
  });
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const value = searchParams.get('sort');
    return ['clientName', 'clientId', 'station', 'status'].includes(value ?? '')
      ? value as SortKey
      : 'clientName';
  });
  const [sortDir, setSortDir] = useState<SortDir>(searchParams.get('dir') === 'desc' ? 'desc' : 'asc');
  const [targetMode, setTargetMode] = useState<PlanningTargetMode>('MATCHING_TASKS');
  const [selection, setSelection] = useState<SelectionState>(() => EMPTY_SELECTION());
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [data, setData] = useState<PlanningCurationDashboardResponse | null>(null);
  const teamLabel = data?.teamLabel || teamLabelFromUrl;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pendingCuration, setPendingCuration] = useState<PendingCuration | null>(null);
  const [closePreview, setClosePreview] = useState<PlanningDayCycleSummary | null>(null);
  const [closePreviewOpen, setClosePreviewOpen] = useState(false);
  const [loadingClosePreview, setLoadingClosePreview] = useState(false);
  const [closingCycle, setClosingCycle] = useState(false);
  const requestSequence = useRef(0);

  useEffect(() => {
    if (canEditContactControl) return;
    setSelection(current => (
      current.scope === 'CONTACTS' ? EMPTY_SELECTION('TASKS') : current
    ));
  }, [canEditContactControl]);

  const filtersKey = useMemo(() => JSON.stringify(cleanFilters(filters)), [filters]);

  const clearSelection = useCallback((scope: SelectionScope = selection.scope) => {
    setSelection(EMPTY_SELECTION(scope));
  }, [selection.scope]);

  const updateFilters = useCallback((patch: Partial<PlanningDashboardFilters>) => {
    setFilters(current => cleanFilters({ ...current, ...patch }));
    setPage(1);
    setSelection(current => EMPTY_SELECTION(current.scope));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = searchDraft.trim();
      if ((filters.q ?? '') !== next) updateFilters({ q: next || undefined });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [filters.q, searchDraft, updateFilters]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const put = (key: string, value: string) => value ? next.set(key, value) : next.delete(key);
    next.set('date', date);
    next.set('label', teamLabel);
    put('q', filters.q ?? '');
    put('status', toCsv(filters.lifecycleStatuses));
    put('stations', toCsv(filters.stationIds));
    put('classes', toCsv(filters.classifications));
    put('ownership', toCsv(filters.ownershipTypes));
    put('taskIds', toCsv(filters.taskIds));
    put('taskTypes', toCsv(filters.taskTypes));
    put('families', toCsv(filters.taskFamilies));
    put('priorities', toCsv(filters.priorities));
    put('due', filters.dueState ?? '');
    put('exclusions', toCsv(filters.exclusionLayers));
    put('minTasks', filters.minTaskCount == null ? '' : String(filters.minTaskCount));
    put('maxTasks', filters.maxTaskCount == null ? '' : String(filters.maxTaskCount));
    // Clear removed controls from legacy/bookmarked URLs so an invisible
    // filter can never continue narrowing the dashboard results.
    next.delete('taskStatuses');
    next.delete('phone');
    next.delete('attempts');
    next.set('page', String(page));
    next.set('limit', String(limit));
    next.set('sort', sortKey);
    next.set('dir', sortDir);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [
    date,
    filters,
    limit,
    page,
    searchParams,
    setSearchParams,
    sortDir,
    sortKey,
    teamLabel,
  ]);

  const loadData = useCallback(async () => {
    const sequence = ++requestSequence.current;
    if (data) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    try {
      const result = await api.planning.curationDashboard({
        date,
        teamKey,
        filters: cleanFilters(filters),
        page,
        limit,
        sortBy: sortKey,
        sortDir,
      });
      if (sequence !== requestSequence.current) return;
      setData(result);
      if (result.pagination.page !== page) setPage(result.pagination.page);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setLoadError(errorMessage(error, 'تعذر تحميل مساحة تنقية جهات الاتصال'));
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [data, date, filters, limit, page, sortDir, sortKey, teamKey]);

  useEffect(() => {
    void loadData();
    // loadData intentionally owns the complete server query.
  }, [branchId, date, filtersKey, limit, page, sortDir, sortKey, teamKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const refreshVisibleDashboard = () => {
      if (document.visibilityState === 'visible') void loadData();
    };
    const intervalId = window.setInterval(refreshVisibleDashboard, 30_000);
    document.addEventListener('visibilitychange', refreshVisibleDashboard);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshVisibleDashboard);
    };
  }, [loadData]);

  useEffect(() => {
    setSelection(current => EMPTY_SELECTION(current.scope));
  }, [branchId, date, filtersKey, sortDir, sortKey, teamKey]);

  const rows = data?.rows ?? [];
  const summary = data?.summary;
  const pagination = data?.pagination;
  const planCommitted = data?.planState === 'COMMITTED';
  const cycleClosed = data?.cycle?.status === 'closed' || data?.cycle?.status === 'closing';

  const totalTasksForMode = useMemo(() => {
    if (!summary) return 0;
    if (targetMode === 'MATCHING_TASKS') return summary.matchingActionableTasks;
    if (targetMode === 'NON_MATCHING_TASKS_OF_MATCHED_CONTACTS') {
      return Math.max(0, summary.actionableTasks - summary.matchingActionableTasks);
    }
    return summary.actionableTasks;
  }, [summary, targetMode]);

  const pageTaskIds = useMemo(
    () => rows.flatMap(row => selectableTasksForMode(row, targetMode).map(task => task.taskId)),
    [rows, targetMode],
  );
  const pageContactKeys = useMemo(() => rows.map(row => row.rowKey), [rows]);

  const isTaskSelected = useCallback((taskId: number) => (
    selection.scope === 'TASKS'
    && (selection.allMatching
      ? !selection.exceptTaskIds.has(taskId)
      : selection.taskIds.has(taskId))
  ), [selection]);

  const isContactSelected = useCallback((rowKey: string) => (
    selection.scope === 'CONTACTS'
    && (selection.allMatching
      ? !selection.exceptContactKeys.has(rowKey)
      : selection.contactKeys.has(rowKey))
  ), [selection]);

  const selectedCount = selection.scope === 'TASKS'
    ? selection.allMatching
      ? Math.max(0, totalTasksForMode - selection.exceptTaskIds.size)
      : selection.taskIds.size
    : selection.allMatching
      ? Math.max(0, (pagination?.totalContacts ?? 0) - selection.exceptContactKeys.size)
      : selection.contactKeys.size;

  const pageSelection = selection.scope === 'TASKS'
    ? {
        all: pageTaskIds.length > 0 && pageTaskIds.every(isTaskSelected),
        some: pageTaskIds.some(isTaskSelected),
      }
    : {
        all: pageContactKeys.length > 0 && pageContactKeys.every(isContactSelected),
        some: pageContactKeys.some(isContactSelected),
      };

  const toggleSelectionScope = (scope: SelectionScope) => {
    if (scope === 'CONTACTS' && !canEditContactControl) {
      setMessage({
        type: 'warning',
        text: 'اختيار الزبائن وقرارات عدم التواصل تتطلب صلاحية التحكم بحالة التواصل.',
      });
      return;
    }
    setSelection(EMPTY_SELECTION(scope));
  };

  const toggleTask = (taskId: number) => {
    setSelection(current => {
      if (current.scope !== 'TASKS') return current;
      if (current.allMatching) {
        const exceptTaskIds = new Set(current.exceptTaskIds);
        if (exceptTaskIds.has(taskId)) exceptTaskIds.delete(taskId);
        else exceptTaskIds.add(taskId);
        return { ...current, exceptTaskIds };
      }
      const taskIds = new Set(current.taskIds);
      if (taskIds.has(taskId)) taskIds.delete(taskId);
      else taskIds.add(taskId);
      return { ...current, taskIds };
    });
  };

  const toggleContact = (rowKey: string) => {
    setSelection(current => {
      if (current.scope !== 'CONTACTS') return current;
      if (current.allMatching) {
        const exceptContactKeys = new Set(current.exceptContactKeys);
        if (exceptContactKeys.has(rowKey)) exceptContactKeys.delete(rowKey);
        else exceptContactKeys.add(rowKey);
        return { ...current, exceptContactKeys };
      }
      const contactKeys = new Set(current.contactKeys);
      if (contactKeys.has(rowKey)) contactKeys.delete(rowKey);
      else contactKeys.add(rowKey);
      return { ...current, contactKeys };
    });
  };

  const toggleRow = (row: PlanningCurationRow) => {
    if (selection.scope === 'CONTACTS') {
      toggleContact(row.rowKey);
      return;
    }
    const ids = selectableTasksForMode(row, targetMode).map(task => task.taskId);
    if (ids.length === 0) return;
    const allSelected = ids.every(isTaskSelected);
    setSelection(current => {
      if (current.scope !== 'TASKS') return current;
      if (current.allMatching) {
        const exceptTaskIds = new Set(current.exceptTaskIds);
        ids.forEach(id => allSelected ? exceptTaskIds.add(id) : exceptTaskIds.delete(id));
        return { ...current, exceptTaskIds };
      }
      const taskIds = new Set(current.taskIds);
      ids.forEach(id => allSelected ? taskIds.delete(id) : taskIds.add(id));
      return { ...current, taskIds };
    });
  };

  const togglePage = () => {
    if (selection.scope === 'CONTACTS') {
      setSelection(current => {
        if (current.scope !== 'CONTACTS') return current;
        if (current.allMatching) {
          const exceptContactKeys = new Set(current.exceptContactKeys);
          pageContactKeys.forEach(key => pageSelection.all
            ? exceptContactKeys.add(key)
            : exceptContactKeys.delete(key));
          return { ...current, exceptContactKeys };
        }
        const contactKeys = new Set(current.contactKeys);
        pageContactKeys.forEach(key => pageSelection.all ? contactKeys.delete(key) : contactKeys.add(key));
        return { ...current, contactKeys };
      });
      return;
    }
    setSelection(current => {
      if (current.scope !== 'TASKS') return current;
      if (current.allMatching) {
        const exceptTaskIds = new Set(current.exceptTaskIds);
        pageTaskIds.forEach(id => pageSelection.all ? exceptTaskIds.add(id) : exceptTaskIds.delete(id));
        return { ...current, exceptTaskIds };
      }
      const taskIds = new Set(current.taskIds);
      pageTaskIds.forEach(id => pageSelection.all ? taskIds.delete(id) : taskIds.add(id));
      return { ...current, taskIds };
    });
  };

  const selectAllMatching = () => {
    setSelection(current => ({
      ...EMPTY_SELECTION(current.scope),
      allMatching: true,
    }));
  };

  const buildSelectionSelector = (): PlanningCurationSelector | null => {
    if (!data || selectedCount === 0) return null;
    if (selection.allMatching) {
      return {
        kind: 'FILTERED_SET',
        filters: cleanFilters(filters),
        queryFingerprint: data.queryFingerprint,
        targetMode: selection.scope === 'TASKS'
          ? targetMode
          : 'ALL_TASKS_OF_MATCHED_CONTACTS',
        exceptTaskIds: selection.scope === 'TASKS' ? [...selection.exceptTaskIds] : undefined,
        exceptContactKeys: [...selection.exceptContactKeys],
      };
    }
    if (selection.scope === 'TASKS') {
      return { kind: 'TASK_IDS', taskIds: [...selection.taskIds] };
    }
    return { kind: 'CONTACT_KEYS', contactKeys: [...selection.contactKeys] };
  };

  const openBulkOperation = (operation: CurationOperation) => {
    if (cycleClosed) {
      setMessage({ type: 'warning', text: 'انتهت خطة هذا الفريق واليوم وأصبحت للقراءة فقط.' });
      return;
    }
    if (operation.layer === 'CLIENT_DO_NOT_CONTACT' && !canEditContactControl) {
      setMessage({
        type: 'warning',
        text: 'لا تملك صلاحية تطبيق قرارات عدم التواصل على الزبائن.',
      });
      return;
    }
    const selector = buildSelectionSelector();
    if (!selector) return;
    setPendingCuration({
      operation,
      selector,
      selectionLabel: selection.scope === 'TASKS'
        ? `${selectedCount} مهمة محددة`
        : `${selectedCount} جهة اتصال محددة`,
    });
  };

  const openTaskOperation = (task: PlanningCurationTask, operation: CurationOperation) => {
    if (cycleClosed) {
      setMessage({ type: 'warning', text: 'انتهت خطة هذا الفريق واليوم وأصبحت للقراءة فقط.' });
      return;
    }
    setPendingCuration({
      operation,
      selector: { kind: 'TASK_IDS', taskIds: [task.taskId] },
      selectionLabel: `المهمة #${task.taskId} · ${task.taskTypeLabel}`,
    });
  };

  const openContactOperation = (row: PlanningCurationRow) => {
    if (cycleClosed) {
      setMessage({ type: 'warning', text: 'انتهت خطة هذا الفريق واليوم وأصبحت للقراءة فقط.' });
      return;
    }
    if (!canEditContactControl) {
      setMessage({
        type: 'warning',
        text: 'لا تملك صلاحية تغيير حالة عدم التواصل لهذا الزبون.',
      });
      return;
    }
    const operation = row.contactBlocks.doNotContact ? CONTACT_OPERATIONS[1] : CONTACT_OPERATIONS[0];
    setPendingCuration({
      operation,
      selector: { kind: 'CONTACT_KEYS', contactKeys: [row.rowKey] },
      selectionLabel: `${row.clientName} · جميع مهام الزبون`,
    });
  };

  const handleApplied = async (result: Awaited<ReturnType<typeof api.planning.applyCuration>>) => {
    setPendingCuration(null);
    setMessage({
      type: 'success',
      text: `تم تطبيق القرار بنجاح — ${result.changedTasks} مهمة، ${result.changedClients} زبون، ${result.releasedAssignments} إسناد محرر.`,
    });
    clearSelection();
    await loadData();
  };

  const handleSync = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const result = await api.planning.syncContactTargetsDashboard(date, teamKey);
      const newlyAssigned = result?.counts?.newlyAssigned ?? 0;
      const released = result?.counts?.released ?? 0;
      setMessage({
        type: 'success',
        text: `تمت تسوية الخطة — ${newlyAssigned} مهمة جديدة أُسندت${released ? `، و${released} مهمة تحررت` : ''}.`,
      });
      clearSelection();
      await loadData();
    } catch (error) {
      setMessage({ type: 'error', text: errorMessage(error, 'تعذر تحديث جهات الاتصال') });
    } finally {
      setSyncing(false);
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
        type: skipped ? 'warning' : 'success',
        text: `تم اعتماد المتبقي المؤهل — ${added} مضاف، ${updated} محدّث${skipped ? `، ${skipped} متجاوز` : ''}.`,
      });
      clearSelection();
      await loadData();
    } catch (error) {
      setMessage({ type: 'error', text: errorMessage(error, 'تعذر توليد قائمة الاتصال') });
    } finally {
      setGenerating(false);
    }
  };

  const openClosePreview = async () => {
    setClosePreviewOpen(true);
    setClosePreview(null);
    setLoadingClosePreview(true);
    setMessage(null);
    try {
      const result = await api.planning.previewClosePlanningDay(date, teamKey);
      setClosePreview(result.summary);
    } catch (error) {
      setClosePreviewOpen(false);
      setMessage({ type: 'error', text: errorMessage(error, 'تعذر تجهيز معاينة إنهاء الخطة') });
    } finally {
      setLoadingClosePreview(false);
    }
  };

  const confirmCloseCycle = async () => {
    setClosingCycle(true);
    try {
      const result = await api.planning.closePlanningDay(date, teamKey);
      setClosePreviewOpen(false);
      setMessage({
        type: 'success',
        text: `تم إنهاء الخطة وحفظ سجلها — أغلقت ${result.summary.contactTargetsClosed} جهة اتصال، وعادت ${result.summary.tasksReleased} مهمة غير مجدولة للانتظار.`,
      });
      clearSelection();
      await loadData();
    } catch (error) {
      setMessage({ type: 'error', text: errorMessage(error, 'تعذر إنهاء دورة التخطيط') });
    } finally {
      setClosingCycle(false);
    }
  };

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(current => current === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(1);
  };

  const toggleLifecycle = (status?: LifecycleStatus) => {
    const current = filters.lifecycleStatuses ?? [];
    updateFilters({
      lifecycleStatuses: status
        ? current.length === 1 && current[0] === status ? undefined : [status]
        : undefined,
    });
  };

  const clearFilters = () => {
    setFilters({});
    setSearchDraft('');
    setTaskIdsDraft('');
    setPage(1);
    clearSelection();
  };

  const activeFilterCount = Object.entries(filters).filter(([, value]) => (
    value !== undefined
    && value !== ''
    && (!Array.isArray(value) || value.length > 0)
  )).length;

  return (
    <div className="h-full overflow-y-auto bg-slate-50/70 custom-scroll" dir="rtl">
      <div className="mx-auto max-w-[1500px] space-y-4 px-4 py-6">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <button
              type="button"
              onClick={() => navigate('/planning/overview')}
              className="mb-3 inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 transition hover:text-sky-600"
            >
              <ArrowRight className="h-4 w-4" />
              العودة إلى ملخص الخطة
            </button>
            <h1 className="flex items-center gap-2 text-2xl font-black text-slate-800">
              <Target className="h-6 w-6 text-sky-600" />
              تنقية جهات الاتصال — {teamLabel}
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              اختر مجموعة دقيقة بالفلاتر، راجع مهام كل زبون وموقع، ثم طبّق قرار اليوم على المستوى المقصود.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {data?.cycle && (
              <span className={[
                'inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-black',
                cycleClosed
                  ? 'border-slate-300 bg-slate-100 text-slate-700'
                  : data.cycle.status === 'active'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-sky-200 bg-sky-50 text-sky-700',
              ].join(' ')}>
                <Lock className="h-4 w-4" />
                {cycleClosed ? 'الخطة منتهية' : data.cycle.status === 'active' ? 'الخطة فعالة' : 'قيد التخطيط'}
              </span>
            )}
            <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600">
              <Calendar className="h-4 w-4 text-sky-600" />
              <input
                type="date"
                value={date}
                onChange={event => {
                  const next = new URLSearchParams(searchParams);
                  next.set('date', event.target.value);
                  next.set('page', '1');
                  setSearchParams(next);
                  clearSelection();
                }}
                className="bg-transparent font-mono text-sm outline-none"
              />
            </label>
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing || loading || cycleClosed}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 text-sm font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
            >
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              تحديث الإسناد
            </button>
            {!cycleClosed && data && (
              <button
                type="button"
                onClick={openClosePreview}
                disabled={loading || loadingClosePreview}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-red-200 bg-white px-4 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {loadingClosePreview ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                إنهاء الخطة
              </button>
            )}
          </div>
        </header>

        {message && (
          <div className={[
            'flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-bold',
            message.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : message.type === 'warning'
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : 'border-red-200 bg-red-50 text-red-700',
          ].join(' ')}>
            <span>{message.text}</span>
            <button type="button" onClick={() => setMessage(null)} aria-label="إغلاق">
              <X className="h-4 w-4 opacity-60 hover:opacity-100" />
            </button>
          </div>
        )}

        {data && (
          <section className={[
            'rounded-2xl border px-5 py-4 shadow-sm',
            planCommitted
              ? 'border-emerald-200 bg-emerald-50'
              : 'border-amber-200 bg-amber-50',
          ].join(' ')}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-3">
                {planCommitted
                  ? <Lock className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                  : <SlidersHorizontal className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />}
                <div>
                  <p className={`text-sm font-black ${planCommitted ? 'text-emerald-800' : 'text-amber-800'}`}>
                    {planCommitted ? 'القائمة معتمدة — المهام المعتمدة مجمّدة' : 'مرحلة المعاينة — التنقية متاحة قبل الاعتماد'}
                  </p>
                  <p className={`mt-1 text-xs leading-5 ${planCommitted ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {planCommitted
                      ? `ما دخل القائمة يبقى مجمّدًا، بينما يمكن تنقية المهام الجديدة غير المعتمدة ثم إضافتها بالتوليد التالي.${data.generatedAt ? ` آخر اعتماد: ${formatDateTime(data.generatedAt)}` : ''}`
                      : 'الفلاتر تحدد ما تراجعه، وقرارات الاستبعاد تحفظ على المهام. التوليد يستخدم كل المتبقي المؤهل بعد هذه القرارات، لا الصفوف الظاهرة فقط.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating || loading || cycleClosed}
                className={[
                  'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-black text-white shadow-sm disabled:opacity-50',
                  planCommitted ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-amber-600 hover:bg-amber-500',
                ].join(' ')}
              >
                {generating
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : planCommitted
                    ? <RotateCcw className="h-4 w-4" />
                    : <PhoneCall className="h-4 w-4" />}
                {generating ? 'جاري التوليد...' : planCommitted ? 'إضافة المهام الجديدة' : 'اعتماد وتوليد القائمة'}
              </button>
            </div>
          </section>
        )}

        {data && (
          <section className="flex gap-2 overflow-x-auto pb-1 custom-scroll">
            <MetricCard
              label="كل الجهات"
              count={summary?.contacts ?? 0}
              active={!filters.lifecycleStatuses?.length}
              onClick={() => toggleLifecycle()}
            />
            {(['ready', 'queued', 'in_call_list', 'contacted', 'closed'] as LifecycleStatus[]).map(status => (
              <MetricCard
                key={status}
                label={LIFECYCLE_META[status].label}
                count={summary?.[status] ?? 0}
                status={status}
                active={filters.lifecycleStatuses?.length === 1 && filters.lifecycleStatuses[0] === status}
                onClick={() => toggleLifecycle(status)}
              />
            ))}
            <div className="min-w-[125px] rounded-2xl border border-red-200 bg-white px-4 py-3">
              <span className="block text-2xl font-black text-red-700">{summary?.excludedAllTeamsDay ?? 0}</span>
              <span className="mt-1 block text-xs font-bold text-red-600">مستبعدة اليوم</span>
            </div>
            <div className="min-w-[125px] rounded-2xl border border-amber-200 bg-white px-4 py-3">
              <span className="block text-2xl font-black text-amber-700">{summary?.excludedTeamDay ?? 0}</span>
              <span className="mt-1 block text-xs font-bold text-amber-600">غير مناسبة للفريق</span>
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchDraft}
                onChange={event => setSearchDraft(event.target.value)}
                placeholder="اسم، هاتف، رقم زبون، رقم أو نوع مهمة..."
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pr-10 pl-4 text-sm outline-none transition focus:border-sky-400 focus:bg-white"
              />
              {refreshing && <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-sky-500" />}
            </div>

            <MultiChoiceFilter
              label="المحطات"
              values={(filters.stationIds ?? []).map(String)}
              options={(data?.facets.stations ?? []).map(item => ({
                value: String(item.value),
                label: item.label,
                count: item.count,
              }))}
              onChange={values => updateFilters({
                stationIds: values.map(Number).filter(Number.isInteger),
              })}
            />
            <MultiChoiceFilter
              label="أنواع المهام"
              values={filters.taskTypes ?? []}
              options={(data?.facets.taskTypes ?? []).map(item => ({
                value: item.value,
                label: item.label,
                count: item.count,
              }))}
              onChange={values => updateFilters({ taskTypes: values })}
            />
            <MultiChoiceFilter
              label="حالة جهة الاتصال"
              values={filters.lifecycleStatuses ?? []}
              options={(['ready', 'queued', 'in_call_list', 'contacted', 'closed'] as LifecycleStatus[]).map(status => ({
                value: status,
                label: LIFECYCLE_META[status].label,
              }))}
              onChange={values => updateFilters({
                lifecycleStatuses: values as LifecycleStatus[],
              })}
            />
            <button
              type="button"
              onClick={() => setAdvancedFiltersOpen(current => !current)}
              className={[
                'inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-bold',
                advancedFiltersOpen || activeFilterCount > 0
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
              ].join(' ')}
            >
              <Filter className="h-4 w-4" />
              فلاتر متقدمة
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] text-white">{activeFilterCount}</span>
              )}
            </button>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                <RotateCcw className="h-4 w-4" />
                مسح
              </button>
            )}
          </div>

          {advancedFiltersOpen && (
            <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              <MultiChoiceFilter
                label="عائلات المهام"
                values={filters.taskFamilies ?? []}
                options={(data?.facets.taskFamilies ?? []).map(item => ({
                  value: item.value,
                  label: taskFamilyLabel(item.value),
                  count: item.count,
                }))}
                onChange={values => updateFilters({ taskFamilies: values })}
              />
              <MultiChoiceFilter
                label="الأولوية"
                values={filters.priorities ?? []}
                options={(data?.facets.priorities ?? []).map(item => ({
                  value: item.value,
                  label: PRIORITY_LABELS[item.value] ?? item.label,
                  count: item.count,
                }))}
                onChange={values => updateFilters({ priorities: values })}
              />
              <MultiChoiceFilter
                label="تصنيف الزبون"
                values={filters.classifications ?? []}
                options={[
                  { value: 'LEAD', label: 'Lead' },
                  { value: 'FOP', label: 'FOP' },
                  { value: 'OP', label: 'OP' },
                ]}
                onChange={values => updateFilters({ classifications: values })}
              />
              <MultiChoiceFilter
                label="الملكية"
                values={filters.ownershipTypes ?? []}
                options={[
                  { value: 'personal', label: 'ملكية شخصية' },
                  { value: 'company_branch', label: 'ملكية الشركة' },
                ]}
                onChange={values => updateFilters({ ownershipTypes: values })}
              />
              <MultiChoiceFilter
                label="طبقة الاستبعاد"
                values={(filters.exclusionLayers ?? []) as string[]}
                options={[
                  { value: 'NONE', label: 'بلا استبعاد' },
                  { value: 'TEAM_DAY', label: 'غير مناسبة للفريق' },
                  { value: 'ALL_TEAMS_DAY', label: 'مستبعدة من اليوم' },
                  { value: 'CLIENT_DO_NOT_CONTACT', label: 'عدم التواصل' },
                ]}
                onChange={values => updateFilters({
                  exclusionLayers: values as PlanningDashboardFilters['exclusionLayers'],
                })}
              />

              <Select
                value={filters.dueState ?? 'all'}
                onChange={value => updateFilters({
                  dueState: value === 'all' ? undefined : value as PlanningDashboardFilters['dueState'],
                })}
                ariaLabel="الاستحقاق"
                className="w-full"
                options={[
                  { value: 'all', label: 'كل الاستحقاقات' },
                  { value: 'OVERDUE', label: 'متأخرة' },
                  { value: 'ON_DATE', label: 'مطلوبة في يوم الخطة' },
                  { value: 'FUTURE', label: 'مستقبلية' },
                  { value: 'NO_DATE', label: 'بلا تاريخ' },
                ]}
              />
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold text-slate-500">أقل عدد مهام</span>
                <input
                  type="number"
                  min={0}
                  value={filters.minTaskCount ?? ''}
                  onChange={event => updateFilters({
                    minTaskCount: event.target.value === '' ? undefined : Number(event.target.value),
                  })}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-sky-400"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold text-slate-500">أعلى عدد مهام</span>
                <input
                  type="number"
                  min={0}
                  value={filters.maxTaskCount ?? ''}
                  onChange={event => updateFilters({
                    maxTaskCount: event.target.value === '' ? undefined : Number(event.target.value),
                  })}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-sky-400"
                />
              </label>
              <label className="block xl:col-span-2">
                <span className="mb-1 block text-[11px] font-bold text-slate-500">أرقام مهام محددة</span>
                <input
                  value={taskIdsDraft}
                  onChange={event => setTaskIdsDraft(event.target.value)}
                  onBlur={() => updateFilters({ taskIds: fromNumberCsv(taskIdsDraft) })}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      updateFilters({ taskIds: fromNumberCsv(taskIdsDraft) });
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="مثال: 125, 132, 900"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-sm outline-none focus:border-sky-400"
                  dir="ltr"
                />
              </label>
            </div>
          )}
        </section>

        {data && (
          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-500">نوع الاختيار:</span>
                <div className="flex rounded-xl bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => toggleSelectionScope('TASKS')}
                    className={[
                      'rounded-lg px-3 py-1.5 text-xs font-bold transition',
                      selection.scope === 'TASKS' ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500',
                    ].join(' ')}
                  >
                    مهام
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSelectionScope('CONTACTS')}
                    disabled={!canEditContactControl}
                    title={!canEditContactControl
                      ? 'يتطلب صلاحية clients.contact_control.edit'
                      : 'اختيار زبائن لتطبيق قرار عدم التواصل'}
                    className={[
                      'inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-45',
                      selection.scope === 'CONTACTS' ? 'bg-white text-red-700 shadow-sm' : 'text-slate-500',
                    ].join(' ')}
                  >
                    {!canEditContactControl && <Lock className="h-3 w-3" />}
                    زبائن
                  </button>
                </div>
                {selection.scope === 'TASKS' && (
                  <Select
                    value={targetMode}
                    onChange={value => {
                      setTargetMode(value);
                      clearSelection('TASKS');
                    }}
                    options={TARGET_MODE_OPTIONS}
                    ariaLabel="نمط استهداف المهام"
                    size="sm"
                  />
                )}
                <span className="text-xs text-slate-400">
                  {selection.scope === 'TASKS'
                    ? 'يمكن تحديد مهمة واحدة من مجموعة مهام الزبون.'
                    : 'اختيار الزبائن مخصص لقرار عدم التواصل الدائم.'}
                </span>
                {!canEditContactControl && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700">
                    <Lock className="h-3.5 w-3.5" />
                    عدم التواصل محجوب لغياب صلاحية التحكم بحالة التواصل.
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-sky-700">
                  {summary?.matchingTasks ?? 0} مهمة مطابقة من {summary?.tasks ?? 0}
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-600">
                  {pagination?.totalContacts ?? 0} جهة اتصال
                </span>
              </div>
            </div>

            {selection.scope === 'TASKS' && targetMode === 'NON_MATCHING_TASKS_OF_MATCHED_CONTACTS' && totalTasksForMode === 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                لا توجد مهام غير مطابقة داخل الجهات الحالية. طبّق فلترًا على نوع أو عائلة أو حالة مهمة أولًا.
              </div>
            )}
          </section>
        )}

        {selectedCount > 0 && data && (
          <section className="sticky top-2 z-30 rounded-2xl border border-indigo-200 bg-indigo-950 px-4 py-3 text-white shadow-xl">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 font-black">
                  <ListChecks className="h-5 w-5 text-indigo-300" />
                  {selection.allMatching ? 'كل النتائج المطابقة' : `${selectedCount} ${selection.scope === 'TASKS' ? 'مهمة' : 'جهة'} محددة`}
                </span>
                {!selection.allMatching && (
                  <button
                    type="button"
                    onClick={selectAllMatching}
                    className="rounded-full border border-indigo-400 bg-indigo-900 px-3 py-1.5 text-xs font-bold text-indigo-100 hover:bg-indigo-800"
                  >
                    تحديد كل {selection.scope === 'TASKS' ? totalTasksForMode : pagination?.totalContacts ?? 0} نتيجة مطابقة
                  </button>
                )}
                {selection.allMatching && (
                  <span className="text-xs text-indigo-200">
                    الاستثناءات اليدوية: {selection.scope === 'TASKS' ? selection.exceptTaskIds.size : selection.exceptContactKeys.size}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => clearSelection()}
                  className="inline-flex items-center gap-1 text-xs font-bold text-indigo-200 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                  إلغاء التحديد
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {selection.scope === 'TASKS' ? (
                  TASK_OPERATIONS.map(operation => (
                    <button
                      key={`${operation.action}:${operation.layer}`}
                      type="button"
                      onClick={() => openBulkOperation(operation)}
                      className={[
                        'rounded-full px-3 py-2 text-xs font-black transition',
                        operation.tone === 'red'
                          ? 'bg-red-500 text-white hover:bg-red-400'
                          : operation.tone === 'amber'
                            ? 'bg-amber-400 text-amber-950 hover:bg-amber-300'
                            : 'border border-emerald-400 bg-emerald-950 text-emerald-200 hover:bg-emerald-900',
                      ].join(' ')}
                    >
                      {operation.label}
                    </button>
                  ))
                ) : canEditContactControl ? CONTACT_OPERATIONS.map(operation => (
                  <button
                    key={operation.action}
                    type="button"
                    onClick={() => openBulkOperation(operation)}
                    className={[
                      'rounded-full px-3 py-2 text-xs font-black transition',
                      operation.action === 'SET_DO_NOT_CONTACT'
                        ? 'bg-red-500 text-white hover:bg-red-400'
                        : 'border border-emerald-400 bg-emerald-950 text-emerald-200 hover:bg-emerald-900',
                    ].join(' ')}
                  >
                    {operation.label}
                  </button>
                )) : null}
              </div>
            </div>
          </section>
        )}

        {loading && !data ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white py-24 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
            <span className="text-sm font-bold">جاري تجهيز مساحة التنقية...</span>
          </div>
        ) : loadError && !data ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 py-16 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-red-400" />
            <p className="mt-3 text-sm font-bold text-red-700">{loadError}</p>
            <button type="button" onClick={() => void loadData()} className="mt-3 text-sm font-bold text-red-600 hover:underline">
              إعادة المحاولة
            </button>
          </div>
        ) : data && rows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center">
            <Users className="mx-auto h-10 w-10 text-slate-200" />
            <p className="mt-3 text-sm font-bold text-slate-600">لا توجد جهات مطابقة للفلاتر الحالية</p>
            <p className="mt-1 text-xs text-slate-400">امسح بعض الفلاتر أو حدّث الإسناد لإدخال المهام المؤهلة الجديدة.</p>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
              >
                <RotateCcw className="h-4 w-4" />
                مسح الفلاتر
              </button>
            )}
          </div>
        ) : data ? (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {loadError && (
              <div className="flex items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-700">
                <span>{loadError} — المعروض هو آخر تحميل ناجح.</span>
                <button type="button" onClick={() => void loadData()} className="hover:underline">إعادة المحاولة</button>
              </div>
            )}
            <DataTable minWidth={1120} className={refreshing ? 'opacity-60' : ''}>
              <DataTable.Head>
                <DataTable.Row>
                  <DataTable.Th align="center" className="w-12">
                    <Checkbox
                      checked={pageSelection.all}
                      indeterminate={!pageSelection.all && pageSelection.some}
                      onCheckedChange={togglePage}
                      disabled={
                        selection.scope === 'TASKS'
                          ? pageTaskIds.length === 0
                          : pageContactKeys.length === 0
                      }
                      label="تحديد الصفحة الحالية"
                    />
                  </DataTable.Th>
                  <DataTable.Th>
                    <SortButton label="الزبون" sortKey="clientName" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                  </DataTable.Th>
                  <DataTable.Th>
                    <SortButton label="موقع العمل" sortKey="station" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                  </DataTable.Th>
                  <DataTable.Th>الإسناد والملكية</DataTable.Th>
                  <DataTable.Th>القيود الفعالة</DataTable.Th>
                  <DataTable.Th>
                    <SortButton label="حالة جهة الاتصال" sortKey="status" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                  </DataTable.Th>
                  <DataTable.Th align="center" className="w-20">تفاصيل</DataTable.Th>
                </DataTable.Row>
              </DataTable.Head>
              <DataTable.Body>
                {rows.map(row => {
                  const rowTasks = selectableTasksForMode(row, targetMode);
                  const selectedTasksInRow = rowTasks.filter(task => isTaskSelected(task.taskId)).length;
                  const rowChecked = selection.scope === 'CONTACTS'
                    ? isContactSelected(row.rowKey)
                    : rowTasks.length > 0 && selectedTasksInRow === rowTasks.length;
                  const rowIndeterminate = selection.scope === 'TASKS'
                    && selectedTasksInRow > 0
                    && selectedTasksInRow < rowTasks.length;
                  const expanded = expandedRows.has(row.rowKey);
                  const teamBlocked = row.tasks.filter(task => task.blocks.currentTeamDay).length;
                  const allBlocked = row.tasks.filter(task => task.blocks.allTeamsDay).length;
                  return (
                    <Fragment key={row.rowKey}>
                      <DataTable.Row className={expanded ? 'bg-sky-50/30' : ''}>
                        <DataTable.Td align="center">
                          <Checkbox
                            checked={rowChecked}
                            indeterminate={rowIndeterminate}
                            onCheckedChange={() => toggleRow(row)}
                            disabled={selection.scope === 'TASKS' && rowTasks.length === 0}
                            label={`تحديد ${row.clientName}`}
                          />
                        </DataTable.Td>
                        <DataTable.Td>
                          <div className="flex min-w-[220px] items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-black text-slate-600">
                              #{row.clientId}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="truncate font-black text-slate-800">{row.clientName}</span>
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                                  {classificationLabel(row.classification)}
                                </span>
                                {row.contactTarget && (
                                  <span className="rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">
                                    CT #{row.contactTarget.id}
                                  </span>
                                )}
                                <span
                                  className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700"
                                  title="عدد المهام المرتبطة بجهة الاتصال في موقع العمل هذا"
                                >
                                  <ListChecks className="h-3 w-3" />
                                  {taskCountLabel(row.counts.totalTasks)}
                                </span>
                              </div>
                              <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                                <Phone className="h-3.5 w-3.5" />
                                <span dir="ltr" className="font-mono">{row.primaryPhone || 'بلا رقم'}</span>
                                <button
                                  type="button"
                                  onClick={() => navigate(`/clients/${row.clientId}`)}
                                  className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-sky-600"
                                  aria-label="فتح ملف الزبون"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </DataTable.Td>
                        <DataTable.Td>
                          <div className="flex min-w-[150px] items-center gap-2 text-sm font-bold text-slate-700">
                            <MapPin className="h-4 w-4 shrink-0 text-sky-500" />
                            <span>{row.workLocationName || 'موقع غير مكتمل'}</span>
                          </div>
                          {row.workLocationGeoUnitId && (
                            <span className="mt-1 block text-[10px] text-slate-400">#{row.workLocationGeoUnitId}</span>
                          )}
                        </DataTable.Td>
                        <DataTable.Td>
                          <p className="max-w-[210px] text-xs font-bold text-slate-700">
                            {ownershipLabel(row.ownershipType, row.ownerLabel)}
                          </p>
                          <p className="mt-1 text-[10px] text-slate-400">
                            {row.tasks.some(task => task.assignment.teamKey)
                              ? teamLabel
                              : 'غير مسندة حاليًا'}
                          </p>
                        </DataTable.Td>
                        <DataTable.Td>
                          <div className="flex max-w-[290px] flex-wrap gap-1.5">
                            {row.contactBlocks.doNotContact && (
                              <span
                                className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700"
                                title="قرار دائم على الزبون كله حتى إلغائه"
                              >
                                عدم التواصل · الزبون كله
                              </span>
                            )}
                            {row.contactBlocks.cooldownUntil && (
                              <span
                                className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-700"
                                title="قيد مؤقت على الزبون كله"
                              >
                                تهدئة الزبون · حتى {row.contactBlocks.cooldownUntil.slice(0, 10)}
                              </span>
                            )}
                            {allBlocked > 0 && (
                              <span
                                className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700"
                                title="استبعاد يومي يشمل جميع الفرق"
                              >
                                استبعاد جميع الفرق · {taskCountLabel(allBlocked)}
                              </span>
                            )}
                            {teamBlocked > 0 && (
                              <span
                                className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700"
                                title={`قيد خاص بـ${teamLabel} في يوم الخطة`}
                              >
                                غير مناسبة · {teamLabel} · {taskCountLabel(teamBlocked)}
                              </span>
                            )}
                            {!row.contactBlocks.doNotContact && !row.contactBlocks.cooldownUntil && teamBlocked === 0 && allBlocked === 0 && (
                              <span className="text-xs font-bold text-slate-400">لا توجد قيود فعالة</span>
                            )}
                          </div>
                        </DataTable.Td>
                        <DataTable.Td>
                          <div className="min-w-[170px]">
                            <StatusBadge status={row.lifecycleStatus} />
                            <p className="mt-1.5 text-[11px] font-bold text-slate-500">
                              {contactAttemptLabel(row.contactTarget?.attemptCount ?? 0)}
                            </p>
                            <p className="mt-0.5 text-[10px] text-slate-400">
                              {row.listState.generated
                                ? `${row.listState.itemCount} بند في القائمة`
                                : 'لم تدخل قائمة الاتصال'}
                            </p>
                          </div>
                        </DataTable.Td>
                        <DataTable.Td align="center">
                          <button
                            type="button"
                            onClick={() => setExpandedRows(current => {
                              const next = new Set(current);
                              if (next.has(row.rowKey)) next.delete(row.rowKey);
                              else next.add(row.rowKey);
                              return next;
                            })}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
                            aria-expanded={expanded}
                            aria-label="عرض تفاصيل المهام"
                          >
                            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                          </button>
                        </DataTable.Td>
                      </DataTable.Row>
                      {expanded && (
                        <tr>
                          <td colSpan={7} className="border-t border-sky-100 bg-slate-50/70 px-5 py-4">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-black text-slate-700">مهام جهة الاتصال في هذا الموقع</p>
                                <p className="mt-0.5 text-xs text-slate-400">
                                  المهمة المعلّمة «مطابقة» هي التي دخلت نتيجة الفلاتر الحالية.
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => openContactOperation(row)}
                                disabled={!canEditContactControl}
                                title={!canEditContactControl
                                  ? 'يتطلب صلاحية clients.contact_control.edit'
                                  : undefined}
                                className={[
                                  'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400',
                                  row.contactBlocks.doNotContact
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                    : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
                                ].join(' ')}
                              >
                                {row.contactBlocks.doNotContact
                                  ? <Undo2 className="h-3.5 w-3.5" />
                                  : <Phone className="h-3.5 w-3.5" />}
                                {row.contactBlocks.doNotContact ? 'إلغاء عدم التواصل' : 'عدم التواصل مع الزبون'}
                              </button>
                            </div>
                            <div className="grid gap-2 lg:grid-cols-2">
                              {row.tasks.map(task => {
                                const selected = isTaskSelected(task.taskId);
                                const matchesMode = taskMatchesMode(task, targetMode);
                                const canSelectTask = selection.scope === 'TASKS'
                                  && matchesMode
                                  && taskCanBeCurated(task);
                                return (
                                  <div
                                    key={task.taskId}
                                    className={[
                                      'rounded-xl border p-3 transition',
                                      task.matchesTaskFilters
                                        ? 'border-sky-200 bg-white shadow-sm'
                                        : 'border-slate-200 bg-slate-50 opacity-75',
                                    ].join(' ')}
                                  >
                                    <div className="flex items-start gap-3">
                                      <Checkbox
                                        checked={selected}
                                        onCheckedChange={() => toggleTask(task.taskId)}
                                        disabled={!canSelectTask}
                                        label={`تحديد المهمة ${task.taskId}`}
                                        className="mt-1"
                                      />
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <span className="font-black text-slate-800">{task.taskTypeLabel}</span>
                                          <span className="font-mono text-[10px] text-slate-400">#{task.taskId}</span>
                                          {task.matchesTaskFilters && (
                                            <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">
                                              مطابقة
                                            </span>
                                          )}
                                          {task.assignment.committed && (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                                              <Lock className="h-3 w-3" />
                                              معتمدة
                                            </span>
                                          )}
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                                          <span>{TASK_STATUS_LABELS[task.status] ?? task.status}</span>
                                          <span>العائلة: {taskFamilyLabel(task.taskFamily)}</span>
                                          {task.priority && <span>الأولوية: {PRIORITY_LABELS[task.priority] ?? task.priority}</span>}
                                          {task.dueDate && <span>الاستحقاق: {task.dueDate.slice(0, 10)}</span>}
                                          {task.expectedDate && <span>المتوقع: {task.expectedDate.slice(0, 10)}</span>}
                                        </div>
                                        <div className="mt-2 flex flex-wrap gap-1">
                                          {task.blocks.currentTeamDay && (
                                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                                              غير مناسبة · {teamLabel}
                                            </span>
                                          )}
                                          {task.blocks.allTeamsDay && (
                                            <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
                                              مستبعدة من جميع الفرق اليوم
                                            </span>
                                          )}
                                          {task.blocks.clientDoNotContact && (
                                            <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
                                              عدم التواصل · الزبون كله
                                            </span>
                                          )}
                                          {task.blocks.clientCooldown && (
                                            <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700">
                                              تهدئة الزبون
                                            </span>
                                          )}
                                        </div>
                                        {(task.exclusionReasonText || task.exclusionReasonCode) && (
                                          <p className="mt-2 rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-500">
                                            السبب: {task.exclusionReasonText || task.exclusionReasonCode}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                    {task.availableActions.length > 0 && (
                                      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2.5">
                                        {task.availableActions.includes('EXCLUDE_TEAM_DAY') && (
                                          <button
                                            type="button"
                                            onClick={() => openTaskOperation(task, TASK_OPERATIONS[0])}
                                            className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700 hover:bg-amber-100"
                                          >
                                            استبعاد عن الفريق
                                          </button>
                                        )}
                                        {task.availableActions.includes('RESTORE_TEAM_DAY') && (
                                          <button
                                            type="button"
                                            onClick={() => openTaskOperation(task, TASK_OPERATIONS[2])}
                                            className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100"
                                          >
                                            استعادة للفريق
                                          </button>
                                        )}
                                        {task.availableActions.includes('EXCLUDE_ALL_TEAMS_DAY') && (
                                          <button
                                            type="button"
                                            onClick={() => openTaskOperation(task, TASK_OPERATIONS[1])}
                                            className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-700 hover:bg-red-100"
                                          >
                                            استبعاد عن اليوم
                                          </button>
                                        )}
                                        {task.availableActions.includes('RESTORE_ALL_TEAMS_DAY') && (
                                          <button
                                            type="button"
                                            onClick={() => openTaskOperation(task, TASK_OPERATIONS[3])}
                                            className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100"
                                          >
                                            استعادة عامة
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </DataTable.Body>
            </DataTable>

            <footer className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>
                  عرض {rows.length ? ((pagination?.page ?? 1) - 1) * (pagination?.limit ?? limit) + 1 : 0}
                  {' '}– {Math.min((pagination?.page ?? 1) * (pagination?.limit ?? limit), pagination?.totalContacts ?? 0)}
                  {' '}من {pagination?.totalContacts ?? 0} جهة
                </span>
                <Select
                  value={limit}
                  onChange={value => {
                    setLimit(value);
                    setPage(1);
                  }}
                  options={[10, 25, 50, 100].map(value => ({ value, label: `${value} صف` }))}
                  ariaLabel="عدد الصفوف"
                  size="sm"
                />
              </div>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(current => Math.max(1, current - 1))}
                  disabled={(pagination?.page ?? 1) <= 1 || refreshing}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                  aria-label="الصفحة السابقة"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <span className="min-w-[100px] text-center text-xs font-bold text-slate-600">
                  صفحة {pagination?.page ?? 1} من {pagination?.totalPages ?? 1}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(current => Math.min(pagination?.totalPages ?? current, current + 1))}
                  disabled={(pagination?.page ?? 1) >= (pagination?.totalPages ?? 1) || refreshing}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                  aria-label="الصفحة التالية"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              </div>
            </footer>
          </section>
        ) : null}

      </div>

      <CurationPreviewModal
        request={pendingCuration}
        date={date}
        teamKey={teamKey}
        teamLabel={teamLabel}
        onClose={() => setPendingCuration(null)}
        onApplied={handleApplied}
      />
      <Modal
        isOpen={closePreviewOpen}
        onClose={() => !closingCycle && setClosePreviewOpen(false)}
        title="إنهاء خطة الفريق لهذا اليوم"
        size="md"
        footer={(
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setClosePreviewOpen(false)}
              disabled={closingCycle}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={confirmCloseCycle}
              disabled={!closePreview || closingCycle}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
            >
              {closingCycle && <Loader2 className="h-4 w-4 animate-spin" />}
              تأكيد إنهاء الخطة
            </button>
          </div>
        )}
      >
        {loadingClosePreview ? (
          <div className="flex min-h-40 items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-sky-600" />
          </div>
        ) : closePreview ? (
          <div className="space-y-4 text-sm text-slate-700">
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
              هذا الإجراء نهائي لهذه الدورة. سيبقى سجل القائمة والاتصالات محفوظاً، ولن يمكن توليد أو إسناد مهام جديدة داخلها.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 p-3"><b className="block text-xl">{closePreview.contactTargetsClosed}</b> جهات اتصال ستغلق</div>
              <div className="rounded-xl border border-slate-200 p-3"><b className="block text-xl">{closePreview.tasksReleased}</b> مهام ستعود للانتظار</div>
              <div className="rounded-xl border border-slate-200 p-3"><b className="block text-xl">{closePreview.preservedBookings}</b> حجوزات محفوظة</div>
              <div className="rounded-xl border border-slate-200 p-3"><b className="block text-xl">{closePreview.activeLocks}</b> أقفال معالجة ستنظف</div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
