import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, Monitor, Filter, Wrench, DollarSign, RefreshCw, Gift, ShieldCheck, UserCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { useBranchListScope } from '../../hooks/useBranchListScope';
import ClientCardPopup from '../../components/ClientCardPopup';
import Select from '../../components/ui/Select';
import {
  OPEN_TASK_STATUS_LABELS,
  OPEN_TASK_PHASE_LABELS,
  OPEN_TASK_PHASE_COLORS,
  getTaskPhase,
  type OpenTaskStatus,
  type CustomerOwnership,
} from '@golden-crm/shared';
import { getExpectedDateStatus, getDueDateStatus } from '../../lib/taskDateStatus';
import { getGeoUnits, type GeoUnit } from '../../lib/geoUnitsCache';
import BranchScopeIndicator from '../../components/BranchScopeIndicator';
import GoldenWarrantyOfferModal from '../../taskTypes/golden_warranty_offer/GoldenWarrantyOfferModal';
import GoldenWarrantyCardDeliveryModal from '../../taskTypes/golden_warranty_card_delivery/GoldenWarrantyCardDeliveryModal';

// ============================================================
// TaskGroupPage — Unified tasks list for all 6 display_groups.
// Constitution: docs/constitution/features/unified-task-template.md
//
// The table layout is the canonical base copied from DeviceDemo.tsx
// (2026-06-01). We unify the other 5 groups onto the same structure
// by group-aware API wiring in a follow-up step.
// ============================================================

type GroupKey =
  | 'device-demo'
  | 'maintenance'
  | 'collection'
  | 'after-sale-services'
  | 'gift-delivery'
  | 'warranty-services'
  | 'device-delivery'
  | 'device-installation'
  | 'device-activation'
  | 'my-customers';

type GroupConfig = {
  label: string;
  subtitle: string;
  taskTypes: string[];
  Icon: typeof Monitor;
  accentBg: string;
  accentRing: string;
  detailHref: string;
};

