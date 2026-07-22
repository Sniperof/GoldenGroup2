// ============================================================
// AccountRequestsListPage — mobile-app account-creation requests
// DEC-013 §2.5 — reuses the service_requests intake, request_type=account_creation
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Filter, Hash, Loader2, RefreshCw, Search } from 'lucide-react';
import { api } from '../../lib/api';
import SmartTable, { type ColumnDef } from '../../components/SmartTable';
import Select from '../../components/ui/Select';
import PageHeader from '../../components/ui/PageHeader';

const STATUS_LABELS: Record<string, string> = {
  received: 'مُستلَم',
  in_review: 'قيد المراجعة',
  awaiting_customer_info: 'بانتظار الزبون',
  completed: 'مُعتمَد ومُفعَّل',
  rejected: 'مرفوض',
  cancelled: 'مُلغى',
};

const STATUS_COLORS: Record<string, string> = {
  received: 'bg-slate-100 text-slate-700',
  in_review: 'bg-blue-100 text-blue-700',
  awaiting_customer_info: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

export default function AccountRequestsListPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<{ status?: string; duplicate?: boolean; search?: string }>({});
  const [searchInput, setSearchInput] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.accountRequests.list({
        status: filters.status,
        duplicate: filters.duplicate || undefined,
        search: filters.search,
        limit: 200,
      });
      setItems(res.items);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const columns: ColumnDef<any>[] = [
    {
      key: 'public_ref_number',
      label: 'المرجع',
      sortable: true,
      width: 'w-36',
      getValue: (r) => r.public_ref_number ?? '',
      render: (r) => (
        <span className="font-mono text-xs text-blue-700">
          <Hash className="h-3 w-3 inline ml-1" />
          {r.public_ref_number}
        </span>
      ),
    },
    {
      key: 'full_name',
      label: 'الاسم',
      minWidth: '160px',
      getValue: (r) => r.full_name ?? '',
      render: (r) => <span className="text-sm text-slate-700">{r.full_name ?? '—'}</span>,
    },
    {
      key: 'primary_phone',
      label: 'رقم الموبايل',
      getValue: (r) => r.primary_phone ?? '',
      render: (r) => <span className="font-mono text-sm text-slate-700" dir="ltr">{r.primary_phone}</span>,
    },
    {
      key: 'governorate',
      label: 'المحافظة',
      render: (r) => <span className="text-sm text-slate-600">{r.governorate ?? '—'}</span>,
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
      key: 'flags',
      label: 'العلامات',
      render: (r) => (
        <div className="flex gap-1">
          {r.duplicate_flag && (
            <span className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded" title="مُكرَّر">د</span>
          )}
          {r.escalated_at && (
            <span className="text-xs px-1.5 py-0.5 bg-red-600 text-white rounded font-semibold" title="مُصعَّد">ص</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-7xl mx-auto p-4" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <PageHeader title="طلبات إنشاء الحساب" icon={<UserPlus className="h-6 w-6 text-blue-600" />} />
        <button
          onClick={load}
          className="text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded flex items-center gap-1"
        >
          <RefreshCw className="h-4 w-4" />
          تَحديث
        </button>
      </div>

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
        <label className="text-sm flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!filters.duplicate}
            onChange={(e) => setFilters((f) => ({ ...f, duplicate: e.target.checked }))}
          />
          مكرَّر فقط
        </label>
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
          title="قائمة الطلبات"
          icon={UserPlus}
          data={items}
          columns={columns}
          getId={(r) => r.id}
          hideFilterBar
          onRowClick={(r) => navigate(`/account-requests/${r.id}`)}
          emptyIcon={UserPlus}
          emptyMessage="لا توجد طلبات إنشاء حساب مطابقة."
          tableMinWidth={900}
        />
      )}
    </div>
  );
}
