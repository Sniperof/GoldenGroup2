// ============================================================
// RequestsListView — unified request-section list (contract §6 + §7)
// docs/constitution/request-section-contract.md
//
// One table for every request type: 7 fixed core columns in fixed order
// (ref, requester, phone, status, reviewer, flags, received-at), followed
// by the columns the type declares. One filter bar, one flag language,
// one Arabic status lexicon. Each page provides only: fetch, normalize,
// declared extras, and its permission family.
// ============================================================
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  Archive,
  Clock3,
  Copy,
  Filter,
  Hash,
  Loader2,
  Phone,
  RefreshCw,
  Search,
  ShieldAlert,
  User,
} from 'lucide-react';
import SmartTable, { type ColumnDef } from '../SmartTable';
import Select from '../ui/Select';
import Checkbox from '../ui/Checkbox';
import PageHeader from '../ui/PageHeader';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { useAuthStore } from '../../hooks/useAuthStore';
import { usePermissions } from '../../hooks/usePermissions';

// ------------------------------------------------------------
// §7 — the one lexicon. Never redefine these labels in a page.
// ------------------------------------------------------------
export const REQUEST_STATUS_LABELS: Record<string, string> = {
  received: 'مُستلَم',
  in_review: 'قيد المراجعة',
  resolved_at_intake: 'محلول عند الاستلام',
  rejected: 'مرفوض',
  cancelled: 'مُلغى',
  promoted: 'مُرقّى إلى مهمة',
  completed: 'مُكتمَل',
  // Legacy — dropped by contract §3; rendered only for pre-existing rows.
  awaiting_customer_info: 'بانتظار الزبون (قديم)',
};

export const REQUEST_STATUS_COLORS: Record<string, string> = {
  received: 'bg-slate-100 text-slate-700',
  in_review: 'bg-blue-100 text-blue-700',
  resolved_at_intake: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
  promoted: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  awaiting_customer_info: 'bg-yellow-100 text-yellow-700',
};

export const REQUEST_CHANNEL_LABELS: Record<string, string> = {
  phone: 'هاتف',
  internal_button: 'زر داخلي',
  client_detail_button: 'من تفاصيل الزبون',
  admin_manual: 'إنشاء يدوي',
  mobile_app: 'تطبيق موبايل',
  website: 'موقع',
  whatsapp: 'واتساب',
};

/** Canonical label + declared per-type display overlays (contract §9). */
export function requestStatusLabel(status: string, requestType?: string | null): string {
  if (requestType === 'account_creation' && status === 'completed') return 'مُعتمَد ومُفعَّل';
  return REQUEST_STATUS_LABELS[status] ?? status;
}