const GROUP_CONFIG: Record<GroupKey, GroupConfig> = {
  'device-demo': {
    label: 'مهام عرض الجهاز',
    subtitle: 'عرض جهاز فلتر مياه على زبون مرشَّح وتقديم عرض مالي',
    taskTypes: ['device_demo'],
    Icon: Monitor,
    accentBg: 'bg-indigo-500',
    accentRing: 'shadow-indigo-500/20',
    detailHref: '/tasks/device-demo',
  },
  'maintenance': {
    label: 'مهام الصيانة',
    subtitle: 'الصيانة الدورية والصيانة الطارئة للأجهزة المركّبة',
    taskTypes: ['periodic_maintenance', 'emergency_maintenance'],
    Icon: Wrench,
    accentBg: 'bg-amber-500',
    accentRing: 'shadow-amber-500/20',
    detailHref: '/tasks/group/maintenance',
  },
  'collection': {
    label: 'مهام تحصيل الأقساط',
    subtitle: 'تحصيل أقساط العقود وذمم الصيانة',
    taskTypes: ['installment_collection', 'maintenance_collection'],
    Icon: DollarSign,
    accentBg: 'bg-emerald-500',
    accentRing: 'shadow-emerald-500/20',
    detailHref: '/tasks/group/collection',
  },
  'after-sale-services': {
    label: 'مهام خدمات ما بعد البيع',
    subtitle: 'الفحص والإصلاح والسحب والإرجاع والنقل وبيع القطع',
    taskTypes: ['device_repair', 'device_retrieval', 'device_return', 'device_transfer', 'device_disconnection', 'parts_sale'],
    Icon: RefreshCw,
    accentBg: 'bg-sky-500',
    accentRing: 'shadow-sky-500/20',
    detailHref: '/tasks/group/after-sale-services',
  },
  'gift-delivery': {
    label: 'مهام تسليم الهدايا',
    subtitle: 'تسليم الهدايا للزبائن المؤهَّلين',
    taskTypes: ['gift_delivery'],
    Icon: Gift,
    accentBg: 'bg-rose-500',
    accentRing: 'shadow-rose-500/20',
    detailHref: '/tasks/group/gift-delivery',
  },
  'warranty-services': {
    label: 'مهام خدمات الكفالة',
    subtitle: 'الكفالة الذهبية، إعادة تفعيل الكفالة, وإلغاؤها',
    taskTypes: ['golden_warranty', 'golden_warranty_offer', 'golden_warranty_card_delivery', 'warranty_reactivation', 'warranty_cancellation'],
    Icon: ShieldCheck,
    accentBg: 'bg-violet-500',
    accentRing: 'shadow-violet-500/20',
    detailHref: '/tasks/group/warranty-services',
  },
  'device-delivery': {
    label: 'مهام تسليم الجهاز',
    subtitle: 'تسليم الأجهزة المباعة إلى الزبائن',
    taskTypes: ['device_delivery'],
    Icon: Gift,
    accentBg: 'bg-sky-500',
    accentRing: 'shadow-sky-500/20',
    detailHref: '/tasks/group/device-delivery',
  },
  'device-installation': {
    label: 'مهام تركيب الجهاز',
    subtitle: 'تركيب الأجهزة في مواقع الزبائن',
    taskTypes: ['device_installation'],
    Icon: Wrench,
    accentBg: 'bg-amber-500',
    accentRing: 'shadow-amber-500/20',
    detailHref: '/tasks/group/device-installation',
  },
  'device-activation': {
    label: 'مهام تشغيل الجهاز',
    subtitle: 'تشغيل الأجهزة المركّبة وتفعيلها',
    taskTypes: ['device_activation'],
    Icon: Monitor,
    accentBg: 'bg-indigo-500',
    accentRing: 'shadow-indigo-500/20',
    detailHref: '/tasks/group/device-activation',
  },
  // ASSIGNED-scope aggregate (§7, مُسنَد): every task of customers the user
  // personally owns, regardless of type. Served by /open-tasks/my-customers;
  // row clicks route per-row by task type (see TASK_TYPE_DETAIL_HREF).
  'my-customers': {
    label: 'مهامي',
    subtitle: 'كل مهام الزبائن المملوكين لك شخصياً، من جميع الأنواع',
    taskTypes: [],
    Icon: UserCheck,
    accentBg: 'bg-teal-500',
    accentRing: 'shadow-teal-500/20',
    detailHref: '/tasks/group/maintenance',
  },
};

// Per-type detail route, derived from each group's taskTypes → detailHref. Lets
// the mixed-type "my customers" table route each row to the right detail page.
const TASK_TYPE_DETAIL_HREF: Record<string, string> = Object.values(GROUP_CONFIG)
  .reduce((acc, cfg) => {
    for (const t of cfg.taskTypes) acc[t] = cfg.detailHref;
    return acc;
  }, {} as Record<string, string>);

// ============================================================
// Display helpers — copied verbatim from DeviceDemo.tsx so the
// unified table matches the existing operational look exactly.
// ============================================================

const PRIORITY_LABELS: Record<string, string> = {
  high: 'عالية',
  medium: 'متوسطة',
  low: 'منخفضة',
};

const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-rose-50 text-rose-700 border-rose-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-slate-100 text-slate-600 border-slate-200',
};

const TASK_STATUS_COLORS: Record<string, string> = {
  open: 'bg-sky-50 text-sky-700 border border-sky-200',
  needs_follow_up: 'bg-amber-50 text-amber-700 border border-amber-200',
  assigned: 'bg-violet-50 text-violet-700 border border-violet-200',
  in_scheduling: 'bg-blue-50 text-blue-700 border border-blue-200',
  scheduled: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  waiting_execution: 'bg-teal-50 text-teal-700 border border-teal-200',
  in_execution: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  ended: 'bg-cyan-50 text-cyan-700 border border-cyan-200',
  completed: 'bg-green-50 text-green-700 border border-green-100',
  closed: 'bg-slate-100 text-slate-700 border border-slate-200',
  cancelled: 'bg-slate-200 text-slate-600 border border-slate-300',
};

