// ============================================================
// ServiceRequestsListPage — central intake dashboard
// Constitution: maintenance.md §٠.١٦ (GLOBAL view) + §٠.٤.أ (claim ownership)
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Filter, Hash, Loader2, Plus, RefreshCw, User } from 'lucide-react';
import { api } from '../../lib/api';
import Select from '../../components/ui/Select';
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
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.serviceRequests.list({
        status: filters.status,
        channel: filters.channel,
        mine: filters.mine || undefined,
        reviewRequired: filters.reviewRequired || undefined,
        duplicateOnly: filters.duplicateOnly || undefined,
        archived: filters.archived,
        limit: LIMIT,
        offset,
      });
      setItems(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [filters, offset]);

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

  return (
    <div className="max-w-7xl mx-auto p-4" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-blue-600" />
          طلبات الصيانة
        </h1>
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

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded p-3 mb-4 flex items-center gap-3 flex-wrap">
        <Filter className="h-4 w-4 text-slate-500" />
        <Select
          value={filters.status ?? ''}
          onChange={(v) => {
            setOffset(0);
            setFilters((f) => ({ ...f, status: v || undefined }));
          }}
          size="sm"
          ariaLabel="الحالة"
          options={[
            { value: '', label: 'كل الحالات' },
            ...Object.entries(STATUS_LABELS).map(([k, v]) => ({ value: k, label: v })),
          ]}
        />
        <Select
          value={filters.channel ?? ''}
          onChange={(v) => {
            setOffset(0);
            setFilters((f) => ({ ...f, channel: v || undefined }));
          }}
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
            onChange={(e) => {
              setOffset(0);
              setFilters((f) => ({ ...f, mine: e.target.checked }));
            }}
          />
          طلباتي
        </label>
        <label className="text-sm flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!filters.reviewRequired}
            onChange={(e) => {
              setOffset(0);
              setFilters((f) => ({ ...f, reviewRequired: e.target.checked }));
            }}
          />
          يَحتاج مراجعة مدقّق
        </label>
        <label className="text-sm flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!filters.duplicateOnly}
            onChange={(e) => {
              setOffset(0);
              setFilters((f) => ({ ...f, duplicateOnly: e.target.checked }));
            }}
          />
          مكرَّر فقط
        </label>
        <Select<'true' | 'false' | 'all'>
          value={filters.archived ?? 'false'}
          onChange={(v) => {
            setOffset(0);
            setFilters((f) => ({ ...f, archived: v }));
          }}
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
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-right p-2 font-medium">المرجع</th>
              <th className="text-right p-2 font-medium">القناة</th>
              <th className="text-right p-2 font-medium">صاحب الطلب</th>
              <th className="text-right p-2 font-medium">المشكلة</th>
              <th className="text-right p-2 font-medium">الحالة</th>
              <th className="text-right p-2 font-medium">المُتولّي</th>
              <th className="text-right p-2 font-medium">العلامات</th>
              <th className="text-right p-2 font-medium">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center p-6 text-slate-400">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center p-6 text-slate-500">
                  لا توجد طلبات مطابقة.
                </td>
              </tr>
            ) : (
              items.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-slate-100 hover:bg-blue-50 cursor-pointer"
                  onClick={() => navigate(`/service-requests/${r.id}`)}
                >
                  <td className="p-2 font-mono text-xs text-blue-700">
                    <Hash className="h-3 w-3 inline ml-1" />
                    {r.publicRefNumber}
                  </td>
                  <td className="p-2">{CHANNEL_LABELS[r.channel] ?? r.channel}</td>
                  <td className="p-2">
                    {r.requesterExternal?.name ?? (r.beneficiaryClientId ? `عميل #${r.beneficiaryClientId}` : '—')}
                  </td>
                  <td className="p-2 max-w-xs truncate">{r.problemDescription}</td>
                  <td className="p-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[r.status]}`}>
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="p-2 text-xs">
                    {r.reviewedByUserId ? (
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {r.reviewedByUserId === user?.id ? 'أنا' : `#${r.reviewedByUserId}`}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      {r.duplicateFlag && (
                        <span className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">د</span>
                      )}
                      {r.reviewRequiredFlag && (
                        <span className="text-xs px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded">م</span>
                      )}
                      {r.archivedAt && (
                        <span className="text-xs px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded">أ</span>
                      )}
                    </div>
                  </td>
                  <td className="p-2">
                    {canReview && r.status === 'received' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          quickClaim(r.id);
                        }}
                        className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded"
                      >
                        تَولّي
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-3 text-sm text-slate-600">
        <div>
          {total} طلب — يَعرض {Math.min(offset + 1, total)}–{Math.min(offset + LIMIT, total)}
        </div>
        <div className="flex gap-1">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            className="px-2 py-1 border rounded disabled:opacity-50"
          >
            السابق
          </button>
          <button
            disabled={offset + LIMIT >= total}
            onClick={() => setOffset(offset + LIMIT)}
            className="px-2 py-1 border rounded disabled:opacity-50"
          >
            التالي
          </button>
        </div>
      </div>
    </div>
  );
}
