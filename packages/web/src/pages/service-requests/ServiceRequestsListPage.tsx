// ============================================================
// ServiceRequestsListPage — central intake dashboard
// Constitution: maintenance.md §٠.١٦ (GLOBAL view) + §٠.٤.أ (claim ownership)
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Filter, Hash, Loader2, Plus, RefreshCw, User } from 'lucide-react';
import { api } from '../../lib/api';
import SmartTable, { type ColumnDef } from '../../components/SmartTable';
import Select from '../../components/ui/Select';
import PageHeader from '../../components/ui/PageHeader';
import { useAuthStore } from '../../hooks/useAuthStore';
import { usePermissions } from '../../hooks/usePermissions';

const STATUS_LABELS: Record<string, string> = {
  received: 'مُستلَم',
  in_review: 'قيد المراجعة',
  awaiting_customer_info: 'بانتظار الزبون',
  resolved_at_intake: 'محلول في الاستلام',
  rejected: 'مرفوض',
  promoted: 'مُرَقّى',
  cancelled: 'مُلغى',
};

const STATUS_COLORS: Record<string, string> = {
  received: 'bg-slate-100 text-slate-700',
  in_review: 'bg-blue-100 text-blue-700',
  awaiting_customer_info: 'bg-yellow-100 text-yellow-700',
  resolved_at_intake: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  promoted: 'bg-purple-100 text-purple-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

const CHANNEL_LABELS: Record<string, string> = {
  phone: 'هاتف',
  internal_button: 'زر داخلي',
  client_detail_button: 'من تفاصيل الزبون',
  admin_manual: 'إنشاء يدوي',
  mobile_app: 'تطبيق موبايل',
  website: 'موقع',
  whatsapp: 'واتساب',
};

export default function ServiceRequestsListPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('service_requests.create');
  const canReview = hasPermission('service_requests.review');

  const [filters, setFilters] = useState<{
    status?: string;
    channel?: string;
    mine?: boolean;
    reviewRequired?: boolean;
    duplicateOnly?: boolean;
    archived?: 'true' | 'false' | 'all';
  }>({ archived: 'false' });
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Load all matching rows; SmartTable handles pagination client-side (10/page),
      // consistent with every other list page in the app.
      const res = await api.serviceRequests.list({
        status: filters.status,
        channel: filters.channel,
        mine: filters.mine || undefined,
        reviewRequired: filters.reviewRequired || undefined,
        duplicateOnly: filters.duplicateOnly || undefined,
        archived: filters.archived,
        limit: 1000,
      });
      setItems(res.items);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  async function quickClaim(id: number) {
    try {
      await api.serviceRequests.claim(id);
      await load();
    } catch (e: any) {
      alert(e?.message ?? 'فَشل الـ claim');
    }
  }

  const columns: ColumnDef<any>[] = [
    {
      key: 'publicRefNumber',
      label: 'المرجع',
      sortable: true,
      width: 'w-32',
      getValue: (r) => r.publicRefNumber ?? '',
      render: (r) => (
        <span className="font-mono text-xs text-blue-700">
          <Hash className="h-3 w-3 inline ml-1" />
          {r.publicRefNumber}
        </span>
      ),
    },
    {
      key: 'channel',
      label: 'القناة',
      sortable: true,
      getValue: (r) => CHANNEL_LABELS[r.channel] ?? r.channel ?? '',
      render: (r) => <span className="text-sm text-slate-700">{CHANNEL_LABELS[r.channel] ?? r.channel}</span>,
    },
    {
      key: 'requester',
      label: 'صاحب الطلب',
      minWidth: '160px',
      render: (r) => (
        <span className="text-sm text-slate-700">
          {r.requesterExternal?.name ?? (r.beneficiaryClientId ? `عميل #${r.beneficiaryClientId}` : '—')}
        </span>
      ),
    },
    {
      key: 'problemDescription',
      label: 'المشكلة',
      minWidth: '240px',
      render: (r) => <span className="block max-w-[280px] truncate text-sm text-slate-600">{r.problemDescription}</span>,
    },
    {
      key: 'status',
      label: 'الحالة',
      sortable: true,
      getValue: (r) => STATUS_LABELS[r.status] ?? r.status ?? '',
      render: (r) => (
        <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[r.status] ?? ''}`}>
          {STATUS_LABELS[r.status] ?? r.status}
        </span>
      ),
    },
    {
      key: 'reviewedByUserId',
      label: 'المُتولّي',
      render: (r) =>
        r.reviewedByUserId ? (
          <span className="flex items-center gap-1 text-xs text-slate-700">
            <User className="h-3 w-3" />
            {r.reviewedByUserId === user?.id ? 'أنا' : `#${r.reviewedByUserId}`}
          </span>
        ) : (
          <span className="text-slate-400 text-xs">—</span>
        ),
    },
    {
      key: 'flags',
      label: 'العلامات',
      render: (r) => (
        <div className="flex gap-1">
          {r.duplicateFlag && <span className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">د</span>}
          {r.reviewRequiredFlag && <span className="text-xs px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded">م</span>}
          {r.archivedAt && <span className="text-xs px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded">أ</span>}
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-7xl mx-auto p-4" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <PageHeader
          title="طلبات الصيانة"
          icon={<ClipboardList className="h-6 w-6 text-blue-600" />}
        />
        <div className="flex gap-2">
          <button
            onClick={load}
            className="text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded flex items-center gap-1"
          >
            <RefreshCw className="h-4 w-4" />
            تَحديث
          </button>
          {canCreate && (
            <button
              onClick={() => navigate('/service-requests/new')}
              className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded flex items-center gap-1"
            >
              <Plus className="h-4 w-4" />
              طلب جديد
            </button>
          )}
        </div>
      </div>

      {/* Filters (server-side) */}
      <div className="bg-white border border-slate-200 rounded p-3 mb-4 flex items-center gap-3 flex-wrap">
        <Filter className="h-4 w-4 text-slate-500" />
        <Select
          value={filters.status ?? ''}
          onChange={(v) => setFilters((f) => ({ ...f, status: v || undefined }))}
          size="sm"
          ariaLabel="الحالة"
          options={[
            { value: '', label: 'كل الحالات' },
            ...Object.entries(STATUS_LABELS).map(([k, v]) => ({ value: k, label: v })),
          ]}
        />
        <Select
          value={filters.channel ?? ''}
          onChange={(v) => setFilters((f) => ({ ...f, channel: v || undefined }))}
          size="sm"
          ariaLabel="القناة"
          options={[
            { value: '', label: 'كل القنوات' },
            ...Object.entries(CHANNEL_LABELS).map(([k, v]) => ({ value: k, label: v })),
          ]}
        />
        <label className="text-sm flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!filters.mine}
            onChange={(e) => setFilters((f) => ({ ...f, mine: e.target.checked }))}
          />
          طلباتي
        </label>
        <label className="text-sm flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!filters.reviewRequired}
            onChange={(e) => setFilters((f) => ({ ...f, reviewRequired: e.target.checked }))}
          />
          يَحتاج مراجعة مدقّق
        </label>
        <label className="text-sm flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!filters.duplicateOnly}
            onChange={(e) => setFilters((f) => ({ ...f, duplicateOnly: e.target.checked }))}
          />
          مكرَّر فقط
        </label>
        <Select<'true' | 'false' | 'all'>
          value={filters.archived ?? 'false'}
          onChange={(v) => setFilters((f) => ({ ...f, archived: v }))}
          size="sm"
          ariaLabel="الأرشفة"
          options={[
            { value: 'false', label: 'غير المُؤرشَفة' },
            { value: 'true', label: 'المُؤرشَفة فقط' },
            { value: 'all', label: 'الكلّ' },
          ]}
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <SmartTable
          title="قائمة الطلبات"
          icon={ClipboardList}
          data={items}
          columns={columns}
          getId={(r) => r.id}
          hideFilterBar
          onRowClick={(r) => navigate(`/service-requests/${r.id}`)}
          emptyIcon={ClipboardList}
          emptyMessage="لا توجد طلبات مطابقة."
          tableMinWidth={1000}
          actions={(r) =>
            canReview && r.status === 'received' ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  quickClaim(r.id);
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