const VISIT_STATUS_LABELS: Record<string, string> = {
  scheduled: 'مجدول',
  in_progress: 'جارٍ',
  completed: 'مكتمل',
  not_completed: 'لم يكتمل',
  postponed_by_company: 'مؤجل (شركة)',
  postponed_by_customer: 'مؤجل (زبون)',
  cancelled: 'ملغى',
  needs_reschedule: 'يحتاج إعادة جدولة',
};

const VISIT_STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  in_progress: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  completed: 'bg-green-50 text-green-700 border border-green-100',
  not_completed: 'bg-rose-50 text-rose-700 border border-rose-200',
  postponed_by_company: 'bg-amber-50 text-amber-700 border border-amber-200',
  postponed_by_customer: 'bg-amber-50 text-amber-700 border border-amber-200',
  cancelled: 'bg-slate-200 text-slate-600 border border-slate-300',
  needs_reschedule: 'bg-orange-50 text-orange-700 border border-orange-200',
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    // Arabic month names with Western (latin) digits per operator preference.
    return new Date(dateStr).toLocaleDateString('ar', {
      year: 'numeric', month: 'short', day: 'numeric',
      numberingSystem: 'latn',
    } as Intl.DateTimeFormatOptions);
  } catch {
    return dateStr;
  }
}

// Client lifecycle classification — LEAD / FOP / OP.
// Mirrors the vocabulary used in ClientInfoCard and the candidate flows.
//   LEAD = اسم مرشح بلا نشاط فعلي بعد
//   FOP  = زبون محتمل (له زيارات لكن بلا عقد)
//   OP   = زبون فعلي (له عقد واحد على الأقل)
const CLIENT_CLASSIFICATION_LABELS: Record<string, { label: string; color: string }> = {
  LEAD: { label: 'LEAD', color: 'bg-sky-50 text-sky-700 border border-sky-200' },
  FOP:  { label: 'FOP',  color: 'bg-rose-50 text-rose-700 border border-rose-200' },
  OP:   { label: 'OP',   color: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
};

function ClientClassificationCell({ value }: { value?: string | null }) {
  const key = value && CLIENT_CLASSIFICATION_LABELS[value] ? value : 'LEAD';
  const entry = CLIENT_CLASSIFICATION_LABELS[key];
  return (
    <span className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-bold ${entry.color}`}>
      {entry.label}
    </span>
  );
}

function compactText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

function parseGeoId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function buildCompactGeoAddress(geoUnitId: number | null, geoMap: Map<number, GeoUnit>): string {
  if (!geoUnitId) return '';
  const unit = geoMap.get(geoUnitId);
  if (!unit) return '';
  const parent = unit.parentId ? geoMap.get(unit.parentId) : null;
  if (parent) return `${parent.name} ← ${unit.name}`;
  return unit.name;
}

function getFullCustomerName(row: any): string {
  const structured = [row.clientFirstName, row.clientFatherName, row.clientLastName]
    .map(compactText)
    .filter(Boolean)
    .join(' ');
  return structured || row.clientSnapshot?.name || row.clientName || row.customerName || '—';
}

function getPrimaryMobile(row: any): string {
  return row.clientMobile || row.clientSnapshot?.mobile || row.customerMobile || '—';
}

function getLocation(row: any, geoMap: Map<number, GeoUnit>): string {
  const currentDeviceGeoId = parseGeoId(row.currentDeviceGeoUnitId);
  const currentDeviceGeoLabel = buildCompactGeoAddress(currentDeviceGeoId, geoMap);
  if (row.taskType === 'device_delivery') {
    return currentDeviceGeoLabel || '—';
  }
  if (row.taskType === 'device_installation') {
    return currentDeviceGeoLabel || '—';
  }
  if (row.taskType === 'device_activation') {
    return currentDeviceGeoLabel || '—';
  }
  const snap = row.clientSnapshot?.address;
  const hierarchy = snap
    ? [snap.governorate, snap.district, snap.subArea, snap.neighborhood]
    : [row.clientGovernorate, row.clientDistrict, row.clientNeighborhood];
  const lastTwo = hierarchy.map(compactText).filter(Boolean).slice(-2);
  return lastTwo.length > 0 ? lastTwo.join(' > ') : '—';
}

function getTaskTypeLabel(taskType: string): string {
  switch (taskType) {
    case 'device_demo':
      return 'عرض جهاز';
    case 'device_delivery':
      return 'تسليم جهاز';
    case 'device_installation':
      return 'تركيب جهاز';
    case 'device_activation':
      return 'تشغيل جهاز';
    case 'emergency_maintenance':
      return 'صيانة طارئة';
    case 'periodic_maintenance':
      return 'صيانة دورية';
    case 'collection':
      return 'تحصيل';
    case 'gift_delivery':
      return 'تسليم هدية';
    case 'golden_warranty':
      return 'كفالة ذهبية';
    case 'golden_warranty_offer':
      return 'عرض كفالة ذهبية';
    case 'golden_warranty_card_delivery':
      return 'تسليم كرت كفالة ذهبية';
    case 'warranty_reactivation':
      return 'إعادة تفعيل كفالة';
    case 'warranty_cancellation':
      return 'إلغاء كفالة';
    default:
      return taskType;
  }
}

function OwnershipCell({ ownership }: { ownership?: CustomerOwnership | null }) {
  const label = ownership?.ownerLabel || 'الشركة العامة';
  const isPersonal = (ownership?.ownerType ?? '').startsWith('personal');
  return (
    <span className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs font-bold ${
      isPersonal
        ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
        : 'border-slate-200 bg-slate-50 text-slate-600'
    }`}>
      {label}
    </span>
  );
}

