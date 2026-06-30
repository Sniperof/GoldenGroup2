// ============================================================
// ProblemsHistorySection — diagnosed problems history per device.
// Source: service_request_problems WHERE installed_device_id = X.
// ============================================================
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2, Wrench } from 'lucide-react';
import { api } from '../../../lib/api';
import SmartTable, { type ColumnDef } from '../../../components/SmartTable';

const STATUS_META: Record<string, { label: string; cls: string }> = {
  reported: { label: 'مُبلَّغ', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  confirmed: { label: 'مُؤكَّد', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  resolved_at_intake: { label: 'حُلَّ في الاستلام', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  resolved: { label: 'حُلَّ', cls: 'bg-green-50 text-green-700 border-green-200' },
  deferred: { label: 'مُؤجَّل', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  unresolvable_field: { label: 'غير قابل ميدانياً', cls: 'bg-red-50 text-red-700 border-red-200' },
  cancelled: { label: 'مُلغى', cls: 'bg-slate-200 text-slate-500 border-slate-300' },
};

function formatDate(d?: string | null) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('ar-SY', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

export function ProblemsHistorySection({ deviceId }: { deviceId: number }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.installedDevices
      .problems(deviceId)
      .then((data) => {
        if (!cancelled) setRows(data ?? []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  // Columns mirror the original raw table 1:1 (design-only migration to <SmartTable>).
  const columns: ColumnDef<any>[] = [
    { key: 'id', label: '#', render: p => <span className="font-mono text-xs text-slate-500">#{p.id}</span> },
    {
      key: 'problemTypeLabel', label: 'نوع العطل',
      render: p => (
        <span className="text-sm font-bold text-slate-800">
          {p.problemTypeLabel ?? `نوع #${p.problemTypeId}`}
          {p.addedDuringPhase === 'field_discovery' && (
            <span className="mr-1 text-xs font-bold rounded-full border px-1.5 py-0.5 bg-violet-50 text-violet-700 border-violet-200">
              ميدانياً
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'details', label: 'التفاصيل',
      render: p => <span className="block text-sm text-slate-600 max-w-[260px] truncate" title={p.details ?? ''}>{p.details ?? '—'}</span>,
    },
    {
      key: 'status', label: 'الحالة',
      render: p => {
        const meta = STATUS_META[p.status] ?? STATUS_META.reported;
        return <span className={`inline-flex items-center text-xs font-bold rounded-full border px-2 py-0.5 ${meta.cls}`}>{meta.label}</span>;
      },
    },
    {
      key: 'serviceRequestId', label: 'طلب الصيانة',
      render: p => p.serviceRequestId ? (
        <button
          onClick={(e) => { e.stopPropagation(); navigate(`/service-requests/${p.serviceRequestId}`); }}
          className="text-xs font-mono text-sky-700 hover:underline"
        >
          {p.serviceRequestRef ?? `#${p.serviceRequestId}`}
        </button>
      ) : <span className="text-sm text-slate-500">—</span>,
    },
    { key: 'createdAt', label: 'تاريخ الإبلاغ', render: p => <span className="text-xs text-slate-500">{formatDate(p.createdAt)}</span> },
    { key: 'repairedByEmployeeName', label: 'مَن أصلح', render: p => <span className="text-sm text-slate-700">{p.repairedByEmployeeName ?? '—'}</span> },
    { key: 'resolvedAt', label: 'تاريخ الحل', render: p => <span className="text-xs text-slate-500">{formatDate(p.resolvedAt)}</span> },
  ];

  return (
    <section id="problems" className="scroll-mt-24">
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <SmartTable<any>
          title="سجل أعطال الجهاز"
          subtitle={`${rows.length} عطل`}
          icon={Wrench}
          data={rows}
          columns={columns}
          getId={p => p.id}
          hideFilterBar
          tableMinWidth={1100}
          emptyIcon={AlertTriangle}
          emptyMessage="لا أعطال مُسجَّلة على هذا الجهاز"
        />
      )}
    </section>
  );
}
