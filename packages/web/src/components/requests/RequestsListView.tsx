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
import { Filter, Hash, Loader2, Phone, RefreshCw, Search, User } from 'lucide-react';
import SmartTable, { type ColumnDef } from '../SmartTable';
import Select from '../ui/Select';
import Checkbox from '../ui/Checkbox';
import PageHeader from '../ui/PageHeader';
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
    <span className={`w-fit rounded px-2 py-0.5 text-xs ${REQUEST_STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {requestStatusLabel(status, requestType)}
    </span>
  );
}

// ------------------------------------------------------------
// §6 — one visual flag language: letter + color + tooltip.
// ------------------------------------------------------------
export function RequestFlags({ row }: { row: NormalizedRequestRow }) {
  return (
    <div className="flex gap-1">
      {row.duplicateFlag && (
        <span className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded" title="مُكرَّر">د</span>
      )}
      {row.reviewRequiredFlag && (
        <span className="text-xs px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded" title="يَحتاج مراجعة مدقّق">م</span>
      )}
      {row.escalated && (
        <span className="text-xs px-1.5 py-0.5 bg-red-600 text-white rounded font-semibold" title="مُصعَّد — وضع مقيَّد">ص</span>
      )}
      {row.stale && (
        <span className="text-xs px-1.5 py-0.5 bg-amber-200 text-amber-800 rounded" title="راكد — قيد المراجعة بلا حركة أطول من العتبة الإدارية (تنبيه فقط)">ر</span>
      )}
      {row.archived && (
        <span className="text-xs px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded" title="مُؤرشَف">أ</span>
      )}
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
          <span className="flex items-center gap-1 text-xs text-slate-700">
            <User className="h-3 w-3" />
            {r.reviewerId === user?.id ? 'أنا' : r.reviewerName ?? `#${r.reviewerId}`}
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
    <div className="max-w-7xl mx-auto p-4" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <PageHeader
          title={props.title}
          subtitle={props.subtitle}
          icon={<props.icon className="h-6 w-6 text-blue-600" />}
        />
        <div className="flex gap-2">
          <button
            onClick={() => void load()}
            className="text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded flex items-center gap-1"
          >
            <RefreshCw className="h-4 w-4" />
            تحديث
          </button>
          {props.headerActions}
        </div>
      </div>

      {/* §6 unified filter bar */}
      <div className="bg-white border border-slate-200 rounded p-3 mb-4 flex items-center gap-3 flex-wrap">
        <Filter className="h-4 w-4 text-slate-500" />
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
        <Checkbox
          checked={!!filters.mine}
          onCheckedChange={(v) => setFilters((f) => ({ ...f, mine: v }))}
          className="text-sm"
        >
          طلباتي
        </Checkbox>
        <Checkbox
          checked={!!filters.escalatedOnly}
          onCheckedChange={(v) => setFilters((f) => ({ ...f, escalatedOnly: v }))}
          className="text-sm"
        >
          مُصعَّد فقط
        </Checkbox>
        <Checkbox
          checked={!!filters.staleOnly}
          onCheckedChange={(v) => setFilters((f) => ({ ...f, staleOnly: v }))}
          className="text-sm"
        >
          راكد فقط
        </Checkbox>
        <Checkbox
          checked={!!filters.duplicateOnly}
          onCheckedChange={(v) => setFilters((f) => ({ ...f, duplicateOnly: v }))}
          className="text-sm"
        >
          مكرَّر فقط
        </Checkbox>
        <Checkbox
          checked={!!filters.reviewRequired}
          onCheckedChange={(v) => setFilters((f) => ({ ...f, reviewRequired: v }))}
          className="text-sm"
        >
          يَحتاج مراجعة مدقّق
        </Checkbox>
        <Select<'true' | 'false' | 'all'>
          value={filters.archived}
          onChange={(v) => setFilters((f) => ({ ...f, archived: v }))}
          size="sm"
          ariaLabel="الأرشفة"
          options={[
            { value: 'false', label: 'غير المُؤرشَفة' },
            { value: 'true', label: 'المُؤرشَفة فقط' },
            { value: 'all', label: 'الكلّ' },
          ]}
        />
        <form
          className="flex items-center gap-1 mr-auto"
          onSubmit={(e) => {
            e.preventDefault();
            setFilters((f) => ({ ...f, search: searchInput.trim() || undefined }));
          }}
        >
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="بحث: اسم / رقم / مرجع"
            className="text-sm border border-slate-200 rounded px-2 py-1 w-52"
          />
          <button type="submit" className="text-slate-600 hover:text-blue-600 p-1" aria-label="بحث">
            <Search className="h-4 w-4" />
          </button>
        </form>
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
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded"
              >
                تَولّي
              </button>
            ) : null
          }
        />
      )}
    </div>
  );
}
