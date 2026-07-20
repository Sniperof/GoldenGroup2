// ============================================================
// AccountRequestDetailPage — review + decide on an account-creation request
// DEC-013 §2.5.4 — request data + suggested clients + comparison + decisions
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Loader2, UserCheck, AlertTriangle, XCircle, CheckCircle2 } from 'lucide-react';
import { api } from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import { usePermissions } from '../../hooks/usePermissions';

const STATUS_LABELS: Record<string, string> = {
  received: 'قيد المراجعة', in_review: 'قيد المعالجة', completed: 'مُعتمَد', rejected: 'مرفوض', cancelled: 'مُلغى',
};
const ACTIVE = ['received', 'in_review'];
const CONF_LABEL: Record<string, string> = { high: 'ثقة عالية', medium: 'ثقة متوسطة', low: 'ثقة منخفضة' };
const CONF_COLOR: Record<string, string> = {
  high: 'bg-green-100 text-green-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-slate-100 text-slate-600',
};

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm text-slate-800 text-left">{value ?? '—'}</span>
    </div>
  );
}

export default function AccountRequestDetailPage() {
  const { id } = useParams();
  const rid = Number(id);
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const canLink = hasPermission('account_requests.link');
  const canEscalate = hasPermission('account_requests.escalate');
  const canReject = hasPermission('account_requests.reject');

  const [data, setData] = useState<{ request: any; audit: any[] } | null>(null);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [detail, sug] = await Promise.all([
        api.accountRequests.get(rid),
        api.accountRequests.suggestions(rid).catch(() => ({ suggestions: [] })),
      ]);
      setData(detail);
      setSuggestions(sug.suggestions ?? []);
    } finally {
      setLoading(false);
    }
  }, [rid]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(fn: () => Promise<any>, okMsg: string) {
    setBusy(true);
    try {
      await fn();
      alert(okMsg);
      await load();
    } catch (e: any) {
      alert(e?.message ?? 'فشل تنفيذ الإجراء');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  if (!data) return <div className="p-6 text-slate-500">الطلب غير موجود.</div>;

  const r = data.request;
  const p = r.submitted_payload ?? {};
  const isActive = ACTIVE.includes(r.status);

  return (
    <div className="max-w-5xl mx-auto p-4" dir="rtl">
      <button onClick={() => navigate('/account-requests')} className="text-sm text-slate-500 hover:text-blue-600 flex items-center gap-1 mb-3">
        <ArrowRight className="h-4 w-4" /> رجوع للقائمة
      </button>

      <div className="flex items-center justify-between mb-4">
        <PageHeader title={`طلب ${r.public_ref_number}`} icon={<UserCheck className="h-6 w-6 text-blue-600" />} />
        <span className={`text-xs px-2.5 py-1 rounded ${r.status === 'completed' ? 'bg-green-100 text-green-700' : r.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
          {STATUS_LABELS[r.status] ?? r.status}
        </span>
      </div>

      {r.status === 'completed' && (
        <div className="bg-green-50 border border-green-200 rounded p-3 mb-4 text-sm text-green-800 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> تم اعتماد الربط وتفعيل الحساب — الزبون #{r.beneficiary_client_id}.
        </div>
      )}
      {r.status === 'rejected' && (
        <div className="bg-red-50 border border-red-200 rounded p-3 mb-4 text-sm text-red-800">
          مرفوض — السبب: {r.rejection_reason ?? '—'}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {/* Request data */}
        <div className="bg-white border border-slate-200 rounded p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">بيانات الطلب</h2>
          <Field label="الاسم الأول" value={p.first_name} />
          <Field label="الكنية" value={p.last_name} />
          <Field label="رقم الموبايل الرئيسي" value={<span dir="ltr" className="font-mono">{p.primary_mobile}</span>} />
          <Field label="رقم ثانوي" value={p.secondary_mobile ? <span dir="ltr" className="font-mono">{p.secondary_mobile}</span> : '—'} />
          <Field label="المحافظة" value={p.address_labels?.governorate ?? p.governorate} />
          <Field label="المنطقة" value={p.address_labels?.city_or_area ?? p.city_or_area} />
          <Field label="الناحية" value={p.address_labels?.sub_area ?? p.sub_area} />
          <Field label="الحي" value={p.address_labels?.neighborhood ?? p.neighborhood} />
          <Field label="العنوان التفصيلي" value={p.detailed_address} />
          <Field label="ملاحظات" value={p.notes} />
        </div>

        {/* Suggestions + comparison */}
        <div className="bg-white border border-slate-200 rounded p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">السجلات المقترحة (زبائن)</h2>
          {suggestions.length === 0 ? (
            <p className="text-sm text-slate-400 py-4">لا توجد سجلات مقترحة مطابقة.</p>
          ) : (
            <div className="space-y-2">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  className={`w-full text-right border rounded p-2.5 transition ${selected === s.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-800">{s.name} <span className="text-xs text-slate-400">#{s.id}</span></span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${CONF_COLOR[s.confidence] ?? ''}`}>{CONF_LABEL[s.confidence] ?? s.confidence}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-slate-500 font-mono" dir="ltr">{s.phone ?? '—'}</span>
                    <span className="text-xs text-slate-400">تطابق {Math.round((s.score ?? 0) * 100)}%</span>
                  </div>
                  {selected === s.id && (
                    <div className="mt-2 pt-2 border-t border-blue-100 text-xs text-slate-600 space-y-1">
                      <div className="flex justify-between"><span>الاسم</span><span className={s.name && p.first_name && s.name.includes(p.first_name) ? 'text-green-600' : 'text-slate-500'}>{s.name}</span></div>
                      <div className="flex justify-between"><span>الهاتف</span><span dir="ltr" className={s.phone === p.primary_mobile ? 'text-green-600 font-mono' : 'text-slate-500 font-mono'}>{s.phone}</span></div>
                      <div className="flex justify-between"><span>العنوان</span><span className="text-slate-500 truncate max-w-[180px]">{s.detailedAddress ?? '—'}</span></div>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Decisions */}
      {isActive && (
        <div className="bg-white border border-slate-200 rounded p-4 mt-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">القرارات</h2>
          <div className="flex flex-wrap gap-2">
            {canLink && (
              <button
                disabled={busy || selected == null}
                onClick={() => {
                  if (selected == null) return;
                  if (confirm(`اعتماد ربط الطلب بالزبون #${selected} وتفعيل الحساب؟`)) {
                    act(() => api.accountRequests.link(rid, selected), 'تم الربط والتفعيل');
                  }
                }}
                className="text-sm bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white px-4 py-2 rounded flex items-center gap-1.5"
              >
                <UserCheck className="h-4 w-4" /> اعتماد الربط{selected != null ? ` (#${selected})` : ''}
              </button>
            )}
            {canEscalate && (
              <button
                disabled={busy || r.escalated_at != null}
                onClick={() => {
                  const reason = prompt('سبب التصعيد إلى مشرف التدقيق:');
                  if (reason && reason.trim()) act(() => api.accountRequests.escalate(rid, reason.trim()), 'تم التصعيد');
                }}
                className="text-sm bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white px-4 py-2 rounded flex items-center gap-1.5"
              >
                <AlertTriangle className="h-4 w-4" /> {r.escalated_at ? 'مُصعَّد' : 'تصعيد'}
              </button>
            )}
            {canReject && (
              <button
                disabled={busy}
                onClick={() => {
                  const reason = prompt('سبب الرفض (مدقّق الحسابات فقط):');
                  if (reason && reason.trim()) act(() => api.accountRequests.reject(rid, reason.trim()), 'تم رفض الطلب');
                }}
                className="text-sm bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white px-4 py-2 rounded flex items-center gap-1.5"
              >
                <XCircle className="h-4 w-4" /> رفض
              </button>
            )}
          </div>
          {selected == null && canLink && <p className="text-xs text-slate-400 mt-2">اختر سجلاً مقترحاً أولاً لاعتماد الربط.</p>}
        </div>
      )}

      {/* Audit */}
      <div className="bg-white border border-slate-200 rounded p-4 mt-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-2">سجل التدقيق</h2>
        <div className="space-y-1">
          {data.audit.map((a, i) => (
            <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-slate-50 last:border-0">
              <span className="text-slate-700">{a.event_type}</span>
              <span className="text-slate-400" dir="ltr">{new Date(a.created_at).toLocaleString('ar')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
