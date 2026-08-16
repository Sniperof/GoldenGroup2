import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, FileText, Loader2 } from '../../components/ui/icons';
import { api } from '../../lib/api';
import { REQUEST_STATUS_COLORS, requestStatusLabel } from '../../components/requests/RequestsListView';

const REQUEST_TYPE_LABELS: Record<string, string> = {
  name_nomination: 'طلب ترشيح أسماء',
  emergency_maintenance: 'طلب صيانة طارئة',
  water_check: 'طلب فحص مياه',
  periodic_maintenance: 'طلب صيانة دورية',
  golden_warranty: 'طلب كفالة ذهبية',
  device_request: 'طلب جهاز',
  agent_license: 'طلب ترخيص وكيل',
  account_creation: 'طلب إنشاء حساب',
};

const ROLE_LABELS: Record<string, string> = {
  requester: 'مقدم الطلب',
  beneficiary: 'المستفيد',
  referrer: 'الوسيط',
};

function detailPath(row: any): string {
  return row.requestType === 'account_creation'
    ? `/account-requests/${row.id}`
    : `/service-requests/${row.id}`;
}

export default function ServiceRequestsTab({ clientId }: { clientId: number }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.clients.listServiceRequests(clientId)
      .then((result) => {
        if (active) setRows(result.items ?? []);
      })
      .catch((err: any) => {
        if (active) {
          setRows([]);
          setError(err?.message ?? 'تعذر تحميل طلبات الزبون.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [clientId]);

  if (loading) {
    return <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-5 text-sm font-bold text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> جاري تحميل الطلبات...</div>;
  }
  if (error) {
    return <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-bold text-red-700"><AlertCircle className="h-4 w-4" /> {error}</div>;
  }
  if (rows.length === 0) {
    return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm font-bold text-slate-400">لا توجد طلبات ظاهرة مرتبطة بهذا الزبون.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <h3 className="flex items-center gap-2 text-base font-black text-slate-800"><FileText className="h-5 w-5 text-sky-600" /> طلبات الزبون</h3>
        <p className="mt-1 text-sm text-slate-500">كل طلب ظهر فيه الزبون كمقدم طلب أو مستفيد أو وسيط، ضمن صلاحيات العرض الحالية.</p>
      </div>
      {rows.map((row) => (
        <Link key={row.id} to={detailPath(row)} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-sky-300 hover:shadow-md">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span dir="ltr" className="font-mono text-sm font-bold text-sky-700">{row.publicRefNumber}</span>
                <span className="text-sm font-bold text-slate-800">{REQUEST_TYPE_LABELS[row.requestType] ?? row.requestType}</span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${REQUEST_STATUS_COLORS[row.status] ?? 'bg-slate-100 text-slate-600'}`}>
                  {requestStatusLabel(row.status, row.requestType)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(row.roles ?? []).map((role: string) => (
                  <span key={role} className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-bold text-violet-700">{ROLE_LABELS[role] ?? role}</span>
                ))}
              </div>
            </div>
            <div className="shrink-0 text-xs text-slate-500 sm:text-left">
              <div>{new Date(row.createdAt).toLocaleString('ar-SY')}</div>
              <div className="mt-1">المراجع: {row.reviewedByUserName ?? 'غير مُتولّى'}</div>
              {row.branchName && <div className="mt-1">الفرع: {row.branchName}</div>}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
