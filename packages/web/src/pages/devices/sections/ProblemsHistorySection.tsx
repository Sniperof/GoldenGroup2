// ============================================================
// ProblemsHistorySection — diagnosed problems history per device.
// Source: service_request_problems WHERE installed_device_id = X.
// ============================================================
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2, Wrench } from 'lucide-react';
import { api } from '../../../lib/api';

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

  return (
    <section id="problems" className="bg-white rounded-2xl border border-slate-100 shadow-sm">
      <header className="flex items-center justify-between gap-3 p-5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Wrench className="w-5 h-5 text-rose-500" />
          <h2 className="text-lg font-bold text-slate-800">سجل أعطال الجهاز</h2>
          <span className="text-xs font-bold text-slate-400">({rows.length})</span>
        </div>
      </header>

      <div className="p-5">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-400">
            <AlertTriangle className="w-8 h-8 mb-2" />
            <p className="text-sm">لا أعطال مُسجَّلة على هذا الجهاز</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-bold text-slate-500 border-b border-slate-200">
                  <th className="text-right py-2 px-2">#</th>
                  <th className="text-right py-2 px-2">نوع العطل</th>
                  <th className="text-right py-2 px-2">التفاصيل</th>
                  <th className="text-right py-2 px-2">الحالة</th>
                  <th className="text-right py-2 px-2">طلب الصيانة</th>
                  <th className="text-right py-2 px-2">تاريخ الإبلاغ</th>
                  <th className="text-right py-2 px-2">مَن أصلح</th>
                  <th className="text-right py-2 px-2">تاريخ الحل</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const meta = STATUS_META[p.status] ?? STATUS_META.reported;
                  return (
                    <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                      <td className="py-2 px-2 font-mono text-xs text-slate-500">#{p.id}</td>
                      <td className="py-2 px-2 font-bold text-slate-800">
                        {p.problemTypeLabel ?? `نوع #${p.problemTypeId}`}
                        {p.addedDuringPhase === 'field_discovery' && (
                          <span className="mr-1 text-[9px] font-bold rounded-full border px-1.5 py-0.5 bg-violet-50 text-violet-700 border-violet-200">
                            ميدانياً
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-slate-600 max-w-[260px] truncate" title={p.details ?? ''}>
                        {p.details ?? '—'}
                      </td>
                      <td className="py-2 px-2">
                        <span className={`inline-flex items-center text-xs font-bold rounded-full border px-2 py-0.5 ${meta.cls}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="py-2 px-2">
                        {p.serviceRequestId ? (
                          <button
                            onClick={() => navigate(`/service-requests/${p.serviceRequestId}`)}
                            className="text-xs font-mono text-sky-700 hover:underline"
                          >
                            {p.serviceRequestRef ?? `#${p.serviceRequestId}`}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2 px-2 text-xs text-slate-500">{formatDate(p.createdAt)}</td>
                      <td className="py-2 px-2 text-slate-700">{p.repairedByEmployeeName ?? '—'}</td>
                      <td className="py-2 px-2 text-xs text-slate-500">{formatDate(p.resolvedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
