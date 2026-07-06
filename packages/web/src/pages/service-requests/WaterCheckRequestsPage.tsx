import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Beaker, Hash, MapPin, Phone, RefreshCw, Send, User } from 'lucide-react';
import { api } from '../../lib/api';
import SmartTable, { type ColumnDef } from '../../components/SmartTable';
import PageHeader from '../../components/ui/PageHeader';

const STATUS_LABELS: Record<string, string> = {
  received: 'مستلم',
  in_review: 'قيد المراجعة',
  awaiting_customer_info: 'بانتظار الزبون',
  resolved_at_intake: 'محلول في الاستلام',
  rejected: 'مرفوض',
  promoted: 'تم تحويله',
  cancelled: 'ملغى',
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

const BRANCH_RESOLUTION_LABELS: Record<string, string> = {
  resolved: 'تم ربط الفرع',
  ambiguous: 'أكثر من فرع',
  no_coverage: 'خارج التغطية',
  missing_geo: 'موقع ناقص',
  not_applicable: 'غير مطبق',
};

const BRANCH_RESOLUTION_COLORS: Record<string, string> = {
  resolved: 'bg-emerald-100 text-emerald-700',
  ambiguous: 'bg-amber-100 text-amber-700',
  no_coverage: 'bg-red-100 text-red-700',
  missing_geo: 'bg-slate-100 text-slate-600',
  not_applicable: 'bg-slate-100 text-slate-600',
};

function formatDate(value?: string | null): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ar-SY', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getAddress(row: any): string {
  const address = row.serviceAddress ?? {};
  return address.detailedAddress ?? address.detailed_address ?? '-';
}

export default function WaterCheckRequestsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.serviceRequests.list({
        requestType: 'water_check',
        archived: 'false',
        limit: 1000,
      });
      setItems(res.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: ColumnDef<any>[] = [
    {
      key: 'publicRefNumber',
      label: 'المرجع',
      sortable: true,
      width: 'w-32',
      getValue: (r) => r.publicRefNumber ?? '',
      render: (r) => (
        <span className="inline-flex items-center gap-1 font-mono text-xs text-sky-700" dir="ltr">
          <Hash className="h-3 w-3" />
          {r.publicRefNumber}
        </span>
      ),
    },
    {
      key: 'requester',
      label: 'صاحب الطلب',
      minWidth: '190px',
      getValue: (r) => r.requesterExternal?.name ?? '',
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
          <User className="h-4 w-4 text-slate-400" />
          {r.requesterExternal?.name ?? '-'}
        </span>
      ),
    },
    {
      key: 'phone',
      label: 'الهاتف',
      minWidth: '140px',
      getValue: (r) => r.requesterExternal?.primary_phone ?? '',
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 text-sm text-slate-700" dir="ltr">
          <Phone className="h-4 w-4 text-slate-400" />
          {r.requesterExternal?.primary_phone ?? '-'}
        </span>
      ),
    },
    {
      key: 'address',
      label: 'العنوان',
      minWidth: '260px',
      getValue: getAddress,
      render: (r) => (
        <span className="block max-w-[320px] truncate text-sm text-slate-600">
          <MapPin className="ml-1 inline h-4 w-4 text-slate-400" />
          {getAddress(r)}
        </span>
      ),
    },
    {
      key: 'branchResolutionStatus',
      label: 'ربط الفرع',
      sortable: true,
      getValue: (r) => r.branchResolutionLabel ?? BRANCH_RESOLUTION_LABELS[r.branchResolutionStatus] ?? r.branchResolutionStatus ?? '',
      render: (r) => {
        const status = r.branchResolutionStatus ?? 'not_applicable';
        return (
          <div className="flex flex-col gap-1">
            <span className={`w-fit rounded px-2 py-0.5 text-xs ${BRANCH_RESOLUTION_COLORS[status] ?? 'bg-slate-100 text-slate-600'}`}>
              {r.branchResolutionLabel ?? BRANCH_RESOLUTION_LABELS[status] ?? status}
            </span>
            {r.branchName ? <span className="text-xs text-slate-500">{r.branchName}</span> : null}
          </div>
        );
      },
    },
    {
      key: 'status',
      label: 'حالة الطلب',
      sortable: true,
      getValue: (r) => r.statusLabel ?? STATUS_LABELS[r.status] ?? r.status ?? '',
      render: (r) => (
        <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COLORS[r.status] ?? 'bg-slate-100 text-slate-600'}`}>
          {r.statusLabel ?? STATUS_LABELS[r.status] ?? r.status}
        </span>
      ),
    },
    {
      key: 'reviewRequiredFlag',
      label: 'مراجعة',
      render: (r) =>
        r.reviewRequiredFlag ? (
          <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" />
            نعم
          </span>
        ) : (
          <span className="text-xs text-slate-400">-</span>
        ),
    },
    {
      key: 'createdAt',
      label: 'تاريخ الاستلام',
      sortable: true,
      getValue: (r) => r.createdAt ?? '',
      render: (r) => <span className="text-xs text-slate-500">{formatDate(r.createdAt)}</span>,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl p-4" dir="rtl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="طلبات فحص المياه"
          icon={<Beaker className="h-6 w-6 text-sky-600" />}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            تحديث
          </button>
          <button
            type="button"
            onClick={() => navigate('/service-requests/water-check/simulator')}
            className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
          >
            <Send className="h-4 w-4" />
            محاكاة إرسال
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <RefreshCw className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <SmartTable
          title="جدول استقبال طلبات فحص المياه"
          icon={Beaker}
          data={items}
          columns={columns}
          getId={(r) => r.id}
          hideFilterBar
          onRowClick={(r) => navigate(`/service-requests/${r.id}`)}
          emptyIcon={Beaker}
          emptyMessage="لا توجد طلبات فحص مياه مستلمة."
          tableMinWidth={1050}
        />
      )}
    </div>
  );
}