function getBranchLabel(row: any): string {
  return compactText(row.displayBranchName) || compactText(row.branchName) || compactText(row.clientBranchName) || compactText(row.taskBranchName) || '—';
}

function getCreatorLabel(row: any): string {
  return compactText(row.displayCreatedByName) || compactText(row.createdByName) || compactText(row.createdBy?.name) || compactText(row.createdBy?.username) || '—';
}

function getDateCounterReference(row: any): string | null {
  return row.taskStatus === 'completed' ? (row.completedAt ?? row.updatedAt ?? null) : null;
}

// ============================================================
// Page component
// ============================================================

export default function TaskGroupPage() {
  const navigate = useNavigate();
  const { group = '' } = useParams<{ group: string }>();
  const config = GROUP_CONFIG[group as GroupKey];
  const { effectiveBranchId, needsBranchSelection } = useBranchListScope();

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [visitStatusFilter, setVisitStatusFilter] = useState('');
  const [scheduledFilter, setScheduledFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [hideSnoozed, setHideSnoozed] = useState(false);
  const [hideFutureTasks, setHideFutureTasks] = useState(false);
  const [clientPopupId, setClientPopupId] = useState<number | null>(null);
  const [savingPriorityId, setSavingPriorityId] = useState<number | null>(null);
  const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
  // DEC-CT-17: golden-warranty tasks open their result modal in-place (no detail page).
  const [offerTask, setOfferTask] = useState<any | null>(null);
  const [cardTask, setCardTask] = useState<any | null>(null);

  useEffect(() => {
    getGeoUnits().then(setGeoUnits).catch(() => setGeoUnits([]));
  }, []);

  const handlePriorityChange = useCallback(async (rowId: number, newPriority: string) => {
    setSavingPriorityId(rowId);
    try {
      await api.openTasks.update(rowId, { priority: newPriority || null });
      setRows(prev => prev.map(r => r.id === rowId ? { ...r, priority: newPriority || null } : r));
    } catch {
      // silent — row stays unchanged on failure
    } finally {
      setSavingPriorityId(null);
    }
  }, []);

  const load = useCallback(async () => {
    if (!config) return;
    // Super-admins must pick a branch first; branch-scoped users load directly.
    if (needsBranchSelection) return;
    setLoading(true);
    setError(null);
    try {
      const params: {
        branchId?: number;
        status?: string;
        visitStatus?: string;
        scheduledDate?: string;
        scheduled?: 'yes' | 'no';
        hideSnoozed?: 'true';
        hideFutureTasks?: 'true';
      } = {
        ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(visitStatusFilter ? { visitStatus: visitStatusFilter } : {}),
        ...(dateFilter ? { scheduledDate: dateFilter } : {}),
        ...(scheduledFilter === 'yes' || scheduledFilter === 'no'
          ? { scheduled: scheduledFilter as 'yes' | 'no' }
          : {}),
        ...(hideSnoozed ? { hideSnoozed: 'true' } : {}),
        ...(hideFutureTasks ? { hideFutureTasks: 'true' } : {}),
      };
      if (group === 'my-customers') {
        setRows(await api.openTasks.listMyCustomers(params));
      } else if (group === 'device-demo') {
        setRows(await api.openTasks.listDeviceDemo(params));
      } else {
        // All other groups are served by the unified group endpoint, each gated
        // by its own table-view permission (migration 288).
        setRows(await api.openTasks.listByGroup(group, params));
      }
    } catch (err) {
      console.error('Failed to load task group rows:', err);
      const detail = err instanceof Error ? err.message : '';
      setError(detail ? `تعذر تحميل بيانات المهام: ${detail}` : 'تعذر تحميل بيانات المهام');
    } finally {
      setLoading(false);
    }
  }, [effectiveBranchId, needsBranchSelection, group, config, statusFilter, visitStatusFilter, dateFilter, scheduledFilter, hideSnoozed, hideFutureTasks]);

  useEffect(() => { load(); }, [load]);

  if (!config) {
    return (
      <div className="p-6" dir="rtl">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          القسم <code className="font-mono">{group}</code> غير معرَّف.
        </div>
      </div>
    );
  }

  if (needsBranchSelection) {
    const Icon = config.Icon;
    return (
      <div className="p-8 text-center text-slate-500">
        <Icon className="w-12 h-12 mx-auto mb-4 text-slate-300" />
        <p className="text-lg">يرجى اختيار فرع لعرض {config.label}</p>
      </div>
    );
  }

  const Icon = config.Icon;
  // All groups are now served by the backend group endpoint (migration 288).
  const notWiredYet = false;
  const geoMap = new Map(geoUnits.map((unit) => [unit.id, unit]));

  // Golden-warranty rows open a modal in place; everything else navigates to its detail page.
  const actionRow = (row: any) => {
    if (row.taskType === 'golden_warranty_offer') { setOfferTask(row); return; }
    if (row.taskType === 'golden_warranty_card_delivery') { setCardTask(row); return; }
    navigate(`${(group === 'my-customers' ? (TASK_TYPE_DETAIL_HREF[row.taskType] ?? config.detailHref) : config.detailHref)}/${row.id}`);
  };

  // warranty-services renders two tables: offers/other vs VIP-card delivery (DEC-CT-17).
  const tableGroups: Array<{ key: string; heading: string | null; rows: any[] }> =
    group === 'warranty-services'
      ? [
          { key: 'offers', heading: 'مهام الكفالة (عرض · إعادة تفعيل · إلغاء)', rows: rows.filter((r) => r.taskType !== 'golden_warranty_card_delivery') },
          { key: 'cards',  heading: 'تسليم كروت الكفالة الذهبية',              rows: rows.filter((r) => r.taskType === 'golden_warranty_card_delivery') },
        ].filter((g) => g.rows.length > 0)
      : [{ key: 'all', heading: null, rows }];

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-lg ${config.accentBg} ${config.accentRing}`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">{config.label}</h1>
            <p className="text-sm text-slate-500">{config.subtitle}</p>
            <div className="mt-2"><BranchScopeIndicator /></div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />

          <Select
            value={statusFilter}
            onChange={(v) => setStatusFilter(v)}
            size="sm"
            ariaLabel="حالة المهمة"
            options={[
              { value: '', label: 'كل حالات المهمة' },
              ...Object.entries(OPEN_TASK_STATUS_LABELS).map(([key, label]) => ({ value: key, label: String(label) })),
            ]}
          />

          <Select
            value={visitStatusFilter}
            onChange={(v) => setVisitStatusFilter(v)}
            size="sm"
            ariaLabel="حالة الزيارة"
            options={[
              { value: '', label: 'كل حالات الزيارة' },
              ...Object.entries(VISIT_STATUS_LABELS).map(([key, label]) => ({ value: key, label })),
            ]}
          />

          <Select
            value={scheduledFilter}
            onChange={(v) => setScheduledFilter(v)}
            size="sm"
            ariaLabel="مجدول / غير مجدول"
            options={[
              { value: '', label: 'مجدول / غير مجدول' },
              { value: 'yes', label: 'مجدول فقط' },
              { value: 'no', label: 'غير مجدول' },
            ]}
          />

          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />

          <label className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg cursor-pointer text-sm text-slate-700">
            <input
              type="checkbox"
              checked={hideSnoozed}
              onChange={(e) => setHideSnoozed(e.target.checked)}
              className="accent-indigo-600"
            />
            <span title="المهام التي حدد لها التلمارك موعداً متوقعاً في المستقبل">إخفاء المؤجلة</span>
          </label>

          <label className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg cursor-pointer text-sm text-slate-700">
            <input
              type="checkbox"
              checked={hideFutureTasks}
              onChange={(e) => setHideFutureTasks(e.target.checked)}
              className="accent-indigo-600"
            />
            <span title="استثناء المهام اللاحقة من حساب الحمل — D13">إخفاء اللاحقة</span>
          </label>
        </div>
      </div>

      {/* Banner for groups still pending unification */}
      {notWiredYet && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          هذا القسم يستخدم نفس هيكل جدول مهام عرض الجهاز كأساس. مصدر البيانات لهذه الأنواع
          (<span className="font-mono">{config.taskTypes.join(', ')}</span>) سيُوحَّد في الخطوة التالية بعد الاتفاق على الأعمدة والفلاتر.
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <span className="mr-3 text-slate-600">جارٍ التحميل...</span>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && rows.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <Icon className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p className="text-lg">لا توجد مهام</p>
          {!notWiredYet && (
            <p className="text-sm">سيتم إنشاء المهام تلقائيًا عند حجز موعد تسويقي من نوع عرض الجهاز</p>
          )}
        </div>
      )}

      {/* Table(s) — warranty-services splits offers vs card-delivery into two tables (DEC-CT-17) */}
      {!loading && rows.length > 0 && tableGroups.map((g) => (
        <div key={g.key} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          {g.heading && (
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">{g.heading}</div>
          )}
          {/* Horizontal scroll: table expands to natural width so every row stays on one line. */}
          <div className="overflow-x-auto">
            <table className="text-sm min-w-max whitespace-nowrap">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">معرف المهمة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">نوع المهمة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">الفرع</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">اسم الزبون الكامل</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">تصنيف الزبون</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">العنوان</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">رقم الموبايل الأساسي</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">الملكية</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">المرحلة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">الحالة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">الأولوية</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">التاريخ المطلوب</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">التاريخ المتوقع</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">تاريخ الزيارة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">حالة الزيارة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">نتيجة الزيارة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">منشئ المهمة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">تاريخ الإنشاء</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((row) => {
                  const mobile = getPrimaryMobile(row);
                  const name = getFullCustomerName(row);
                  const phase = (row.phase ?? getTaskPhase(row.taskStatus as OpenTaskStatus)) as keyof typeof OPEN_TASK_PHASE_LABELS;
                  const dateCounterReference = getDateCounterReference(row);

                  return (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-indigo-50 hover:cursor-pointer transition-colors" onClick={() => actionRow(row)}>
                      <td className="px-4 py-3 text-slate-700 font-mono text-xs">
                        #{row.id}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-bold text-slate-700">
                          {getTaskTypeLabel(row.taskType)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{getBranchLabel(row)}</td>
                      <td className="px-4 py-3">
                        {row.clientId ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); setClientPopupId(row.clientId); }}
                            className="font-medium text-slate-800 hover:text-indigo-700 hover:underline transition-colors"
                          >
                            {name}
                          </button>
                        ) : (
                          <span className="font-medium text-slate-800">{name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3"><ClientClassificationCell value={row.clientClassification} /></td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{getLocation(row, geoMap)}</td>
                      <td className="px-4 py-3 text-slate-600" dir="ltr">{mobile}</td>
                      <td className="px-4 py-3"><OwnershipCell ownership={row.ownership} /></td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold border ${OPEN_TASK_PHASE_COLORS[phase]}`}>
                          {OPEN_TASK_PHASE_LABELS[phase]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${TASK_STATUS_COLORS[row.taskStatus] || 'bg-slate-100 text-slate-600'}`}>
                          {(OPEN_TASK_STATUS_LABELS as Record<string, string>)[row.taskStatus] || row.taskStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <Select
                          value={row.priority || ''}
                          onChange={(v) => handlePriorityChange(row.id, v)}
                          disabled={savingPriorityId === row.id}
                          size="sm"
                          ariaLabel="الأولوية"
                          options={[
                            { value: '', label: '—' },
                            { value: 'high', label: PRIORITY_LABELS.high },
                            { value: 'medium', label: PRIORITY_LABELS.medium },
                            { value: 'low', label: PRIORITY_LABELS.low },
                          ]}
                        />
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {(() => {
                          const s = getDueDateStatus(row.dueDate, dateCounterReference);
                          if (!s) return <span className="text-slate-300">—</span>;
                          return (
                            <div className="flex flex-col gap-1 items-start">
                              <span className={s.textClass}>{formatDate(row.dueDate)}</span>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold ${s.badgeClass}`}>
                                {s.shortLabel}
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {(() => {
                          if (!row.expectedDate) return <span className="text-slate-300">—</span>;
                          const s = getExpectedDateStatus(row.expectedDate, dateCounterReference);
                          if (!s) return <span className="text-slate-600">{formatDate(row.expectedDate)}</span>;
                          return (
                            <div className="flex flex-col gap-1 items-start">
                              <span className={s.textClass}>{formatDate(row.expectedDate)}</span>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold ${s.badgeClass}`}>
                                {s.shortLabel}
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{formatDate(row.scheduledDate)}</td>
                      <td className="px-4 py-3">
                        {row.visitStatus ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${VISIT_STATUS_COLORS[row.visitStatus] || 'bg-slate-100 text-slate-600'}`}>
                            {VISIT_STATUS_LABELS[row.visitStatus] || row.visitStatus}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        {row.latestResult
                          ? <span className="font-mono">{row.latestResult}</span>
                          : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{getCreatorLabel(row)}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(row.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {clientPopupId !== null && (
        <ClientCardPopup
          clientId={clientPopupId}
          onClose={() => setClientPopupId(null)}
        />
      )}

      {offerTask && (
        <GoldenWarrantyOfferModal
          taskId={offerTask.id}
          customerId={offerTask.clientId ?? offerTask.customerId ?? null}
          deviceId={offerTask.deviceId ?? offerTask.installedDeviceId ?? null}
          branchId={effectiveBranchId ?? null}
          onClose={() => setOfferTask(null)}
          onSaved={() => { setOfferTask(null); load(); }}
        />
      )}

      {cardTask && (
        <GoldenWarrantyCardDeliveryModal
          taskId={cardTask.id}
          deviceId={cardTask.deviceId ?? cardTask.installedDeviceId ?? null}
          onClose={() => setCardTask(null)}
          onSaved={() => { setCardTask(null); load(); }}
        />
      )}
    </div>
  );
}