export function RequestStatusBadge({ status, requestType }: { status: string; requestType?: string | null }) {
  return (
    <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-semibold ${REQUEST_STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {requestStatusLabel(status, requestType)}
    </span>
  );
}

// ------------------------------------------------------------
// §6 — one explicit visual flag language. Never rely on initials: every
// state remains understandable without a tooltip or memorised legend.
// ------------------------------------------------------------
export function RequestFlags({ row }: { row: NormalizedRequestRow }) {
  const flags = [
    row.duplicateFlag && { label: 'طلب مكرّر', icon: Copy, className: 'border-orange-200 bg-orange-50 text-orange-700' },
    row.reviewRequiredFlag && { label: 'مراجعة مطلوبة', icon: ShieldAlert, className: 'border-yellow-200 bg-yellow-50 text-yellow-800' },
    row.escalated && { label: 'طلب مصعّد', icon: AlertTriangle, className: 'border-red-200 bg-red-50 text-red-700' },
    row.stale && { label: 'طلب متأخر', icon: Clock3, className: 'border-amber-200 bg-amber-50 text-amber-800' },
    row.archived && { label: 'طلب مؤرشف', icon: Archive, className: 'border-slate-200 bg-slate-100 text-slate-600' },
  ].filter(Boolean) as { label: string; icon: typeof Copy; className: string }[];

  if (flags.length === 0) return <span className="text-xs text-slate-400">لا توجد علامات</span>;

  return (
    <div className="flex max-w-[260px] flex-wrap gap-1.5">
      {flags.map(({ label, icon: Icon, className }) => (
        <span key={label} className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold ${className}`}>
          <Icon className="h-3 w-3" aria-hidden="true" />
          {label}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------
// Normalized row — pages map their API payload onto this shape once.
// ------------------------------------------------------------
export interface NormalizedRequestRow {
  id: number;
  ref: string;
  requesterName: string;
  phone: string;
  status: string;
  requestType?: string | null;
  reviewerId: number | null;
  reviewerName: string | null;
  duplicateFlag: boolean;
  reviewRequiredFlag: boolean;
  escalated: boolean;
  /** Contract §3 advisory stale flag («ر»). */
  stale: boolean;
  archived: boolean;
  createdAt: string | null;
  /** Original API row, for the type's declared extra columns. */
  raw: any;
}

export interface RequestListFilters {
  status?: string;
  mine?: boolean;
  reviewRequired?: boolean;
  escalatedOnly?: boolean;
  staleOnly?: boolean;
  duplicateOnly?: boolean;
  archived: 'true' | 'false' | 'all';
  search?: string;
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ar-SY', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

interface RequestsListViewProps {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  /** Permission family of this type (contract §5) — gates quick-claim. */
  permissionFamily: string;
  /** Statuses offered in the unified status filter. */
  statusOptions: string[];
  /** Per-type display overlays applied on top of the lexicon. */
  requestTypeForLabels?: string;
  fetchRows: (filters: RequestListFilters) => Promise<any[]>;
  normalize: (raw: any) => NormalizedRequestRow;
  /** Declared type-specific columns, appended after the 7 core columns. */
  extraColumns?: ColumnDef<NormalizedRequestRow>[];
  detailPath: (row: NormalizedRequestRow) => string;
  /** Quick-claim API (contract §6). Omit only if the type declares none. */
  claim?: (id: number) => Promise<any>;
  headerActions?: ReactNode;
  emptyMessage: string;
  tableMinWidth?: number;
}

export default function RequestsListView(props: RequestsListViewProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { hasPermission } = usePermissions();
  const canReview = hasPermission(`${props.permissionFamily}.review`);

  const [filters, setFilters] = useState<RequestListFilters>({ archived: 'false' });
  const [searchInput, setSearchInput] = useState('');
  const [rows, setRows] = useState<NormalizedRequestRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const items = await props.fetchRows(filters);
      setRows(items.map(props.normalize));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  async function quickClaim(id: number) {
    if (!props.claim) return;
    try {
      await props.claim(id);
      await load();
    } catch (e: any) {
      alert(e?.message ?? 'فَشل الاستلام');
    }
  }

  // §6 core columns — fixed set, fixed order.
  const coreColumns: ColumnDef<NormalizedRequestRow>[] = [
    {
      key: 'ref',
      label: 'المرجع',
      sortable: true,
      width: 'w-32',
      getValue: (r) => r.ref,
      render: (r) => (
        <span className="font-mono text-xs text-blue-700" dir="ltr">
          <Hash className="h-3 w-3 inline ml-1" />
          {r.ref}
        </span>
      ),
    },
    {
      key: 'requester',
      label: 'مقدّم الطلب',
      minWidth: '170px',
      getValue: (r) => r.requesterName,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
          <User className="h-4 w-4 text-slate-400" />
          {r.requesterName || '—'}
        </span>
      ),
    },
    {
      key: 'phone',
      label: 'الهاتف',
      minWidth: '130px',
      getValue: (r) => r.phone,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 font-mono text-sm text-slate-700" dir="ltr">
          <Phone className="h-4 w-4 text-slate-400" />
          {r.phone || '—'}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'الحالة',
      sortable: true,
      getValue: (r) => requestStatusLabel(r.status, r.requestType ?? props.requestTypeForLabels),
      render: (r) => <RequestStatusBadge status={r.status} requestType={r.requestType ?? props.requestTypeForLabels} />,
    },
    {
      key: 'reviewer',
      label: 'المتولّي',
      getValue: (r) => r.reviewerName ?? '',
      render: (r) =>
        r.reviewerId ? (
          <span className="flex items-center gap-1.5 text-xs text-slate-700">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-500">
              <User className="h-3.5 w-3.5" />
            </span>
            {r.reviewerId === user?.id
              ? `أنا${r.reviewerName ? ` · ${r.reviewerName}` : ''}`
              : r.reviewerName ?? `المستخدم #${r.reviewerId}`}
          </span>
        ) : (
          <span className="text-slate-400 text-xs">—</span>
        ),
    },
    {
      key: 'flags',
      label: 'العلامات',
      render: (r) => <RequestFlags row={r} />,
    },
    {
      key: 'createdAt',
      label: 'تاريخ الاستلام',
      sortable: true,
      getValue: (r) => r.createdAt ?? '',
      render: (r) => <span className="text-xs text-slate-500">{formatDate(r.createdAt)}</span>,
    },
  ];

  const columns = [...coreColumns, ...(props.extraColumns ?? [])];

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-6" dir="rtl">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-gradient-to-l from-sky-50/70 via-white to-white px-5 py-5 md:px-6">
        <PageHeader
          title={props.title}
          subtitle={props.subtitle}
          icon={
            <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-sky-100 bg-sky-50">
              <props.icon className="h-5 w-5 text-sky-600" />
            </span>
          }
          actions={
            <>
              <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => void load()}>
                تحديث البيانات
              </Button>
              {props.headerActions}
            </>
          }
        />
      </div>

      {/* §6 unified filter bar */}
      <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4 md:px-6">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700">
          <Filter className="h-4 w-4 text-sky-600" />
          تصفية الطلبات
          <span className="text-xs font-normal text-slate-400">اختر حالة أو علامة لتضييق النتائج</span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
        <div className="min-w-[180px]">
          <Select
          value={filters.status ?? ''}
          onChange={(v) => setFilters((f) => ({ ...f, status: v || undefined }))}
          size="sm"
          ariaLabel="الحالة"
          options={[
            { value: '', label: 'كل الحالات' },
            ...props.statusOptions.map((s) => ({
              value: s,
              label: requestStatusLabel(s, props.requestTypeForLabels),
            })),
          ]}
          />
        </div>
        <Select<'true' | 'false' | 'all'>
          value={filters.archived}
          onChange={(v) => setFilters((f) => ({ ...f, archived: v }))}
          size="sm"
          ariaLabel="الأرشفة"
          options={[
            { value: 'false', label: 'الطلبات النشطة' },
            { value: 'true', label: 'الطلبات المؤرشفة' },
            { value: 'all', label: 'كل الطلبات' },
          ]}
        />
        <span className="mx-1 hidden h-6 w-px bg-slate-200 lg:block" />
        <Checkbox
          checked={!!filters.mine}
          onCheckedChange={(v) => setFilters((f) => ({ ...f, mine: v }))}
          className="text-sm"
        >
          الطلبات المسندة لي
        </Checkbox>
        <Checkbox
          checked={!!filters.escalatedOnly}
          onCheckedChange={(v) => setFilters((f) => ({ ...f, escalatedOnly: v }))}
          className="text-sm"
        >
          الطلبات المصعّدة
        </Checkbox>
        <Checkbox
          checked={!!filters.staleOnly}
          onCheckedChange={(v) => setFilters((f) => ({ ...f, staleOnly: v }))}
          className="text-sm"
        >
          الطلبات المتأخرة
        </Checkbox>
        <Checkbox
          checked={!!filters.duplicateOnly}
          onCheckedChange={(v) => setFilters((f) => ({ ...f, duplicateOnly: v }))}
          className="text-sm"
        >
          الطلبات المكررة
        </Checkbox>
        <Checkbox
          checked={!!filters.reviewRequired}
          onCheckedChange={(v) => setFilters((f) => ({ ...f, reviewRequired: v }))}
          className="text-sm"
        >
          تحتاج مراجعة مدقق
        </Checkbox>
        <form
          className="mr-auto w-full min-w-[240px] sm:w-auto"
          onSubmit={(e) => {
            e.preventDefault();
            setFilters((f) => ({ ...f, search: searchInput.trim() || undefined }));
          }}
        >
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="بحث: اسم / رقم / مرجع"
            inputSize="sm"
            className="sm:w-72"
            leading={<Search className="h-4 w-4" />}
            trailing={
              <button type="submit" className="rounded-full p-1 text-slate-500 hover:bg-sky-50 hover:text-sky-600" aria-label="تنفيذ البحث">
                <Search className="h-4 w-4" />
              </button>
            }
          />
        </form>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <SmartTable
          title={props.title}
          icon={props.icon}
          data={rows}
          columns={columns}
          getId={(r) => r.id}
          hideFilterBar
          hideHeader
          embedded
          fillEmptyRows={false}
          defaultSortKey="createdAt"
          defaultSortDir="desc"
          onRowClick={(r) => navigate(props.detailPath(r))}
          emptyIcon={props.icon}
          emptyMessage={props.emptyMessage}
          tableMinWidth={props.tableMinWidth ?? 1050}
          actions={(r) =>
            props.claim && canReview && r.status === 'received' && !r.archived ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void quickClaim(r.id);
                }}
                className="rounded-full bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
              >
                تَولّي
              </button>
            ) : null
          }
        />
      )}
      </section>
    </div>
  );
}
